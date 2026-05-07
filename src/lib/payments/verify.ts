import "server-only";
import { createPublicClient, http, getAddress } from "viem";
import { mainnet } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { getToken } from "./tokens";
import type { Chain, Token } from "../types";

export interface VerifyResult {
  ok: boolean;
  error?: string;
  amountUSD?: number;
  fromAddress?: string;
  toAddress?: string;
}

const ETH_RPC =
  process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com";
const SOL_RPC =
  process.env.SOL_RPC_URL || "https://api.mainnet-beta.solana.com";

/**
 * Verifies a USDC/USDT ERC-20 transfer on Ethereum mainnet.
 * Looks for a `Transfer(from, to, value)` log on the token contract that
 * matches the expected sender, recipient and minimum amount.
 */
async function verifyEthereum({
  txHash,
  expectedTo,
  expectedFrom,
  token,
  minAmountUSD,
}: {
  txHash: `0x${string}`;
  expectedTo: string;
  expectedFrom?: string;
  token: Token;
  minAmountUSD: number;
}): Promise<VerifyResult> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(ETH_RPC),
  });

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    return { ok: false, error: "Transaction not found yet. Wait for it to confirm and retry." };
  }
  if (!receipt) return { ok: false, error: "Transaction not yet mined." };
  if (receipt.status !== "success") return { ok: false, error: "Transaction reverted on-chain." };

  const tokenInfo = getToken("ethereum", token);
  const expectedToCheck = getAddress(expectedTo);
  const tokenAddrCheck = getAddress(tokenInfo.address);

  // Manual decode of the standard ERC-20 Transfer event topics.
  const TRANSFER_TOPIC =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== tokenAddrCheck) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    const fromTopic = log.topics[1];
    const toTopic = log.topics[2];
    if (!fromTopic || !toTopic) continue;
    const from = getAddress("0x" + fromTopic.slice(26));
    const to = getAddress("0x" + toTopic.slice(26));
    if (to !== expectedToCheck) continue;
    if (expectedFrom && from !== getAddress(expectedFrom)) continue;
    const value = BigInt(log.data);
    const amountUSD = Number(value) / 10 ** tokenInfo.decimals;
    if (amountUSD + 1e-9 < minAmountUSD) {
      return {
        ok: false,
        error: `On-chain amount ${amountUSD} ${token} is below the requested ${minAmountUSD}.`,
      };
    }
    return { ok: true, amountUSD, fromAddress: from, toAddress: to };
  }

  return {
    ok: false,
    error: "No matching ERC-20 Transfer to the recipient was found in this transaction.",
  };
}

/**
 * Verifies a USDC/USDT SPL token transfer on Solana mainnet.
 * Walks the parsed instructions looking for a transfer to the recipient's
 * associated token account (or any token account they own) with sufficient amount.
 */
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

  // pre/post token balance diff — most reliable.
  const pre = parsed.meta?.preTokenBalances || [];
  const post = parsed.meta?.postTokenBalances || [];

  // For every post balance whose owner == recipient and mint == token mint,
  // compute delta against the matching pre balance.
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

    // Optionally check sender
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

export async function verifyPayment(input: {
  chain: Chain;
  token: Token;
  txHash: string;
  expectedTo: string;
  expectedFrom?: string;
  minAmountUSD: number;
}): Promise<VerifyResult> {
  if (input.chain === "ethereum") {
    if (!input.txHash.startsWith("0x")) {
      return { ok: false, error: "Invalid Ethereum tx hash." };
    }
    return verifyEthereum({
      txHash: input.txHash as `0x${string}`,
      expectedTo: input.expectedTo,
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
