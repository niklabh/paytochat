import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { verifyEvmClaim } from "@/lib/payments/verify";
import type { MessageDoc, ThreadDoc, UserDoc } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({
  messageId: z.string().min(1),
  /** The recipient's claim() tx hash on the same chain as escrowChainId. */
  claimTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export async function POST(req: Request) {
  let payload: z.infer<typeof Body>;
  try {
    payload = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
  }
  let uid: string;
  try {
    uid = (await adminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "Invalid auth token." }, { status: 401 });
  }

  const db = adminDb();
  const ref = db.collection("messages").doc(payload.messageId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }
  const msg = snap.data() as MessageDoc;
  if (msg.recipientId !== uid) {
    return NextResponse.json({ error: "Not your message." }, { status: 403 });
  }
  if (msg.status === "claimed") {
    return NextResponse.json({ ok: true, alreadyClaimed: true });
  }
  if (msg.status !== "paid" && msg.status !== "opened") {
    return NextResponse.json(
      { error: `Cannot claim a message in status "${msg.status}".` },
      { status: 400 },
    );
  }
  if (!msg.paymentId || !msg.escrowChainId || !msg.toAddress) {
    return NextResponse.json(
      { error: "This message has no escrow paymentId; nothing to claim." },
      { status: 400 },
    );
  }

  const verify = await verifyEvmClaim({
    chainId: msg.escrowChainId,
    txHash: payload.claimTxHash as `0x${string}`,
    paymentId: msg.paymentId as `0x${string}`,
    expectedRecipient: msg.toAddress,
  });
  if (!verify.ok) {
    return NextResponse.json(
      { error: verify.error || "Claim could not be verified on-chain." },
      { status: 402 },
    );
  }

  // Recipient's cool-off setting controls how long the post-claim
  // thread stays open for free replies. Default 1 day.
  const recipientSnap = await db.collection("users").doc(uid).get();
  const recipient = recipientSnap.data() as UserDoc | undefined;
  const coolOffDays = Math.max(0, recipient?.settings.coolOffDays ?? 1);
  const startedAtMs = Date.now();
  const expiresAtMs = startedAtMs + coolOffDays * 24 * 60 * 60 * 1000;

  // Each paid message gets its own dedicated thread (per the product
  // model: "each paid message has its own thread"). The thread doc id
  // is the message id, which makes /a/dashboard/t/{messageId} a stable
  // URL for the thread and lets us scope free replies via
  // `messages where threadId == anchorMessageId`.
  const threadRef = db.collection("threads").doc(msg.id);
  const convRef = db.collection("conversations").doc(msg.conversationId);

  // Amount the recipient actually received post-fee, in USD.
  // `verifyEvmClaim` already converts from the on-chain 6-decimal value
  // to a Number — we use it directly here, since FieldValue.increment
  // accepts plain numbers and the value can be fractional (e.g. 0.99).
  const amountUsd = verify.amountToRecipient ?? 0;

  // We don't need the existing-thread read because every claim writes a
  // fresh thread doc keyed by the message id. A second claim of the
  // same message can't happen — we already short-circuit above when
  // `status === "claimed"`.

  await db.runTransaction(async (tx) => {
    // Mark the message as claimed and stamp it with its own thread id
    // so a single `messages where threadId == X` query returns the
    // anchor + free replies in chronological order.
    tx.update(ref, {
      status: "claimed",
      claimedAt: FieldValue.serverTimestamp(),
      claimTxHash: payload.claimTxHash,
      threadId: msg.id,
    });

    const threadDoc: Omit<
      ThreadDoc,
      "startedAt" | "expiresAt" | "lastMessageAt"
    > & {
      startedAt: number;
      expiresAt: number;
      lastMessageAt: number;
    } = {
      id: msg.id,
      anchorMessageId: msg.id,
      conversationId: msg.conversationId,
      participants: [msg.senderId, msg.recipientId].sort() as [string, string],
      participantHandles: [msg.senderHandle, msg.recipientHandle].sort() as [
        string,
        string,
      ],
      anchorClaimTxHash: payload.claimTxHash,
      startedAt: startedAtMs,
      expiresAt: expiresAtMs,
      status: "active",
      freeReplyCount: 0,
      lastMessageAt: startedAtMs,
      lastMessagePreview: msg.bodyPlain?.slice(0, 80) || "Paid message",
      // Surfaced in the chats list. The thread doc only exists post-claim,
      // so storing the amount here can't leak it before claim.
      anchorAmountUSD: amountUsd,
    };
    tx.set(threadRef, threadDoc);

    // Now that funds are actually with the recipient, credit aggregate
    // stats. We deliberately skip these on /send and on /open so the
    // amount never leaks before a successful on-chain claim.
    if (amountUsd > 0) {
      tx.update(db.collection("users").doc(uid), {
        "stats.totalEarnedUSD": FieldValue.increment(amountUsd),
      });
      tx.set(
        convRef,
        { totalPaidUSD: FieldValue.increment(amountUsd) },
        { merge: true },
      );
    }
  });

  return NextResponse.json({
    ok: true,
    threadId: msg.id,
    amountToRecipient: verify.amountToRecipient,
    fee: verify.fee,
  });
}
