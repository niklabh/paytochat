/**
 * Universal helpers for rich-text message bodies. Safe to import from both
 * client and server. Server-only sanitization lives in `rich-text.server.ts`.
 */

/**
 * Cheap HTML → text. Replaces block boundaries with newlines, images with
 * `[image]`, then strips remaining tags and decodes basic entities.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  let s = html;
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\/(?:p|div|li|h2|h3|blockquote|ul|ol)>/gi, "\n");
  s = s.replace(/<img[^>]*>/gi, "[image]");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Does this body contain any rendered HTML tags? */
export function isHtmlBody(body: string | undefined | null): boolean {
  if (!body) return false;
  return /<\/?[a-z][\s\S]*?>/i.test(body);
}
