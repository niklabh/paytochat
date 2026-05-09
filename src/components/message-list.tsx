"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  Coins,
  ImageIcon,
  Lock,
  MessageSquare,
  Send,
  Wallet,
  X,
} from "lucide-react";
import type { MessageDoc } from "@/lib/types";
import { Badge } from "./ui";
import { RichContent } from "./rich-content";
import { formatUSD, timeAgo } from "@/lib/utils";
import { htmlToPlainText, isHtmlBody } from "@/lib/rich-text";

interface MessageListProps {
  messages: MessageDoc[];
  onArchive: (id: string) => void;
}

export function MessageList({ messages, onArchive }: MessageListProps) {
  if (messages.length === 0) return <EmptyInbox />;
  return (
    <div className="space-y-2.5">
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} onArchive={onArchive} />
      ))}
    </div>
  );
}

/**
 * Inbox row. The whole card is a link to the thread — the thread page
 * handles the actual reveal (including the confetti animation) when the
 * recipient lands on it. Locked messages still render a blurred preview
 * here so the inbox feels alive.
 */
function MessageRow({
  message,
  onArchive,
}: {
  message: MessageDoc;
  onArchive: (id: string) => void;
}) {
  const isLocked = message.status === "paid";
  const href = `/a/dashboard/c/${encodeURIComponent(message.conversationId)}`;

  return (
    <Link
      href={href}
      className={[
        "block rounded-2xl border p-4 transition-colors",
        isLocked
          ? "border-white/10 bg-white/[.04] hover:bg-white/[.06]"
          : "border-emerald-500/15 bg-emerald-500/[.03] hover:bg-emerald-500/[.05]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <Avatar
          url={message.senderAvatarUrl}
          name={message.senderDisplayName || message.senderHandle}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-semibold leading-tight truncate">
                {message.senderDisplayName || message.senderHandle}
              </div>
              <div className="text-xs text-muted truncate">
                @{message.senderHandle} · {timeAgo(toMs(message.createdAt))}
              </div>
            </div>
            <RowBadge status={message.status} amountUSD={message.amountUSD} />
            <button
              onClick={(e) => {
                // Stop the click from bubbling up to the Link wrapper.
                e.preventDefault();
                e.stopPropagation();
                onArchive(message.id);
              }}
              title="Hide"
              className="text-muted hover:text-foreground p-1 rounded-md hover:bg-white/10 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {isLocked ? (
            <LockedPreview message={message} />
          ) : (
            <OpenedPreview message={message} />
          )}
        </div>
      </div>
    </Link>
  );
}

function LockedPreview({ message }: { message: MessageDoc }) {
  const preview = useMemo(() => {
    const plain = message.bodyPlain || htmlToPlainText(message.body || "");
    return plain || "•••••••••••••••••••••••••••••••••••••••••";
  }, [message.body, message.bodyPlain]);
  const hasImage = useMemo(
    () => /<img[\s>]/i.test(message.body || ""),
    [message.body]
  );

  return (
    <>
      <div className="mt-3 relative max-h-12 overflow-hidden">
        <p className="filter blur-md select-none pointer-events-none text-sm text-muted/70 leading-relaxed line-clamp-2">
          {preview}
        </p>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/30 to-background/80" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Lock size={11} /> Tip hidden — {message.token} on {message.chain}
          </span>
          {hasImage && (
            <span className="inline-flex items-center gap-1 text-xs text-brand-200">
              <ImageIcon size={11} /> includes image
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-tr from-brand-500 to-brand-300 text-white text-xs font-medium px-2.5 py-1.5">
          <MessageSquare size={12} /> Open thread
        </span>
      </div>
    </>
  );
}

function OpenedPreview({ message }: { message: MessageDoc }) {
  return (
    <>
      {isHtmlBody(message.body) ? (
        <RichContent html={message.body} className="mt-3 text-sm" />
      ) : (
        <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
          {message.body}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-xs">
          <Coins size={12} className="text-emerald-300" />
          <span className="text-emerald-200 font-semibold">
            {formatUSD(message.amountUSD)}
          </span>
          <span className="text-muted">
            in {message.token} on {message.chain}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-foreground">
          <MessageSquare size={12} /> Open thread
        </span>
      </div>
    </>
  );
}

function RowBadge({
  status,
  amountUSD,
}: {
  status: MessageDoc["status"];
  amountUSD: number;
}) {
  if (status === "paid") {
    return (
      <Badge className="bg-brand-500/15 border-brand-500/30 text-brand-200 whitespace-nowrap">
        <Lock size={10} /> paid
      </Badge>
    );
  }
  if (status === "opened") {
    return (
      <Badge className="bg-emerald-500/10 border-emerald-500/20 text-emerald-200 whitespace-nowrap">
        <Coins size={10} /> {formatUSD(amountUSD)}
      </Badge>
    );
  }
  return null;
}

function Avatar({ url, name }: { url?: string; name: string }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
    );
  }
  return (
    <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-tr from-brand-500 to-brand-300 flex items-center justify-center text-white font-bold">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function toMs(t: MessageDoc["createdAt"]): number {
  if (!t) return Date.now();
  if (typeof t === "number") return t;
  if (typeof (t as { toMillis?: () => number }).toMillis === "function") {
    return (t as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export function EmptyInbox() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.03] py-14 text-center px-6">
      <div className="mx-auto h-16 w-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4">
        <Send className="text-muted" size={24} />
      </div>
      <h3 className="text-lg font-semibold">All caught up</h3>
      <p className="mt-1 text-sm text-muted max-w-xs mx-auto">
        Share your link to start getting paid messages.
      </p>
    </div>
  );
}

export function WalletNote() {
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-muted flex items-center gap-2">
      <Wallet size={14} />
      Tips you receive go straight to your wallet — Pay to Chat never holds
      them.
    </div>
  );
}
