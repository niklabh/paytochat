# paytochat-contracts

Solidity escrow contract that backs the on-chain side of paytochat.fun.

The Next.js app in the parent folder doesn't depend on this package — the
contract is a separate, self-contained Hardhat project so the web app's
runtime stays small. Build and deploy from this folder.

## What it does

`PayToChatEscrow.sol` is a single-file ERC-20 escrow.

1. **Sender** approves the escrow on the chosen token (USDC / USDT) and calls
   `deposit(paymentId, recipient, token, amount, deadline)`. The contract
   pulls the tokens and stores a `Pending` payment.
2. **Recipient** later calls `claim(paymentId)`. The contract sends them
   `amount - fee` and credits `fee` to the admin's per-token bucket.
3. **Sender** can call `refund(paymentId)` strictly after `deadline` if the
   recipient never showed up. They get the full amount back; no fee is taken
   on refund.
4. **Admin** calls `withdrawFees(token, to)` to sweep accumulated fees. The
   admin can never touch user-escrowed principal — only the
   `accumulatedFees[token]` bucket.

## Security model

- **OpenZeppelin** primitives only:
  - `SafeERC20` — works correctly with non-bool-returning tokens (USDT) and
    reverts loudly on token-side failure.
  - `Ownable2Step` — admin transfer is two-phase, so a typo'd new owner
    can't lock the contract.
  - `ReentrancyGuard` — every state-changing external is `nonReentrant`.
  - `Pausable` — pause blocks **only** new deposits. `claim` and `refund`
    always work, so user funds can never be trapped by the admin.
- **Fee is capped on-chain** at `MAX_FEE_BPS = 1000` (10%). The owner cannot
  raise it past this even with full admin keys.
- **Allowlisted tokens only** — only tokens the admin has explicitly enabled
  can be deposited. Don't allowlist rebasing tokens; fee-on-transfer tokens
  technically work (we record actually-received amount) but aren't
  recommended for production tipping.
- **Checks-effects-interactions** — status flag is flipped before any
  external transfer in `claim`, `refund`, and `withdrawFees`.
- **No `selfdestruct`, no `delegatecall`, no upgradeability.** The contract
  is immutable once deployed.
- **No rescue / sweep function.** This is a deliberate trade-off: it means
  any tokens force-sent directly to the contract (not via `deposit`) are
  permanently stuck, but it also means the admin has no path to user
  principal even with a compromised key.
- **`paymentId` reuse is rejected.** Off-chain callers should use
  cryptographically random ids (e.g. UUIDv4 padded to 32 bytes) so mempool
  collisions are infeasible.

## Layout

```
contracts/
├── src/
│   ├── PayToChatEscrow.sol             production contract (the only one deployed)
│   └── test-mocks/                     test-only fixtures (compiled, never deployed)
│       ├── MockERC20.sol               standard OZ-based ERC-20
│       ├── MockUSDTLike.sol            no-bool-returning USDT clone
│       ├── MockFeeOnTransfer.sol       1% FoT to verify balance-delta path
│       └── MaliciousReenterer.sol      ERC-20 that reenters claim/refund
├── test/PayToChatEscrow.test.ts        full coverage (happy + revert + reentrancy)
├── scripts/deploy.ts                   deploy + (optional) Etherscan verify
├── hardhat.config.ts
├── package.json
└── .env.example
```

## Setup

```bash
cd contracts
pnpm install                       # or npm install / yarn
cp .env.example .env               # RPC URLs and explorer API keys go here
```

## Secure key handling

**Do not put a private key in `.env`.** That file is plaintext, gets
backed up by Time Machine / iCloud / Dropbox, and any process running
as you can read it. Use the encrypted-keystore flow instead.

### One-time setup

```bash
pnpm keystore:new
```

That's it. The script (which runs in a `bash` subshell so it works whether
your interactive shell is zsh, bash, or fish) does five things:

1. Prompts you for a password twice, hidden, with no shell-history leak.
2. Validates length (≥ 12 chars).
3. Generates a fresh keypair and encrypts it with scrypt. The plaintext
   private key never lands on disk — only the encrypted JSON does.
4. Writes the keystore to `~/.paytochat/deployer-keystore.json` (override
   with `KEYSTORE_PATH` env).
5. Offers to save the password into the macOS Keychain so future
   `pnpm deploy:*` runs don't have to prompt.

Print the new address (so you can fund it) by reading the keystore JSON's
`address` field, or grab it from the script's stdout.

### Manual fallback (any POSIX shell)

If for some reason you can't use the wrapper, this snippet works in zsh,
bash, dash, ksh, and any other POSIX shell:

```sh
# stty -echo turns off terminal echo, which is what `read -s` would do
# in bash but isn't portable. The trap restores echo even on Ctrl-C.
printf "New keystore password (12+ chars): "
stty -echo
trap 'stty echo' EXIT INT TERM
IFS= read -r KEYSTORE_PASSWORD
stty echo
trap - EXIT INT TERM
echo
export KEYSTORE_PASSWORD
npx hardhat run scripts/generate-keystore.ts
security add-generic-password -U -a "$USER" -s paytochat-deployer -w "$KEYSTORE_PASSWORD"
unset KEYSTORE_PASSWORD
```

