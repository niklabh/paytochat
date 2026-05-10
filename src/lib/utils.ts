import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount < 1 ? 2 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function shortAddress(addr: string, chars = 4): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}

export function timeAgo(date: Date | number): string {
  const ts = typeof date === "number" ? date : date.getTime();
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.floor(mon / 12)}y ago`;
}

/**
 * Coerces a Firestore Timestamp / number / null into a millisecond epoch,
 * with a fallback when the value is missing (e.g. server-stamped fields
 * still pending on the snapshot we just emitted).
 */
export function toMs(
  t: number | { toMillis?: () => number } | null | undefined,
  fallback = Date.now()
): number {
  if (t == null) return fallback;
  if (typeof t === "number") return t;
  if (typeof t.toMillis === "function") return t.toMillis();
  return fallback;
}

/** Formats `ms` (a future millisecond delta) as `1d 2h`, `45m`, `15s`, or `now`. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s <= 0) return "now";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

export function slugifyHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}

// Names that collide with top-level app routes / static assets. The dynamic
// `/[handle]` route lives at the root, so any handle equal to one of these
// would never resolve to a profile page.
// Handles use `[a-z0-9_]` so dashed route names (`apple-icon`, `icon-512`)
// can never collide. Only reserve route names that match the handle regex.
const RESERVED_HANDLES = new Set([
  "a",
  "api",
  "app",
  "admin",
  "www",
  "favicon",
  "robots",
  "sitemap",
  "manifest",
  "icon",
  "terms",
  "privacy",
  "_next",
]);

export function isValidHandle(input: string): boolean {
  if (!/^[a-z0-9_]{3,24}$/.test(input)) return false;
  if (RESERVED_HANDLES.has(input)) return false;
  return true;
}
