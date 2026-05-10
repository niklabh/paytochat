/**
 * Initialize the PayToChatEscrow program — creates the `Config` PDA and
 * the `vault_authority` PDA. Callable exactly once per Program ID
 * (Anchor's `init` constraint enforces this).
 *
 * Usage:
 *   ts-node solana/scripts/initialize.ts \
 *     --cluster devnet \
 *     --admin <ADMIN_PUBKEY> \
 *     --fee-bps 250
 *
 * Or via env vars:
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   ADMIN_PUBKEY=<SQUADS_VAULT_PUBKEY> \
 *   FEE_BPS=250 \
 *     ts-node solana/scripts/initialize.ts
 *
 * Notes:
 * - `admin` may differ from the deployer/payer. For production it
 *   should be a Squads multisig vault — see SOLANA.md §7.1.
 * - `fee_bps` is hard-capped at 1000 (10%) by the on-chain program;
 *   passing a larger value reverts with `FeeTooHigh`.
 */

import { SystemProgram } from "@solana/web3.js";
import {
  parseArgs,
  loadProvider,
  loadProgram,
  configPda,
  vaultAuthorityPda,
  requirePubkey,
  logTx,
  warnUnknownArgs,
} from "./_lib";

async function main() {
  const args = parseArgs();
  const provider = loadProvider(args);
  const { program, programId } = loadProgram(provider);

  const admin = requirePubkey(args, "admin", "ADMIN_PUBKEY");
  const feeBpsRaw = args.rest["fee-bps"] ?? process.env.FEE_BPS ?? "250";
  delete args.rest["fee-bps"];
  const feeBps = Number.parseInt(feeBpsRaw, 10);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) {
    throw new Error(`invalid --fee-bps ${feeBpsRaw} (must be 0-1000)`);
  }

  warnUnknownArgs(args);

  const config = configPda(programId);
  const vaultAuthority = vaultAuthorityPda(programId);

  console.log(`cluster        : ${args.cluster} (${args.rpcUrl})`);
  console.log(`program        : ${programId.toBase58()}`);
  console.log(`payer (deploy) : ${provider.wallet.publicKey.toBase58()}`);
  console.log(`admin          : ${admin.toBase58()}`);
  console.log(`fee_bps        : ${feeBps} (${(feeBps / 100).toFixed(2)}%)`);
  console.log(`config PDA     : ${config.toBase58()}`);
  console.log(`vault_authority: ${vaultAuthority.toBase58()}`);
  console.log("");

  const existing = await provider.connection.getAccountInfo(config);
  if (existing) {
    throw new Error(
      `Config PDA ${config.toBase58()} already exists on this cluster — initialize is single-shot.`,
    );
  }

  const sig = await program.methods
    .initialize(admin, feeBps)
    .accountsPartial({
      payer: provider.wallet.publicKey,
      config,
      vaultAuthority,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("initialized.");
  logTx(args.cluster, sig);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
