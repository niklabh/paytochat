import "server-only";
import {
  createPublicClient,
  http,
  getAddress,
  decodeEventLog,
  type Abi,
} from "viem";
import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  arbitrum,
  optimism,
  polygon,
  type Chain as ViemChain,
} from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { getToken } from "./tokens";
import { getEscrowAddress } from "./escrow";
import { escrowAbi } from "./escrow-abi";
import type { Chain, Token } from "../types";

export interface VerifyResult {
  ok: boolean;
  error?: string;
  amountUSD?: number;
  fromAddress?: string;
  toAddress?: string;
  /** UNIX seconds — only set on EVM escrow verifies, lifted from the Deposited event. */
  escrowDeadline?: number;
}

const SOL_RPC =
  process.env.SOL_RPC_URL || "https://api.mainnet-beta.solana.com";

/** chainId -> viem chain config + RPC URL. */
const EVM_CHAINS: Record<number, { chain: ViemChain; rpc: string | undefined }> = {
  1: { chain: mainnet, rpc: process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com" },
  11155111: { chain: sepolia, rpc: process.env.SEPOLIA_RPC_URL || "https://sepolia.gateway.tenderly.co" },
  8453: { chain: base, rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org" },
  84532: { chain: baseSepolia, rpc: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org" },
  42161: { chain: arbitrum, rpc: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc" },
  10: { chain: optimism, rpc: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io" },
  137: { chain: polygon, rpc: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com" },
};

function evmClient(chainId: number) {
  const cfg = EVM_CHAINS[chainId];
  if (!cfg) throw new Error(`Unsupported EVM chainId: ${chainId}`);
  return createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });
}

/* ----------------------------------------------------------------------- */
/* EVM — Deposited event verification                                      */
/* ----------------------------------------------------------------------- */

interface VerifyEvmEscrowArgs {
  chainId: number;
  txHash: `0x${string}`;
  paymentId: `0x${string}`;
  expectedRecipient: string;
  expectedFrom?: string;
  token: Token;
  minAmountUSD: number;
}

async function verifyEvmEscrowDeposit(
  args: VerifyEvmEscrowArgs,
): Promise<VerifyResult> {
  const escrow = getEscrowAddress(args.chainId);
  if (!escrow) {
    return {
      ok: false,
      error: `No PayToChatEscrow configured server-side for chain ${args.chainId}.`,
    };
  }

  let receipt;
  try {
    receipt = await evmClient(args.chainId).getTransactionReceipt({
      hash: args.txHash,
    });
  } catch {
    return {
      ok: false,
      error: "Transaction not found yet. Wait for it to confirm and retry.",
    };
  }
  if (!receipt) return { ok: false, error: "Transaction not yet mined." };
  if (receipt.status !== "success") {
    return { ok: false, error: "Transaction reverted on-chain." };
  }

  const expectedTo = getAddress(args.expectedRecipient);
  const escrowAddr = getAddress(escrow);
  const tokenInfo = getToken("ethereum", args.token, args.chainId);
  const expectedToken = getAddress(tokenInfo.address);
  const paymentIdLc = args.paymentId.toLowerCase();

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== escrowAddr) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: escrowAbi as unknown as Abi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Deposited") continue;

    const a = decoded.args as unknown as {
      paymentId: `0x${string}`;
      sender: `0x${string}`;
      recipient: `0x${string}`;
      token: `0x${string}`;
      amount: bigint;
      deadline: bigint;
    };

    if (a.paymentId.toLowerCase() !== paymentIdLc) continue;
    if (getAddress(a.recipient) !== expectedTo) {
      return { ok: false, error: "Deposit recipient does not match." };
    }
    if (getAddress(a.token) !== expectedToken) {
      return { ok: false, error: `Deposit token does not match expected ${args.token}.` };
    }
    if (args.expectedFrom && getAddress(a.sender) !== getAddress(args.expectedFrom)) {
      return { ok: false, error: "Deposit sender does not match the connected wallet." };
    }

    const amountUSD = Number(a.amount) / 10 ** tokenInfo.decimals;
    if (amountUSD + 1e-9 < args.minAmountUSD) {
      return {
        ok: false,
        error: `On-chain amount ${amountUSD} ${args.token} is below the requested ${args.minAmountUSD}.`,
      };
    }
    return {
      ok: true,
      amountUSD,
      fromAddress: getAddress(a.sender),
      toAddress: getAddress(a.recipient),
      escrowDeadline: Number(a.deadline),
    };
  }

  return {
    ok: false,
    error: "No matching Deposited event for this paymentId on the configured escrow.",
  };
}

/* ----------------------------------------------------------------------- */
/* EVM — Claimed / Refunded event verification                              */
/* ----------------------------------------------------------------------- */

export interface VerifyClaimResult {
  ok: boolean;
  error?: string;
  amountToRecipient?: number;
  fee?: number;
  recipient?: string;
}

export async function verifyEvmClaim(args: {
  chainId: number;
  txHash: `0x${string}`;
  paymentId: `0x${string}`;
  expectedRecipient: string;
}): Promise<VerifyClaimResult> {
  const escrow = getEscrowAddress(args.chainId);
  if (!escrow) {
    return {
      ok: false,
      error: `No PayToChatEscrow configured server-side for chain ${args.chainId}.`,
    };
  }
  let receipt;
  try {
    receipt = await evmClient(args.chainId).getTransactionReceipt({ hash: args.txHash });
  } catch {
    return { ok: false, error: "Claim tx not found yet." };
  }
  if (!receipt) return { ok: false, error: "Claim tx not yet mined." };
  if (receipt.status !== "success") {
    return { ok: false, error: "Claim tx reverted on-chain." };
  }
  const escrowAddr = getAddress(escrow);
  const expectedTo = getAddress(args.expectedRecipient);
  const paymentIdLc = args.paymentId.toLowerCase();
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== escrowAddr) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: escrowAbi as unknown as Abi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Claimed") continue;
    const a = decoded.args as unknown as {
      paymentId: `0x${string}`;
      recipient: `0x${string}`;
      token: `0x${string}`;
      amountToRecipient: bigint;
      fee: bigint;
    };
    if (a.paymentId.toLowerCase() !== paymentIdLc) continue;
    if (getAddress(a.recipient) !== expectedTo) {
      return { ok: false, error: "Claim recipient does not match." };
    }
    return {
      ok: true,
      recipient: getAddress(a.recipient),
      amountToRecipient: Number(a.amountToRecipient) / 1e6,
      fee: Number(a.fee) / 1e6,
    };
  }
  return { ok: false, error: "No matching Claimed event in this tx." };
}

