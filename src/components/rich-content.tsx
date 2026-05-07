"use client";

import { cn } from "@/lib/utils";

interface RichContentProps {
  html: string;
  className?: string;
}

/**
 * Renders message HTML. The body has already been sanitized server-side by
 * `sanitizeMessageHtml` before being persisted, and Firestore rules prevent
 * any client from writing to `messages` directly — only the Admin-SDK-backed
 * API route can create them. We can render the trusted markup directly.
 */
export function RichContent({ html, className }: RichContentProps) {
  return (
    <div
      className={cn("prose-message", className)}
      dangerouslySetInnerHTML={{ __html: html || "" }}
    />
  );
}
