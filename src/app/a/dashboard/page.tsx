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
import { formatUSD } from "@/lib/utils";
import { MessageList, WalletNote } from "@/components/message-list";

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    // Inbox shows paid messages only — the locked, unopened ones plus the
    // ones already revealed. Free in-thread replies live inside the thread
    // view, not the top-level inbox.
    const q = query(
      collection(db, "messages"),
      where("recipientId", "==", user.uid),
      where("status", "in", ["paid", "opened"]),
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

  const visible = useMemo(
    () => messages.filter((m) => !hidden.has(m.id)),
    [messages, hidden]
  );

  function handleArchive(messageId: string) {
    setHidden((s) => new Set(s).add(messageId));
  }

  const earned = profile?.stats?.totalEarnedUSD ?? 0;
  const received = profile?.stats?.messagesReceived ?? 0;
  const opened = profile?.stats?.messagesOpened ?? 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
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
                You need an Ethereum or Solana address to receive USDC/USDT/USDG.
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
      </div>

      <MessageList messages={visible} onArchive={handleArchive} />

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
