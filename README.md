# Pay to Chat

> Make people **pay** to land in your inbox.

A web app at **[paytochat.fun](https://paytochat.fun)** where senders attach
USDC or USDT (on Solana or Ethereum) to a message. The recipient sees a clean
inbox of locked cards — the **tip amount stays hidden until they tap to
reveal**. Stop ignoring DM requests; charge what your attention is worth.

## Features

- **Rich-text messages with images** — bold, headings, lists, blockquotes,
  links and inline images via a built-in Tiptap editor. Drop, paste, or pick
  an image to attach; we store it in Firebase Storage and embed it inline.
  Bodies are sanitized server-side before being persisted.
- **Hidden-amount messaging** — recipients see who sent it, but not how much
  it's worth, until they reveal.
- **Stablecoins on the chain you choose** — USDC / USDT on Solana mainnet or
  Ethereum mainnet. We never custody funds; senders transfer directly to the
  recipient's wallet and the server only verifies the on-chain transaction
  before unlocking the message.
- **Tap-to-reveal inbox** — a scannable list of locked messages. One tap
  reveals the body and the tip amount; opened messages stay in the list with
  the amount visible. Filter by All / Unread / Opened.
- **Per-recipient settings** — minimum tip threshold, notify-me threshold,
  cool-off window, accepted chains/tokens.
- **Threaded chat after the first paid message** — once a paid message is
  opened, both sides drop into a live chat thread. Replies are free until the
  cool-off window closes; after that, the sender must attach a fresh paid
  message to reopen the thread.
- **Cool-off window** — once someone pays, both sides unlock a free reply
  window (default 24 h, configurable). Each new paid open extends it. Once
  it expires, the sender must attach a fresh paid message to reopen the
  thread — there is no permanent free-chat escape hatch.
- **Read receipts** — sender sees when their message was opened.
- **Public profile** at `paytochat.fun/<handle>` for senders to land on.
- **DM auto-reply generator** — copy-paste template for X / Instagram DM
  requests pointing them at your Pay to Chat link.
- **Wallet connectors** — RainbowKit (Coinbase, MetaMask, WalletConnect…) for
  EVM and Solana Wallet Adapter (Phantom, Backpack, Solflare via Wallet
  Standard) for Solana.
- **Responsive** — works on mobile and desktop.

## Tech

- **Frontend** — Next.js 14 App Router, TypeScript, Tailwind CSS
- **Editor** — Tiptap (ProseMirror) with image, link, lists, headings
- **Auth & data** — Firebase Auth (email + Google) + Firestore + Cloud Storage
- **EVM payments** — wagmi v2 + viem + RainbowKit (Ethereum mainnet, ERC-20)
- **Solana payments** — `@solana/web3.js` + `@solana/spl-token` + Solana Wallet
  Adapter
- **Server-side payment verification** — public RPCs (configurable) parse the
  transaction, confirm the recipient address, token, and amount.

## Project layout

```
src/
  app/
    page.tsx                       landing
    [handle]/                      public profile + send-with-pay form
    a/                             app routes (kept off the root so handles can live there)
      sign-in/, sign-up/           auth
      dashboard/
        page.tsx                   inbox of locked / opened paid messages
        chats/                     list of conversations + cool-off status
        c/[convId]/                live thread view (auto-reveal + chat composer)
        sent/                      sent messages with read receipts
        settings/                  profile, wallets, thresholds, auto-reply
    api/
      messages/send/route.ts       creates a message, verifies on-chain payment
                                   (also handles free replies during the cool-off window)
      messages/open/route.ts       reveal a message, start cool-off, increment stats
    layout.tsx, providers.tsx, globals.css
  components/                      ui primitives, nav, swipe deck, rich editor + renderer
  lib/
    auth-context.tsx               Firebase auth React context
    firebase/{client,admin,storage}.ts  web SDK + admin SDK + image upload helper
    payments/{tokens,client,verify}.ts
    rich-text.ts                   universal HTML → text helpers
    rich-text.server.ts            server-only HTML sanitizer
    types.ts, utils.ts
firestore.rules                    Firestore security rules
firestore.indexes.json             composite indexes
storage.rules                      Cloud Storage rules (caps message image uploads)
firebase.json                      firebase deploy config
contracts/                         Solidity escrow smart contract (Hardhat project,
                                   self-contained — see contracts/README.md)
solana/                            Anchor program mirroring the Solidity escrow
                                   for SPL tokens — see solana/README.md
```

## Setup

### 1. Install

```bash
pnpm install   # or npm install / yarn
```

### 2. Create a Firebase project

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication** → enable **Email/Password** and **Google** providers.
3. **Firestore** → create a database (production mode is fine — we ship rules).
4. **Project settings** → **General** → add a Web app and copy the config
   keys. These map to the `NEXT_PUBLIC_FIREBASE_*` env vars.
5. **Project settings** → **Service accounts** → "Generate new private key".
   Use the resulting JSON to populate `FIREBASE_ADMIN_*` env vars.

### 3. Configure env

```bash
cp .env.example .env.local
# fill in values
```

Required vars (see `.env.example` for the complete list):

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | Web SDK config (incl. `STORAGE_BUCKET` for inline message images) |
| `FIREBASE_ADMIN_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` | Server-only — verifies Firebase ID tokens & writes messages |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | From <https://cloud.walletconnect.com> (free) |
| `ETH_RPC_URL` / `SOL_RPC_URL` | Optional — server-side RPC for tx verification (public RPCs are rate-limited) |
| `NEXT_PUBLIC_ETH_RPC_URL` / `NEXT_PUBLIC_SOL_RPC_URL` | Optional — used by the wallet connectors in the browser |

### 4. Deploy Firestore rules + indexes + Storage rules

```bash
npm i -g firebase-tools
firebase login
firebase use --add        # pick the project
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Make sure **Cloud Storage** is enabled in the Firebase console (Build →
Storage → Get started). The default `<project-id>.appspot.com` bucket is
what `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` points at, and senders upload
inline images there under `message-images/<uid>/...`.

### 5. Run

```bash
pnpm dev
```

Open <http://localhost:3000>.

## Deploying

We deploy the Next.js app on **Vercel** and use **Firebase** for storage only
(Auth + Firestore + optional Storage). The two halves talk over HTTPS — there
is no Firebase Hosting / App Hosting in the path.

### 1. Push to GitHub and import in Vercel

1. Push this repo to GitHub.
2. Go to <https://vercel.com/new> → Import the repo.
3. Framework preset: **Next.js** (auto-detected).
4. Build/output settings: leave the defaults. Install command can stay as
   `pnpm install` (Vercel detects `pnpm-lock.yaml`).
5. Don't deploy yet — set env vars first (next step).

### 2. Configure env vars in the Vercel project

In **Settings → Environment Variables**, add every var from `.env.example`,
scoped to **Production** *and* **Preview** (and **Development** if you'll use
`vercel env pull` locally).

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | Web SDK config from Firebase Console → Project settings → General. Public; baked into the client bundle. |
| `FIREBASE_ADMIN_PROJECT_ID` | Same project ID. |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | From the service-account JSON. |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Paste the full multi-line PEM, including `-----BEGIN/END PRIVATE KEY-----` and the `\n` sequences. The runtime expands `\n` back to real newlines. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | From <https://cloud.walletconnect.com>. |
| `ETH_RPC_URL` / `SOL_RPC_URL` | Server-side RPCs used by `/api/messages/send` for tx verification. Optional but strongly recommended (public RPCs rate-limit). |
| `NEXT_PUBLIC_ETH_RPC_URL` / `NEXT_PUBLIC_SOL_RPC_URL` | Browser-side RPCs for wallet connectors. Optional. |

### 3. Authorize the Vercel domain in Firebase Auth

Firebase Auth blocks sign-in from any domain not on its allow-list.

**Firebase Console → Authentication → Settings → Authorized domains → Add
domain**, and add:

- `your-project.vercel.app` (the Vercel-issued URL).
- Your custom domain if you have one (e.g. `paytochat.fun`, plus `www.paytochat.fun`). You can add this before DNS is wired.

`localhost` and `*.firebaseapp.com` are already there.

> Keep `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` set to the Firebase-issued
> `*.firebaseapp.com` value — *not* your Vercel/custom domain. That's a
> Firebase Auth thing and unrelated to where the app is hosted.

### 4. Deploy

Click **Deploy** in Vercel. Subsequent pushes to your default branch auto-
deploy; PR branches get preview URLs. To deploy from your laptop:

```bash
pnpm dlx vercel link        # one-time: connect this folder to the Vercel project
pnpm dlx vercel --prod      # deploys current working tree
pnpm dlx vercel env pull    # syncs prod env vars into .env.local
```

### 5. Custom domain on Vercel

In Vercel: **Project → Settings → Domains → Add**. Type `paytochat.fun` (and
add a redirect from `www`). Vercel shows the DNS records to set at your
registrar — typically:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

If your registrar is Cloudflare, gray-cloud the records during provisioning so
Vercel's ACME challenge isn't blocked. Vercel issues SSL automatically once DNS
resolves; status flips to **Valid Configuration**, usually in minutes.

After the domain is live, **make sure you also added it to Firebase Auth's
Authorized domains list** (step 3) — otherwise Google sign-in on the new
domain silently fails.

### 6. Deploy Firestore rules + indexes (+ Storage rules) from your laptop

This stays on the Firebase side and is independent of Vercel:

```bash
npm i -g firebase-tools
firebase login
firebase use --add                                              # link the Firebase project
firebase deploy --only firestore:rules,firestore:indexes        # always run after rules/index changes
firebase deploy --only storage                                  # if you change storage.rules
```

### 7. Other production checklist items

- **WalletConnect allowlist** — in the WalletConnect Cloud dashboard, add your
  Vercel preview URL and your custom domain to the project's allowed origins.
- **Vercel function region** — defaults to US East (iad1). If your Firestore
  is in a different region you can override in **Settings → Functions** to
  cut latency on `/api/messages/*`.
- **Service account permissions** — the Admin SDK only needs Firestore + Auth
  IAM roles (`roles/datastore.user`, `roles/firebaseauth.admin`). Don't give
  it Owner.

## How payment & verification works

1. Sender writes a message and chooses chain + token + amount.
2. Sender's connected wallet signs an ERC-20 (Ethereum) or SPL (Solana)
   `transfer` directly to the recipient's wallet address from their profile.
3. Once the tx is confirmed, the client posts `{recipientHandle, body, chain,
   token, txHash, amountUSD, fromAddress}` + the user's Firebase ID token to
   `POST /api/messages/send`.
4. The server (Admin SDK) verifies the ID token, looks up the recipient,
   refuses below-threshold tips, fetches the on-chain transaction via RPC and
   confirms:
   - Transaction succeeded.
   - There's a `Transfer` log on the right token contract / SPL mint.
   - Recipient address matches the recipient's configured wallet.
   - Amount ≥ requested amount.
   - The same tx hash hasn't been used to unlock a different message.
5. On success, the message is written with `status: "paid"`, the conversation
   row is updated, and the recipient's `messagesReceived` counter
   increments. The `totalEarnedUSD` aggregate is **not** touched yet —
   that happens on claim, so a recipient can never learn the amount before
   they pull it on-chain.
6. When the recipient hits "Reveal", `POST /api/messages/open` flips
   `status: "opened"` and decrements the unread counter. The body is now
   visible but the tip is still locked in escrow; the amount remains
   hidden in the UI.
7. The recipient pulls the tip with `claim()` on-chain. `POST
   /api/messages/claim` verifies the tx, flips `status: "claimed"`,
   credits `totalEarnedUSD`, and creates a `threads/{messageId}` doc
   (one thread **per paid message**) with `expiresAt = now +
   coolOffDays * 24h`. The server also stamps `threadId = messageId`
   onto the anchor message so a single
   `messages where threadId == X order by createdAt asc` query returns
   the anchor + all free replies in the thread. The amount is only
   surfaced in the UI once the thread doc exists.
8. Free in-thread replies pass `free: true` plus the `threadId` they
   belong to. `/api/messages/send` accepts them only while
   `threads/{threadId}.expiresAt > now` and bumps `freeReplyCount` /
   `lastMessageAt` on the thread. Outside that window the server
   rejects free sends and the UI collapses the composer to a
   contextual CTA (claim / waiting on claim / send a new paid message).
9. Each paid message anchors **its own thread** with its own 1-day
   window. Two paid messages between the same pair of users → two
   separate threads, two separate URLs (`/a/dashboard/t/{messageId}`),
   and two rows in the chats list.

We never hold the funds. The recipient's wallet receives the transfer
directly.

## What the auto-DM feature actually does

Real auto-replies on X or Instagram require OAuth and are subject to those
platforms' Developer Terms. This v1 ships a **copy-paste generator**:

- Customize a templated reply in **Settings → DM auto-reply**.
- One-click copy of the reply with your handle interpolated.
- One-click copy of your `paytochat.fun/<handle>` link.
- A "Tweet it" deep-link.

A future webhook integration could automate this for verified developer
accounts.

## Security notes

- Firestore rules deny all message writes from clients — only the
  Admin-SDK-backed API routes can create messages, which guarantees a
  payment was verified before the message exists.
- Message bodies are sanitized server-side (`sanitize-html`) before being
  persisted. Only a small allowlist of tags / attributes survives, every
  link is forced to `target="_blank" rel="noopener noreferrer nofollow"`,
  and only `http(s):` and `mailto:` schemes are kept.
- Storage rules restrict inline image uploads to the authenticated sender's
  own `message-images/<uid>/...` folder, cap each file at 8 MB, and allow
  only common image MIME types.
- Handles must be 3–24 chars `[a-z0-9_]`. A small set of route-collision
  names (`api`, `app`, `admin`, `www`, …) is reserved.
- Participants can only update their own conversation `unreadCount`
  field; nothing else. There is no client-writable free-chat flag — free
  replies are gated solely by the server-managed
  `threads/{threadId}.expiresAt` window, which only opens after a
  verified on-chain claim of the specific paid message that anchors
  the thread.
- The user document `handle` and `handleLower` are immutable after creation
  (rules enforce this) so handles can't be hijacked.
- Same `txHash` cannot be reused for a second message (server-side check).
- Min-threshold is enforced server-side, not just in UI.

## On-chain escrow

The escrow logic ships in two parallel implementations sharing the same
flow and `payment_id`-keyed semantics, so the off-chain layer stays
chain-agnostic:

- **`contracts/`** — Solidity / Hardhat for EVM chains
  (Ethereum mainnet + L2s like Base, Arbitrum, Optimism, Polygon).
- **`solana/`** — Rust / Anchor program for Solana (SPL tokens
  USDC / USDT).

`contracts/` is a self-contained Hardhat project containing
`PayToChatEscrow.sol` — a secure ERC-20 escrow that lets us upgrade the
payment flow from "direct transfer" to:

1. **Sender** approves the escrow and calls
   `deposit(paymentId, recipient, token, amount, deadline)`.
2. **Recipient** calls `claim(paymentId)` — receives `amount - fee`, the
   contract retains the fee.
3. **Sender** can `refund(paymentId)` once the deadline passes if the
   recipient ignored the message.
4. **Admin** sweeps accumulated fees with `withdrawFees(token, to)`.

Hardened with OpenZeppelin's `SafeERC20`, `Ownable2Step`,
`ReentrancyGuard`, and `Pausable`; fee is hard-capped at 10 % on-chain;
admin can never withdraw user-escrowed principal. Build and test from
inside `contracts/`:

```bash
cd contracts
pnpm install
pnpm test                # full test suite (happy paths + reverts + reentrancy)
pnpm deploy:sepolia      # after filling in contracts/.env
```

See [`contracts/README.md`](./contracts/README.md) for the EVM contract's
security model and [`solana/README.md`](./solana/README.md) for the
Solana program's. The unified deployment guide is in
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

## What's next (not in v1)

- Email / push notifications above the notify threshold (Firebase Cloud
  Messaging or Resend webhook).
- Wire `src/lib/payments/client.ts` and `verify.ts` to the deployed
  `PayToChatEscrow` contract so cool-off-window refunds replace today's
  direct-transfer flow.
- Native auto-DM via X / Instagram OAuth.
- Custom on-chain memo encoding the message id so verification doesn't need
  a separate API round-trip.

## License

MIT.
