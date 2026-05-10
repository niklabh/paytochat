/**
 * Deploys PayToChatEscrow.
 *
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *   npx hardhat run scripts/deploy.ts --network mainnet
 *
 * Reads from process.env (see .env.example):
 *   INITIAL_OWNER     - address that owns the contract after deployment.
 *                       Defaults to the deployer EOA.
 *   INITIAL_FEE_BPS   - claim fee in basis points (default 250 = 2.5%).
 *                       Capped at 1000 (10%) by the contract.
 *   USDC_ADDRESS      - if set, allowlists this token.
 *   USDT_ADDRESS      - if set, allowlists this token.
 *   RESUME_TX_HASH    - if set, SKIP broadcasting a new deployment and
 *                       just resolve the contract address from this
 *                       previously-broadcast tx hash, then continue with
 *                       allowlist / verify steps. Use this to recover
 *                       from a deploy that failed AFTER the tx was sent
 *                       (e.g. the ethers v6 `to: ""` BAD_DATA bug).
 *
 * After deployment the script prints a one-liner you can paste into
 * `npx hardhat verify` for Etherscan verification.
 */

import { ethers, network, run } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Poll `eth_getTransactionReceipt` for up to ~5 minutes and return the
 * `contractAddress` field once the tx is mined. Returns undefined if the
 * tx never lands. Used both as a fallback inside `waitForDeployment`
 * recovery and as the primary path when resuming via RESUME_TX_HASH.
 */