export interface VerifyRefundResult {
  ok: boolean;
  error?: string;
  amount?: number;
  sender?: string;
}

export async function verifyEvmRefund(args: {
  chainId: number;
  txHash: `0x${string}`;
  paymentId: `0x${string}`;
  expectedSender: string;
}): Promise<VerifyRefundResult> {
  const escrow = getEscrowAddress(args.chainId);
  if (!escrow) {
    return {
      ok: false,
      error: `No PayToChatEscrow configured server-side for chain ${args.chainId}.`,
    };
  }
  let receipt;
  try {
    receipt = await evmClient(args.chainId).getTransactionReceipt({ hash: args.txHash });
  } catch {
    return { ok: false, error: "Refund tx not found yet." };
  }
  if (!receipt) return { ok: false, error: "Refund tx not yet mined." };
  if (receipt.status !== "success") {
    return { ok: false, error: "Refund tx reverted on-chain." };
  }
  const escrowAddr = getAddress(escrow);
  const expectedFrom = getAddress(args.expectedSender);
  const paymentIdLc = args.paymentId.toLowerCase();
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== escrowAddr) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: escrowAbi as unknown as Abi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Refunded") continue;
    const a = decoded.args as unknown as {
      paymentId: `0x${string}`;
      sender: `0x${string}`;
      token: `0x${string}`;
      amount: bigint;
    };
    if (a.paymentId.toLowerCase() !== paymentIdLc) continue;
    if (getAddress(a.sender) !== expectedFrom) {
      return { ok: false, error: "Refund sender does not match." };
    }
    return {
      ok: true,
      sender: getAddress(a.sender),
      amount: Number(a.amount) / 1e6,
    };
  }
  return { ok: false, error: "No matching Refunded event in this tx." };
}

