import type { Chain, Token } from "../types";

export interface TokenInfo {
  chain: Chain;
  token: Token;
  /** Mint (Solana) or contract address (Ethereum mainnet). */
  address: string;
  decimals: number;
}

export const TOKEN_REGISTRY: Record<Chain, Record<Token, TokenInfo>> = {
  ethereum: {
    USDC: {
      chain: "ethereum",
      token: "USDC",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      decimals: 6,
    },
    USDT: {
      chain: "ethereum",
      token: "USDT",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      decimals: 6,
    },
  },
  solana: {
    USDC: {
      chain: "solana",
      token: "USDC",
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      decimals: 6,
    },
    USDT: {
      chain: "solana",
      token: "USDT",
      address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      decimals: 6,
    },
  },
};

export function getToken(chain: Chain, token: Token): TokenInfo {
  return TOKEN_REGISTRY[chain][token];
}
