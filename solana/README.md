# paytochat-solana

Anchor program that mirrors the EVM
[`PayToChatEscrow`](../contracts/src/PayToChatEscrow.sol) on Solana, plus a
TypeScript test suite. Same flow, same security posture, same `payment_id`
keying so the off-chain layer stays chain-agnostic.

## What it does

`programs/paytochat-escrow/src/lib.rs` is a single-file Anchor program.

1. **Sender** calls `deposit(payment_id, amount, deadline)` and signs the
   SPL transfer; tokens land in the per-mint vault.
2. **Recipient** calls `claim(payment_id)`. Program transfers
   `amount - fee` from the vault to the recipient's ATA and credits `fee`
   to the per-mint `accumulated_fees` bucket.
3. **Sender** calls `refund(payment_id)` strictly after `deadline` if the
   recipient never claimed. Full amount, no fee.
4. **Admin** calls `withdraw_fees()` to sweep `accumulated_fees[mint]` to
   any token account. Cannot reach user-escrowed principal.

## Account layout

| PDA | Seeds | Stores |
| --- | --- | --- |
| `Config` | `["config"]` | admin, pending_admin, fee_bps, paused, bumps |
| `TokenConfig` | `["token_config", mint]` | is_allowed, accumulated_fees |
| `Vault` (token account) | `["vault", mint]` | the actual SPL principal + fees |
| `VaultAuthority` | `["vault_authority"]` | signer for every vault transfer |
| `Payment` | `["payment", payment_id]` | one per active deposit |

`payment_id` is a 32-byte off-chain-supplied identifier (typically a
fresh UUID padded to 32 bytes). Anchor's `init` constraint on the
`Payment` PDA rejects reuse while a previous deposit with that id is
still Pending.

## Security model

Same posture as the EVM contract; Solana-specific notes called out.

- **PDA-owned vaults.** All token accounts that hold user funds are owned
  by a single PDA at `["vault_authority"]`. Only this program, signing
  with the right seeds, can move tokens out.
- **Per-payment PDA accounts.** Anchor's `init` makes payment-id reuse
  while Pending impossible.
- **Two-step admin.** `transfer_admin` + `accept_admin` must be signed by
  the new admin. A typo cannot lock the program.
- **Hard-capped fee.** `MAX_FEE_BPS = 1_000` (10 %). Even a compromised
  admin cannot exceed it.
- **Pause is non-trapping.** `set_paused(true)` blocks new `deposit`s
  only. `claim` and `refund` always work, so user funds can never be
  trapped by the admin.
- **Allowlisted mints only.** Admin must explicitly enable each mint with
  `set_token_allowed`. Existing pending payments in a now-disallowed
  mint can still be claimed and refunded.
- **Effects before interactions.** `status`, `accumulated_fees`, and the
  `close` queue are updated before any SPL CPI. Solana's runtime forbids
  classic reentrancy (a program cannot recursively invoke itself), but
  this ordering is still good hygiene.
- **No rescue / no upgrade authority** (set the program upgrade authority
  to a multisig at deploy time and ideally retire it once the program is
  audited and stable). Direct token deposits to the vault that don't go
  through `deposit` are permanently stuck — a deliberate trade-off so
  the admin has no path to user principal.
- **Rent return.** When a payment is Claimed or Refunded, the Payment
  account is closed and its rent (~0.0011 SOL) returns to the original
  sender. This is the recipient or sender's "free money" but it's the
  correct destination — the sender paid the rent on `deposit`.

## Layout

```
solana/
├── Anchor.toml
├── Cargo.toml                   workspace manifest
├── package.json                 ts-mocha deps
├── tsconfig.json
├── programs/
│   └── paytochat-escrow/
│       ├── Cargo.toml
│       ├── Xargo.toml
│       └── src/lib.rs           the program
├── tests/
│   └── paytochat-escrow.ts      Anchor test suite
└── migrations/                  (created by `anchor init`; not used here)
```

## Setup (one-time)

You need the Solana toolchain + Anchor + a recent Node.