async function pollContractAddress(
  hash: string,
): Promise<string | undefined> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await ethers.provider.send("eth_getTransactionReceipt", [hash]);
      if (r && r.contractAddress) {
        return ethers.getAddress(r.contractAddress);
      }
    } catch {
      // ignore transient RPC errors
    }
    await new Promise((res) => setTimeout(res, 5_000));
  }
  return undefined;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();

  const initialOwner = process.env.INITIAL_OWNER?.trim() || deployerAddr;
  const feeBps = Number.parseInt(process.env.INITIAL_FEE_BPS || "250", 10);
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1000) {
    throw new Error(
      `INITIAL_FEE_BPS must be an integer in [0, 1000]; got ${process.env.INITIAL_FEE_BPS}`,
    );
  }

  console.log(`network         : ${network.name}`);
  console.log(`deployer        : ${deployerAddr}`);
  console.log(`initial owner   : ${initialOwner}`);
  console.log(`initial fee bps : ${feeBps} (${feeBps / 100}%)`);

  const resumeHash = process.env.RESUME_TX_HASH?.trim();
  let addr: string | undefined;

  if (resumeHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(resumeHash)) {
      throw new Error(`RESUME_TX_HASH is not a 32-byte hex hash: ${resumeHash}`);
    }
    console.log(`resuming from   : ${resumeHash}`);
    addr = await pollContractAddress(resumeHash);
    if (!addr) {
      throw new Error(
        `Could not resolve a contract address from RESUME_TX_HASH ${resumeHash}. ` +
          `Check on a block explorer that this hash is a successful contract-creation tx.`,
      );
    }
  } else {
    const Escrow = await ethers.getContractFactory("PayToChatEscrow");
    let escrow;
    try {
      escrow = await Escrow.deploy(initialOwner, feeBps);
    } catch (err) {
      // ethers v6 + some RPCs throw BAD_DATA on `to: ""` for the pending
      // contract-creation tx, AFTER the tx has already been broadcast.
      // The hardhat.config.ts provider patch normally prevents this, but
      // keep a belt-and-braces handler here too: surface the deployer
      // nonce so the user can derive the deterministic address and re-run
      // with RESUME_TX_HASH=0x... once they find the hash on a block
      // explorer.
      const nonce = await ethers.provider.getTransactionCount(
        deployerAddr,
        "latest",
      );
      const pending = await ethers.provider.getTransactionCount(
        deployerAddr,
        "pending",
      );
      console.error(
        `\nEscrow.deploy() threw before returning a contract handle.\n` +
          `Latest nonce  : ${nonce}\n` +
          `Pending nonce : ${pending}\n` +
          `If pending > latest, your deploy tx IS in the mempool. Find it on\n` +
          `a block explorer (filter by from=${deployerAddr}) and re-run with:\n` +
          `\n  RESUME_TX_HASH=0x... pnpm deploy:${network.name}\n`,
      );
      throw err;
    }
    const tx = escrow.deploymentTransaction();
    if (!tx) throw new Error("no deployment transaction returned");
    console.log(`deploy tx hash  : ${tx.hash}`);

    // Robust confirmation: ethers v6.16 + some RPCs (notably any that return
    // `to: ""` on contract-creation receipts instead of `to: null`) make
    // `escrow.waitForDeployment()` throw a BAD_DATA error AFTER the tx is
    // already mined. Catch that, fall back to raw `eth_getTransactionReceipt`
    // polling, and recover the deployed address from the receipt itself.
    try {
      await escrow.waitForDeployment();
      addr = await escrow.getAddress();
    } catch (err) {
      console.warn(
        `waitForDeployment threw (${(err as Error).message.split("\n")[0]}). ` +
          "Falling back to raw receipt poll...",
      );
      addr = await pollContractAddress(tx.hash);
      if (!addr) {
        throw new Error(
          `Could not resolve contract address from tx ${tx.hash} after 5 minutes. ` +
            `Check the tx on a block explorer; the deploy may already have succeeded.`,
        );
      }
    }
  }
  console.log(`PayToChatEscrow : ${addr}`);

  // Re-attach the typed contract to the resolved address. After a fallback
  // recovery the original `escrow` reference may be in an unusable state.
  const deployed = await ethers.getContractAt("PayToChatEscrow", addr);

  // Allowlist whatever stablecoins were configured. We can do this only
  // while the deployer is still the owner — i.e. only when INITIAL_OWNER
  // is unset/equal to the deployer. Otherwise we just print instructions.
  const usdc = process.env.USDC_ADDRESS?.trim();
  const usdt = process.env.USDT_ADDRESS?.trim();
  const tokens = [usdc, usdt].filter((x): x is string => !!x);

  if (tokens.length === 0) {
    console.log("\nNo USDC_ADDRESS / USDT_ADDRESS provided — skipping allowlist.");
  } else if (initialOwner.toLowerCase() === deployerAddr.toLowerCase()) {
    for (const t of tokens) {
      console.log(`allowlisting    : ${t}`);
      try {
        const allowTx = await deployed.setTokenAllowed(t, true);
        const receipt = await allowTx.wait();
        if (!receipt) {
          console.warn(`  no receipt yet — tx ${allowTx.hash}; continuing.`);
        }
      } catch (err) {
        console.warn(
          `  setTokenAllowed(${t}) failed: ${(err as Error).message.split("\n")[0]}`,
        );
        console.warn(
          `  Re-run from a console: deployed.setTokenAllowed("${t}", true)`,
        );
      }
    }
  } else {
    console.log(
      `\nDeployer is not the owner; skipping setTokenAllowed.\n` +
        `After accepting ownership, ${initialOwner} should call:\n` +
        tokens.map((t) => `  setTokenAllowed("${t}", true)`).join("\n"),
    );
  }

  console.log("\n--- verification ---");
  console.log(
    `npx hardhat verify --network ${network.name} ${addr} ${initialOwner} ${feeBps}`,
  );

  // Optional: auto-verify when ETHERSCAN_API_KEY is set and we're on a real
  // network. We swallow errors so a verify failure doesn't fail the deploy.
  if (
    process.env.ETHERSCAN_API_KEY &&
    network.name !== "hardhat" &&
    network.name !== "localhost"
  ) {
    try {
      console.log("\nWaiting 30s before verifying so Etherscan indexes the contract...");
      await new Promise((r) => setTimeout(r, 30_000));
      await run("verify:verify", {
        address: addr,
        constructorArguments: [initialOwner, feeBps],
      });
    } catch (err) {
      console.warn(`verify failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
