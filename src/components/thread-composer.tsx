"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Hourglass, Lock, Send, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "./ui";
import { cn, formatCountdown } from "@/lib/utils";
import { toast } from "sonner";

export type ThreadComposerState =
  | "active" // free reply window is open — show the textarea
  | "waiting-claim-recipient" // I'm the recipient, need to claim first
  | "waiting-claim-sender" // I'm the sender, waiting on the other side
  | "expired" // window has passed; need a new paid message
  | "loading"; // anchor is claimed but the thread snapshot hasn't landed yet

interface ThreadComposerProps {
  /** Handle of the other participant — what we'll POST as `recipientHandle`. */
  recipientHandle: string;
  /**
   * Id of the thread this composer is bound to (= the anchor paid
   * message id). Required so the server can scope the free reply to
   * one specific thread and validate its expiry.
   */
  threadId: string;
  /** Drives which UI variant the composer renders. */
  state: ThreadComposerState;
  /** Future epoch ms when the active thread expires, or `null` otherwise. */
  threadExpiresMs: number | null;
  /** Called after a successful send so the thread can scroll to bottom. */
  onSent?: () => void;
}

const MAX_PLAIN_LENGTH = 2000;

/**
 * Chat-style composer used inside a thread. The textarea is only shown
 * while the post-claim reply window is active. Outside the window the
 * composer collapses to a contextual CTA: "claim first" for the
 * recipient, "waiting" for the sender, or "send a new paid message" once
 * the window has expired.
 */
export function ThreadComposer({
  recipientHandle,
  threadId,
  state,
  threadExpiresMs,
  onSent,
}: ThreadComposerProps) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  if (state === "waiting-claim-recipient") {
    return <WaitingClaimRecipientCta />;
  }
  if (state === "waiting-claim-sender") {
    return <WaitingClaimSenderCta recipientHandle={recipientHandle} />;
  }
  if (state === "expired") {
    return <ExpiredCta recipientHandle={recipientHandle} />;
  }
  if (state === "loading") {
    return <LoadingPlaceholder />;
  }

  async function send() {
    if (!user) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_PLAIN_LENGTH) {
      toast.error(`Message is too long (max ${MAX_PLAIN_LENGTH} characters).`);
      return;
    }

    setBusy(true);
    try {
      const html = textToHtml(trimmed);
      const idToken = await user.getIdToken();
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          recipientHandle,
          body: html,
          free: true,
          threadId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send.");
      setText("");
      onSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  }

  const remaining =
    threadExpiresMs && threadExpiresMs > now
      ? formatCountdown(threadExpiresMs - now)
      : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] backdrop-blur p-2.5">
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={`Reply to @${recipientHandle}…`}
          className={cn(
            "flex-1 resize-none rounded-xl bg-transparent border-0 px-3 py-2.5 text-sm",
            "placeholder:text-muted focus:outline-none",
            "max-h-[200px]"
          )}
        />
        <Button
          onClick={() => void send()}
          disabled={busy || text.trim() === ""}
          size="sm"
          className="shrink-0"
          title="Send (Enter)"
        >
          {busy ? "Sending…" : (
            <>
              <Send size={14} /> Send
            </>
          )}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2 px-1.5 pt-1.5 text-[11px] text-muted">
        <div>
          {remaining ? (
            <>
              Free reply window — <span className="text-foreground">{remaining}</span> left.
            </>
          ) : (
            <span>Free reply window active.</span>
          )}
        </div>
        <span>Enter to send · Shift+Enter for newline</span>
      </div>
    </div>
  );
}

/**
 * Recipient hasn't claimed any of the paid messages yet, so no thread
 * exists. Nudge them to scroll up and claim — once they do, the
 * 1-day reply window opens automatically.
 */
function WaitingClaimRecipientCta() {
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[.05] p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-200">
          <ShieldCheck size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Claim to open the thread</div>
          <p className="text-xs text-muted mt-0.5">
            Pull the tip on-chain to reveal the amount and unlock a 1-day
            window where you can reply for free.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Sender's view while waiting for the recipient to claim. The composer
 * is intentionally inert — there's no chat to participate in until the
 * recipient pulls the tip and the thread opens.
 */
function WaitingClaimSenderCta({
  recipientHandle,
}: {
  recipientHandle: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-muted">
          <Hourglass size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">
            Waiting for @{recipientHandle} to claim
          </div>
          <p className="text-xs text-muted mt-0.5">
            Once they pull the tip on-chain, you&apos;ll have 1 day to chat
            back and forth in this thread for free.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Brief stand-in shown while we know the anchor message is claimed
 * but the new `threads/{threadId}` snapshot hasn't landed yet. We
 * intentionally render a neutral placeholder instead of either the
 * "active" textarea or the "expired" CTA, both of which would be
 * misleading for the ~100 ms window between snapshots.
 */
function LoadingPlaceholder() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
      <div className="text-xs text-muted">Opening thread…</div>
    </div>
  );
}

/**
 * Thread window has elapsed. Either side can revive the thread by
 * sending a fresh paid message; once the recipient claims it, a new
 * 1-day window opens.
 */
function ExpiredCta({ recipientHandle }: { recipientHandle: string }) {
  return (
    <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/[.05] p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center text-yellow-200">
          <Lock size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Reply thread closed</div>
          <p className="text-xs text-muted mt-0.5">
            The 1-day reply window has ended. Send a fresh paid message to
            @{recipientHandle} to reopen the thread.
          </p>
          <Link
            href={`/${recipientHandle}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-tr from-brand-500 to-brand-300 text-white text-sm font-medium h-9 px-4 hover:from-brand-400 hover:to-brand-200 transition-colors"
          >
            Send a paid message <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Convert plain-text chat input into the small subset of HTML the server
 * sanitizer keeps. Each line becomes a `<p>`; empty lines become `<br>`s
 * so consecutive newlines survive the round-trip.
 */
function textToHtml(s: string): string {
  const escaped = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped.split(/\n{2,}/);
  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
