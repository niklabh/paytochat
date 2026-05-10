/**
 * Per-chain configuration for the PayToChatEscrow contract.
 *
 * The escrow address for each chain is configured via env vars rather
 * than hard-coded so deployments can be swapped without code changes:
 *
 *   NEXT_PUBLIC_ESCROW_ADDRESS_<chainId>=0x...     (browser-readable)
 *   ESCROW_ADDRESS_<chainId>=0x...                 (server-only mirror)
 *
 *   NEXT_PUBLIC_DEFAULT_EVM_CHAIN_ID=11155111      (default chain the
 *                                                  send form targets)
 *
 *   NEXT_PUBLIC_ESCROW_DEFAULT_DEADLINE_DAYS=7     (default refund window)
 *
 * The server should always prefer its private `ESCROW_ADDRESS_<chainId>`
 * over the client-supplied `escrowAddress` when verifying — never trust
 * the client's value.
 */

export const DEFAULT_EVM_CHAIN_ID = (() => {
  const raw =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_DEFAULT_EVM_CHAIN_ID
      : undefined;
  const n = Number.parseInt(raw || "1", 10);
  return Number.isFinite(n) ? n : 1;
})();

export const ESCROW_DEFAULT_DEADLINE_DAYS = (() => {
  const raw =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_ESCROW_DEFAULT_DEADLINE_DAYS
      : undefined;
  const n = Number.parseInt(raw || "7", 10);
  return Number.isFinite(n) && n > 0 ? n : 7;
})();

export const ESCROW_DEFAULT_DEADLINE_SECONDS =
  ESCROW_DEFAULT_DEADLINE_DAYS * 24 * 60 * 60;

/**
 * Static lookup tables built at module load.
 *
 * Why not a dynamic `process.env[`NEXT_PUBLIC_ESCROW_ADDRESS_${chainId}`]`?
 * Next.js's webpack DefinePlugin inlines `process.env.NEXT_PUBLIC_*` into
 * the client bundle ONLY when each access is a literal property access
 * (`process.env.NEXT_PUBLIC_FOO`). Computed-key access — even with a
 * template literal — does not get inlined and resolves to `undefined` in
 * the browser. Hence each entry below is a hand-written literal.
 *
 * Server-only `ESCROW_ADDRESS_<id>` vars are never exposed to the
 * browser; on the client every entry below is `undefined`, so we
 * transparently fall back to the public mirror.
 */
const PUBLIC_ESCROW_BY_CHAIN_ID: Record<number, string | undefined> = {
  1: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_1,
  11155111: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_11155111,
  8453: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_8453,
  84532: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_84532,
  42161: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_42161,
  10: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_10,
  137: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_137,
};

const SERVER_ESCROW_BY_CHAIN_ID: Record<number, string | undefined> = {
  1: process.env.ESCROW_ADDRESS_1,
  11155111: process.env.ESCROW_ADDRESS_11155111,
  8453: process.env.ESCROW_ADDRESS_8453,
  84532: process.env.ESCROW_ADDRESS_84532,
  42161: process.env.ESCROW_ADDRESS_42161,
  10: process.env.ESCROW_ADDRESS_10,
  137: process.env.ESCROW_ADDRESS_137,
};

/**
 * Resolve the configured escrow address for a chain. Returns `null` when
 * no escrow is configured for that chain — callers treat that as
 * "escrow flow unavailable on this chain".
 *
 * Priority:
 *   1. server-only `ESCROW_ADDRESS_<id>`         (server-side only)
 *   2. public        `NEXT_PUBLIC_ESCROW_ADDRESS_<id>`
 *
 * Server routes get the trusted server copy; the client only ever sees
 * the public mirror, which is exactly what we want.
 */
export function getEscrowAddress(chainId: number): `0x${string}` | null {
  const raw =
    SERVER_ESCROW_BY_CHAIN_ID[chainId] || PUBLIC_ESCROW_BY_CHAIN_ID[chainId];
  if (!raw) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as `0x${string}`;
}

/** Friendly display name for an EVM chainId. */
export function chainIdName(chainId: number): string {
  const m: Record<number, string> = {
    1: "Ethereum",
    11155111: "Sepolia",
    8453: "Base",
    84532: "Base Sepolia",
    42161: "Arbitrum One",
    10: "Optimism",
    137: "Polygon",
  };
  return m[chainId] ?? `EVM chain ${chainId}`;
}
