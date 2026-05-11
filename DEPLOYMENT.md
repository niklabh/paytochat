# Deploying PayToChatEscrow + wiring the frontend

End-to-end runbook: take a fresh checkout from zero to a paytochat.fun
production where senders escrow into the smart contract, recipients claim,
and unclaimed tips can be refunded after a deadline.

There are **two** chain implementations that share the same `payment_id`
flow so the off-chain layer is chain-agnostic:

- [`contracts/`](./contracts/) — Solidity / Hardhat for any EVM chain
  (Ethereum mainnet + Base / Arbitrum / Optimism / Polygon). **This doc
  focuses on the EVM path.**
- [`solana/`](./solana/) — Rust / Anchor program for Solana. The Solana
  deploy + ops runbook lives in [`solana/README.md`](./solana/README.md).
  Hook it up after you've validated the EVM side; the wiring shape on the
  Next.js client is the same — generate a 32-byte `payment_id`, call
  `deposit`, and let the recipient `claim` or the sender `refund`.

The EVM contract itself lives in `contracts/` — a self-contained Hardhat
project that doesn't share `node_modules` with the Next.js app.
Read [`contracts/README.md`](./contracts/README.md) for the contract's
security model; this doc focuses on _operating_ it.

---

## TL;DR

| Step | What | Where |
| --- | --- | --- |
| 1 | Pick a chain | Decide before anything else |
| 2 | Configure env | `contracts/.env` |
| 3 | Dry-run on a testnet | `pnpm deploy:base-sepolia` (or `:sepolia`) |
| 4 | Smoke-test on the testnet contract | Hardhat console |
| 5 | Deploy to mainnet with a Safe owner | `pnpm deploy:base` |
| 6 | Allowlist USDC/USDT/USDG/PUSD (multisig tx) | Etherscan / Safe |
| 7 | Wire the Next.js app | `src/lib/payments/*`, env vars |
| 8 | Update Firestore schema + rules | `firestore.rules`, types |
| 9 | Add claim/refund UX | `dashboard/c/[convId]`, `dashboard/sent` |
| 10 | Operate it | Fee withdrawals, monitoring, kill switch |

---

## 1. Pick a chain

The contract is vanilla Solidity 0.8.26 + OpenZeppelin v5, so it deploys
on any EVM chain. **For paytochat's $1–$50 tip range, mainnet gas is a
deal-breaker** (deposit + approve ≈ 200k gas, that's ~$15 at 30 gwei /
$3k ETH). Use an L2 unless you have a strong reason not to.

| Chain | Pros | Native USDC | `hardhat run --network` |
| --- | --- | --- | --- |
| **Base** | Cheapest, biggest USDC liquidity, Coinbase-friendly UX | Yes | `base` / `baseSepolia` |
| Arbitrum One | Mature, deepest USDC liquidity on L2 | Yes | `arbitrum` |
| Optimism | Mature, OP Stack | Yes | `optimism` |
| Polygon PoS | Cheapest, lowest fees, but bridged USDC dominant | Native + bridged | `polygon` |
| Ethereum mainnet | Brand recognition, but ~$15/tip in gas | Yes | `mainnet` |

The deploy script and `pnpm` scripts already know all of these — see
[`contracts/hardhat.config.ts`](./contracts/hardhat.config.ts) and
[`contracts/package.json`](./contracts/package.json). **The rest of this
guide assumes Base.** Substitute `base-sepolia → base` for your chain pair
of choice.

---

## 2. Configure `contracts/.env` and a deployer keystore

```bash
cd contracts
cp .env.example .env
```

Fill in `.env`:

