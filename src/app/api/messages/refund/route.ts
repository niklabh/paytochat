import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { verifyEvmRefund } from "@/lib/payments/verify";
import type { MessageDoc } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({
  messageId: z.string().min(1),
  /** The sender's refund() tx hash on the same chain as escrowChainId. */
  refundTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
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
  if (msg.senderId !== uid) {
    return NextResponse.json({ error: "Not your message." }, { status: 403 });
  }
  if (msg.status === "refunded") {
    return NextResponse.json({ ok: true, alreadyRefunded: true });
  }
  if (msg.status === "claimed") {
    return NextResponse.json(
      { error: "Recipient already claimed; can't refund." },
      { status: 400 },
    );
  }
  if (msg.status !== "paid" && msg.status !== "opened") {
    return NextResponse.json(
      { error: `Cannot refund a message in status "${msg.status}".` },
      { status: 400 },
    );
  }
  if (!msg.paymentId || !msg.escrowChainId || !msg.fromAddress) {
    return NextResponse.json(
      { error: "This message has no escrow paymentId; nothing to refund." },
      { status: 400 },
    );
  }

  const verify = await verifyEvmRefund({
    chainId: msg.escrowChainId,
    txHash: payload.refundTxHash as `0x${string}`,
    paymentId: msg.paymentId as `0x${string}`,
    expectedSender: msg.fromAddress,
  });
  if (!verify.ok) {
    return NextResponse.json(
      { error: verify.error || "Refund could not be verified on-chain." },
      { status: 402 },
    );
  }

  await ref.update({
    status: "refunded",
    refundedAt: FieldValue.serverTimestamp(),
    refundTxHash: payload.refundTxHash,
  });

  return NextResponse.json({ ok: true, amount: verify.amount });
}