> ⚠️ Use `KEYSTORE_PASSWORD` as the variable name. **Never `PWD`** — that's
> a bash/POSIX built-in for present working directory; assigning to it
> clobbers `$PWD` for the rest of the shell session and breaks any tool
> that reads it.

The keystore lands at `~/.paytochat/deployer-keystore.json` (override with
`KEYSTORE_PATH`). Its address is printed; fund that address with enough
gas-token on whichever chain you're deploying to.

### Deploying with the keystore

```bash
pnpm deploy:base       # or :sepolia, :base-sepolia, :arbitrum, :optimism, :polygon, :mainnet
```

The wrapper script (`scripts/deploy-with-keystore.sh`):

1. Pulls the keystore password from macOS Keychain (or prompts for it).
2. Exports `KEYSTORE_PATH` + `KEYSTORE_PASSWORD` for the Hardhat process only.
3. Runs the deploy.
4. Unsets both env vars on exit (via shell `trap`).

The plaintext private key exists in memory only for the lifetime of the
deploy process. Nothing is written to disk except the encrypted keystore.

### Optional upgrades

- **Hardware wallet** (Ledger Nano S Plus / Nano X, ~$80). Same dev flow
  via [`@nomicfoundation/hardhat-ledger`](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-ledger):
  add the plugin, set `ledgerAccounts: [...]` in `hardhat.config.ts`, and
  every signing prompt goes to the device. Keys never leave the hardware.
- **Safe multisig as the owner**. Set `INITIAL_OWNER` in `.env` to the
  Safe address — the deployer EOA only signs the constructor tx, then is
  irrelevant. All admin operations (`setTokenAllowed`, `setFeeBps`,
  `pause`, `withdrawFees`) require Safe quorum after that.

## Build & test

```bash
pnpm build                         # hardhat compile
pnpm test                          # run the full test suite
pnpm test:gas                      # tests + gas report
pnpm coverage                      # solidity-coverage report
```

The first compile pulls down the Solidity 0.8.26 binary and compiles
OpenZeppelin v5; takes a minute on a cold cache, ~5 s thereafter.

## Deploy

Fill in `.env` with the RPC URL for the chain you're targeting, an
Etherscan/Basescan API key, and (optionally) `INITIAL_OWNER`,
`INITIAL_FEE_BPS`, `USDC_ADDRESS`, `USDT_ADDRESS`. Make sure you've
done the keystore setup above. Then:

```bash
pnpm deploy:base-sepolia           # testnet first
pnpm deploy:base                   # only after extensive review!
```

The deploy script:

1. Deploys `PayToChatEscrow(initialOwner, initialFeeBps)`.
2. If the deployer is the initial owner, `setTokenAllowed(true)` for each of
   `USDC_ADDRESS` and `USDT_ADDRESS` provided in the env.
3. Optionally calls `hardhat verify` on Etherscan when `ETHERSCAN_API_KEY`
   is set.

If `INITIAL_OWNER` is a multisig (recommended), the deployer cannot
allowlist tokens itself — the multisig has to do it after deployment.

## Integrating with the Next.js app

Once deployed, expose the contract address via a new env var
(`NEXT_PUBLIC_ESCROW_ADDRESS`) and replace the direct ERC-20 transfer in
`src/lib/payments/client.ts` with two calls from the sender's wallet:

1. `approve(escrow, amount)` on the token contract.
2. `deposit(paymentId, recipient, token, amount, deadline)` on the escrow.

Server-side verification in `src/lib/payments/verify.ts` should be updated
to look for the escrow's `Deposited(paymentId, sender, recipient, token,
amount, deadline)` event instead of a raw ERC-20 `Transfer`. The
`paymentId` ties the on-chain deposit to the Firestore message so each
deposit can only unlock one message.

The recipient's "open the message" flow then triggers a `claim(paymentId)`
from their wallet (or the server submits a meta-tx if you want gasless
claims later). If the recipient ignores it, the sender can call
`refund(paymentId)` once the deadline has passed.

## Auditing checklist before mainnet

- [ ] Independent code review (Trail of Bits, OpenZeppelin, Spearbit, etc.).
- [ ] Slither / Mythril / Echidna invariant tests.
- [ ] Fork-test against mainnet USDC and USDT (USDT's blocklist behaviour
      can cause `transferFrom` to revert; the contract surfaces this
      correctly via SafeERC20, but worth confirming on a fork).
- [ ] Set `INITIAL_OWNER` to a multisig (e.g. Safe), not an EOA.
- [ ] Verify the contract on Etherscan and lock the source.
- [ ] Document the allowlisted token addresses and the fee in the app FAQ.