```bash
# 1. Accept the macOS Xcode SDK license (only once per machine).
sudo xcodebuild -license

# 2. Solana CLI (Agave). Use whatever the docs currently recommend; the
#    pinned-version installer below is stable enough for most use cases.
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version

# 3. Anchor via avm.
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.30.1
avm use 0.30.1
anchor --version

# 4. Node deps.
cd solana
npm install     # or yarn / pnpm
```

## Build & test

```bash
cd solana
anchor build              # compiles to target/deploy/paytochat_escrow.so
anchor test               # spins up solana-test-validator and runs ts tests
```

After your first `anchor build`, sync the program ID to the keypair the
build generated:

```bash
anchor keys list          # shows the on-chain pubkey of target/deploy/paytochat_escrow-keypair.json
anchor keys sync          # rewrites declare_id! and Anchor.toml to match
anchor build              # rebuild with the new ID baked into the .so
```

The test suite covers:

- `initialize`, `set_fee_bps`, `set_token_allowed`, `set_paused`
- `transfer_admin` / `accept_admin` (two-step parity check)
- `deposit` happy path + reverts (zero id, zero amount, past deadline,
  self-recipient, paymentId reuse, paused)
- `claim` happy path (recipient gets `amount - fee`, fees accumulate,
  Payment account closed) + non-recipient revert
- `refund` happy path (only after deadline, only by sender) + before-
  deadline revert
- `withdraw_fees` (admin sweeps fees, cannot reach principal, errors on
  empty bucket)
- pause-blocks-deposit but not claim/refund

## Deploy

### Devnet

```bash
solana-keygen new --outfile ~/.config/solana/id.json   # if you don't have one
solana airdrop 5                                       # dev SOL
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

The script prints `Program Id: ...`. Save it. Update
`Anchor.toml`'s `[programs.devnet]` so future commands can resolve the
on-chain program by name.

### Mainnet

```bash
solana config set --url mainnet-beta
solana balance                                          # ensure ~3 SOL for the deploy buffer
anchor deploy --provider.cluster mainnet
# Then immediately:
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_OR_MULTISIG>
```

**Always set the upgrade authority to a multisig (Squads, Realms, or a
governance program) before announcing the program ID.** Once auditing is
complete and you don't expect to upgrade further, retire it:

```bash
solana program set-upgrade-authority <PROGRAM_ID> --final
```

After deploy, the admin (which is the Pubkey passed to `initialize`,
**not** the program upgrade authority — they're separate) must:

1. Call `initialize(admin_pubkey, fee_bps)` — this creates `Config` and
   the `vault_authority` PDA. Only callable once.
2. Call `set_token_allowed(true)` for each SPL mint you want to support.
   USDC mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. USDT
   mainnet: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`. The first
   call per mint also creates the per-mint vault token account.

## Operational runbook

- **Withdraw fees** (monthly or on demand): admin signs `withdraw_fees`
  with `mint` set to USDC or USDT and `destination` set to your treasury
  ATA. Reverts cheaply if the bucket is empty.
- **Pause** (incident response): admin signs `set_paused(true)`. Blocks
  new deposits only. Claims and refunds keep working. Resume with
  `set_paused(false)`.
- **Indexing**: subscribe to `Deposited`, `Claimed`, `Refunded`,
  `FeesWithdrawn` events via Anchor's event API or by parsing program
  logs. Helius / Triton / Jito both expose this off the shelf.

## Pre-mainnet checklist

- [ ] `anchor test` green on a clean clone.
- [ ] External audit (Neodyme, OtterSec, Halborn) for production volume.
- [ ] Program upgrade authority set to a Squads multisig at deploy time.
- [ ] `Config.admin` set to a Squads multisig, not an EOA.
- [ ] At least one Squads signer's key in cold storage.
- [ ] USDC + USDT allowlisted via `set_token_allowed`.
- [ ] On Solana Explorer, the program's IDL is published and the source
      verified via [Solana Verify](https://github.com/Ellipsis-Labs/solana-verifiable-build).
- [ ] First real deposit + claim done with $1 of USDC by you, end-to-end.
- [ ] Indexer / Helius webhooks subscribed to the four core events.
