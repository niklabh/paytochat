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
import type { MessageDoc, ThreadDoc } from "@/lib/types";
import { Card } from "@/components/ui";
import { RichContent } from "@/components/rich-content";
import { ThreadComposer } from "@/components/thread-composer";
import { TipRevealConfetti } from "@/components/tip-reveal-confetti";
import { EscrowActions } from "@/components/escrow-actions";
import {
  cn,
  formatCountdown,
  formatUSD,
  timeAgo,
  toMs,
} from "@/lib/utils";
import { htmlToPlainText, isHtmlBody } from "@/lib/rich-text";
import { toast } from "sonner";

/**
 * Per-thread chat page.
 *
 * The route id is the **anchor paid message id** — the same value lives
 * on `messages.threadId` for the anchor itself and for every free
 * reply, so a single `where("threadId", "==", threadId)` query returns
 * the whole thread in chronological order.
 *
 * Pre-claim (no `threads/{threadId}` doc yet): we still render the page
 * by reading the anchor message directly. The composer collapses to a
 * "claim first" / "waiting on claim" CTA, depending on which side the
 * viewer is on.
 */
export default function ThreadPage({
  params,
}: {
  params: { threadId: string };
}) {
  const threadId = decodeURIComponent(params.threadId);
  const { user, profile } = useAuth();
  const [anchor, setAnchor] = useState<MessageDoc | null>(null);
  // `undefined` = first snapshot hasn't arrived yet (we don't know if a
  // thread exists). `null` = snapshot returned no doc (definitely no
  // thread). Distinguishing these prevents a brief "expired" flash
  // right after a successful claim, when the message snapshot
  // (`status: "claimed"`) lands before the new thread snapshot.
  const [thread, setThread] = useState<ThreadDoc | null | undefined>(undefined);
  const [replies, setReplies] = useState<MessageDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confetti, setConfetti] = useState<{ trigger: number } | null>(null);
  const openedRef = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Anchor paid message — this exists from the moment the sender pays,
  // even before the recipient claims (so the page can render the locked
  // bubble + claim CTA pre-claim).
  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const ref = doc(db, "messages", threadId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setError("This thread doesn't exist.");
          return;
        }
        const data = { ...(snap.data() as MessageDoc), id: snap.id };
        if (!data.participants?.includes(user.uid)) {
          setError("This thread isn't yours.");
          return;
        }
        setAnchor(data);
      },
      (err) => {
        console.error(err);
        setError("Could not load this thread.");
      }
    );
    return () => unsub();
  }, [user, threadId]);

  // Optional thread doc. Missing = pre-claim (no reply window yet).
  // The Firestore rule for `get` explicitly allows reading
  // non-existent docs so this listener returns a clean
  // "doesn't exist" snapshot instead of permission-denied.
  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const ref = doc(db, "threads", threadId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setThread(null);
          return;
        }
        setThread({ ...(snap.data() as ThreadDoc), id: snap.id });
      },
      () => {
        // Treat any subscription error (network blip, transient
        // permission-denied during a rule rollout, etc.) as "no
        // thread yet" so the composer falls back to the
        // claim-or-wait CTA instead of getting stuck loading.
        setThread(null);
      }
    );
    return () => unsub();
  }, [user, threadId]);

  // Free in-thread replies. The composite filter
  // (`threadId == X AND participants array-contains uid`) is what lets
  // Firestore's rule engine accept the query. Anchor is fetched
  // separately above and excluded here (it has `threadId == its own id`
  // too once claimed, but we want it pinned at the top of the render).
  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    const q = query(
      collection(db, "messages"),
      where("threadId", "==", threadId),
      where("participants", "array-contains", user.uid),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map(
          (d) => ({ ...(d.data() as MessageDoc), id: d.id })
        );
        // Pin the anchor as the first bubble even if its createdAt
        // sorts identically to a free reply burst.
        setReplies(all.filter((m) => m.id !== threadId));
      },
      (err) => {
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        if (/requires an index/i.test(msg)) {
          setError(
            "Missing Firestore index. Run `firebase deploy --only firestore:indexes` (or click the link printed in the browser console) and try again."
          );
        } else {
          setError(`Could not load replies. ${msg}`);
        }
      }
    );
    return () => unsub();
  }, [user, threadId]);

  // Auto-scroll to bottom when a new reply arrives.
  useEffect(() => {
    if (replies.length === 0) return;
    const last = replies[replies.length - 1];
    if (last.id === lastIdRef.current) return;
    lastIdRef.current = last.id;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [replies]);

  const otherHandle = useMemo(() => {
    if (!anchor || !user) return undefined;
    return anchor.senderId === user.uid
      ? anchor.recipientHandle
      : anchor.senderHandle;
  }, [anchor, user]);

  const threadExpiresMs = thread?.expiresAt ? toMs(thread.expiresAt, 0) : 0;
  const threadActive = !!thread && threadExpiresMs > now;

  const composerState = useMemo<
    | "active"
    | "waiting-claim-recipient"
    | "waiting-claim-sender"
    | "expired"
    | "loading"
  >(() => {
    if (threadActive) return "active";
    if (anchor && user && anchor.status !== "claimed") {
      return anchor.recipientId === user.uid
        ? "waiting-claim-recipient"
        : "waiting-claim-sender";
    }
    // Anchor is claimed but the thread snapshot hasn't landed yet
    // (race: server writes both in one transaction, but the client
    // receives them as two separate snapshots). Show a loading state
    // instead of falling through to "expired", which would otherwise
    // flash for a moment right after the user claims their first
    // message in the thread.
    if (anchor?.status === "claimed" && thread === undefined) {
      return "loading";
    }
    return "expired";
  }, [threadActive, anchor, thread, user]);

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
      // Lottie celebrates the body reveal — never the amount.
      if (message.amountUSD > 0) {
        setConfetti({ trigger: Date.now() });
      }
    } catch (e) {
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

  if (!anchor || !user) {
    return (
      <div className="max-w-2xl mx-auto text-muted text-sm">Loading thread…</div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3 min-h-[calc(100vh-180px)]">
      <TipRevealConfetti trigger={confetti?.trigger ?? null} />

      <ThreadHeader
        otherHandle={otherHandle}
        threadActive={threadActive}
        threadExpiresMs={threadExpiresMs}
        anchorClaimed={anchor.status === "claimed"}
        now={now}
        anchorAmountClaimed={
          // Prefer the post-fee amount from the thread doc (set on
          // claim) over the message's gross amount. Both only surface
          // post-claim, so neither leaks an unclaimed value.
          thread?.anchorAmountUSD ??
          (anchor.status === "claimed" ? anchor.amountUSD : null)
        }
      />

      <div className="flex-1 space-y-2.5">
        <ChatBubble
          message={anchor}
          mine={anchor.senderId === user.uid}
          onReveal={() => autoOpen(anchor)}
          myHandle={profile?.handle}
          isAnchor
        />
        {replies.map((m) => (
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
            threadId={threadId}
            state={composerState}
            threadExpiresMs={threadActive ? threadExpiresMs : null}
          />
        )}
      </div>
    </div>
  );
}

function ThreadHeader({
  otherHandle,
  threadActive,
  threadExpiresMs,
  anchorClaimed,
  now,
  anchorAmountClaimed,
}: {
  otherHandle: string | undefined;
  threadActive: boolean;
  threadExpiresMs: number;
  anchorClaimed: boolean;
  now: number;
  /** USD amount on the anchor, only after a verified on-chain claim. */
  anchorAmountClaimed: number | null;
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
          {threadActive ? (
            <>
              Reply thread open —{" "}
              <span className="text-foreground">
                {formatCountdown(threadExpiresMs - now)}
              </span>{" "}
              left
            </>
          ) : anchorClaimed ? (
            <>Reply thread closed — send a fresh paid message to reopen</>
          ) : (
            <>Awaiting claim</>
          )}
        </div>
      </div>
      {anchorAmountClaimed && anchorAmountClaimed > 0 && (
        <span
          className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-xs px-2.5 py-1"
          title={`${formatUSD(anchorAmountClaimed)} claimed`}
        >
          <Coins size={12} /> {formatUSD(anchorAmountClaimed)}
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
  isAnchor,
}: {
  message: MessageDoc;
  mine: boolean;
  onReveal: () => void;
  myHandle?: string;
  isAnchor?: boolean;
}) {
  const isLockedForMe = !mine && message.status === "paid";
  // The recipient only learns the amount once it's pulled on-chain.
  const showAmountToRecipient = !mine && message.status === "claimed";
  const showAmountToSender =
    mine &&
    message.amountUSD > 0 &&
    (message.status === "paid" ||
      message.status === "opened" ||
      message.status === "claimed");

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
          {isAnchor && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 text-muted px-1.5 py-px">
              anchor
            </span>
          )}
          {showAmountToRecipient && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 px-1.5 py-px">
              <Coins size={10} /> {formatUSD(message.amountUSD)}
            </span>
          )}
          {message.status === "paid" && mine && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-200 px-1.5 py-px">
              <Lock size={10} /> waiting claim
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
        {showAmountToSender && (
          <div className="mt-1.5 text-[11px] text-muted">
            Sent to @{message.recipientHandle} · paid {formatUSD(message.amountUSD)}{" "}
            {message.token ? `${message.token}` : ""}
            {message.chain ? ` on ${message.chain}` : ""}
          </div>
        )}
        <EscrowActions
          message={message}
          perspective={mine ? "sender" : "recipient"}
        />
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
          <Lock size={10} /> Hidden tip · {message.token} on {message.chain}
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
