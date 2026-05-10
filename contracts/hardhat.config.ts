import type { HardhatUserConfig } from "hardhat/config";
import { extendProvider } from "hardhat/config";
import { ProviderWrapper } from "hardhat/plugins";
import type { EIP1193Provider, RequestArguments } from "hardhat/types";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import * as fs from "fs";
import { Wallet } from "ethers";

dotenv.config();

/**
 * Some JSON-RPC providers (publicnode, certain Alchemy edge nodes when the
 * tx is still pending, ...) return `"to": ""` instead of `"to": null` for
 * contract-creation transactions. Ethers v6.16+ rejects the empty string
 * with a hard `BAD_DATA / invalid address` throw inside
 * `formatTransactionResponse`, which crashes hardhat-ethers' post-broadcast
 * `checkTx` step — so `Escrow.deploy(...)` blows up AFTER the tx has
 * already been mined, with no way to recover the deployed address from the
 * normal control flow.
 *
 * Fix at the JSON-RPC layer: wrap the network provider and rewrite
 * `to: ""` → `to: null` on the affected response shapes before ethers
 * ever sees them. This is purely defensive normalization of a known
 * RPC quirk; it does not alter any other field.
 */
class ToFieldNormalizingProvider extends ProviderWrapper {
  constructor(provider: EIP1193Provider) {
    super(provider);
  }

  public async request(args: RequestArguments): Promise<unknown> {
    const result = await this._wrappedProvider.request(args);
    if (
      result &&
      typeof result === "object" &&
      (args.method === "eth_getTransactionByHash" ||
        args.method === "eth_getTransactionReceipt" ||
        args.method === "eth_getTransactionByBlockHashAndIndex" ||
        args.method === "eth_getTransactionByBlockNumberAndIndex")
    ) {
      const r = result as { to?: unknown };
      if (r.to === "") r.to = null;
    }
    return result;
  }
}

extendProvider(async (provider) => new ToFieldNormalizingProvider(provider));

/**
 * Load the deployer private key. Priority:
 *   1. `KEYSTORE_PATH` + `KEYSTORE_PASSWORD` — encrypted JSON keystore,
 *      decrypted in memory only. Recommended; what `scripts/deploy-with-keystore.sh`
 *      uses.
 *   2. `DEPLOYER_PRIVATE_KEY` — plaintext key in env. Legacy / CI only.
 *   3. Empty list — config still loads so non-deploy commands (`compile`,
 *      `test`, `verify`) work without any key configured.
 *
 * Failures decrypting the keystore degrade to an empty list rather than
 * crashing config load, so commands like `compile` and `test` keep working.
 */
function loadAccounts(): string[] {
  const ksPath = process.env.KEYSTORE_PATH;
  const ksPwd = process.env.KEYSTORE_PASSWORD;
  if (ksPath && ksPwd) {
    try {
      const json = fs.readFileSync(ksPath, "utf8");
      const wallet = Wallet.fromEncryptedJsonSync(json, ksPwd);
      return [wallet.privateKey];
    } catch (err) {
      console.warn(
        `[hardhat.config] failed to load keystore at ${ksPath}: ` +
          `${(err as Error).message}`,
      );
    }
  }
  const explicit = process.env.DEPLOYER_PRIVATE_KEY;
  if (explicit) return [explicit];
  return [];
}

const accounts = loadAccounts();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const MAINNET_RPC_URL =
  process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com";

// L2 RPCs (cheaper gas; recommended for production tipping flows).
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BASE_SEPOLIA_RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const ARBITRUM_RPC_URL =
  process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";
const OPTIMISM_RPC_URL =
  process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io";
const POLYGON_RPC_URL =
  process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";

// Etherscan V2 unified API: a single etherscan.io key works for every
// chain Etherscan supports (Ethereum + Base + Arbitrum + Optimism +
// Polygon + ...). The old per-chain keys (BASESCAN_API_KEY, etc.) are
// only needed if your account is _exclusively_ on basescan.org/etc and
// you don't have an etherscan.io account — in which case keep using
// `--api-url` overrides on the command line, V2 expects an etherscan.io
// key.
const ETHERSCAN_API_KEY =
  process.env.ETHERSCAN_API_KEY ||
  process.env.BASESCAN_API_KEY ||
  process.env.ARBISCAN_API_KEY ||
  process.env.OPTIMISTIC_ETHERSCAN_API_KEY ||
  process.env.POLYGONSCAN_API_KEY ||
  "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 800 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      // local in-memory chain used by `hardhat test`
    },
    sepolia: { url: SEPOLIA_RPC_URL, accounts, chainId: 11155111 },
    mainnet: { url: MAINNET_RPC_URL, accounts, chainId: 1 },
    base: { url: BASE_RPC_URL, accounts, chainId: 8453 },
    baseSepolia: { url: BASE_SEPOLIA_RPC_URL, accounts, chainId: 84532 },
    arbitrum: { url: ARBITRUM_RPC_URL, accounts, chainId: 42161 },
    optimism: { url: OPTIMISM_RPC_URL, accounts, chainId: 10 },
    polygon: { url: POLYGON_RPC_URL, accounts, chainId: 137 },
  },
  etherscan: {
    // Single string = Etherscan V2 unified API. Hardhat-verify routes the
    // request to the correct chain based on the network's chainId.
    // Etherscan deprecated the per-chain object form on May 31, 2025.
    apiKey: ETHERSCAN_API_KEY,
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
