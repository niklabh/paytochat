"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { db, firebaseConfigured } from "@/lib/firebase/client";
import type { MessageDoc } from "@/lib/types";
import { Card, Badge } from "@/components/ui";
import { Check, CheckCheck, Coins, ImageIcon, Loader2 } from "lucide-react";
import { formatUSD, timeAgo } from "@/lib/utils";
import { htmlToPlainText } from "@/lib/rich-text";

export default function SentPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<MessageDoc[]>([]);

  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const q = query(
      collection(db, "messages"),
      where("senderId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setMessages(
        snap.docs.map((d) => ({ ...(d.data() as MessageDoc), id: d.id }))
      );
    });
    return () => unsub();
  }, [user]);

  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Sent</h1>
      {messages.length === 0 && (
        <Card className="text-center text-muted">
          You haven&apos;t sent any messages yet.
        </Card>
      )}
      {messages.map((m) => (
        <Card key={m.id} className="!p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-brand-500 to-brand-300 flex items-center justify-center text-white font-bold">
              {m.recipientHandle.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-semibold truncate">@{m.recipientHandle}</div>
                <span className="text-xs text-muted">{timeAgo(toMs(m.createdAt))}</span>
              </div>
              <div className="text-sm text-muted truncate flex items-center gap-1.5">
                {/<img[\s>]/i.test(m.body || "") && (
                  <ImageIcon size={12} className="shrink-0 text-brand-200" />
                )}
                <span className="truncate">
                  {m.bodyPlain || htmlToPlainText(m.body || "")}
                </span>
              </div>
            </div>
            <div className="text-right text-xs">
              {m.amountUSD > 0 ? (
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <Coins size={12} /> {formatUSD(m.amountUSD)}
                </span>
              ) : (
                <Badge>free</Badge>
              )}
              <div className="mt-1 flex items-center justify-end gap-1 text-muted">
                <StatusIcon status={m.status} />
                {labelFor(m.status)}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function StatusIcon({ status }: { status: MessageDoc["status"] }) {
  if (status === "opened") return <CheckCheck size={12} className="text-emerald-300" />;
  if (status === "paid" || status === "free") return <Check size={12} className="text-muted" />;
  if (status === "pending") return <Loader2 size={12} className="text-muted animate-spin" />;
  return <Check size={12} className="text-muted" />;
}

function labelFor(status: MessageDoc["status"]) {
  switch (status) {
    case "opened": return "read";
    case "paid": return "delivered";
    case "free": return "delivered";
    case "pending": return "verifying";
    case "rejected": return "rejected";
  }
}

function toMs(t: MessageDoc["createdAt"]): number {
  if (!t) return Date.now();
  if (typeof t === "number") return t;
  if (typeof (t as { toMillis?: () => number }).toMillis === "function") {
    return (t as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}
