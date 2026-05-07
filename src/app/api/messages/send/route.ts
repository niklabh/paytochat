import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { verifyPayment } from "@/lib/payments/verify";
import { sanitizeMessageHtml } from "@/lib/rich-text.server";
import { sendNewMessageEmail } from "@/lib/email/sendgrid";
import {
  Timestamp,
  FieldValue,
} from "firebase-admin/firestore";
import type { Chain, ConversationDoc, MessageStatus, Token, UserDoc } from "@/lib/types";

export const runtime = "nodejs";

const MAX_PLAIN_LENGTH = 2000;
/** Generous ceiling for the raw HTML — leaves room for tags + image URLs. */
const MAX_HTML_LENGTH = 50_000;

const Body = z.object({
  recipientHandle: z.string().min(3).max(24),
  body: z.string().min(1).max(MAX_HTML_LENGTH),
  chain: z.enum(["ethereum", "solana"]).optional(),
  token: z.enum(["USDC", "USDT"]).optional(),
  txHash: z.string().optional(),
  amountUSD: z.number().nonnegative().optional(),
  fromAddress: z.string().optional(),
  /** When the sender wants to claim a free message during cool-off / free chat. */
  free: z.boolean().optional(),
});

function conversationId(a: string, b: string) {
  return [a, b].sort().join("_");
}

class DuplicateTxError extends Error {
  constructor() {
    super("Transaction has already been used for another message.");
    this.name = "DuplicateTxError";
  }
}