/* ----------------------------------------------------------------------- */
/* Solana — direct SPL transfer (legacy; replaces with Anchor program later) */
/* ----------------------------------------------------------------------- */

async function verifySolana({
  signature,
  expectedTo,
  expectedFrom,
  token,
  minAmountUSD,
}: {
  signature: string;
  expectedTo: string;
  expectedFrom?: string;
  token: Token;
  minAmountUSD: number;
}): Promise<VerifyResult> {
  const conn = new Connection(SOL_RPC, "confirmed");
  let parsed;
  try {
    parsed = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    return { ok: false, error: "Could not fetch Solana transaction." };
  }
  if (!parsed) return { ok: false, error: "Transaction not yet finalized. Try again in a few seconds." };
  if (parsed.meta?.err) return { ok: false, error: "Transaction failed on-chain." };

  const tokenInfo = getToken("solana", token);
  const recipientPk = new PublicKey(expectedTo);

  const pre = parsed.meta?.preTokenBalances || [];
  const post = parsed.meta?.postTokenBalances || [];

  for (const p of post) {
    if (p.mint !== tokenInfo.address) continue;
    if (p.owner !== recipientPk.toBase58()) continue;
    const matchingPre = pre.find(
      (pp) =>
        pp.accountIndex === p.accountIndex &&
        pp.mint === p.mint &&
        pp.owner === p.owner
    );
    const preAmount = matchingPre
      ? Number(matchingPre.uiTokenAmount.amount) / 10 ** tokenInfo.decimals
      : 0;
    const postAmount =
      Number(p.uiTokenAmount.amount) / 10 ** tokenInfo.decimals;
    const delta = postAmount - preAmount;
    if (delta + 1e-9 < minAmountUSD) continue;

    if (expectedFrom) {
      const senderHas = post.some(
        (pp) => pp.mint === tokenInfo.address && pp.owner === expectedFrom
      );
      if (!senderHas) {
        return {
          ok: false,
          error: "Transfer detected, but not from the expected sender wallet.",
        };
      }
    }
    return {
      ok: true,
      amountUSD: delta,
      fromAddress: expectedFrom,
      toAddress: expectedTo,
    };
  }

  return {
    ok: false,
    error: "No matching SPL token transfer to the recipient was found in this signature.",
  };
}

/* ----------------------------------------------------------------------- */
/* Public entry point                                                       */
/* ----------------------------------------------------------------------- */

export async function verifyPayment(input: {
  chain: Chain;
  token: Token;
  txHash: string;
  expectedTo: string;
  expectedFrom?: string;
  minAmountUSD: number;
  /** Required for EVM escrow flow. */
  paymentId?: string;
  /** Required for EVM escrow flow. */
  evmChainId?: number;
}): Promise<VerifyResult> {
  if (input.chain === "ethereum") {
    if (!input.txHash.startsWith("0x")) {
      return { ok: false, error: "Invalid Ethereum tx hash." };
    }
    if (!input.paymentId || !/^0x[0-9a-fA-F]{64}$/.test(input.paymentId)) {
      return {
        ok: false,
        error: "EVM escrow flow requires a valid bytes32 paymentId.",
      };
    }
    if (!input.evmChainId) {
      return { ok: false, error: "EVM escrow flow requires evmChainId." };
    }
    return verifyEvmEscrowDeposit({
      chainId: input.evmChainId,
      txHash: input.txHash as `0x${string}`,
      paymentId: input.paymentId as `0x${string}`,
      expectedRecipient: input.expectedTo,
      expectedFrom: input.expectedFrom,
      token: input.token,
      minAmountUSD: input.minAmountUSD,
    });
  }
  return verifySolana({
    signature: input.txHash,
    expectedTo: input.expectedTo,
    expectedFrom: input.expectedFrom,
    token: input.token,
    minAmountUSD: input.minAmountUSD,
  });
}
