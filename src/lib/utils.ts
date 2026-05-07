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

export function slugifyHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}

// Names that collide with top-level app routes / static assets. The dynamic
// `/[handle]` route lives at the root, so any handle equal to one of these
// would never resolve to a profile page.
const RESERVED_HANDLES = new Set([
  "a",
  "api",
  "app",
  "admin",
  "www",
  "favicon",
  "robots",
  "sitemap",
  "_next",
]);

export function isValidHandle(input: string): boolean {
  if (!/^[a-z0-9_]{3,24}$/.test(input)) return false;
  if (RESERVED_HANDLES.has(input)) return false;
  return true;
}
