# Deploying paytochat-escrow on Solana + wiring the frontend

End-to-end runbook: from a fresh checkout to a paytochat.fun production
where senders escrow USDC/USDT into the Anchor program on Solana
mainnet, recipients claim, and unclaimed tips can be refunded after a
deadline.

The Anchor program lives in [`solana/`](./solana/); the security model
and account layout are documented in
[`solana/README.md`](./solana/README.md). This doc focuses on
**operating** it — building, deploying, initializing, wiring the
Next.js app, and running it.

The EVM equivalent (Solidity / Hardhat) lives in
[`DEPLOYMENT.md`](./DEPLOYMENT.md). Both share the same `payment_id`
flow so the off-chain layer stays chain-agnostic.

---

## TL;DR

| Step | What | Where |
| --- | --- | --- |
| 1 | Install toolchain (Solana CLI, Anchor, Node) | local machine |
| 2 | Generate deployer wallet + program keypair | `~/.config/solana/`, `solana/target/deploy/` |
| 3 | Build & test locally | `solana/` |
| 4 | Devnet dry-run + smoke test | devnet |
| 5 | Pre-mainnet checklist | this doc, §6 |
| 6 | Mainnet deploy | mainnet-beta |
| 7 | Transfer upgrade authority to Squads | mainnet-beta |
| 8 | Initialize + allowlist USDC/USDT (multisig) | Squads UI |
| 9 | Smoke-test on mainnet with $1 USDC | mainnet-beta |
| 10 | Wire Next.js app | `src/lib/payments/*`, env vars |
| 11 | Operate it | fee withdrawals, monitoring, kill switch |

---

## 0. Where you are today

This repo is in the following state (as of the last `anchor test`):

- Solana toolchain pinned: **Anchor 0.32.1**, Solana CLI **3.x (Agave)**, Node **24**.
- Program source: [`solana/programs/paytochat-escrow/src/lib.rs`](./solana/programs/paytochat-escrow/src/lib.rs).
- Local test suite: **12/12 passing** (`cd solana && anchor test`).
- Local program ID stored in
  `solana/target/deploy/paytochat_escrow-keypair.json` and mirrored into
  `solana/Anchor.toml` + `declare_id!()` in `lib.rs`.
- A local Solana keypair exists at `~/.config/solana/id.json` (no
  passphrase, generated for tests). **It is not safe for mainnet.**
- The Next.js app already verifies legacy direct SPL transfers in
  [`src/lib/payments/verify.ts`](./src/lib/payments/verify.ts); the
  escrow-program wiring is not yet hooked up.

If you're picking this up fresh on a new machine, start at step 1.
Otherwise jump to step 2 (production wallets) or step 4 (devnet).

---

## 1. Install the toolchain

The official bundled installer ships Rust, Solana CLI (Agave), Anchor,
Node, Yarn, and Surfpool in one shot. The legacy `release.solana.com`
URL is deprecated — see <https://solana.com/docs/intro/installation>.

- [ ] Accept the macOS Xcode SDK license:
      `sudo xcodebuild -license`
- [ ] Run the bundled installer:
      `curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash`
- [ ] Re-source your shell so PATH picks up the new bins:
      `exec $SHELL -l`
- [ ] If `solana` still isn't on PATH, append to `~/.zshrc`:
      `export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"`
- [ ] Verify versions:
      `rustc --version && solana --version && anchor --version && node --version`
      Expected: rustc 1.91+, solana-cli 3.x (Agave), anchor-cli 0.32.1,
      Node v24.x.
- [ ] Install JS deps for the Anchor test suite:
      `cd solana && npm install`

