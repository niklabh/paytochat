/**
 * Allow or disallow an SPL mint for new deposits.
 *
 * The first call per mint also creates the per-mint Vault token
 * account + the TokenConfig PDA (~0.002 SOL rent, paid by --payer).
 * Existing pending payments in a now-disallowed mint can still be
 * claimed and refunded — the allowlist only gates new deposits.
 *
 * Must be signed by the program's `Config.admin`. The connected wallet
 * (default `~/.config/solana/id.json`, override via `ANCHOR_WALLET` or
 * `--wallet`) must equal `Config.admin` or the tx reverts with NotAdmin.
 * For a multisig admin (e.g. Squads), use the multisig's Program
 * Interaction UI instead — see SOLANA.md §7.2.
 *
 * Usage (via the `solana/` package script — note the `--` so npm forwards
 * the flags to ts-node):
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npm run set-token-allowed -- \
 *     --cluster mainnet \
 *     --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
 *     --allowed true
 *
 * Or invoke ts-node directly:
 *   ts-node solana/scripts/set-token-allowed.ts \
 *     --cluster devnet \
 *     --mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
 *     --allowed true
 *
 * Env-var equivalent:
 *   MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v ALLOWED=true \
 *     ts-node solana/scripts/set-token-allowed.ts
 *
 * Common mainnet mints:
 *   USDC  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v   (SPL legacy)
 *   USDT  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB   (SPL legacy)
 *   USDG  2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH   (Token-2022) ⚠
 *   PUSD  CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s   (Token-2022) ⚠
 * Devnet:
 *   USDC  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
 *
 * ⚠ USDG, PUSD, and any other Token-2022 mint will revert against the
 *   current program build. The instruction validates the mint and vault
 *   via `anchor_spl::token::{Mint, TokenAccount}`, which require the
 *   legacy SPL Token program as owner. Upgrade the program to
 *   `anchor_spl::token_interface` (Token-2022 + legacy in one surface)
 *   and re-deploy before allowlisting these mints.
 *
 *   The Next.js app does not depend on this — its Solana payment flow
 *   is a direct SPL transfer (see `payOnSolana` in
 *   `src/lib/payments/client.ts`) and already routes Token-2022 mints
 *   (USDG, PUSD) through `TOKEN_2022_PROGRAM_ID`. The escrow program
 *   is a POC for the future server-mediated flow.
 */

import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  parseArgs,
  loadProvider,
  loadProgram,
  configPda,
  vaultAuthorityPda,
  tokenConfigPda,
  vaultPda,
  requirePubkey,
  logTx,
  warnUnknownArgs,
} from "./_lib";

function parseBool(raw: string, name: string): boolean {
  const v = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  throw new Error(`invalid boolean for --${name}: ${raw}`);
}

async function main() {
  const args = parseArgs();
  const provider = loadProvider(args);
  const { program, programId } = loadProgram(provider);

  const mint = requirePubkey(args, "mint", "MINT");
  const allowedRaw = args.rest.allowed ?? process.env.ALLOWED ?? "true";
  delete args.rest.allowed;
  const allowed = parseBool(allowedRaw, "allowed");

  warnUnknownArgs(args);

  const config = configPda(programId);
  const vaultAuthority = vaultAuthorityPda(programId);
  const tokenConfig = tokenConfigPda(programId, mint);
  const vault = vaultPda(programId, mint);

  const cfg = await provider.connection.getAccountInfo(config);
  if (!cfg) {
    throw new Error(
      `Config PDA ${config.toBase58()} not found — run initialize.ts first.`,
    );
  }

  const cfgData = await program.account.config.fetch(config);
  const adminPk = cfgData.admin.toBase58();
  if (adminPk !== provider.wallet.publicKey.toBase58()) {
    console.warn(
      `warning: connected wallet ${provider.wallet.publicKey.toBase58()} is not the\n` +
        `         configured admin ${adminPk}. The tx will fail with NotAdmin\n` +
        `         unless this wallet is the admin (or its multisig signer).`,
    );
  }

  console.log(`cluster        : ${args.cluster} (${args.rpcUrl})`);
  console.log(`program        : ${programId.toBase58()}`);
  console.log(`admin (signer) : ${provider.wallet.publicKey.toBase58()}`);
  console.log(`mint           : ${mint.toBase58()}`);
  console.log(`allowed        : ${allowed}`);
  console.log(`token_config   : ${tokenConfig.toBase58()}`);
  console.log(`vault          : ${vault.toBase58()}`);
  console.log("");

  const sig = await program.methods
    .setTokenAllowed(allowed)
    .accountsPartial({
      config,
      admin: provider.wallet.publicKey,
      mint,
      tokenConfig,
      vault,
      vaultAuthority,
      payer: provider.wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log(`set_token_allowed(${allowed}) submitted.`);
  logTx(args.cluster, sig);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
