import "server-only";
import sanitizeHtml from "sanitize-html";
import { htmlToPlainText } from "./rich-text";

/** Tags allowed inside a message body. Mirrors what the Tiptap editor produces. */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "s",
  "u",
  "code",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "a",
  "img",
  "hr",
  "span",
];

/**
 * Sanitize an HTML message body. Removes scripts, event handlers, unsafe
 * URI schemes, and anything outside the allowed tag/attribute set. Forces
 * `target=_blank` + `rel=noopener noreferrer` on every link.
 *
 * Returns the sanitized HTML and a derived plain-text representation
 * (used for previews and length checks).
 */
export function sanitizeMessageHtml(input: string): {
  html: string;
  plainText: string;
} {
  const trimmed = (input || "").trim();
  if (!trimmed) return { html: "", plainText: "" };

  const html = sanitizeHtml(trimmed, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      "*": [],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https"],
      a: ["http", "https", "mailto"],
    },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      }),
    },
    disallowedTagsMode: "discard",
  });

  const plainText = htmlToPlainText(html);
  return { html, plainText };
}
