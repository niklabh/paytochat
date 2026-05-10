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
import type { MessageDoc, ThreadDoc } from "@/lib/types";
import { Card } from "@/components/ui";
import {
  cn,
  formatCountdown,
  formatUSD,
  timeAgo,
  toMs,
} from "@/lib/utils";

type Row = {
  /** Doc id of the row — thread id when post-claim, message id otherwise. */
  id: string;
  /** Thread id (== anchor message id) — what /t/{threadId} links to. */
  threadId: string;
  otherHandle: string | undefined;
  state: "active" | "expired" | "awaiting-claim";
  /** ms epoch — used for sorting, freshest first. */
  lastActivity: number;
  /** Active threads only: ms epoch the window closes at. */
  expiresAt: number;
  /** Plain text preview of the most recent activity in this thread. */
  preview: string;
  /** Only set for claimed threads — never leaks unclaimed amounts. */
  claimedUSD: number;
};

/**
 * Chats list — one row per **thread**.
 *
 * A pair of users with three claimed paid messages shows up as three
 * separate rows; an unclaimed paid message also shows up as a row in
 * its own right (state: "awaiting-claim") so the recipient has a
 * direct link to claim it. Sorted by most-recent-activity descending.
 */
export default function ChatsPage() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ThreadDoc[]>([]);
  const [pending, setPending] = useState<MessageDoc[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // All threads I'm a participant of (active or expired).
  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const q = query(
      collection(db, "threads"),
      where("participants", "array-contains", user.uid),
      orderBy("lastMessageAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setThreads(
        snap.docs.map((d) => ({ ...(d.data() as ThreadDoc), id: d.id }))
      );
    });
    return () => unsub();
  }, [user]);

  // Paid messages still awaiting a claim. These don't have a thread doc
  // yet but we still surface them as rows so the recipient can navigate
  // straight to the claim flow (and the sender can see them sitting in
  // limbo). We pull both sides here — the sender wants visibility too.
  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const q = query(
      collection(db, "messages"),
      where("participants", "array-contains", user.uid),
      where("status", "in", ["paid", "opened"]),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setPending(
        snap.docs.map((d) => ({ ...(d.data() as MessageDoc), id: d.id }))
      );
    });
    return () => unsub();
  }, [user]);

  const rows = useMemo<Row[]>(() => {
    if (!user) return [];
    const list: Row[] = [];

    for (const t of threads) {
      const otherIdx = t.participants[0] === user.uid ? 1 : 0;
      const otherHandle = t.participantHandles?.[otherIdx];
      const expiresAt = toMs(t.expiresAt, 0);
      const lastActivity = toMs(t.lastMessageAt, expiresAt);
      list.push({
        id: t.id,
        threadId: t.id,
        otherHandle,
        state: expiresAt > now ? "active" : "expired",
        lastActivity,
        expiresAt,
        preview: t.lastMessagePreview || "Paid message",
        // Set on the thread doc by /api/messages/claim, so it's only
        // present once the recipient has actually pulled the funds.
        claimedUSD: t.anchorAmountUSD ?? 0,
      });
    }

    // Pending paid messages → "awaiting-claim" rows. Skip any that
    // already have a thread (the thread row above already represents
    // them more accurately).
    const threadIds = new Set(threads.map((t) => t.id));
    for (const m of pending) {
      if (threadIds.has(m.id)) continue;
      const otherHandle =
        m.senderId === user.uid ? m.recipientHandle : m.senderHandle;
      list.push({
        id: m.id,
        threadId: m.id,
        otherHandle,
        state: "awaiting-claim",
        lastActivity: toMs(m.createdAt, Date.now()),
        expiresAt: 0,
        preview:
          m.senderId === user.uid
            ? "Paid message — waiting on recipient to claim"
            : "Paid message — claim to reveal",
        claimedUSD: 0,
      });
    }

    list.sort((a, b) => b.lastActivity - a.lastActivity);
    return list;
  }, [threads, pending, user, now]);

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Chats</h1>
        <span className="text-xs text-muted">
          {rows.length} {rows.length === 1 ? "thread" : "threads"}
        </span>
      </div>

      {rows.length === 0 ? (
        <Card className="text-center py-10">
          <div className="mx-auto h-16 w-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
            <MessageSquare className="text-muted" size={22} />
          </div>
          <h3 className="text-base font-semibold">No chats yet</h3>
          <p className="mt-1 text-sm text-muted max-w-xs mx-auto">
            Each paid message becomes its own thread once the recipient
            claims it. The thread stays open for free back-and-forth for
            1 day, then closes — a fresh paid message opens a new one.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/a/dashboard/t/${encodeURIComponent(r.threadId)}`}
              className={cn(
                "block rounded-2xl border border-white/10 bg-white/[.04] hover:bg-white/[.06]",
                "p-3.5 transition-colors"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-tr from-brand-500 to-brand-300 flex items-center justify-center text-white font-bold">
                  {r.otherHandle?.slice(0, 1).toUpperCase() ?? "·"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">
                      @{r.otherHandle ?? "unknown"}
                    </span>
                    <span className="ml-auto text-[11px] text-muted shrink-0">
                      {timeAgo(r.lastActivity)}
                    </span>
                  </div>
                  <div className="text-xs text-muted truncate mt-0.5">
                    {r.preview}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {r.claimedUSD > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 px-1.5 py-px">
                        <Coins size={10} /> {formatUSD(r.claimedUSD)}
                      </span>
                    )}
                    {r.state === "active" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-200 px-1.5 py-px">
                        thread open · {formatCountdown(r.expiresAt - now)}
                      </span>
                    ) : r.state === "expired" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 px-1.5 py-px">
                        <Lock size={10} /> thread closed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 text-muted px-1.5 py-px">
                        awaiting claim
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
