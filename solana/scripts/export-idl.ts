/**
 * Copy the freshly-built Anchor IDL + TypeScript types into the
 * Next.js app at `src/lib/payments/`, so the client and server share
 * a typed `program.methods.*` surface and the on-chain Program ID.
 *
 * Run after every `anchor build`:
 *   ts-node solana/scripts/export-idl.ts
 *
 * Mirrors what `contracts/scripts/export-abi.ts` does for the EVM
 * side. See SOLANA.md §9.2.
 */

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const root = resolve(__dirname, "../..");

const COPIES: Array<[string, string]> = [
  [
    resolve(__dirname, "../target/idl/paytochat_escrow.json"),
    resolve(root, "src/lib/payments/sol-escrow-idl.json"),
  ],
  [
    resolve(__dirname, "../target/types/paytochat_escrow.ts"),
    resolve(root, "src/lib/payments/sol-escrow-types.ts"),
  ],
];

for (const [src, dst] of COPIES) {
  if (!existsSync(src)) {
    console.error(`missing ${src} — run \`anchor build\` first.`);
    process.exit(1);
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`wrote ${dst.replace(root + "/", "")}`);
}
