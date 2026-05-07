import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type { MessageDoc, UserDoc } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({
  messageId: z.string().min(1),
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
  if (!snap.exists) return NextResponse.json({ error: "Message not found." }, { status: 404 });

  const msg = snap.data() as MessageDoc;
  if (msg.recipientId !== uid) {
    return NextResponse.json({ error: "Not your message." }, { status: 403 });
  }
  if (msg.status === "opened") {
    return NextResponse.json({ ok: true, alreadyOpened: true });
  }

  // Recipient's cool-off setting
  const recipientSnap = await db.collection("users").doc(uid).get();
  const recipient = recipientSnap.data() as UserDoc | undefined;
  const coolOffDays = recipient?.settings.coolOffDays ?? 1;
  const coolOffMs = coolOffDays * 24 * 60 * 60 * 1000;

  const convRef = db.collection("conversations").doc(msg.conversationId);

  await db.runTransaction(async (tx) => {
    // All reads first (Admin SDK requires reads before writes).
    const convSnap = await tx.get(convRef);

    // Then writes.
    tx.update(ref, {
      status: "opened",
      openedAt: FieldValue.serverTimestamp(),
    });

    if (convSnap.exists) {
      const conv = convSnap.data() as { unreadCount?: Record<string, number> };
      const next = Math.max(0, (conv.unreadCount?.[uid] || 0) - 1);
      tx.update(convRef, {
        [`unreadCount.${uid}`]: next,
        coolOffUntil: Date.now() + coolOffMs,
      });
    }

    tx.update(db.collection("users").doc(uid), {
      "stats.messagesOpened": FieldValue.increment(1),
    });
  });

  return NextResponse.json({ ok: true });
}