| Var | Required | Notes |
| --- | --- | --- |
| `BASE_RPC_URL` / `BASE_SEPOLIA_RPC_URL` | Yes | Get a free key from Alchemy/Infura/QuickNode; public RPCs rate-limit hard. |
| `BASESCAN_API_KEY` | Yes for `verify` | Free at [basescan.org/myapikey](https://basescan.org/myapikey). |
| `INITIAL_OWNER` | Yes for prod | The address that will own the contract. **Use a Safe multisig.** Leave blank only for testnet dry-runs. |
| `INITIAL_FEE_BPS` | Yes | Basis points (250 = 2.5%). Hard-capped at 1000 by the contract. |
| `USDC_ADDRESS` / `USDT_ADDRESS` / `USDG_ADDRESS` / `PUSD_ADDRESS` | Recommended | Per-chain stablecoin addresses (see comments in `.env.example`). Leave `USDG_ADDRESS` blank on chains where Paxos hasn't deployed USDG yet, and `PUSD_ADDRESS` blank where Palm USD isn't deployed yet. |

**Do NOT put a private key in `.env`.** Use the encrypted keystore flow:

```bash
pnpm keystore:new
```

The wrapper runs in a bash subshell (so it works in zsh, bash, fish —
whatever your interactive shell is), prompts twice for a password,
generates an encrypted keystore at `~/.paytochat/deployer-keystore.json`,
and offers to save the password to macOS Keychain so future deploys
don't prompt.

See "Secure key handling" in [`contracts/README.md`](./contracts/README.md)
for the manual POSIX-portable fallback and the optional Ledger /
Safe-multisig upgrades.

The keystore lands at `~/.paytochat/deployer-keystore.json`; fund the
address it prints with enough gas-token. See the "Secure key handling"
section of [`contracts/README.md`](./contracts/README.md) for details.

---

## 3. Dry-run on a testnet

### 3.1. Fund the deployer

Bridge or faucet ~0.01 ETH to the deployer EOA on Base Sepolia. The
contract is small (~1.06M gas to deploy → ~$0.001 on Base Sepolia).

### 3.2. Deploy

```bash
cd contracts
pnpm install            # first time only
pnpm test               # 26/26 should pass before you ever deploy
pnpm deploy:base-sepolia
```

Expected output:

```
network         : baseSepolia
deployer        : 0x...
initial owner   : 0x...
initial fee bps : 250 (2.5%)
PayToChatEscrow : 0xABC...123
allowlisting    : 0x...USDC
--- verification ---
npx hardhat verify --network baseSepolia 0xABC...123 0x... 250
```

If `BASESCAN_API_KEY` is set the script auto-verifies after a 30 s wait.

**Save the address.** Copy it — it's the contract address you'll wire the
frontend to.

### 3.3. Smoke-test from a Hardhat console

```bash
npx hardhat console --network baseSepolia
```

```js
const escrow = await ethers.getContractAt("PayToChatEscrow", "0xABC...123");
await escrow.feeBps();                                    // -> 250n
await escrow.tokenAllowed("0x...USDC");                   // -> true
await escrow.owner();                                      // -> your address
```

For an end-to-end check, get a small amount of testnet USDC, then from a
recipient EOA:

```js
const usdc = await ethers.getContractAt("IERC20", "0x...USDC");
await (await usdc.approve(escrow.target, 1_000_000n)).wait();   // 1 USDC
const pid = ethers.id("smoketest-1");                            // bytes32
const dl  = BigInt(Math.floor(Date.now() / 1000) + 600);          // 10 min
await (await escrow.deposit(pid, recipientAddr, usdc.target, 1_000_000n, dl)).wait();

// switch wallet to recipient and:
await (await escrow.claim(pid)).wait();
```

Confirm on Basescan that `Deposited` and `Claimed` events fired with the
expected `paymentId`, sender, recipient, and amount.

---

## 4. Deploy to mainnet

### 4.1. Set up the owner multisig

1. Create a Safe on the target chain at [app.safe.global](https://app.safe.global/).
2. Pick at least 2 signers (3-of-5 is a healthy default). At least one
   signer should be in cold storage.
3. Copy the Safe address into `contracts/.env` as `INITIAL_OWNER`.

The deployer EOA does **not** need to be a Safe signer; it just submits
the create transaction. Once deployment succeeds, the deployer has zero
permissions on the contract.

### 4.2. Deploy

```bash
cd contracts
pnpm deploy:base               # or :arbitrum / :optimism / :polygon / :mainnet
```

The script will:

1. Deploy `PayToChatEscrow(safeAddress, 250)`.
2. Skip `setTokenAllowed` because the deployer is no longer the owner —
   the Safe will do it next.
3. Auto-verify on Basescan if `BASESCAN_API_KEY` is set.

**Save the deployed address into a permanent place** (1Password, repo
secrets, etc.). It's now part of the protocol.

### 4.3. Manually verify if the auto-verify failed

```bash
cd contracts
npx hardhat verify --network base 0xDEPLOYED 0xSAFEOWNER 250
```

Replace `250` with whatever `INITIAL_FEE_BPS` you used.

---

## 5. Allowlist USDC / USDT / USDG / PUSD (Safe multisig tx)

Until the Safe calls `setTokenAllowed`, no deposits can happen. From the
Safe UI:

1. **New transaction → Contract interaction**.
2. Address: the deployed `PayToChatEscrow`.
3. ABI: paste the contract's ABI from
   `contracts/artifacts/src/PayToChatEscrow.sol/PayToChatEscrow.json`
   (the `"abi"` array), or load by address (Safe pulls from Etherscan).
4. Method: `setTokenAllowed`.
5. Args: USDC address, `true`. Submit. Get signers to approve. Execute.
6. Repeat for USDT.
7. Repeat for USDG (Ethereum mainnet:
   `0xe343167631d89B6Ffc58B88d6b7fB0228795491D`). Paxos has not yet
   deployed USDG on Base / Arbitrum / Optimism / Polygon — skip the
   USDG step on those chains.
8. Repeat for PUSD (Ethereum mainnet:
   `0xfaF0CEE6b20E2AaA4b80748a6Af4cD89609a3d78`). Palm USD is currently
   only verified on Ethereum mainnet — skip the PUSD step on the L2s
   until Palm Azgar Finance deploys there.

Verify each token is allowlisted after the Safe tx executes by reading
the escrow on a block explorer:

```
escrow.tokenAllowed(0xUSDC)  // -> true
escrow.tokenAllowed(0xUSDT)  // -> true
escrow.tokenAllowed(0xUSDG)  // -> true (mainnet only)
escrow.tokenAllowed(0xPUSD)  // -> true (mainnet only)
```

Do the same dance for `setFeeBps(N)` if you want a different fee than the
constructor value.

---

## 6. Frontend env vars

In the Next.js project root (`paytochat/`, **not** `contracts/`), add to
`.env.local` and to Vercel's project settings (Production + Preview):

```bash
# Deployed PayToChatEscrow contract addresses (one per chain you support).
NEXT_PUBLIC_ESCROW_ADDRESS_BASE=0xDEPLOYED
NEXT_PUBLIC_ESCROW_ADDRESS_ARBITRUM=
NEXT_PUBLIC_ESCROW_ADDRESS_OPTIMISM=
NEXT_PUBLIC_ESCROW_ADDRESS_POLYGON=
NEXT_PUBLIC_ESCROW_ADDRESS_MAINNET=

# Server-side mirror of the same set (used by the verifier in
# /api/messages/send). Keep in sync with the public ones — splitting the
# vars just lets you trust the server copy and ignore client tampering.
ESCROW_ADDRESS_BASE=0xDEPLOYED
ESCROW_ADDRESS_ARBITRUM=
ESCROW_ADDRESS_OPTIMISM=
ESCROW_ADDRESS_POLYGON=
ESCROW_ADDRESS_MAINNET=

# How many days a deposit is locked before the sender can refund.
NEXT_PUBLIC_ESCROW_DEFAULT_DEADLINE_DAYS=7
```

You'll also want a per-chain RPC URL (already supported by the existing
`NEXT_PUBLIC_ETH_RPC_URL` / `ETH_RPC_URL`; add `BASE_RPC_URL`, etc., if
you go multi-chain).

---

## 7. Wire the Next.js app

The wiring is three files: an ABI export, an updated client helper, and an
updated server verifier.

### 7.1. Export the ABI

Add a tiny script in `contracts/scripts/export-abi.ts`:

```ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import artifact from "../artifacts/src/PayToChatEscrow.sol/PayToChatEscrow.json";

const out = `// AUTO-GENERATED by contracts/scripts/export-abi.ts — do not edit.
export const escrowAbi = ${JSON.stringify(artifact.abi, null, 2)} as const;
`;

writeFileSync(resolve(__dirname, "../../src/lib/payments/escrow-abi.ts"), out);
console.log("wrote src/lib/payments/escrow-abi.ts");
```

Run it after every contract change:

```bash
cd contracts
pnpm build               # hardhat compile
npx hardhat run scripts/export-abi.ts
```

The `as const` is the magic that lets viem's `Abi` typing flow through to
typed read/write hooks in wagmi.

### 7.2. Sender flow: replace direct transfer with `approve` + `deposit`

The current sender flow lives in
```92:105:src/lib/payments/client.ts
export function buildEvmTransferArgs(
  token: Token,
  toAddress: `0x${string}`,
  amountUSD: number
) {
  const tokenInfo = getToken("ethereum", token);
  const value = parseUnits(amountUSD.toFixed(tokenInfo.decimals), tokenInfo.decimals);
  return {
    address: tokenInfo.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "transfer" as const,
    args: [toAddress, value] as const,
  };
}
```

Add two new helpers next to it (don't delete `buildEvmTransferArgs` until
you're certain the rollback path doesn't need it):

```ts
import { erc20Abi, parseUnits, toHex } from "viem";
import { escrowAbi } from "./escrow-abi";

/** 32 random bytes, returned as a 0x-prefixed bytes32 paymentId. */
export function newPaymentId(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Step 1 of the escrow flow: approve the escrow to pull `amountUSD`. */
export function buildEvmApproveArgs(
  token: Token,
  escrow: `0x${string}`,
  amountUSD: number,
) {
  const tokenInfo = getToken("ethereum", token);
  const value = parseUnits(amountUSD.toFixed(tokenInfo.decimals), tokenInfo.decimals);
  return {
    address: tokenInfo.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "approve" as const,
    args: [escrow, value] as const,
  };
}

/** Step 2 of the escrow flow: deposit into the contract. */
export function buildEvmDepositArgs(args: {
  escrow: `0x${string}`;
  paymentId: `0x${string}`;
  recipient: `0x${string}`;
  token: Token;
  amountUSD: number;
  /** Seconds from now until refund unlocks. */
  deadlineSeconds: number;
}) {
  const tokenInfo = getToken("ethereum", args.token);
  const value = parseUnits(args.amountUSD.toFixed(tokenInfo.decimals), tokenInfo.decimals);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + args.deadlineSeconds);
  return {
    address: args.escrow,
    abi: escrowAbi,
    functionName: "deposit" as const,
    args: [
      args.paymentId,
      args.recipient,
      tokenInfo.address as `0x${string}`,
      value,
      deadline,
    ] as const,
  };
}

/** Recipient claims their tip. */
export function buildEvmClaimArgs(escrow: `0x${string}`, paymentId: `0x${string}`) {
  return {
    address: escrow,
    abi: escrowAbi,
    functionName: "claim" as const,
    args: [paymentId] as const,
  };
}

/** Sender refunds an unclaimed deposit after the deadline. */
export function buildEvmRefundArgs(escrow: `0x${string}`, paymentId: `0x${string}`) {
  return {
    address: escrow,
    abi: escrowAbi,
    functionName: "refund" as const,
    args: [paymentId] as const,
  };
}
```

In the page component that composes the message (the EVM half of
[`src/components/thread-composer.tsx`](./src/components/thread-composer.tsx)
or wherever you call `buildEvmTransferArgs` today), replace the single
`writeContract` call with:

```ts
import {
  buildEvmApproveArgs,
  buildEvmDepositArgs,
  newPaymentId,
} from "@/lib/payments/client";
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { erc20Abi } from "viem";

const escrow = process.env.NEXT_PUBLIC_ESCROW_ADDRESS_BASE as `0x${string}`;
const tokenAddress = /* from getToken(chain, token).address */;

// Skip the approve if the user already approved enough.
const { data: currentAllowance } = useReadContract({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: "allowance",
  args: [userAddress, escrow],
});

const paymentId = useMemo(newPaymentId, []);   // stable per render of the form
const { writeContractAsync } = useWriteContract();

async function send() {
  const value = parseUnits(amountUSD.toFixed(decimals), decimals);
  if ((currentAllowance ?? 0n) < value) {
    const approveTx = await writeContractAsync(
      buildEvmApproveArgs(token, escrow, amountUSD),
    );
    await waitForReceipt(approveTx);
  }
  const depositTx = await writeContractAsync(
    buildEvmDepositArgs({
      escrow,
      paymentId,
      recipient,
      token,
      amountUSD,
      deadlineSeconds: 7 * 24 * 3600,
    }),
  );
  await waitForReceipt(depositTx);

  // Send the existing /api/messages/send POST, but include paymentId
  // and the chain-specific escrow address. txHash is now the deposit tx.
  await fetch("/api/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      ...existingFields,
      txHash: depositTx,
      paymentId,
      escrowAddress: escrow,
    }),
  });
}
```

> **Why a fresh `paymentId` per send?** The escrow rejects `paymentId`
> reuse. Generating one per send guarantees no collision and lets the
> server tie each Firestore message to exactly one on-chain deposit.

### 7.3. Server verification: look for `Deposited`, not `Transfer`

In [`src/lib/payments/verify.ts`](./src/lib/payments/verify.ts), replace
`verifyEthereum` with a version that decodes the escrow's `Deposited`
event and matches by `paymentId`:

```ts
import { createPublicClient, http, getAddress, decodeEventLog } from "viem";
import { mainnet, base, arbitrum, optimism, polygon } from "viem/chains";
import { escrowAbi } from "./escrow-abi";

const ESCROWS_BY_CHAIN: Record<string, `0x${string}` | undefined> = {
  ethereum: process.env.ESCROW_ADDRESS_MAINNET as `0x${string}` | undefined,
  base: process.env.ESCROW_ADDRESS_BASE as `0x${string}` | undefined,
  arbitrum: process.env.ESCROW_ADDRESS_ARBITRUM as `0x${string}` | undefined,
  optimism: process.env.ESCROW_ADDRESS_OPTIMISM as `0x${string}` | undefined,
  polygon: process.env.ESCROW_ADDRESS_POLYGON as `0x${string}` | undefined,
};

async function verifyEvmEscrowDeposit({
  chain,
  txHash,
  paymentId,
  expectedRecipient,
  expectedFrom,
  token,
  minAmountUSD,
}: {
  chain: keyof typeof ESCROWS_BY_CHAIN;
  txHash: `0x${string}`;
  paymentId: `0x${string}`;
  expectedRecipient: string;
  expectedFrom?: string;
  token: Token;
  minAmountUSD: number;
}): Promise<VerifyResult> {
  const escrowAddress = ESCROWS_BY_CHAIN[chain];
  if (!escrowAddress) return { ok: false, error: `No escrow configured for ${chain}.` };

  const client = createPublicClient({
    chain: { ethereum: mainnet, base, arbitrum, optimism, polygon }[chain]!,
    transport: http(rpcFor(chain)),
  });

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt) return { ok: false, error: "Transaction not yet mined." };
  if (receipt.status !== "success") return { ok: false, error: "Tx reverted." };
  if (getAddress(receipt.to ?? "0x0") !== getAddress(escrowAddress)) {
    return { ok: false, error: "Tx did not target the escrow contract." };
  }

  const tokenInfo = getToken(chain === "ethereum" ? "ethereum" : "ethereum", token);
  // ^ the existing tokens.ts only knows mainnet addresses. When you add
  //   per-chain stablecoin maps, key getToken on `chain` here.

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(escrowAddress)) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Deposited") continue;
    const { paymentId: pid, sender, recipient, token: tokenAddr, amount } = decoded.args;
    if (pid !== paymentId) continue;
    if (getAddress(recipient) !== getAddress(expectedRecipient)) {
      return { ok: false, error: "Deposit recipient mismatch." };
    }
    if (getAddress(tokenAddr) !== getAddress(tokenInfo.address)) {
      return { ok: false, error: "Deposit token mismatch." };
    }
    if (expectedFrom && getAddress(sender) !== getAddress(expectedFrom)) {
      return { ok: false, error: "Deposit sender mismatch." };
    }
    const amountUSD = Number(amount) / 10 ** tokenInfo.decimals;
    if (amountUSD + 1e-9 < minAmountUSD) {
      return { ok: false, error: `Deposited ${amountUSD} < requested ${minAmountUSD}.` };
    }
    return { ok: true, amountUSD, fromAddress: sender, toAddress: recipient };
  }
  return { ok: false, error: "No matching Deposited event for this paymentId." };
}
```

In `src/app/api/messages/send/route.ts`, extend the request schema with
`paymentId` and `escrowAddress`, and pass them to the new verifier:

```ts
const Body = z.object({
  // ...existing fields...
  paymentId: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  escrowAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});
```

The server should **prefer the server-side `ESCROW_ADDRESS_*` env var
over `payload.escrowAddress`** — never trust the client copy. Use the
client value only as a hint.

### 7.4. Persist new fields on the message doc

Update `MessageDoc` in
```53:76:src/lib/types.ts
export interface MessageDoc {
  id: string;
  conversationId: string;
  senderId: string;
  senderHandle: string;
  senderDisplayName: string;
  senderAvatarUrl?: string;
  recipientId: string;
  recipientHandle: string;
  /** Sanitized rich-text HTML (Tiptap output). May contain inline images. */
  body: string;
  /** Plain-text projection of `body`, cached for previews and length checks. */
  bodyPlain?: string;
  amountUSD: number; // 0 for free messages
  chain?: Chain;
  token?: Token;
  txHash?: string;
  fromAddress?: string;
  toAddress?: string;
  status: MessageStatus;
  createdAt: Timestamp | number;
  paidAt?: Timestamp | number;
  openedAt?: Timestamp | number;
}
```

Add:

```ts
/** Escrow contract address that holds (or held) the deposit. */
escrowAddress?: string;
/** bytes32 hex paymentId used as the on-chain key. */
paymentId?: string;
/** Unix seconds; sender can refund after this if not yet claimed. */
escrowDeadline?: number;
/** Filled in when the recipient claims through the contract. */
claimedAt?: Timestamp | number;
claimTxHash?: string;
/** Filled in when the sender refunds after the deadline. */
refundedAt?: Timestamp | number;
refundTxHash?: string;
```

Extend `MessageStatus` with `"claimed" | "refunded"` so the UI can branch
cleanly.

---

## 8. Update Firestore rules

Today, [`firestore.rules`](./firestore.rules) only lets clients update a
participant's `unreadCount`. Allow recipients to write the claim fields
on their own messages, and senders to write the refund fields on theirs:

```
match /messages/{messageId} {
  allow read: if request.auth != null
    && (resource.data.recipientId == request.auth.uid
        || resource.data.senderId == request.auth.uid);
  allow create, delete: if false;  // only Admin SDK creates
  allow update: if request.auth != null
    // Recipient can flip status to "opened" (existing rule) OR record a claim.
    && (
      // existing opened-flip
      ...
      ||
      // claim: recipient writes claim metadata, server-verified separately.
      (
        resource.data.recipientId == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['status', 'claimedAt', 'claimTxHash'])
        && request.resource.data.status == 'claimed'
      )
      ||
      // refund: sender writes refund metadata.
      (
        resource.data.senderId == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['status', 'refundedAt', 'refundTxHash'])
        && request.resource.data.status == 'refunded'
        && resource.data.escrowDeadline < request.time.toMillis() / 1000
      )
    );
}
```

You can also gate the writes through a server route (`/api/messages/claim`,
`/api/messages/refund`) that re-verifies the on-chain action and writes
with the Admin SDK — strictly safer, slightly more code. **Do this for
production.** The client-write rules above are an acceptable fallback if
you ever need to resync.

Then:

```bash
firebase deploy --only firestore:rules
```

---

## 9. Add claim and refund UX

### 9.1. Claim button (recipient)

In the open-message / chat-thread view (the page that already swaps the
locked card for the message body — see
`src/app/a/dashboard/c/[convId]/page.tsx`), when the message has
`status === "paid"` and `paymentId` is set, render a CTA:

```tsx
const escrow = process.env.NEXT_PUBLIC_ESCROW_ADDRESS_BASE!;
const { writeContractAsync } = useWriteContract();
const { data: quote } = useReadContract({
  address: escrow,
  abi: escrowAbi,
  functionName: "quoteClaim",
  args: [message.paymentId as `0x${string}`],
});
const [toRecipient, fee] = quote ?? [0n, 0n];

async function onClaim() {
  const claimTx = await writeContractAsync(
    buildEvmClaimArgs(escrow, message.paymentId as `0x${string}`),
  );
  await waitForReceipt(claimTx);
  await fetch("/api/messages/claim", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ messageId: message.id, claimTxHash: claimTx }),
  });
}

// "Claim $4.88 (after 0.12 fee)" button shown until status flips to "claimed".
```

`/api/messages/claim` (new server route) re-verifies that the `Claimed`
event with the right `paymentId` fired in `claimTxHash`, then sets
`status: "claimed"`, `claimedAt: now`, `claimTxHash` on the message via
the Admin SDK. Same shape as `/api/messages/send`.

### 9.2. Refund button (sender)

In the sender's "sent" page (`src/app/a/dashboard/sent/page.tsx`), for any
message where `status === "paid"`, `paymentId` is set, and
`Date.now() / 1000 > escrowDeadline`, render a "Refund" CTA that calls
`buildEvmRefundArgs(escrow, paymentId)`. After the receipt, POST to
`/api/messages/refund` to flip the Firestore status.

The contract enforces both checks (`onlyPending`, `onlySender`,
`afterDeadline`); the UI just needs to hide the button when those are
unmet to avoid wasting the user's gas on a guaranteed revert.

---

## 10. Operational runbook

### 10.1. Withdraw fees

From the Safe UI, monthly or whenever:

```
escrow.withdrawFees(0xUSDC, 0xTreasury)
escrow.withdrawFees(0xUSDT, 0xTreasury)
```

The contract zeroes `accumulatedFees[token]` before transferring, and
reverts with `NoFeesToWithdraw` if the bucket is empty — so you can run
it speculatively without risk of a no-op consuming gas-only.

### 10.2. Pause (incident response)

If you spot a wallet-stealer phishing site or a bug:

```
escrow.pause()
```

This blocks _new deposits_ only. **Existing deposits stay claimable and
refundable.** That's deliberate — the admin must never be able to trap
user funds.

To resume: `escrow.unpause()`.

### 10.3. Monitor

Subscribe to these events for off-chain reconciliation. Any decent indexer
works (Alchemy webhooks, The Graph, Goldsky, custom worker):

| Event | What to do |
| --- | --- |
| `Deposited(paymentId, sender, recipient, token, amount, deadline)` | Cross-check against Firestore — alert if a deposit lands without a corresponding `messages/{id}`. |
| `Claimed(paymentId, recipient, token, amountToRecipient, fee)` | Update the message doc to `status: "claimed"` if your client-side flow missed it. |
| `Refunded(paymentId, sender, token, amount)` | Update the message to `status: "refunded"`. |
| `FeesWithdrawn(token, to, amount)` | Audit log for accounting. |
| `Paused` / `Unpaused` | Page on-call. |

### 10.4. Migrating to a v2 contract

The contract is **immutable on purpose** — there's no proxy and no
self-destruct. Migration looks like:

1. Deploy v2 (with whatever fix or feature).
2. `pause()` v1.
3. Update `NEXT_PUBLIC_ESCROW_ADDRESS_*` to point at v2 in Vercel and
   redeploy the frontend. New deposits flow through v2.
4. Leave v1 running (just paused for new deposits) until every Pending
   payment is either claimed or refunded — typically 1× the deadline
   window plus some grace. Monitor the v1 contract's balance going to
   zero, then remove it from the indexer.

---

## 11. Pre-mainnet checklist

Don't ship to mainnet without checking every box:

- [ ] `pnpm test` in `contracts/` — 26/26 passing on the latest commit.
- [ ] Slither / Mythril clean (or known-suppressed) on
      `contracts/src/PayToChatEscrow.sol`.
- [ ] External audit (Trail of Bits, OpenZeppelin, Spearbit, Certik, …).
      For a $1–$50 tip-volume contract, a single-firm audit at the cheap
      end (~$10k) is appropriate. Don't deploy with no audit.
- [ ] Mainnet fork test via `hardhat-network-helpers` against real USDC
      and USDT. USDT's blocklist can make `transferFrom` revert; verify
      the SafeERC20 path surfaces this correctly.
- [ ] `INITIAL_OWNER` is a Safe multisig, **not** an EOA.
- [ ] At least one Safe signer's key is in cold storage.
- [ ] USDC + USDT allowlisted via Safe tx.
- [ ] Contract verified on the relevant block explorer.
- [ ] `NEXT_PUBLIC_ESCROW_ADDRESS_*` and `ESCROW_ADDRESS_*` set in Vercel
      Production + Preview.
- [ ] Server verifier rejects deposits to any escrow address other than
      the configured one.
- [ ] Claim and refund flows manually tested end-to-end on the mainnet
      contract with $1 of USDC.
- [ ] FAQ + ToS mention the fee bps and the deadline policy.
- [ ] Indexer / webhooks subscribed to the four core events.
- [ ] On-call rotation knows how to pause and how to reach a quorum of
      Safe signers.
- [ ] Treasury address (where `withdrawFees` sends) is documented in the
      same place as the contract address.

When every box is ticked, send the first real deposit yourself, claim it
yourself, refund a separate deposit yourself, and only _then_ flip the
`NEXT_PUBLIC_ESCROW_ADDRESS_*` envs in Vercel to point at the production
contract. Welcome to mainnet.
