/**
 * Allow or disallow an SPL mint for new deposits.
 *
 * The first call per mint also creates the per-mint Vault token
 * account + the TokenConfig PDA (~0.002 SOL rent, paid by --payer).
 * Existing pending payments in a now-disallowed mint can still be
 * claimed and refunded — the allowlist only gates new deposits.
 *
 * Must be signed by the program's `Config.admin`. For production this
 * is the Squads multisig vault, in which case use Squads' Program
 * Interaction UI instead of this script (see SOLANA.md §7.2). This
 * script is for devnet / dry-run / single-key-admin setups.
 *
 * Usage:
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
 *   USDC  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 *   USDT  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
 * Devnet:
 *   USDC  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
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
