/**
 * Creates a fresh deployer wallet and writes it as an encrypted JSON keystore.
 *
 * The plaintext private key never lands on disk — only the scrypt-encrypted
 * keystore JSON does. The password is read from KEYSTORE_PASSWORD in the
 * environment so it's never on the command line / shell history.
 *
 * Don't run this script directly unless you know what you're doing — call
 * `pnpm keystore:new` instead, which wraps this in a bash script that
 * handles the password prompt, validation, and Keychain integration in
 * a way that works regardless of whether your shell is zsh, bash, or fish.
 *
 * Default output: ~/.paytochat/deployer-keystore.json (overridable via
 * KEYSTORE_PATH).
 */

import { Wallet } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

async function main() {
  const password = process.env.KEYSTORE_PASSWORD;
  if (!password) {
    console.error(
      "KEYSTORE_PASSWORD is not set in env.\n" +
        "Run this script via `pnpm keystore:new` instead — that wrapper " +
        "handles the password prompt and Keychain integration for you.",
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Use a password >= 12 characters.");
    process.exit(1);
  }

  const outPath =
    process.env.KEYSTORE_PATH ||
    path.join(os.homedir(), ".paytochat", "deployer-keystore.json");

  if (fs.existsSync(outPath)) {
    console.error(
      `Keystore already exists at ${outPath}. Move it aside first if you want a fresh one.`,
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });

  const wallet = Wallet.createRandom();
  console.log(`generating fresh address: ${wallet.address}`);
  console.log("encrypting with scrypt (this takes a few seconds)...");

  const json = await wallet.encrypt(password);
  // 0o600: owner read/write only.
  fs.writeFileSync(outPath, json, { mode: 0o600 });

  console.log(`\n  keystore: ${outPath}`);
  console.log(`  address:  ${wallet.address}`);
  console.log(`\nNext steps:`);
  console.log(
    `  1. Fund ${wallet.address} with ETH on the chain you'll deploy to.`,
  );
  console.log(
    `  2. (Recommended) Save the password to macOS Keychain so future deploys`,
  );
  console.log(`     don't prompt:`);
  console.log(
    `       security add-generic-password -a "$USER" -s paytochat-deployer -w`,
  );
  console.log(
    `  3. Deploy: pnpm deploy:base   (or :arbitrum, :optimism, :polygon, :mainnet)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
