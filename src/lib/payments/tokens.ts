import type { Chain, Token } from "../types";

/** Which on-chain SPL program owns a given Solana mint. */
export type SolanaTokenProgram = "spl-token" | "spl-token-2022";

/**
 * Solana mints — keyed by token symbol; SPL flow uses these directly.
 *
 * `tokenProgram` selects between the legacy SPL Token program
 * (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) and the newer
 * SPL Token-2022 program (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
 * Token-2022 mints (e.g. USDG) need the matching program everywhere we
 * derive ATAs, build transfer instructions, and sign CPIs.
 */
const SOLANA_MINTS: Record<
  Token,
  { address: string; decimals: number; tokenProgram: SolanaTokenProgram }
> = {
  USDC: {
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    tokenProgram: "spl-token",
  },
  USDT: {
    address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
    tokenProgram: "spl-token",
  },
  // Paxos Global Dollar (USDG). Token-2022 mint with these extensions
  // currently enabled on the mint config:
  //   - permanentDelegate (Paxos can move/burn tokens at any time)
  //   - transferFeeConfig (currently 0 bps; could be raised by Paxos)
  //   - transferHook (authority set, programId null — no hook today)
  //   - confidentialTransfer / confidentialTransferFee
  //   - mintCloseAuthority, metadataPointer, tokenMetadata
  // The transferFee extension means deposits/transfers may net less than
  // the requested amount once Paxos enables a non-zero fee, exactly the
  // same way fee-on-transfer ERC-20s already behave in the EVM escrow.
  USDG: {
    address: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    decimals: 6,
    tokenProgram: "spl-token-2022",
  },
};

/**
 * EVM token addresses keyed by chainId. Add a chain by adding its entry.
 *
 * Numeric chain IDs are deliberate — they match wagmi's `useChainId()`
 * return value and the on-chain `chainid` opcode, which makes the lookup
 * trivial in both client and server code.
 *
 * Sources:
 *   - Mainnet:  Etherscan canonical contracts.
 *   - Sepolia:  Circle's testnet USDC. Sepolia has no canonical USDT;
 *              users testing USDT/USDG flow there should deploy a mock token.
 *   - Base:    USDC = native (Circle). USDT not common on Base — leave undefined.
 *   - Arbitrum: USDC = native (Circle), USDT = bridged Tether.
 *   - Optimism: USDC = native, USDT = bridged.
 *   - Polygon: USDC = native, USDT = native.
 *   - USDG:    Paxos Global Dollar. Currently only deployed on Ethereum mainnet
 *              (and Ink + X Layer, which we don't yet target). See
 *              <https://docs.paxos.com/guides/stablecoin/usdg/mainnet>.
 */
const EVM_TOKENS: Record<Token, {
  decimals: number;
  addresses: Record<number, `0x${string}`>;
}> = {
  USDC: {
    decimals: 6,
    addresses: {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    },
  },
  USDT: {
    decimals: 6,
    addresses: {
      1: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      10: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
      137: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    },
  },
  USDG: {
    decimals: 6,
    addresses: {
      1: "0xe343167631d89B6Ffc58B88d6b7fB0228795491D",
    },
  },
};

export interface TokenInfo {
  chain: Chain;
  token: Token;
  /** Mint (Solana) or contract address (EVM). */
  address: string;
  decimals: number;
  /**
   * Solana-only: which SPL program owns this mint. Undefined for EVM
   * tokens. Callers building ATAs / transfer ixs must use the matching
   * program id (legacy vs Token-2022).
   */
  tokenProgram?: SolanaTokenProgram;
}

/**
 * Look up a token for a given chain.
 *
 * EVM chains require a chainId — pass the wagmi `useChainId()` value.
 * Throws if the token isn't supported on that chain so callers don't
 * accidentally try to deposit a non-existent token.
 */
export function getToken(
  chain: Chain,
  token: Token,
  chainId?: number,
): TokenInfo {
  if (chain === "solana") {
    const m = SOLANA_MINTS[token];
    return {
      chain: "solana",
      token,
      address: m.address,
      decimals: m.decimals,
      tokenProgram: m.tokenProgram,
    };
  }
  const cid = chainId ?? 1;
  const cfg = EVM_TOKENS[token];
  const addr = cfg.addresses[cid];
  if (!addr) {
    throw new Error(`No ${token} address configured for EVM chainId ${cid}.`);
  }
  return {
    chain: "ethereum",
    token,
    address: addr,
    decimals: cfg.decimals,
  };
}

/** True iff `token` has a configured address on `chainId`. */
export function isTokenSupportedOnChain(
  token: Token,
  chainId: number,
): boolean {
  return Boolean(EVM_TOKENS[token].addresses[chainId]);
}

/** All tokens we support somewhere. UI components iterate this. */
export const ALL_TOKENS: readonly Token[] = ["USDC", "USDT", "USDG"];
