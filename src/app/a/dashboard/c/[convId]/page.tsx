"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  ArrowLeft,
  Coins,
  Eye,
  ImageIcon,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { db, firebaseConfigured } from "@/lib/firebase/client";
import type { ConversationDoc, MessageDoc } from "@/lib/types";
import { Card } from "@/components/ui";
import { RichContent } from "@/components/rich-content";
import { ThreadComposer } from "@/components/thread-composer";
import { TipRevealConfetti } from "@/components/tip-reveal-confetti";
import {
  cn,
  formatCountdown,
  formatUSD,
  timeAgo,
  toMs,
} from "@/lib/utils";
import { htmlToPlainText, isHtmlBody } from "@/lib/rich-text";
import { toast } from "sonner";

export default function ThreadPage({
  params,
}: {
  params: { convId: string };
}) {
  const convId = decodeURIComponent(params.convId);
  const { user, profile } = useAuth();
  const [conv, setConv] = useState<ConversationDoc | null>(null);
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confetti, setConfetti] = useState<{
    trigger: number;
    amountLabel?: string;
  } | null>(null);
  const openedRef = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const ref = doc(db, "conversations", convId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setError("Conversation not found.");
          return;
        }
        const data = { ...(snap.data() as ConversationDoc), id: snap.id };
        if (!data.participants?.includes(user.uid)) {
          setError("This conversation isn't yours.");
          return;
        }
        setConv(data);
      },
      (err) => {
        console.error(err);
        setError("Could not load conversation.");
      }
    );
    return () => unsub();
  }, [user, convId]);

  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const q = query(
      collection(db, "messages"),
      where("conversationId", "==", convId),
      orderBy("createdAt", "asc")
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
        const msg = err instanceof Error ? err.message : String(err);
        // Firestore phrases missing-composite-index errors as
        // `failed-precondition: The query requires an index. You can create
        // it here: https://console.firebase.google.com/...&create_composite=...`
        // We surface that link so the dev can click straight through, instead
        // of needing to open devtools.
        if (/requires an index/i.test(msg)) {
          setError(
            "Missing Firestore index. Run `firebase deploy --only firestore:indexes` (or click the link printed in the browser console) and try again."
          );
        } else {
          setError(`Could not load messages. ${msg}`);
        }
      }
    );
    return () => unsub();
  }, [user, convId]);

  // Auto-scroll to bottom whenever a new message arrives.
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.id === lastIdRef.current) return;
    lastIdRef.current = last.id;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const otherHandle = useMemo(() => {
    if (!conv || !user) return undefined;
    const idx = conv.participants[0] === user.uid ? 1 : 0;
    return conv.participantHandles?.[idx];
  }, [conv, user]);

  const coolOffMs = conv?.coolOffUntil ? toMs(conv.coolOffUntil, 0) : 0;
  const inCoolOff = coolOffMs > now;
  const canSendFree = inCoolOff;

  async function autoOpen(message: MessageDoc) {
    if (!user) return;
    if (openedRef.current.has(message.id)) return;
    openedRef.current.add(message.id);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/messages/open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ messageId: message.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Could not open.");
      }
      if (message.amountUSD > 0) {
        setConfetti({
          trigger: Date.now(),
          amountLabel: formatUSD(message.amountUSD),
        });
      }
    } catch (e) {
      // Allow retrying on next snapshot if it failed.
      openedRef.current.delete(message.id);
      toast.error(e instanceof Error ? e.message : "Open failed.");
    }
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto">
        <Link
          href="/a/dashboard/chats"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground mb-4"
        >
          <ArrowLeft size={14} /> Back to chats
        </Link>
        <Card className="text-center text-muted">{error}</Card>
      </div>
    );
  }

  if (!conv || !user) {
    return (
      <div className="max-w-2xl mx-auto text-muted text-sm">Loading chat…</div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3 min-h-[calc(100vh-180px)]">
      <TipRevealConfetti
        trigger={confetti?.trigger ?? null}
        amountLabel={confetti?.amountLabel}
      />

      <ThreadHeader
        otherHandle={otherHandle}
        inCoolOff={inCoolOff}
        coolOffMs={coolOffMs}
        now={now}
        totalPaidUSD={conv.totalPaidUSD}
      />

      <div className="flex-1 space-y-2.5">
        {messages.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-8 text-center text-sm text-muted">
            No messages yet.
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble
            key={m.id}
            message={m}
            mine={m.senderId === user.uid}
            onReveal={() => autoOpen(m)}
            myHandle={profile?.handle}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-20 md:bottom-4 pt-2">
        {otherHandle && (
          <ThreadComposer
            recipientHandle={otherHandle}
            canSendFree={canSendFree}
            coolOffUntilMs={coolOffMs || null}
          />
        )}
      </div>
    </div>
  );
}

function ThreadHeader({
  otherHandle,
  inCoolOff,
  coolOffMs,
  now,
  totalPaidUSD,
}: {
  otherHandle: string | undefined;
  inCoolOff: boolean;
  coolOffMs: number;
  now: number;
  totalPaidUSD: number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4 flex items-center gap-3">
      <Link
        href="/a/dashboard/chats"
        className="text-muted hover:text-foreground p-1 rounded-md hover:bg-white/10 transition-colors"
        title="Back to chats"
      >
        <ArrowLeft size={16} />
      </Link>
      <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-tr from-brand-500 to-brand-300 flex items-center justify-center text-white font-bold">
        {otherHandle?.slice(0, 1).toUpperCase() ?? "·"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={otherHandle ? `/${otherHandle}` : "#"}
            className="font-semibold truncate hover:underline"
          >
            @{otherHandle ?? "—"}
          </Link>
        </div>
        <div className="text-xs text-muted truncate">
          {inCoolOff ? (
            <>
              Free reply window —{" "}
              <span className="text-foreground">
                {formatCountdown(coolOffMs - now)}
              </span>{" "}
              left
            </>
          ) : (
            <>Cool-off ended — a fresh paid message reopens the thread</>
          )}
        </div>
      </div>
      {totalPaidUSD > 0 && (
        <span
          className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-xs px-2.5 py-1"
          title={`${formatUSD(totalPaidUSD)} paid in this thread`}
        >
          <Coins size={12} /> {formatUSD(totalPaidUSD)}
        </span>
      )}
    </div>
  );
}

function ChatBubble({
  message,
  mine,
  onReveal,
  myHandle,
}: {
  message: MessageDoc;
  mine: boolean;
  onReveal: () => void;
  myHandle?: string;
}) {
  const isLockedForMe = !mine && message.status === "paid";
  const isPaid = message.status === "opened" && message.amountUSD > 0;
  const isFreeMsg = message.status === "free";

  return (
    <div className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <Avatar
          url={message.senderAvatarUrl}
          name={message.senderDisplayName || message.senderHandle}
        />
      )}
      <div
        className={cn(
          "max-w-[80%] min-w-0 rounded-2xl px-4 py-2.5 text-sm",
          mine
            ? "bg-brand-500/20 border border-brand-400/40"
            : isLockedForMe
            ? "bg-white/[.04] border border-white/10"
            : "bg-white/[.06] border border-white/10"
        )}
      >
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="font-medium text-foreground/80">
            {mine ? "You" : `@${message.senderHandle}`}
          </span>
          <span>·</span>
          <span>{timeAgo(toMs(message.createdAt))}</span>
          {isPaid && !mine && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 px-1.5 py-px">
              <Coins size={10} /> {formatUSD(message.amountUSD)}
            </span>
          )}
          {isFreeMsg && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 px-1.5 py-px">
              free reply
            </span>
          )}
          {message.status === "paid" && mine && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-200 px-1.5 py-px">
              <Lock size={10} /> waiting
            </span>
          )}
          {message.status === "opened" && mine && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 px-1.5 py-px">
              <ShieldCheck size={10} /> read
            </span>
          )}
        </div>

        {isLockedForMe ? (
          <LockedBubble message={message} onReveal={onReveal} />
        ) : (
          <div className="mt-1.5">
            {isHtmlBody(message.body) ? (
              <RichContent html={message.body} className="text-sm" />
            ) : (
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                {message.body}
              </p>
            )}
          </div>
        )}
        {isPaid && mine && (
          <div className="mt-1.5 text-[11px] text-muted">
            Sent to @{message.recipientHandle} · paid {formatUSD(message.amountUSD)}{" "}
            {message.token ? `${message.token}` : ""}
            {message.chain ? ` on ${message.chain}` : ""}
          </div>
        )}
        {/* `myHandle` is unused but kept on the prop signature for future
            conditional UX (e.g. "this message is from you to the chat"). */}
        <span className="hidden">{myHandle}</span>
      </div>
      {mine && (
        <Avatar url={message.senderAvatarUrl} name={message.senderHandle} />
      )}
    </div>
  );
}

