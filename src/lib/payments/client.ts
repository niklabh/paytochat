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
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { erc20Abi, parseUnits } from "viem";
import type { Chain, Token } from "../types";
import { getToken } from "./tokens";

/**
 * Build & request the Solana SPL transfer signature from the connected wallet.
 * Creates the recipient ATA if it doesn't exist (paid by sender).
 *
 * Returns the transaction signature on success.
 */
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

  const fromAta = getAssociatedTokenAddressSync(mint, fromPubkey);
  const toAta = getAssociatedTokenAddressSync(mint, recipient);

  const ixs: TransactionInstruction[] = [];

  // Create recipient ATA if missing.
  const toAtaInfo = await connection.getAccountInfo(toAta);
  if (!toAtaInfo) {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        fromPubkey,
        toAta,
        recipient,
        mint,
        TOKEN_PROGRAM_ID,
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
      tokenInfo.decimals
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

/**
 * Returns the wagmi-compatible writeContract args for an ERC-20 transfer.
 */
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

export type { Chain, Token };
