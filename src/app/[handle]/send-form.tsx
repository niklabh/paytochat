"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Label } from "@/components/ui";
import { RichEditor } from "@/components/rich-editor";
import { useAuth } from "@/lib/auth-context";
import { ConnectButton as RainbowConnect } from "@rainbow-me/rainbowkit";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { erc20Abi, parseUnits } from "viem";
import {
  useConnection,
  useWallet as useSolanaWallet,
} from "@solana/wallet-adapter-react";
import {
  buildEvmApproveArgs,
  buildEvmDepositArgs,
  newPaymentId,
  payOnSolana,
} from "@/lib/payments/client";
import {
  DEFAULT_EVM_CHAIN_ID,
  ESCROW_DEFAULT_DEADLINE_SECONDS,
  chainIdName,
  getEscrowAddress,
} from "@/lib/payments/escrow";
import { ALL_TOKENS, getToken, isTokenSupportedOnChain } from "@/lib/payments/tokens";
import type { Chain, Token, UserDoc } from "@/lib/types";
import { toast } from "sonner";
import { ArrowRight, CircleDollarSign, LogIn, Sparkles } from "lucide-react";
import Link from "next/link";

// Resolved at module load via the static lookup in `escrow.ts`. Webpack
// inlines the `NEXT_PUBLIC_ESCROW_ADDRESS_<id>` literal at build time so
// the address is baked into the client bundle.
const ESCROW_ADDRESS_FOR_DEFAULT_CHAIN = getEscrowAddress(DEFAULT_EVM_CHAIN_ID);

interface Props {
  recipient: {
    handle: string;
    displayName: string;
    wallets: UserDoc["wallets"];
    acceptedChains: Chain[];
    acceptedTokens: Token[];
    minThresholdUSD: number;
  };
}

const PRESETS = [1, 5, 10, 25, 100];
const MAX_PLAIN_LENGTH = 2000;

