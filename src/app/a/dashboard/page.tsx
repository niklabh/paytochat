"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { db, firebaseConfigured } from "@/lib/firebase/client";
import type { MessageDoc } from "@/lib/types";
import { Card } from "@/components/ui";
import { ArrowUpRight, Coins, Inbox } from "lucide-react";
import Link from "next/link";
import { cn, formatUSD } from "@/lib/utils";
import { toast } from "sonner";
import { MessageList, WalletNote } from "@/components/message-list";
import { TipRevealConfetti } from "@/components/tip-reveal-confetti";

type Filter = "all" | "unread" | "opened";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "opened", label: "Opened" },
];

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [confetti, setConfetti] = useState<{
    trigger: number;
    amountLabel?: string;
  } | null>(null);

  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const q = query(
      collection(db, "messages"),
      where("recipientId", "==", user.uid),
      where("status", "in", ["paid", "free", "opened"]),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(
          snap.docs.map((d) => ({ ...(d.data() as MessageDoc), id: d.id }))
        );
      },
      (err) => {
        console.error(err);
      }
    );
    return () => unsub();
  }, [user]);

  const counts = useMemo(() => {
    const visible = messages.filter((m) => !hidden.has(m.id));
    return {
      all: visible.length,
      unread: visible.filter((m) => m.status === "paid").length,
      opened: visible.filter(
        (m) => m.status === "opened" || m.status === "free"
      ).length,
    };
  }, [messages, hidden]);

  const visible = useMemo(() => {
    return messages.filter((m) => {
      if (hidden.has(m.id)) return false;
      if (filter === "unread") return m.status === "paid";
      if (filter === "opened")
        return m.status === "opened" || m.status === "free";
      return true;
    });
  }, [messages, hidden, filter]);

  async function handleOpen(messageId: string) {
    if (!user) return;
    const target = messages.find((m) => m.id === messageId);
    const wasPaid = target?.status === "paid" && (target.amountUSD ?? 0) > 0;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/messages/open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Could not open.");
      }
      if (wasPaid && target) {
        setConfetti({
          trigger: Date.now(),
          amountLabel: formatUSD(target.amountUSD),
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Open failed.");
    }
  }

  function handleArchive(messageId: string) {
    setHidden((s) => new Set(s).add(messageId));
  }

  const earned = profile?.stats?.totalEarnedUSD ?? 0;
  const received = profile?.stats?.messagesReceived ?? 0;
  const opened = profile?.stats?.messagesOpened ?? 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <TipRevealConfetti
        trigger={confetti?.trigger ?? null}
        amountLabel={confetti?.amountLabel}
      />
      {profile && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Total earned"
            value={formatUSD(earned)}
            icon={<Coins size={18} />}
          />
          <StatCard
            label="Paid msgs"
            value={String(received)}
            icon={<Inbox size={18} />}
          />
          <StatCard
            label="Opened"
            value={String(opened)}
            icon={<ArrowUpRight size={18} />}
          />
        </div>
      )}

      {!profile?.wallets?.ethereum && !profile?.wallets?.solana && (
        <Card className="!p-4 border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">
                Add a wallet to start receiving tips
              </div>
              <div className="text-sm text-muted">
                You need an Ethereum or Solana address to receive USDC/USDT.
              </div>
            </div>
            <Link
              href="/a/dashboard/settings"
              className="text-sm text-brand-300 hover:underline whitespace-nowrap"
            >
              Add wallet →
            </Link>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Inbox</h1>
        <FilterTabs filter={filter} onChange={setFilter} counts={counts} />
      </div>

      <MessageList
        messages={visible}
        onOpen={handleOpen}
        onArchive={handleArchive}
      />

      {visible.length === 0 && counts.all > 0 && (
        <div className="text-center text-sm text-muted">
          Nothing in this view. Try{" "}
          <button
            onClick={() => setFilter("all")}
            className="text-foreground underline decoration-dotted"
          >
            All
          </button>
          .
        </div>
      )}

      <WalletNote />

      {profile && (
        <div className="text-center text-sm text-muted pt-2">
          Your link:{" "}
          <Link
            href={`/${profile.handle}`}
            target="_blank"
            className="text-foreground underline decoration-dotted"
          >
            paytochat.fun/{profile.handle}
          </Link>
        </div>
      )}
    </div>
  );
}

function FilterTabs({
  filter,
  onChange,
  counts,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  counts: { all: number; unread: number; opened: number };
}) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1 text-xs">
      {FILTERS.map((f) => {
        const count = counts[f.id];
        const active = filter === f.id;
        return (
          <button
            key={f.id}
            onClick={() => onChange(f.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap",
              active
                ? "bg-white/10 text-foreground"
                : "text-muted hover:text-foreground"
            )}
          >
            {f.label}
            <span
              className={cn(
                "ml-1.5 text-[10px]",
                active ? "text-muted" : "text-muted/70"
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