export async function POST(req: Request) {
  let payload: z.infer<typeof Body>;
  try {
    payload = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { html: sanitizedBody, plainText: bodyPlain } = sanitizeMessageHtml(
    payload.body
  );
  if (!bodyPlain) {
    return NextResponse.json(
      { error: "Message is empty after sanitization." },
      { status: 400 }
    );
  }
  if (bodyPlain.length > MAX_PLAIN_LENGTH) {
    return NextResponse.json(
      { error: `Message is too long (max ${MAX_PLAIN_LENGTH} characters).` },
      { status: 400 }
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }

  let senderUid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    senderUid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Invalid auth token." }, { status: 401 });
  }

  const db = adminDb();

  // Recipient lookup
  const recipQuery = await db
    .collection("users")
    .where("handleLower", "==", payload.recipientHandle.toLowerCase())
    .limit(1)
    .get();
  if (recipQuery.empty) {
    return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
  }
  const recipientSnap = recipQuery.docs[0];
  const recipient = recipientSnap.data() as UserDoc;
  if (recipient.uid === senderUid) {
    return NextResponse.json({ error: "You can't send to yourself." }, { status: 400 });
  }

  // Sender profile (for handle/displayName)
  const senderSnap = await db.collection("users").doc(senderUid).get();
  if (!senderSnap.exists) {
    return NextResponse.json({ error: "Sender profile not found." }, { status: 404 });
  }
  const sender = senderSnap.data() as UserDoc;

  const convId = conversationId(senderUid, recipient.uid);
  const convRef = db.collection("conversations").doc(convId);
  const convSnap = await convRef.get();
  const conv = convSnap.exists ? (convSnap.data() as ConversationDoc) : null;

  const nowMs = Date.now();
  const inCoolOff =
    conv?.coolOffUntil &&
    (typeof conv.coolOffUntil === "number"
      ? conv.coolOffUntil > nowMs
      : (conv.coolOffUntil as Timestamp).toMillis() > nowMs);
  const isFreeChat = conv?.isFree === true;

  const isFreeMessage = payload.free === true && (inCoolOff || isFreeChat);
  let status: MessageStatus = "pending";
  let amountUSD = 0;
  let chain: Chain | undefined;
  let token: Token | undefined;
  let txHash: string | undefined;
  let fromAddress: string | undefined;
  let toAddress: string | undefined;

  if (isFreeMessage) {
    status = "free";
  } else {
    if (!payload.chain || !payload.token || !payload.txHash || !payload.amountUSD) {
      return NextResponse.json(
        { error: "Payment required. Provide chain, token, txHash and amountUSD." },
        { status: 402 }
      );
    }

    if (!recipient.settings.acceptedChains.includes(payload.chain)) {
      return NextResponse.json(
        { error: `${recipient.handle} doesn't accept payments on ${payload.chain}.` },
        { status: 400 }
      );
    }
    if (!recipient.settings.acceptedTokens.includes(payload.token)) {
      return NextResponse.json(
        { error: `${recipient.handle} doesn't accept ${payload.token}.` },
        { status: 400 }
      );
    }

    const recipAddress =
      payload.chain === "ethereum"
        ? recipient.wallets.ethereum
        : recipient.wallets.solana;
    if (!recipAddress) {
      return NextResponse.json(
        { error: `${recipient.handle} hasn't configured a ${payload.chain} wallet yet.` },
        { status: 400 }
      );
    }

    if (payload.amountUSD < recipient.settings.minThresholdUSD) {
      return NextResponse.json(
        {
          error: `Minimum tip for @${recipient.handle} is ${recipient.settings.minThresholdUSD} USD.`,
        },
        { status: 400 }
      );
    }

    const verify = await verifyPayment({
      chain: payload.chain,
      token: payload.token,
      txHash: payload.txHash,
      expectedTo: recipAddress,
      expectedFrom: payload.fromAddress,
      minAmountUSD: payload.amountUSD,
    });
    if (!verify.ok) {
      return NextResponse.json({ error: verify.error || "Payment not verified." }, { status: 402 });
    }
    status = "paid";
    amountUSD = verify.amountUSD ?? payload.amountUSD;
    chain = payload.chain;
    token = payload.token;
    txHash = payload.txHash;
    fromAddress = verify.fromAddress;
    toAddress = verify.toAddress || recipAddress;
  }

  // Use the txHash as the message doc ID for paid messages so duplicate-tx
  // attempts collide on a single document and are caught atomically by the
  // tx.get() guard below. Free messages keep an auto-generated ID.
  const messageRef =
    status === "paid" && txHash
      ? db.collection("messages").doc(txHash)
      : db.collection("messages").doc();
  const message = {
    id: messageRef.id,
    conversationId: convId,
    senderId: senderUid,
    senderHandle: sender.handle,
    senderDisplayName: sender.displayName,
    senderAvatarUrl: sender.avatarUrl || "",
    recipientId: recipient.uid,
    recipientHandle: recipient.handle,
    body: sanitizedBody,
    bodyPlain,
    amountUSD,
    chain: chain ?? null,
    token: token ?? null,
    txHash: txHash ?? null,
    fromAddress: fromAddress ?? null,
    toAddress: toAddress ?? null,
    status,
    createdAt: FieldValue.serverTimestamp(),
    paidAt: status === "paid" ? FieldValue.serverTimestamp() : null,
    openedAt: null,
  };

  // Conversation update
  const updatedUnread = {
    ...(conv?.unreadCount || {}),
    [recipient.uid]:
      (conv?.unreadCount?.[recipient.uid] || 0) + 1,
  };

  const convUpdate: Record<string, unknown> = {
    id: convId,
    participants: [senderUid, recipient.uid].sort(),
    participantHandles: [sender.handle, recipient.handle].sort(),
    lastMessageAt: FieldValue.serverTimestamp(),
    lastMessagePreview: status === "paid" ? "paid message" : bodyPlain.slice(0, 80),
    isFree: conv?.isFree ?? false,
    coolOffUntil: conv?.coolOffUntil ?? null,
    totalPaidUSD: (conv?.totalPaidUSD || 0) + amountUSD,
    unreadCount: updatedUnread,
  };

  try {
    await db.runTransaction(async (tx) => {
      // Reads first (Admin SDK requires reads-before-writes). For paid
      // messages, this also locks the message doc on its txHash-derived ID,
      // so two concurrent sends with the same txHash cannot both commit.
      if (status === "paid") {
        const existing = await tx.get(messageRef);
        if (existing.exists) {
          throw new DuplicateTxError();
        }
      }

      tx.set(messageRef, message);
      tx.set(convRef, convUpdate, { merge: true });
      if (status === "paid") {
        tx.update(db.collection("users").doc(recipient.uid), {
          "stats.totalEarnedUSD": FieldValue.increment(amountUSD),
          "stats.messagesReceived": FieldValue.increment(1),
        });
      }
    });
  } catch (err) {
    if (err instanceof DuplicateTxError) {
      return NextResponse.json(
        { error: "This transaction has already been used for another message." },
        { status: 409 }
      );
    }
    throw err;
  }

  // Best-effort: email the recipient. Never block the response on this.
  void notifyRecipientByEmail({
    recipient,
    sender,
    amountUSD,
    isFree: status === "free",
    preview: bodyPlain,
  });

  return NextResponse.json({
    ok: true,
    messageId: messageRef.id,
    status,
    amountUSD,
  });
}

/**
 * Fire-and-forget recipient email notification. Honours the user's
 * `emailNotifications` toggle and `notifyThresholdUSD` (paid messages only).
 * Errors are swallowed and logged; this must never break the send flow.
 */
async function notifyRecipientByEmail(args: {
  recipient: UserDoc;
  sender: UserDoc;
  amountUSD: number;
  isFree: boolean;
  preview: string;
}): Promise<void> {
  try {
    const { recipient, sender, amountUSD, isFree, preview } = args;

    if (recipient.settings?.emailNotifications === false) return;

    // For paid messages, only ping when the tip clears the user's threshold.
    // Free / cool-off messages always notify (subject to the master toggle).
    const notifyThreshold = recipient.settings?.notifyThresholdUSD ?? 0;
    if (!isFree && amountUSD < notifyThreshold) return;

    const authUser = await adminAuth().getUser(recipient.uid);
    const toEmail = authUser.email;
    if (!toEmail || authUser.disabled) return;

    await sendNewMessageEmail({
      toEmail,
      recipientHandle: recipient.handle,
      recipientDisplayName: recipient.displayName,
      senderHandle: sender.handle,
      senderDisplayName: sender.displayName,
      preview,
      amountUSD,
      isFree,
    });
  } catch (err) {
    console.error("[notifyRecipientByEmail] failed", err);
  }
}
