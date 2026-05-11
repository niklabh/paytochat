import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { verifyPayment } from "@/lib/payments/verify";
import { getEscrowAddress } from "@/lib/payments/escrow";
import { sanitizeMessageHtml } from "@/lib/rich-text.server";
import { sendNewMessageEmail } from "@/lib/email/sendgrid";
import {
  Timestamp,
  FieldValue,
} from "firebase-admin/firestore";
import type {
  Chain,
  ConversationDoc,
  MessageStatus,
  ThreadDoc,
  Token,
  UserDoc,
} from "@/lib/types";

export const runtime = "nodejs";

const MAX_PLAIN_LENGTH = 2000;
/** Generous ceiling for the raw HTML — leaves room for tags + image URLs. */
const MAX_HTML_LENGTH = 50_000;

const Body = z.object({
  recipientHandle: z.string().min(3).max(24),
  body: z.string().min(1).max(MAX_HTML_LENGTH),
  chain: z.enum(["ethereum", "solana"]).optional(),
  token: z.enum(["USDC", "USDT", "USDG"]).optional(),
  txHash: z.string().optional(),
  amountUSD: z.number().nonnegative().optional(),
  fromAddress: z.string().optional(),
  /** EVM escrow flow only. 0x-prefixed bytes32. */
  paymentId: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  /** Numeric chainId for the EVM chain that holds the escrow deposit. */
  evmChainId: z.number().int().positive().optional(),
  /** Sender claims a free reply inside an active thread. */
  free: z.boolean().optional(),
  /**
   * Required when `free === true`: id of the thread the reply belongs
   * to (== the anchor paid message id). Used to scope free replies and
   * to validate the cool-off window server-side.
   */
  threadId: z.string().min(1).optional(),
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

  // Free replies must name the thread they belong to. Threads are
  // per paid message (the doc id is the anchor message id), so the
  // client tells us which thread it's replying inside.
  let thread: ThreadDoc | null = null;
  let threadRef: FirebaseFirestore.DocumentReference | null = null;
  if (payload.free === true) {
    if (!payload.threadId) {
      return NextResponse.json(
        { error: "threadId is required for free in-thread replies." },
        { status: 400 },
      );
    }
    threadRef = db.collection("threads").doc(payload.threadId);
    const threadSnap = await threadRef.get();
    if (!threadSnap.exists) {
      return NextResponse.json(
        { error: "Thread not found. Claim the paid message first." },
        { status: 404 },
      );
    }
    thread = threadSnap.data() as ThreadDoc;
    if (
      !thread.participants.includes(senderUid) ||
      !thread.participants.includes(recipient.uid)
    ) {
      return NextResponse.json(
        { error: "You aren't a participant of this thread." },
        { status: 403 },
      );
    }
  }

  const nowMs = Date.now();
  const threadExpiresAtMs = thread?.expiresAt
    ? typeof thread.expiresAt === "number"
      ? thread.expiresAt
      : (thread.expiresAt as Timestamp).toMillis()
    : 0;
  const threadActive = !!thread && threadExpiresAtMs > nowMs;

  // Free replies are only allowed inside the (still-active) post-claim
  // thread window. Outside that window, the client must send a fresh
  // paid message which will eventually open a new thread on claim.
  const isFreeMessage = payload.free === true && threadActive;
  if (payload.free === true && !threadActive) {
    return NextResponse.json(
      { error: "This thread has closed. Send a new paid message to reopen it." },
      { status: 400 },
    );
  }
  let status: MessageStatus = "pending";
  let amountUSD = 0;
  let chain: Chain | undefined;
  let token: Token | undefined;
  let txHash: string | undefined;
  let fromAddress: string | undefined;
  let toAddress: string | undefined;
  let paymentId: string | undefined;
  let escrowAddress: string | undefined;
  let escrowChainId: number | undefined;
  let escrowDeadline: number | undefined;

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

    // For EVM, resolve and validate the server-trusted escrow address.
    // The client tells us which chain it deposited to, but we resolve the
    // escrow address from server-only env vars and never trust the client.
    if (payload.chain === "ethereum") {
      if (!payload.evmChainId) {
        return NextResponse.json(
          { error: "evmChainId is required for the Ethereum escrow flow." },
          { status: 400 },
        );
      }
      if (!payload.paymentId) {
        return NextResponse.json(
          { error: "paymentId is required for the Ethereum escrow flow." },
          { status: 400 },
        );
      }
      const escrow = getEscrowAddress(payload.evmChainId);
      if (!escrow) {
        return NextResponse.json(
          {
            error:
              `No PayToChatEscrow configured server-side for chain ${payload.evmChainId}. ` +
              `Set ESCROW_ADDRESS_${payload.evmChainId} or NEXT_PUBLIC_ESCROW_ADDRESS_${payload.evmChainId}.`,
          },
          { status: 500 },
        );
      }
      escrowAddress = escrow;
      escrowChainId = payload.evmChainId;
      paymentId = payload.paymentId;
    }

    const verify = await verifyPayment({
      chain: payload.chain,
      token: payload.token,
      txHash: payload.txHash,
      expectedTo: recipAddress,
      expectedFrom: payload.fromAddress,
      minAmountUSD: payload.amountUSD,
      paymentId: payload.paymentId,
      evmChainId: payload.evmChainId,
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
    escrowDeadline = verify.escrowDeadline;
  }

  // Use a deterministic doc ID for paid messages so duplicate-tx attempts
  // collide on a single document and are caught atomically by the tx.get()
  // guard below. For escrow deposits we use `evm-<chainId>-<paymentId>` so
  // the same paymentId on different chains is allowed (different escrow
  // contracts). Solana keeps `txHash` directly. Free messages keep an
  // auto-generated ID.
  let messageRef;
  if (status === "paid") {
    if (paymentId && escrowChainId) {
      messageRef = db.collection("messages").doc(`evm-${escrowChainId}-${paymentId}`);
    } else if (txHash) {
      messageRef = db.collection("messages").doc(txHash);
    } else {
      messageRef = db.collection("messages").doc();
    }
  } else {
    messageRef = db.collection("messages").doc();
  }
  const message = {
    id: messageRef.id,
    conversationId: convId,
    // Free replies inherit the thread's id (which is the anchor paid
    // message's id). Paid messages get their threadId stamped on later
    // by /api/messages/claim, so it stays null until a claim happens.
    threadId: status === "free" ? payload.threadId ?? null : null,
    // Sorted [senderId, recipientId] so the thread page can do
    // `where("participants", "array-contains", uid)` and have Firestore
    // rules engine accept the query.
    participants: [senderUid, recipient.uid].sort(),
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
    paymentId: paymentId ?? null,
    escrowAddress: escrowAddress ?? null,
    escrowChainId: escrowChainId ?? null,
    escrowDeadline: escrowDeadline ?? null,
    status,
    createdAt: FieldValue.serverTimestamp(),
    paidAt: status === "paid" ? FieldValue.serverTimestamp() : null,
    openedAt: null,
    claimedAt: null,
    claimTxHash: null,
    refundedAt: null,
    refundTxHash: null,
  };

  // Conversation update. We deliberately do NOT touch `totalPaidUSD`
  // here — that aggregate is only incremented on a successful on-chain
  // claim (see /api/messages/claim), which is what the user actually
  // received. Same goes for `users.stats.totalEarnedUSD`.
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
    lastMessagePreview:
      status === "paid" ? "paid message" : bodyPlain.slice(0, 80),
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

      // Bump the "messages received" counter on every paid send (this
      // is a delivery count, not a money count, so it stays here).
      if (status === "paid") {
        tx.update(db.collection("users").doc(recipient.uid), {
          "stats.messagesReceived": FieldValue.increment(1),
        });
      }

      // For free in-thread replies, bump the thread's reply counter
      // and refresh the list-ordering / preview fields.
      if (status === "free" && thread && threadRef) {
        tx.update(threadRef, {
          freeReplyCount: FieldValue.increment(1),
          lastMessageAt: Date.now(),
          lastMessagePreview: bodyPlain.slice(0, 80),
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

  // Best-effort: email the recipient on paid messages only. Free replies
  // (cool-off chatter) never trigger emails — that's a spam vector and
  // the recipient is presumably already engaged in the thread.
  if (status === "paid") {
    void notifyRecipientByEmail({
      recipient,
      sender,
      amountUSD,
    });
  }

  return NextResponse.json({
    ok: true,
    messageId: messageRef.id,
    status,
    amountUSD,
  });
}

/**
 * Fire-and-forget paid-message email notification. Honours the user's
 * `emailNotifications` toggle and `notifyThresholdUSD`. The email itself
 * does NOT include the message body or the tip amount — the recipient has
 * to open the inbox to learn either, which keeps the "amount stays hidden
 * until you reveal" promise even when the notification is intercepted
 * (e.g. shoulder-surfed on a lock-screen preview).
 */
async function notifyRecipientByEmail(args: {
  recipient: UserDoc;
  sender: UserDoc;
  amountUSD: number;
}): Promise<void> {
  try {
    const { recipient, sender, amountUSD } = args;

    if (recipient.settings?.emailNotifications === false) return;

    const notifyThreshold = recipient.settings?.notifyThresholdUSD ?? 0;
    if (amountUSD < notifyThreshold) return;

    const authUser = await adminAuth().getUser(recipient.uid);
    const toEmail = authUser.email;
    if (!toEmail || authUser.disabled) return;

    await sendNewMessageEmail({
      toEmail,
      recipientHandle: recipient.handle,
      recipientDisplayName: recipient.displayName,
      senderHandle: sender.handle,
      senderDisplayName: sender.displayName,
    });
  } catch (err) {
    console.error("[notifyRecipientByEmail] failed", err);
  }
}
