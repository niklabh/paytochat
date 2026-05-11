"use client";

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { erc20Abi, parseUnits, toHex } from "viem";
import type { Chain, Token } from "../types";
import { getToken } from "./tokens";
import { escrowAbi } from "./escrow-abi";

/* ----------------------------------------------------------------------- */
/* Solana — direct SPL transfer (legacy; Anchor escrow program lives in
   `solana/` and is not yet wired here).                                   */
/* ----------------------------------------------------------------------- */

export async function payOnSolana(args: {
  connection: Connection;
  fromPubkey: PublicKey;
  toAddress: string;
  token: Token;
  amountUSD: number;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  sendTransaction: (
    tx: Transaction,
    connection: Connection
  ) => Promise<string>;
}): Promise<string> {
  const { connection, fromPubkey, toAddress, token, amountUSD, sendTransaction } =
    args;
  const tokenInfo = getToken("solana", token);
  const mint = new PublicKey(tokenInfo.address);
  const recipient = new PublicKey(toAddress);

  // Token-2022 mints (e.g. USDG) live under a different SPL program
  // than the legacy USDC / USDT mints. Pick the right program everywhere
  // we touch this mint, otherwise the ATA derivation and the transfer
  // instruction both reject with InvalidAccountData.
  const tokenProgramId =
    tokenInfo.tokenProgram === "spl-token-2022"
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  const fromAta = getAssociatedTokenAddressSync(
    mint,
    fromPubkey,
    false,
    tokenProgramId,
  );
  const toAta = getAssociatedTokenAddressSync(
    mint,
    recipient,
    false,
    tokenProgramId,
  );

  const ixs: TransactionInstruction[] = [];

  const toAtaInfo = await connection.getAccountInfo(toAta);
  if (!toAtaInfo) {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        fromPubkey,
        toAta,
        recipient,
        mint,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  const amount = BigInt(Math.round(amountUSD * 10 ** tokenInfo.decimals));
  ixs.push(
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      fromPubkey,
      amount,
      tokenInfo.decimals,
      undefined,
      tokenProgramId,
    )
  );

  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = fromPubkey;

  const signature = await sendTransaction(tx, connection);
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return signature;
}

/* ----------------------------------------------------------------------- */
/* EVM — PayToChatEscrow flow (approve + deposit, then later claim/refund) */
/* ----------------------------------------------------------------------- */

/**
 * 32 random bytes as a 0x-prefixed bytes32 — used as the on-chain
 * paymentId. Each send must use a fresh id; the escrow contract rejects
 * reuse while a previous deposit with that id is still Pending.
 */
export function newPaymentId(): `0x${string}` {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Should never happen in modern browsers; fall back to Math.random.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return toHex(bytes);
}

/**
 * Build the wagmi `writeContract` args for an ERC-20 `approve` granting
 * the escrow permission to pull `amountUSD` of `token` from the user.
 *
 * If the user already has sufficient allowance, the caller can skip this
 * and go straight to `buildEvmDepositArgs`.
 */
export function buildEvmApproveArgs(
  token: Token,
  chainId: number,
  escrow: `0x${string}`,
  amountUSD: number,
) {
  const tokenInfo = getToken("ethereum", token, chainId);
  const value = parseUnits(amountUSD.toFixed(tokenInfo.decimals), tokenInfo.decimals);
  return {
    address: tokenInfo.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "approve" as const,
    args: [escrow, value] as const,
  };
}

/**
 * Build the wagmi `writeContract` args for the escrow's `deposit`. Sender
 * must have approved at least `amountUSD` of `token` for `escrow` first.
 */
export function buildEvmDepositArgs(args: {
  escrow: `0x${string}`;
  paymentId: `0x${string}`;
  recipient: `0x${string}`;
  token: Token;
  chainId: number;
  amountUSD: number;
  /** Seconds from now until refund unlocks. Default: caller-supplied. */
  deadlineSeconds: number;
}) {
  const tokenInfo = getToken("ethereum", args.token, args.chainId);
  const value = parseUnits(
    args.amountUSD.toFixed(tokenInfo.decimals),
    tokenInfo.decimals,
  );
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

/** Recipient: pull the (amount - fee) tokens from the escrow into their wallet. */
export function buildEvmClaimArgs(
  escrow: `0x${string}`,
  paymentId: `0x${string}`,
) {
  return {
    address: escrow,
    abi: escrowAbi,
    functionName: "claim" as const,
    args: [paymentId] as const,
  };
}

/** Sender: pull an unclaimed deposit back, after the deadline has passed. */
export function buildEvmRefundArgs(
  escrow: `0x${string}`,
  paymentId: `0x${string}`,
) {
  return {
    address: escrow,
    abi: escrowAbi,
    functionName: "refund" as const,
    args: [paymentId] as const,
  };
}

export type { Chain, Token };
