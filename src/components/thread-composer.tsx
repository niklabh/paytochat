"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Lock, Send } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "./ui";
import { cn, formatCountdown } from "@/lib/utils";
import { toast } from "sonner";

interface ThreadComposerProps {
  /** Handle of the other participant — what we'll POST as `recipientHandle`. */
  recipientHandle: string;
  /** `true` while the conversation is inside an active cool-off window. */
  canSendFree: boolean;
  /** Future epoch ms when the cool-off ends, or `null` if not in cool-off. */
  coolOffUntilMs: number | null;
  /** Called after a successful send so the thread can scroll to bottom. */
  onSent?: () => void;
}

const MAX_PLAIN_LENGTH = 2000;

/**
 * Chat-style composer used inside a thread. While the conversation is in
 * cool-off it sends free messages via the existing `/api/messages/send`
 * endpoint. Once the cool-off expires it collapses to a CTA pointing at
 * the recipient's public page so the sender has to attach a fresh paid
 * message to revive the thread.
 */
export function ThreadComposer({
  recipientHandle,
  canSendFree,
  coolOffUntilMs,
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

  if (!canSendFree) {
    return <PaidCta recipientHandle={recipientHandle} />;
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
    coolOffUntilMs && coolOffUntilMs > now
      ? formatCountdown(coolOffUntilMs - now)
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

function PaidCta({ recipientHandle }: { recipientHandle: string }) {
  return (
    <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/[.05] p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center text-yellow-200">
          <Lock size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Cool-off ended</div>
          <p className="text-xs text-muted mt-0.5">
            Free replies in this chat have closed. Send a new paid message to
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
