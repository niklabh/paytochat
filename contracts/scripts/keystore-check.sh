#!/usr/bin/env bash
# Sanity-check the deployer keystore.
#
#   - Confirms the keystore file exists at $KEYSTORE_PATH.
#   - Reads the password from KEYSTORE_PASSWORD (or macOS Keychain, or
#     interactively prompts as a last resort).
#   - Decrypts the keystore with that password.
#   - Verifies the decrypted address matches the address written into the
#     keystore JSON (catches corrupted files).
#
# A green "OK" line means the deploy commands will Just Work.
# Always invoked via `pnpm keystore:check` so it runs in bash regardless
# of the user's interactive shell.

set -euo pipefail

KEYSTORE_PATH="${KEYSTORE_PATH:-$HOME/.paytochat/deployer-keystore.json}"

if [ ! -f "$KEYSTORE_PATH" ]; then
  echo "ERROR: no keystore at $KEYSTORE_PATH" >&2
  echo "Generate one with: pnpm keystore:new" >&2
  exit 1
fi

# Pull the address out of the JSON without needing the password.
STORED_ADDR="$(node -e '
  try {
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const a = (j.address || "").replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-fA-F]{40}$/.test(a)) {
      console.error("keystore has no valid address field");
      process.exit(1);
    }
    process.stdout.write("0x" + a);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
' "$KEYSTORE_PATH")"

echo "keystore:        $KEYSTORE_PATH"
echo "stored address:  $STORED_ADDR"

# Resolve the password.
PWD_SOURCE="prompt"
if [ -n "${KEYSTORE_PASSWORD:-}" ]; then
  PWD_SOURCE="env"
elif command -v security >/dev/null 2>&1; then
  if KEYSTORE_PASSWORD="$(security find-generic-password \
      -a "$USER" -s paytochat-deployer -w 2>/dev/null)"; then
    PWD_SOURCE="keychain"
  fi
fi

if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  read -rsp "Keystore password: " KEYSTORE_PASSWORD
  echo
fi

case "$PWD_SOURCE" in
  env)      echo "password source: \$KEYSTORE_PASSWORD env var" ;;
  keychain) echo "password source: macOS Keychain (account=$USER, service=paytochat-deployer)" ;;
  prompt)   echo "password source: interactive prompt" ;;
esac

echo "decrypting (scrypt; ~5s)..."

export KEYSTORE_PATH KEYSTORE_PASSWORD
trap 'unset KEYSTORE_PASSWORD' EXIT

# Decrypt with ethers and emit the recovered address. Any failure (wrong
# password, corrupted JSON, etc.) bubbles up as a non-zero exit code.
if ! DECRYPTED_ADDR="$(node -e '
  const fs = require("fs");
  const { Wallet } = require("ethers");
  try {
    const json = fs.readFileSync(process.env.KEYSTORE_PATH, "utf8");
    const w = Wallet.fromEncryptedJsonSync(json, process.env.KEYSTORE_PASSWORD);
    process.stdout.write(w.address.toLowerCase());
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
')"; then
  echo
  echo "FAILED: the password does not decrypt $KEYSTORE_PATH" >&2
  if [ "$PWD_SOURCE" = "keychain" ]; then
    echo "Hint: the Keychain entry holds the wrong password." >&2
    echo "Re-save with: pnpm keystore:new   (then choose 's' for save)" >&2
  fi
  exit 1
fi

echo "decrypted address: $DECRYPTED_ADDR"

if [ "$DECRYPTED_ADDR" != "$STORED_ADDR" ]; then
  echo
  echo "FAILED: decrypted address doesn't match the address stored in the keystore." >&2
  echo "The file may be corrupted. Restore from backup or regenerate." >&2
  exit 1
fi

echo
echo "OK — keystore is valid, password decrypts it, and addresses match."
echo "     pnpm deploy:* commands will work for $DECRYPTED_ADDR."