> **Anchor version mismatch?** This repo pins `anchor_version = "0.32.1"`
> in [`solana/Anchor.toml`](./solana/Anchor.toml). If your global
> `anchor` is on a different major, install
> [`avm`](https://www.anchor-lang.com/docs/installation#installing-using-anchor-version-manager-avm-recommended)
> and `avm use 0.32.1` inside the `solana/` folder.

---

## 2. Production wallets

You need **two** Solana keypairs in production, kept strictly separate:

1. **Deployer wallet** — pays for the deploy transaction + program rent.
   Burned after deploy; can be a hot wallet.
2. **Program keypair** — defines the on-chain Program ID. Cannot
   change once deployed. **Back this up like a hardware-token seed.**

You'll also need a third entity that's not a keypair: a **Squads
multisig** that takes over the program's upgrade authority and acts
as the on-chain `Config.admin`.

### 2.1 Generate the production deployer

The keypair already at `~/.config/solana/id.json` is a no-passphrase
test key. Don't use it for mainnet.

- [ ] Move the test keypair aside:
      `mv ~/.config/solana/id.json ~/.config/solana/id.localnet.json`
- [ ] Generate a fresh deployer **with** a BIP-39 passphrase:
      `solana-keygen new --outfile ~/.config/solana/id.json`
      Save the seed phrase + passphrase in 1Password under
      "paytochat solana deployer".
- [ ] Confirm: `solana address` prints the new pubkey.
- [ ] Fund the deployer with ~3 SOL (mainnet) for the deploy buffer
      and rent. Devnet: `solana airdrop 5` (requires
      `solana config set --url devnet` first).

> **Hardware wallet alternative.** For higher assurance, use a Ledger:
> `solana config set --keypair usb://ledger`. Anchor will prompt the
> Ledger to sign the deploy. The deploy buffer needs ~2.5 SOL routed
> through the Ledger address.

### 2.2 Mint a fresh program keypair for production

The local `solana/target/deploy/paytochat_escrow-keypair.json` was
generated by a dev `anchor build` and should be regenerated from
scratch for mainnet so its provenance is clean.

- [x] Move the dev program keypair aside:
      `mv solana/target/deploy/paytochat_escrow-keypair.json solana/target/deploy/paytochat_escrow-keypair.devnet.json`
- [x] Generate a fresh, no-passphrase program keypair (it's only
      used at deploy time):
      `solana-keygen new --no-bip39-passphrase --outfile solana/target/deploy/paytochat_escrow-keypair.json`
- [ ] Sync `declare_id!()` and `Anchor.toml` to the new pubkey:
      `cd solana && anchor keys sync`
- [ ] Mirror the new ID into `[programs.devnet]` and `[programs.mainnet]`
      in [`solana/Anchor.toml`](./solana/Anchor.toml) — `keys sync`
      only updates the active cluster.
- [x] Rebuild so the new ID is baked into the `.so`:
      `anchor build`
- [x] **Back up the program keypair offline** (1Password attachment +
      a hardware token like a YubiKey). Losing it permanently locks
      out future upgrades on this Program ID.
- [x] Commit the synced `Anchor.toml` and `lib.rs` so production builds
      are reproducible. **Do not commit** the program keypair — it's
      already in [`solana/.gitignore`](./solana/.gitignore).

### 2.3 Create the Squads multisig

This will own the program's upgrade authority **and** be passed as
`admin` to `initialize`. They're separate roles on-chain but a single
Squads can hold both.

- [ ] Visit <https://squads.so> and create a multisig on **Solana
      mainnet** (not devnet).
- [ ] Pick at least 2 signers (3-of-5 is healthy). At least one
      signer's key in cold storage.
- [ ] Copy the multisig **vault** address (not the squad address). This
      is the Pubkey you'll pass to `set-upgrade-authority` and to
      `initialize`.
- [ ] Document who holds each signer key, where, and how to reach them.

---

## 3. Build & test locally

- [ ] `cd solana`
- [ ] `anchor build` — produces
      `target/deploy/paytochat_escrow.so` + `target/idl/paytochat_escrow.json`
      + `target/types/paytochat_escrow.ts`.
- [ ] `anchor test` — spins up `solana-test-validator` and runs the
      TypeScript suite in [`tests/paytochat-escrow.ts`](./solana/tests/paytochat-escrow.ts).
- [x] All 12 tests must pass. Anything red blocks deploy.

The suite covers `initialize`, `set_fee_bps`, `set_token_allowed`,
`set_paused`, `transfer_admin` / `accept_admin`, `deposit` happy +
revert paths, `claim`, `refund`, `withdraw_fees`, and the
pause-blocks-deposit-but-not-claim/refund invariant.

---

## 4. Devnet dry-run

Devnet validates the entire flow against real RPCs and a real
toolchain output without spending mainnet SOL. **Always do this
before mainnet, even on a small contract change.**

### 4.1 Configure the CLI for devnet

- [ ] `solana config set --url devnet`
- [ ] `solana airdrop 5` (retry a few times — devnet faucets are flaky)
- [ ] `solana balance` — should report ~5 SOL on your deployer.

### 4.2 Deploy

- [ ] `cd solana && anchor deploy --provider.cluster devnet`
- [ ] Capture the printed `Program Id` — it must equal
      `anchor keys list`. If it doesn't, re-run `anchor keys sync`
      and rebuild.
- [ ] Verify on Solana Explorer (devnet):
      `https://explorer.solana.com/address/<PROGRAM_ID>?cluster=devnet`

### 4.3 Initialize on devnet

The deploy/admin scripts already live in
[`solana/scripts/`](./solana/scripts/) — they read the IDL emitted
by `anchor build` and pick up the Program ID from `idl.address`, so
they keep working after a `anchor keys sync` rotation.

- [ ] Pick the admin pubkey. For devnet, your deployer is fine.
      For dress-rehearsal of the mainnet flow, use a devnet Squads.
- [ ] Run the initialize script with `fee_bps = 250` (2.5%):
      ```bash
      cd solana
      npm run initialize -- \
        --cluster devnet \
        --admin <ADMIN_PUBKEY> \
        --fee-bps 250
      ```
      (Or `ts-node scripts/initialize.ts --cluster devnet ...` directly.)
      The script refuses to re-initialize if the `Config` PDA already
      exists, so it's safe to re-run.
- [ ] Allowlist devnet USDC mint
      `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`:
      ```bash
      cd solana
      npm run set-token-allowed -- \
        --cluster devnet \
        --mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
        --allowed true
      ```
      (No devnet USDT exists. For a USDT dry-run, use a custom mint via
      `spl-token create-token`.) Run a second time with
      `--allowed false` to revoke a mint without affecting still-pending
      payments.

The scripts share a small CLI in
[`solana/scripts/_lib.ts`](./solana/scripts/_lib.ts): every script
accepts `--cluster {localnet|devnet|testnet|mainnet|<rpc-url>}` and
`--wallet <path>` (defaults to the env vars `ANCHOR_PROVIDER_URL` /
`ANCHOR_WALLET` and finally to `~/.config/solana/id.json`). All
script-specific args also accept env-var equivalents (`ADMIN_PUBKEY`,
`FEE_BPS`, `MINT`, `ALLOWED`).

### 4.4 Smoke-test on devnet

End-to-end with $0.01-equivalent USDC. Use a freshly-funded wallet
to play "sender" and another for "recipient".

- [ ] Get devnet USDC: <https://faucet.circle.com> → choose Solana
      Devnet.
- [ ] From the sender wallet, build & send a `deposit(payment_id, 10000, deadline)`
      (10 000 = 0.01 USDC, 6 decimals).
- [ ] From the recipient wallet, send `claim(payment_id)`. Expect
      `0.01 - fee` USDC in the recipient ATA, fees accumulating in
      the per-mint vault accounting.
- [ ] Repeat with a second `payment_id`, **don't** claim, wait past
      the deadline (set deadline to ~30 s for the test), then send
      `refund(payment_id)` from the sender. Expect full amount back.
- [ ] In `solana logs <PROGRAM_ID> --url devnet`, confirm the
      `Deposited`, `Claimed`, `Refunded` events fired with the right
      paymentIds.

---

## 5. Pre-mainnet checklist

Don't proceed past this section without ticking every box.

- [ ] `anchor test` green on a clean clone of the exact commit you'll
      deploy.
- [ ] All four flows (deposit / claim / refund / withdraw_fees)
      manually verified on devnet.
- [ ] External audit completed by Neodyme, OtterSec, or Halborn.
      Audit report archived in the repo (or its private mirror)
      alongside the commit hash that was reviewed.
- [ ] Reproducible build verified via
      [solana-verifiable-build](https://github.com/Ellipsis-Labs/solana-verifiable-build):
      ```bash
      solana-verify build
      solana-verify get-program-hash <PROGRAM_ID> --url mainnet
      ```
      Hashes match.
- [ ] Squads multisig exists on mainnet and you have the vault Pubkey.
- [ ] At least one Squads signer key in cold storage.
- [ ] Indexer / Helius webhooks pre-configured for events
      `DepositedEvent`, `ClaimedEvent`, `RefundedEvent`,
      `FeesWithdrawnEvent`.
- [ ] Treasury ATA pre-created for both USDC and USDT mints (the
      `withdraw_fees` destination must be a token account, not a
      bare wallet).
- [ ] Production program keypair backed up offline + at least one
      offsite copy.
- [ ] On-call rotation knows: how to pause, how to reach a quorum of
      Squads signers, and where the Program ID + keypair are stored.
- [ ] FAQ + ToS mention the fee bps and the deadline policy.

---

## 6. Mainnet deploy

### 6.1 Switch CLI to mainnet

- [ ] `solana config set --url mainnet-beta`
- [ ] `solana balance` — confirm ~3 SOL on the deployer.
- [ ] Bump the priority fee env to avoid stuck transactions during
      congestion:
      `export ANCHOR_PRIORITY_FEE=50000` (microlamports/CU).

### 6.2 Deploy

- [ ] `cd solana && anchor deploy --provider.cluster mainnet`
- [ ] Capture the printed `Program Id` and the deploy tx signature.
      Append both to [`deployment.log`](./deployment.log) under a new
      `# Solana mainnet` block.

If the deploy buffer fails partway (network burp), recover with:

```bash
solana program deploy-buffer-from-keypair \
  ~/.config/solana/buffer-keypair.json \
  --program-id BBxr7wYZwBv8Kgjz9tmrDnJoSKJxRi28hCzd2cWXhxWj \
  --url mainnet-beta
```

(Use the buffer keypair Anchor printed; never re-deploy from scratch
unless you've explicitly closed the prior buffer.)

### 6.3 Transfer upgrade authority to Squads

**Do this immediately, before announcing the Program ID anywhere.**
Until upgrade authority is on a multisig, your hot deployer key can
unilaterally replace the program.

- [ ] Set the Squads vault as the new upgrade authority:
      ```bash
      solana program set-upgrade-authority EFfsYcyU8L6K7rKGW5wbwrn5EiVqhL6yyr6xBqxc3rwB \
        --new-upgrade-authority E1Q6Lxqg7r5adRvNgadA3jtEGKryX6Dug7dgW9tYZQ8p
      ```
- [ ] Verify on Solana Explorer that `Program Authority` now reads the
      Squads vault address.
- [ ] Once the audit cycle is complete and you don't expect to upgrade
      further, retire upgrades entirely (irreversible):
      ```bash
      solana program set-upgrade-authority <PROGRAM_ID> --final
      ```

---

## 7. Initialize on mainnet

The `Config.admin` is **separate** from the upgrade authority. It
controls fees, pause, allowlisting, and fee withdrawals. Set it to the
same Squads multisig.

### 7.1 Initialize

- [ ] Run `initialize.ts` against mainnet, signed by the deployer,
      with the Squads vault as `admin`. Either as a one-shot env-var
      invocation:
      ```bash
      ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
      ANCHOR_WALLET=~/.config/solana/id.json \
      ADMIN_PUBKEY=<SQUADS_VAULT_PUBKEY> \
      FEE_BPS=250 \
        npm run initialize --prefix solana
      ```
      …or via the pre-baked `initpaytochat` shortcut already wired into
      `solana/package.json`, which pins the production admin pubkey and
      fee bps so you don't have to remember them at the prompt:
      ```bash
      cd solana
      npm run initpaytochat
      ```
      Edit the `initpaytochat` script in `solana/package.json` if the
      production admin or fee changes before deploy.
- [ ] Capture the tx signature in `deployment.log`.

`initialize` is callable exactly once; the Anchor `init` constraint on
the `Config` PDA enforces this.

### 7.2 Allowlist USDC + USDT (Squads tx)

`set_token_allowed` is `admin`-gated — it must be signed by the
Squads multisig.

USDC mainnet mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
USDT mainnet mint: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

For each mint:

- [ ] In Squads → New Transaction → Program Interaction, paste the
      Program ID and load the IDL from
      `solana/target/idl/paytochat_escrow.json`.
- [ ] Pick `set_token_allowed`, set `allowed = true`, set the `mint`
      account to USDC, payer to the Squads vault, and submit.
- [ ] Get the required quorum of signers to approve, then execute.
      The first call per mint creates the per-mint Vault token
      account (~0.002 SOL rent, paid by the payer).
- [ ] Repeat for USDT.
- [ ] Verify both mints show `is_allowed: true` by reading the
      `TokenConfig` PDA (Anchor: `program.account.tokenConfig.fetch(...)`).

### 7.3 USDG on Solana (Token-2022) — current status

USDG mainnet mint: `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH`

USDG is a **Token-2022** mint (owner program
`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) with these extensions
enabled on the mint:

- `mintCloseAuthority`, `metadataPointer`, `tokenMetadata`
- `permanentDelegate` — Paxos can move or burn USDG out of any wallet
- `transferFeeConfig` (currently 0 bps, but Paxos can raise it)
- `transferHook` (authority set, programId null today)
- `confidentialTransferMint` / `confidentialTransferFeeConfig`

The Anchor program in `programs/paytochat-escrow/src/lib.rs` is built
against the legacy SPL Token program (`anchor_spl::token::{Token,
TokenAccount, Transfer}`). It **cannot** custody Token-2022 mints as-is —
the `init` constraint for the per-mint Vault token account requires the
legacy program as owner.

What works today:

- ✅ **Frontend direct transfer**: `payOnSolana` in
  `src/lib/payments/client.ts` is Token-2022 aware and routes USDG
  through `TOKEN_2022_PROGRAM_ID`. End-to-end USDG sends on Solana work
  through this path right now — no on-chain action needed.
- ❌ **Anchor escrow**: skip `set_token_allowed` for the USDG mint until
  the program is upgraded; the script's vault-init will revert.

Upgrade path (separate work item):

1. Swap `anchor_spl::token` → `anchor_spl::token_interface` so the program
   accepts either token program; gate it on the mint's owner.
2. Re-deploy via the Squads multisig that holds the upgrade authority.
3. Then run §7.2 with the USDG mint to allowlist it.

Track this as a follow-up; the EVM side already supports USDG end-to-end
through `setTokenAllowed` (see [DEPLOYMENT.md §5](./DEPLOYMENT.md)).

---

## 8. Smoke-test mainnet with real money

Before flipping any frontend env vars, prove the contract works on
mainnet end-to-end with a tiny amount.

- [ ] Send yourself $1 of USDC into a fresh "sender" wallet.
- [ ] From the sender, deposit $1 to a "recipient" wallet of yours
      with a 5-minute deadline.
- [ ] From the recipient, claim. Confirm `1.00 - 0.025 = 0.975` USDC
      arrived at the recipient ATA and `0.025` shows up in
      `TokenConfig.accumulated_fees` for the USDC mint.
- [ ] Separately, deposit $0.50 with a 60-second deadline, **don't**
      claim, wait past the deadline, refund. Confirm full $0.50 back.
- [ ] In Solana Explorer, confirm `DepositedEvent`, `ClaimedEvent`,
      `RefundedEvent` firing with the expected paymentIds, senders,
      recipients, and amounts.
- [ ] Squads-sign a `withdraw_fees(USDC, treasuryATA)` for the
      accumulated $0.025. Confirm it lands and the bucket zeroes.

If any step fails, **pause the program** (Squads-sign
`set_paused(true)`) and root-cause before announcing.

---

## 9. Wire the Next.js app

The current Solana payment path in
[`src/lib/payments/verify.ts`](./src/lib/payments/verify.ts) verifies
**direct SPL transfers** to the recipient's ATA. For escrow, you swap
that for verifying a `Deposited` event from the program for a matching
`payment_id`. Mirror what the EVM section does in
[`DEPLOYMENT.md`](./DEPLOYMENT.md) §7.

### 9.1 Env vars

In `.env.local` and Vercel (Production + Preview):

- [ ] Add the program ID:
      ```bash
      NEXT_PUBLIC_SOL_ESCROW_PROGRAM_ID=<PROGRAM_ID>
      SOL_ESCROW_PROGRAM_ID=<PROGRAM_ID>
      ```
- [ ] Set a real RPC (public endpoints rate-limit hard):
      ```bash
      SOL_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
      NEXT_PUBLIC_SOL_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
      ```
- [ ] Default refund window in days:
      ```bash
      NEXT_PUBLIC_ESCROW_DEFAULT_DEADLINE_DAYS=7
      ```
      (already declared in [`src/lib/payments/escrow.ts`](./src/lib/payments/escrow.ts)
      for the EVM side — reuse it.)

### 9.2 Ship the IDL into the app bundle

The copy script already exists at
[`solana/scripts/export-idl.ts`](./solana/scripts/export-idl.ts) and
is wired into `solana/package.json` as `npm run export-idl`. It writes
into `src/lib/payments/sol-escrow-{idl.json,types.ts}` so the client
and server share a typed `program.methods.*` surface (mirrors the EVM
`contracts/scripts/export-abi.ts`).

- [ ] After every `anchor build`, sync the IDL + types into the app:
      ```bash
      cd solana
      npm run build && npm run export-idl
      ```
- [ ] Verify the destination files are present:
      `ls src/lib/payments/sol-escrow-{idl.json,types.ts}`
- [ ] (Optional) Add a `postbuild` hook so it runs automatically:
      ```jsonc
      // solana/package.json
      "scripts": {
        "build": "anchor build",
        "postbuild": "ts-node scripts/export-idl.ts",
        ...
      }
      ```

### 9.3 Sender flow: replace direct SPL transfer with `deposit`

The current sender flow lives in
[`src/app/[handle]/send-form.tsx`](./src/app/[handle]/send-form.tsx).
The Solana branch should:

- [ ] Generate a fresh 32-byte `payment_id` per send (`crypto.getRandomValues`).
- [ ] Build a `deposit(payment_id, amount, deadline)` instruction
      using the IDL and the wallet adapter. Required accounts:
      `config`, `mint`, `token_config`, `payment` (PDA from
      `["payment", payment_id]`), `recipient`, `vault`,
      `vault_authority`, `sender_token_account`, `sender`,
      `token_program`, `system_program`.
- [ ] Send + confirm the tx; capture `signature` as `txHash` and
      `payment_id` (hex-encoded).
- [ ] POST to `/api/messages/send` with the existing fields plus
      `paymentId`, `escrowProgramId`, and `chain: "solana"`.

### 9.4 Server verification: parse the `Deposited` event

In [`src/lib/payments/verify.ts`](./src/lib/payments/verify.ts) replace
the legacy `verifySolana` with a version that:

- [ ] Fetches the tx by signature.
- [ ] Confirms the tx targeted `SOL_ESCROW_PROGRAM_ID` (server-side env,
      never trust client).
- [ ] Decodes the `Deposited` event from `meta.logMessages` using
      Anchor's `BorshEventCoder` against the bundled IDL.
- [ ] Asserts `payment_id`, `recipient`, `mint`, and `amount ≥ minimum`
      match the request.
- [ ] Rejects if the same `payment_id` has already been used in
      Firestore.

Sketch:

```ts
import { BorshEventCoder } from "@coral-xyz/anchor";
import idl from "@/lib/payments/sol-escrow-idl.json";

const coder = new BorshEventCoder(idl as any);
const programLogPrefix = `Program log: `;
for (const line of tx.meta?.logMessages ?? []) {
  if (!line.startsWith(programLogPrefix)) continue;
  const decoded = coder.decode(line.slice(programLogPrefix.length));
  if (decoded?.name === "DepositedEvent" &&
      Buffer.from(decoded.data.paymentId).equals(expectedPaymentId)) {
    /* validate recipient / mint / amount, return ok */
  }
}
```

### 9.5 Claim and refund routes

Mirror the EVM new routes from `DEPLOYMENT.md` §7:

- [ ] `POST /api/messages/claim` — body `{ messageId, claimTxHash }`.
      Server re-verifies the `ClaimedEvent` with the matching
      `payment_id` fired in `claimTxHash`, then flips Firestore
      `status: "claimed"` via the Admin SDK.
- [ ] `POST /api/messages/refund` — same shape, verifies `RefundedEvent`,
      flips `status: "refunded"`.

### 9.6 UX

In the recipient dashboard
([`src/app/a/dashboard/c/[convId]/page.tsx`](./src/app/a/dashboard/c/[convId]/page.tsx))
and sender's sent page
(`src/app/a/dashboard/sent/page.tsx`):

- [ ] When a Solana message has `status: "paid"`, render a "Claim"
      CTA on the recipient side that builds a `claim(payment_id)`
      tx, sends it via the wallet adapter, and POSTs to
      `/api/messages/claim`.
- [ ] When a Solana message has `status: "paid"` and
      `Date.now() > escrowDeadline`, render a "Refund" CTA on the
      sender side mirroring the EVM flow.

---

## 10. Operational runbook

### 10.1 Withdraw accumulated fees

Monthly, or whenever a balance accrues that's worth the multisig
ceremony:

- [ ] In Squads, build a `withdraw_fees` tx for each mint with
      `destination = treasuryATA`. Required accounts: `config`,
      `admin` (Squads vault), `mint`, `token_config`, `vault`,
      `vault_authority`, `destination`, `token_program`.
- [ ] Approve + execute. Reverts cheaply with `NoFeesToWithdraw` if
      the bucket is empty, so safe to run speculatively.
- [ ] Log the tx signature + amount in your accounting sheet.

### 10.2 Pause (incident response)

If you spot a wallet-stealer phishing site, an audit-finding
exploit, or any user-impacting bug:

- [ ] Squads-sign `set_paused(true)`. Targets: `config` PDA + `admin`
      signer.
- [ ] Confirm via `program.account.config.fetch(configPda)` that
      `paused: true`.

This blocks **new deposits only**. Existing pending payments stay
fully claimable and refundable — by design, the admin can never trap
user funds.

To resume: Squads-sign `set_paused(false)`.

### 10.3 Indexing & monitoring

Subscribe to the four core events for off-chain reconciliation
(Helius webhooks are the lowest-friction path):

| Event | Reaction |
| --- | --- |
| `DepositedEvent` | Cross-check against Firestore — alert if a deposit lands without a matching `messages/{id}`. |
| `ClaimedEvent` | Update `status: "claimed"` if the client-side flow missed it. |
| `RefundedEvent` | Update `status: "refunded"`. |
| `FeesWithdrawnEvent` | Audit log for accounting. |

### 10.4 Migrating to a v2 program

- [ ] Deploy v2 with a fresh program keypair.
- [ ] Squads-sign `set_paused(true)` on v1 to stop new deposits.
- [ ] Update `NEXT_PUBLIC_SOL_ESCROW_PROGRAM_ID` + `SOL_ESCROW_PROGRAM_ID`
      in Vercel to v2 and redeploy. New deposits flow through v2.
- [ ] Leave v1 running (paused) until every Pending v1 payment is
      either claimed or refunded — typically `deadline_days + grace`.
      Monitor v1's vault balance trending to zero.
- [ ] Once v1 is drained, you can `set_upgrade_authority --final`
      on v1 and remove it from the indexer.

### 10.5 Upgrading in place (v1.x patch)

While the upgrade authority is still live and on a Squads:

- [ ] `cd solana && anchor build` against the patch commit.
- [ ] Hash-check via `solana-verify build` so signers can
      independently verify what they're signing.
- [ ] Squads-sign an `Upgrade` tx pointing at the new buffer:
      ```bash
      solana program write-buffer solana/target/deploy/paytochat_escrow.so \
        --url mainnet-beta
      # Squads tx: bpf_loader_upgradeable::Upgrade { buffer, programId, ... }
      ```
- [ ] Once upgraded, re-publish the IDL on-chain so explorers pick up
      the new schema:
      `anchor idl upgrade <PROGRAM_ID> --provider.cluster mainnet --filepath target/idl/paytochat_escrow.json`

---

## 11. Post-deploy paperwork

- [ ] Append to [`deployment.log`](./deployment.log):
      Program ID, deploy tx signature, deploy block, upgrade-authority
      Pubkey, `Config.admin` Pubkey, fee bps, allowlisted mints +
      `set_token_allowed` tx signatures.
- [ ] Publish the IDL on-chain so explorers display decoded data:
      ```bash
      anchor idl init --provider.cluster mainnet \
        --filepath solana/target/idl/paytochat_escrow.json <PROGRAM_ID>
      ```
- [ ] Submit the program for verified-build status via
      [solana-verifiable-build](https://github.com/Ellipsis-Labs/solana-verifiable-build).
- [ ] Update [`README.md`](./README.md) with the live Program ID under
      the "On-chain escrow" section.
- [ ] Tag the release in git: `git tag -a sol-v1.0.0 -m "..." && git push --tags`.

When every box on this page is ticked, switch the Solana branch of
the send form to default to the escrow flow and announce.
