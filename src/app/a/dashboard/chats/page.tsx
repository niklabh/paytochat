"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { ChevronRight, Coins, Lock, MessageSquare } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { db, firebaseConfigured } from "@/lib/firebase/client";
import type { ConversationDoc } from "@/lib/types";
import { Card } from "@/components/ui";
import {
  cn,
  formatCountdown,
  formatUSD,
  timeAgo,
  toMs,
} from "@/lib/utils";

export default function ChatsPage() {
  const { user } = useAuth();
  const [convs, setConvs] = useState<ConversationDoc[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", user.uid),
      orderBy("lastMessageAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setConvs(
        snap.docs.map((d) => ({ ...(d.data() as ConversationDoc), id: d.id }))
      );
    });
    return () => unsub();
  }, [user]);

  const items = useMemo(
    () =>
      convs.map((c) => {
        const otherIdx = user && c.participants[0] === user.uid ? 1 : 0;
        const otherHandle = c.participantHandles?.[otherIdx];
        const coolOffMs = c.coolOffUntil ? toMs(c.coolOffUntil, 0) : 0;
        const inCoolOff = coolOffMs > now;
        const unread = (user && c.unreadCount?.[user.uid]) || 0;
        return { ...c, otherHandle, coolOffMs, inCoolOff, unread };
      }),
    [convs, user, now]
  );

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Chats</h1>
        <span className="text-xs text-muted">
          {items.length} {items.length === 1 ? "thread" : "threads"}
        </span>
      </div>

      {items.length === 0 ? (
        <Card className="text-center py-10">
          <div className="mx-auto h-16 w-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
            <MessageSquare className="text-muted" size={22} />
          </div>
          <h3 className="text-base font-semibold">No chats yet</h3>
          <p className="mt-1 text-sm text-muted max-w-xs mx-auto">
            When someone pays to message you (or you pay them), the thread
            shows up here. Both sides can reply free for the cool-off
            window after each paid message — then a fresh paid message is
            needed to reopen the thread.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <Link
              key={c.id}
              href={`/a/dashboard/c/${encodeURIComponent(c.id)}`}
              className={cn(
                "block rounded-2xl border border-white/10 bg-white/[.04] hover:bg-white/[.06]",
                "p-3.5 transition-colors"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-tr from-brand-500 to-brand-300 flex items-center justify-center text-white font-bold relative">
                  {c.otherHandle?.slice(0, 1).toUpperCase() ?? "·"}
                  {c.unread > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-brand-500 border-2 border-background text-white text-[10px] font-bold inline-flex items-center justify-center">
                      {c.unread > 9 ? "9+" : c.unread}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">
                      @{c.otherHandle ?? "unknown"}
                    </span>
                    <span className="ml-auto text-[11px] text-muted shrink-0">
                      {timeAgo(toMs(c.lastMessageAt))}
                    </span>
                  </div>
                  <div className="text-xs text-muted truncate mt-0.5">
                    {c.lastMessagePreview || "—"}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {c.totalPaidUSD > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 px-1.5 py-px">
                        <Coins size={10} /> {formatUSD(c.totalPaidUSD)}
                      </span>
                    )}
                    {c.inCoolOff ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-200 px-1.5 py-px">
                        free reply · {formatCountdown(c.coolOffMs - now)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 px-1.5 py-px">
                        <Lock size={10} /> cool-off ended
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted shrink-0" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
