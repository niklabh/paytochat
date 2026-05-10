/**
 * Shared helpers for the deploy/admin scripts.
 *
 * Every script in this folder follows the same shape:
 *   1. Resolve cluster + wallet from `--cluster` / env (`ANCHOR_PROVIDER_URL`,
 *      `ANCHOR_WALLET`). Defaults to localnet + the standard CLI keypair so a
 *      script can be smoke-tested against `solana-test-validator`.
 *   2. Load the IDL emitted by `anchor build` and instantiate `Program`.
 *      The Program ID is read from `idl.address`, so rotating the keypair
 *      (e.g. when generating a fresh one for mainnet per SOLANA.md §2.2)
 *      does not require editing any script.
 *   3. Run a single instruction, print the tx signature + Solana Explorer
 *      link.
 *
 * Run with:
 *   ts-node solana/scripts/<name>.ts [--cluster devnet|mainnet|localnet|<rpc-url>]
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { PaytochatEscrow } from "../target/types/paytochat_escrow";

export type EscrowProgram = Program<PaytochatEscrow>;

const CLUSTER_URLS: Record<string, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

const SEED_CONFIG = Buffer.from("config");
const SEED_TOKEN_CONFIG = Buffer.from("token_config");
const SEED_VAULT = Buffer.from("vault");
const SEED_VAULT_AUTHORITY = Buffer.from("vault_authority");

export interface ParsedArgs {
  cluster: string;
  rpcUrl: string;
  rest: Record<string, string>;
  flags: Set<string>;
}

/**
 * Tiny CLI parser that understands `--key value`, `--key=value`, and
 * boolean flags. Anything not consumed is returned in `rest` so callers
 * can pluck script-specific options.
 *
 * `--cluster` (or env `ANCHOR_PROVIDER_URL`) accepts a named cluster
 * (`devnet` / `mainnet` / `localnet`) or a full RPC URL.
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const rest: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    const eq = arg.indexOf("=");
    if (eq !== -1) {
      rest[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.add(key);
    } else {
      rest[key] = next;
      i++;
    }
  }

  const clusterRaw =
    rest.cluster ?? process.env.ANCHOR_PROVIDER_URL ?? "localnet";
  delete rest.cluster;

  const rpcUrl = clusterRaw.startsWith("http")
    ? clusterRaw
    : (CLUSTER_URLS[clusterRaw] ??
      (() => {
        throw new Error(
          `unknown --cluster '${clusterRaw}'. Use one of: ${Object.keys(
            CLUSTER_URLS,
          ).join(", ")} or pass a full RPC URL.`,
        );
      })());

  const cluster =
    Object.entries(CLUSTER_URLS).find(([, url]) => url === rpcUrl)?.[0] ??
    "custom";

  return { cluster, rpcUrl, rest, flags };
}

function expandHome(p: string): string {
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return p;
}

/**
 * Build an AnchorProvider from `--wallet` / `ANCHOR_WALLET` (defaults to
 * the standard Solana CLI keypair location). Sets it as the global
 * provider so subsequent `Program` instantiations pick it up.
 */
export function loadProvider(args: ParsedArgs): anchor.AnchorProvider {
  const walletPath = expandHome(
    args.rest.wallet ??
      process.env.ANCHOR_WALLET ??
      `${homedir()}/.config/solana/id.json`,
  );
  delete args.rest.wallet;

  const keypair = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8"))),
  );
  const wallet = new anchor.Wallet(keypair);

  const connection = new anchor.web3.Connection(args.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  return provider;
}

/**
 * Load the program from `solana/target/idl/paytochat_escrow.json` and
 * instantiate `Program`. Program ID is read from `idl.address` so the
 * scripts work without modification after `anchor keys sync`.
 */
export function loadProgram(provider: anchor.AnchorProvider): {
  program: EscrowProgram;
  programId: PublicKey;
} {
  const idlPath = resolve(__dirname, "../target/idl/paytochat_escrow.json");
  const idl = JSON.parse(readFileSync(idlPath, "utf8"));

  if (!idl.address) {
    throw new Error(
      `IDL at ${idlPath} has no 'address' field. Run \`anchor build\` first.`,
    );
  }

  const program = new Program<PaytochatEscrow>(
    idl as PaytochatEscrow,
    provider,
  );
  return { program, programId: new PublicKey(idl.address) };
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEED_CONFIG], programId)[0];
}

export function vaultAuthorityPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEED_VAULT_AUTHORITY], programId)[0];
}

export function tokenConfigPda(
  programId: PublicKey,
  mint: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED_TOKEN_CONFIG, mint.toBuffer()],
    programId,
  )[0];
}

export function vaultPda(programId: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED_VAULT, mint.toBuffer()],
    programId,
  )[0];
}

/**
 * Parse a script arg as a Pubkey, supporting both `--name <pubkey>`
 * and an env-var fallback. Throws with a clear message if the value is
 * missing or malformed.
 */
export function requirePubkey(
  args: ParsedArgs,
  name: string,
  envName?: string,
): PublicKey {
  const raw = args.rest[name] ?? (envName ? process.env[envName] : undefined);
  if (!raw) {
    const hint = envName ? `--${name} <PUBKEY>  (or env ${envName})` : `--${name} <PUBKEY>`;
    throw new Error(`missing required arg: ${hint}`);
  }
  delete args.rest[name];
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`invalid pubkey for --${name}: ${raw}`);
  }
}

/** Same shape as requirePubkey but returns null instead of throwing. */
export function optionalPubkey(
  args: ParsedArgs,
  name: string,
  envName?: string,
): PublicKey | null {
  const raw = args.rest[name] ?? (envName ? process.env[envName] : undefined);
  if (!raw) return null;
  delete args.rest[name];
  return new PublicKey(raw);
}

/**
 * Print a tx signature with a clickable Solana Explorer link for the
 * cluster the script ran against.
 */
export function logTx(cluster: string, sig: string): void {
  const param =
    cluster === "mainnet" || cluster === "mainnet-beta"
      ? ""
      : cluster === "custom"
        ? "?cluster=custom"
        : `?cluster=${cluster}`;
  console.log(`tx: ${sig}`);
  console.log(`    https://explorer.solana.com/tx/${sig}${param}`);
}

export function warnUnknownArgs(args: ParsedArgs): void {
  const unknown = [
    ...Object.keys(args.rest),
    ...Array.from(args.flags).filter(
      (f) => !["help", "h", "yes"].includes(f),
    ),
  ];
  if (unknown.length > 0) {
    console.warn(`warning: unknown args ignored: ${unknown.join(", ")}`);
  }
}
