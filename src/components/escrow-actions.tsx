"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CheckCircle2, Coins, Hourglass, ShieldCheck, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";
import {
  buildEvmClaimArgs,
  buildEvmRefundArgs,
} from "@/lib/payments/client";
import { chainIdName } from "@/lib/payments/escrow";
import { formatUSD } from "@/lib/utils";
import type { MessageDoc } from "@/lib/types";

interface Props {
  message: MessageDoc;
  /**
   * Which side of the message this caller represents:
   *   - "recipient": render the claim CTA when applicable.
   *   - "sender":    render the refund CTA when applicable.
   *
   * (We pass this in explicitly rather than infer from auth so the same
   * component can be embedded in both the thread view and the sent view.)
   */
  perspective: "recipient" | "sender";
  /** Optional callback fired after a successful claim/refund. */
  onResolved?: () => void;
}

export function EscrowActions({ message, perspective, onResolved }: Props) {
  const { user } = useAuth();
  const { address: evmAddress, isConnected } = useAccount();
  const evmChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { openConnectModal } = useConnectModal();
  const targetChainId = message.escrowChainId ?? null;
  const publicClient = usePublicClient({ chainId: targetChainId ?? undefined });
  const [busy, setBusy] = useState(false);

  // Live now-ms tick so the deadline countdown re-renders.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const isEvmEscrow =
    !!message.paymentId && !!message.escrowAddress && !!message.escrowChainId;

  // We deliberately do NOT pre-fetch the on-chain quote (toRecipient, fee).
  // The recipient should not see what the tip is worth before they actually
  // pull it from the escrow — surfacing the quote here would defeat the
  // "amount stays hidden until you claim" promise. The amount is only
  // revealed in UI once `message.status === "claimed"`.
  const deadlinePassed = useMemo(() => {
    if (!message.escrowDeadline) return false;
    return nowSec > message.escrowDeadline;
  }, [message.escrowDeadline, nowSec]);

  const remainingLabel = useMemo(() => {
    if (!message.escrowDeadline) return null;
    const remaining = message.escrowDeadline - nowSec;
    if (remaining <= 0) return null;
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }, [message.escrowDeadline, nowSec]);

  if (!isEvmEscrow) return null;

  // Already-resolved states get a neutral status pill, no CTA. Showing
  // the amount on the claimed pill is fine here — the recipient has
  // already pulled the funds.
  if (message.status === "claimed") {
    const showAmount = perspective !== "recipient" || !!message.amountUSD;
    return (
      <Pill tone="success" icon={<CheckCircle2 size={12} />}>
        Claimed
        {showAmount && message.amountUSD
          ? ` · ${formatUSD(message.amountUSD)}`
          : ""}
      </Pill>
    );
  }
  if (message.status === "refunded") {
    return (
      <Pill tone="muted" icon={<Undo2 size={12} />}>
        Refunded
      </Pill>
    );
  }

  // ---- recipient: claim CTA ---------------------------------------------
  if (perspective === "recipient") {
    if (message.status !== "paid" && message.status !== "opened") return null;

    async function onClaim() {
      if (!user) return;
      if (!message.escrowAddress || !message.paymentId || !message.escrowChainId) return;
      if (!isConnected || !evmAddress) {
        // No wallet connected: open the RainbowKit modal so the user can
        // pick one. Once they're connected they can hit "Claim now" again.
        if (openConnectModal) {
          openConnectModal();
        } else {
          toast.error("Connect your Ethereum wallet to claim.");
        }
        return;
      }
      // Recipient-address sanity check: warn if connected wallet isn't the
      // recipient address recorded on the deposit.
      if (
        message.toAddress &&
        evmAddress.toLowerCase() !== message.toAddress.toLowerCase()
      ) {
        toast.error(
          `Connected wallet ${evmAddress.slice(0, 6)}…${evmAddress.slice(-4)} is not ` +
            `the recipient of this deposit (${message.toAddress.slice(0, 6)}…${message.toAddress.slice(-4)}). ` +
            "Switch wallets first.",
        );
        return;
      }
      setBusy(true);
      try {
        if (evmChainId !== message.escrowChainId) {
          await switchChainAsync({ chainId: message.escrowChainId });
        }
        const hash = await writeContractAsync(
          buildEvmClaimArgs(
            message.escrowAddress as `0x${string}`,
            message.paymentId as `0x${string}`,
          ),
        );
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
        }
        const idToken = await user.getIdToken();
        const res = await fetch("/api/messages/claim", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ messageId: message.id, claimTxHash: hash }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Server failed to record claim.");
        toast.success("Claimed.");
        onResolved?.();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Claim failed.");
      } finally {
        setBusy(false);
      }
    }

    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[.06] p-4 mt-3">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-200">
            <ShieldCheck size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">Claim your tip</div>
            <p className="text-xs text-muted mt-0.5">
              Held in escrow on {chainIdName(message.escrowChainId!)}. The
              amount is hidden until you pull it on-chain — claim to reveal.
            </p>
            <Button onClick={() => void onClaim()} disabled={busy} size="sm" className="mt-3">
              {busy ? (
                <>
                  <Coins size={14} /> Claiming…
                </>
              ) : !isConnected ? (
                <>
                  <Wallet size={14} /> Connect wallet to claim
                </>
              ) : (
                <>
                  <Coins size={14} /> Claim now
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---- sender: refund CTA -----------------------------------------------
  if (message.status !== "paid" && message.status !== "opened") return null;

  async function onRefund() {
    if (!user) return;
    if (!message.escrowAddress || !message.paymentId || !message.escrowChainId) return;
    if (!isConnected || !evmAddress) {
      if (openConnectModal) {
        openConnectModal();
      } else {
        toast.error("Connect your Ethereum wallet to refund.");
      }
      return;
    }
    if (
      message.fromAddress &&
      evmAddress.toLowerCase() !== message.fromAddress.toLowerCase()
    ) {
      toast.error(
        `Connected wallet isn't the original sender ` +
          `(${message.fromAddress.slice(0, 6)}…${message.fromAddress.slice(-4)}). ` +
          "Switch wallets first.",
      );
      return;
    }
    setBusy(true);
    try {
      if (evmChainId !== message.escrowChainId) {
        await switchChainAsync({ chainId: message.escrowChainId });
      }
      const hash = await writeContractAsync(
        buildEvmRefundArgs(
          message.escrowAddress as `0x${string}`,
          message.paymentId as `0x${string}`,
        ),
      );
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      const idToken = await user.getIdToken();
      const res = await fetch("/api/messages/refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ messageId: message.id, refundTxHash: hash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Server failed to record refund.");
      toast.success("Refunded.");
      onResolved?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Refund failed.");
    } finally {
      setBusy(false);
    }
  }

  // Sender view: show countdown until deadline, then the refund CTA.
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-3 mt-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-muted">
          {deadlinePassed ? (
            <>
              <Undo2 size={12} className="text-yellow-200" />
              Refundable now (recipient never claimed).
            </>
          ) : (
            <>
              <Hourglass size={12} />
              Refund unlocks in {remainingLabel ?? "—"}.
            </>
          )}
        </div>
        {deadlinePassed && (
          <Button onClick={() => void onRefund()} disabled={busy} size="sm">
            {busy ? (
              <>
                <Undo2 size={14} /> Refunding…
              </>
            ) : !isConnected ? (
              <>
                <Wallet size={14} /> Connect wallet to refund
              </>
            ) : (
              <>
                <Undo2 size={14} /> Refund
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function Pill({
  tone,
  icon,
  children,
}: {
  tone: "success" | "muted";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/[.08] text-emerald-200"
      : "border-white/10 bg-white/[.05] text-muted";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${cls}`}
    >
      {icon}
      {children}
    </span>
  );
}