export function SendMessageForm({ recipient }: Props) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [chain, setChain] = useState<Chain>(
    recipient.acceptedChains[0] ?? "solana"
  );
  const [token, setToken] = useState<Token>(
    recipient.acceptedTokens[0] ?? "USDC"
  );
  const [amount, setAmount] = useState<number>(
    Math.max(recipient.minThresholdUSD, 5)
  );
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<
    "idle" | "switching" | "approving" | "depositing" | "verifying"
  >("idle");

  // EVM
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const evmChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const evmPublicClient = usePublicClient({ chainId: DEFAULT_EVM_CHAIN_ID });

  // Solana
  const { connection } = useConnection();
  const {
    publicKey: solPubkey,
    sendTransaction: solSend,
    signTransaction: solSign,
    connected: solConnected,
  } = useSolanaWallet();

  useEffect(() => {
    if (!recipient.acceptedChains.includes(chain)) {
      setChain(recipient.acceptedChains[0] ?? "solana");
    }
    if (!recipient.acceptedTokens.includes(token)) {
      setToken(recipient.acceptedTokens[0] ?? "USDC");
    }
  }, [recipient.acceptedChains, recipient.acceptedTokens, chain, token]);

  const evmTokenSupported = useMemo(
    () => isTokenSupportedOnChain(token, DEFAULT_EVM_CHAIN_ID),
    [token],
  );
  const evmEscrowReady = ESCROW_ADDRESS_FOR_DEFAULT_CHAIN !== null;

  async function postToApi(extra: {
    chain: Chain;
    txHash: string;
    fromAddress?: string;
    paymentId?: `0x${string}`;
    evmChainId?: number;
  }) {
    if (!user) return;
    setStage("verifying");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          recipientHandle: recipient.handle,
          body,
          chain: extra.chain,
          token,
          amountUSD: amount,
          txHash: extra.txHash,
          fromAddress: extra.fromAddress,
          paymentId: extra.paymentId,
          evmChainId: extra.evmChainId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send.");
      toast.success("Sent! They'll see your message in their inbox.");
      router.push("/a/dashboard/sent");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(false);
      setStage("idle");
    }
  }

  async function handleSubmit() {
    if (!user) {
      router.push(`/a/sign-in?next=/${recipient.handle}`);
      return;
    }
    if (bodyText.trim().length === 0) {
      toast.error("Write a message first.");
      return;
    }
    if (bodyText.length > MAX_PLAIN_LENGTH) {
      toast.error(`Message is too long (max ${MAX_PLAIN_LENGTH} characters).`);
      return;
    }
    if (amount < recipient.minThresholdUSD) {
      toast.error(`Minimum tip is $${recipient.minThresholdUSD}.`);
      return;
    }

    setBusy(true);
    setStage("switching");

    try {
      if (chain === "solana") {
        if (!solConnected || !solPubkey || !solSign || !solSend) {
          toast.error("Connect a Solana wallet first.");
          setBusy(false);
          setStage("idle");
          return;
        }
        if (!recipient.wallets.solana) {
          toast.error("Recipient hasn't set a Solana wallet.");
          setBusy(false);
          setStage("idle");
          return;
        }
        const signature = await payOnSolana({
          connection,
          fromPubkey: solPubkey,
          toAddress: recipient.wallets.solana,
          token,
          amountUSD: amount,
          signTransaction: solSign,
          sendTransaction: (tx, conn) => solSend(tx, conn),
        });
        await postToApi({
          chain: "solana",
          txHash: signature,
          fromAddress: solPubkey.toBase58(),
        });
      } else {
        // EVM escrow flow (approve + deposit).
        if (!evmConnected || !evmAddress) {
          toast.error("Connect an Ethereum wallet first.");
          setBusy(false);
          setStage("idle");
          return;
        }
        if (!recipient.wallets.ethereum) {
          toast.error("Recipient hasn't set an Ethereum wallet.");
          setBusy(false);
          setStage("idle");
          return;
        }
        if (!evmEscrowReady || !ESCROW_ADDRESS_FOR_DEFAULT_CHAIN) {
          toast.error(
            `Escrow contract not configured for ${chainIdName(DEFAULT_EVM_CHAIN_ID)}. ` +
              "Set NEXT_PUBLIC_ESCROW_ADDRESS_<chainId> in your env.",
          );
          setBusy(false);
          setStage("idle");
          return;
        }
        if (!evmTokenSupported) {
          toast.error(
            `${token} is not configured on ${chainIdName(DEFAULT_EVM_CHAIN_ID)}. ` +
              "Try a different token or chain.",
          );
          setBusy(false);
          setStage("idle");
          return;
        }
        if (evmChainId !== DEFAULT_EVM_CHAIN_ID) {
          setStage("switching");
          await switchChainAsync({ chainId: DEFAULT_EVM_CHAIN_ID });
        }

        // Step 1: ensure the escrow has at least `amount` allowance.
        const tokenInfo = getToken("ethereum", token, DEFAULT_EVM_CHAIN_ID);
        const value = parseUnits(
          amount.toFixed(tokenInfo.decimals),
          tokenInfo.decimals,
        );
        const currentAllowance = evmPublicClient
          ? ((await evmPublicClient.readContract({
              address: tokenInfo.address as `0x${string}`,
              abi: erc20Abi,
              functionName: "allowance",
              args: [evmAddress, ESCROW_ADDRESS_FOR_DEFAULT_CHAIN],
            })) as bigint)
          : 0n;
        if (currentAllowance < value) {
          setStage("approving");
          const approveHash = await writeContractAsync(
            buildEvmApproveArgs(
              token,
              DEFAULT_EVM_CHAIN_ID,
              ESCROW_ADDRESS_FOR_DEFAULT_CHAIN,
              amount,
            ),
          );
          if (evmPublicClient) {
            await evmPublicClient.waitForTransactionReceipt({ hash: approveHash });
          }
        }

        // Step 2: deposit into the escrow with a fresh paymentId.
        const paymentId = newPaymentId();
        setStage("depositing");
        const depositHash = await writeContractAsync(
          buildEvmDepositArgs({
            escrow: ESCROW_ADDRESS_FOR_DEFAULT_CHAIN,
            paymentId,
            recipient: recipient.wallets.ethereum as `0x${string}`,
            token,
            chainId: DEFAULT_EVM_CHAIN_ID,
            amountUSD: amount,
            deadlineSeconds: ESCROW_DEFAULT_DEADLINE_SECONDS,
          }),
        );
        if (evmPublicClient) {
          await evmPublicClient.waitForTransactionReceipt({ hash: depositHash });
        }

        // Step 3: tell the server about the deposit.
        await postToApi({
          chain: "ethereum",
          txHash: depositHash,
          fromAddress: evmAddress,
          paymentId,
          evmChainId: DEFAULT_EVM_CHAIN_ID,
        });
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Payment cancelled.");
      setBusy(false);
      setStage("idle");
    }
  }

  return (
    <Card className="mt-8">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Sparkles className="text-brand-300" size={18} /> Send {recipient.displayName} a
        message
      </h2>
      <p className="text-sm text-muted mt-1">
        The amount stays hidden until they swipe to read.
      </p>

      <div className="mt-5 space-y-1.5">
        <Label>Message</Label>
        <RichEditor
          value={body}
          onChange={(html, plain) => {
            setBody(html);
            setBodyText(plain);
          }}
          uploaderUid={user?.uid ?? null}
          placeholder={`Hey ${recipient.displayName}, I'd love your take on…`}
          maxPlainLength={MAX_PLAIN_LENGTH}
          disabled={busy}
        />
        <p className="text-xs text-muted">
          Format with bold, headings, lists, and{" "}
          <span className="text-foreground">drop or paste images</span> to make
          your message stand out.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Chain</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["solana", "ethereum"] as Chain[]).map((c) => {
              const enabled = recipient.acceptedChains.includes(c);
              return (
                <button
                  key={c}
                  disabled={!enabled}
                  onClick={() => setChain(c)}
                  className={`h-11 rounded-xl text-sm border transition-colors ${
                    chain === c
                      ? "bg-brand-500/20 border-brand-400 text-foreground"
                      : "border-white/10 text-muted hover:bg-white/5"
                  } disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  {c === "solana" ? "Solana" : "Ethereum"}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Token</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ALL_TOKENS.map((t) => {
              const enabled = recipient.acceptedTokens.includes(t);
              return (
                <button
                  key={t}
                  disabled={!enabled}
                  onClick={() => setToken(t)}
                  className={`h-11 rounded-xl text-sm border transition-colors ${
                    token === t
                      ? "bg-brand-500/20 border-brand-400 text-foreground"
                      : "border-white/10 text-muted hover:bg-white/5"
                  } disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <Label>Tip amount (USD)</Label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(p)}
              className={`h-9 rounded-lg px-3 text-sm border transition-colors ${
                amount === p
                  ? "bg-brand-500/20 border-brand-400"
                  : "border-white/10 text-muted hover:bg-white/5"
              }`}
            >
              ${p}
            </button>
          ))}
        </div>
        <div className="relative">
          <CircleDollarSign
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="number"
            min={recipient.minThresholdUSD}
            step="0.5"
            value={amount}
            onChange={(e) => setAmount(parseFloat(e.target.value || "0"))}
            className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-4 text-sm focus:outline-none focus:border-brand/60"
          />
        </div>
        <p className="text-xs text-muted">
          Minimum: ${recipient.minThresholdUSD}. Sender pays standard network fees.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 items-center">
        {chain === "solana" ? (
          <SolConnect />
        ) : (
          <RainbowConnect chainStatus="icon" showBalance={false} />
        )}
        {!user && !loading && (
          <Link href={`/a/sign-in?next=/${recipient.handle}`}>
            <Badge>
              <LogIn size={12} /> Sign in required to send
            </Badge>
          </Link>
        )}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={
          busy ||
          !user ||
          bodyText.trim() === "" ||
          bodyText.length > MAX_PLAIN_LENGTH
        }
        size="lg"
        className="mt-6 w-full"
      >
        {stage === "switching"
          ? `Switching to ${chainIdName(DEFAULT_EVM_CHAIN_ID)}…`
          : stage === "approving"
          ? `Approving ${token} for the escrow…`
          : stage === "depositing"
          ? `Depositing $${amount} into escrow…`
          : stage === "verifying"
          ? "Verifying on-chain…"
          : busy
          ? "Working…"
          : (
            <>
              Pay ${amount} & Send <ArrowRight size={18} />
            </>
          )}
      </Button>
      {chain === "ethereum" && (
        <p className="mt-2 text-[11px] text-muted text-center">
          Funds escrow on {chainIdName(DEFAULT_EVM_CHAIN_ID)} for {Math.round(ESCROW_DEFAULT_DEADLINE_SECONDS / 86400)} days.
          The recipient claims to unlock; if they ignore it, you can refund after the deadline.
        </p>
      )}
    </Card>
  );
}

function SolConnect() {
  // Minimal styling override of WalletMultiButton.
  return (
    <div className="[&>button]:!h-11 [&>button]:!rounded-xl [&>button]:!bg-white/5 [&>button]:!text-foreground [&>button]:!border [&>button]:!border-white/10 [&>button]:!font-medium [&>button]:!text-sm [&>button]:!px-4 [&>button:hover]:!bg-white/10">
      <WalletMultiButton />
    </div>
  );
}