function LockedBubble({
  message,
  onReveal,
}: {
  message: MessageDoc;
  onReveal: () => void;
}) {
  const preview =
    message.bodyPlain || htmlToPlainText(message.body || "") || "•••";
  const hasImage = /<img[\s>]/i.test(message.body || "");
  return (
    <div className="mt-2">
      <div className="relative max-h-12 overflow-hidden rounded-lg">
        <p className="filter blur-md select-none pointer-events-none text-xs text-muted/70 leading-relaxed line-clamp-2">
          {preview}
        </p>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/30 to-background/80" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[11px] text-muted">
          <Lock size={10} /> Tip hidden — {message.token} on {message.chain}
          {hasImage && (
            <>
              <span className="mx-1">·</span>
              <ImageIcon size={10} className="text-brand-200" /> image
            </>
          )}
        </span>
        <button
          onClick={onReveal}
          className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-tr from-brand-500 to-brand-300 text-white text-xs font-medium px-2.5 py-1.5 hover:from-brand-400 hover:to-brand-200 transition-colors"
        >
          <Eye size={12} /> Reveal
        </button>
      </div>
    </div>
  );
}

function Avatar({ url, name }: { url?: string; name: string }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="h-8 w-8 rounded-full object-cover shrink-0 self-end"
      />
    );
  }
  return (
    <div className="h-8 w-8 shrink-0 self-end rounded-full bg-gradient-to-tr from-brand-500 to-brand-300 flex items-center justify-center text-white text-xs font-bold">
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}
