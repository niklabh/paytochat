#!/usr/bin/env bash
# Interactive helper for the deployer keystore.
#
#   - If no keystore exists at $KEYSTORE_PATH, creates one (encrypted JSON,
#     scrypt-protected, plaintext private key never written to disk).
#   - If one already exists, shows its address and offers four actions:
#       k - keep it as-is
#       s - keep it but (re)save the password to macOS Keychain
#       r - back up the old one and create a fresh keystore
#       c - cancel
#
# Always invoked via `pnpm keystore:new` so it runs in bash regardless of
# the user's interactive shell (zsh / fish / etc.).

set -euo pipefail

KEYSTORE_PATH="${KEYSTORE_PATH:-$HOME/.paytochat/deployer-keystore.json}"

# Print the address recorded inside an Ethereum keystore JSON file. Pure
# JSON parse — does NOT require the password.
keystore_address() {
  local file="$1"
  node -e '
    try {
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const a = (j.address || "").replace(/^0x/i, "");
      if (!/^[0-9a-fA-F]{40}$/.test(a)) {
        console.error("keystore has no valid address field");
        process.exit(1);
      }
      console.log("0x" + a);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  ' "$file"
}

# Prompt-and-save the keystore password into the macOS Keychain. Validates
# it actually decrypts the keystore first, so we don't silently store a
# typo'd password.
save_password_to_keychain() {
  local password="$1"
  if ! command -v security >/dev/null 2>&1; then
    echo "Skipping Keychain save — \`security\` not available on this OS."
    return
  fi
  read -rp "Save password to macOS Keychain so future deploys don't prompt? [Y/n] " ANSWER
  case "${ANSWER:-Y}" in
    [Yy]*|"")
      security add-generic-password -U \
        -a "$USER" -s paytochat-deployer \
        -w "$password"
      echo "  saved (account=$USER, service=paytochat-deployer)"
      ;;
    *)
      echo "  skipped — you'll be prompted on each deploy."
      ;;
  esac
}

# Validate that a password decrypts a given keystore. scrypt makes this
# slow (~5s by design); that's the cost.
validate_password() {
  local file="$1"
  local password="$2"
  KEYSTORE_FILE="$file" KEYSTORE_PASSWORD="$password" node -e '
    const fs = require("fs");
    const { Wallet } = require("ethers");
    try {
      const json = fs.readFileSync(process.env.KEYSTORE_FILE, "utf8");
      Wallet.fromEncryptedJsonSync(json, process.env.KEYSTORE_PASSWORD);
    } catch (e) {
      process.exit(1);
    }
  ' >/dev/null 2>&1
}

# ---- existing-keystore branch -------------------------------------------

if [ -f "$KEYSTORE_PATH" ]; then
  EXISTING_ADDR="$(keystore_address "$KEYSTORE_PATH")"
  echo "An existing keystore was found:"
  echo "  path:    $KEYSTORE_PATH"
  echo "  address: $EXISTING_ADDR"
  echo
  echo "What would you like to do?"
  echo "  [k] keep      — fund $EXISTING_ADDR and run pnpm deploy:* (default)"
  echo "  [s] save      — keep it, prompt for the password, save it to macOS Keychain"
  echo "  [r] replace   — back up the old keystore and create a fresh one"
  echo "  [c] cancel"
  read -rp "Action [k/s/r/c]: " ACTION
  case "${ACTION:-k}" in
    [Kk]*|"")
      echo "Keeping existing keystore. Fund $EXISTING_ADDR, then run pnpm deploy:*."
      exit 0
      ;;
    [Ss]*)
      read -rsp "Existing keystore password: " KEYSTORE_PASSWORD
      echo
      if ! validate_password "$KEYSTORE_PATH" "$KEYSTORE_PASSWORD"; then
        echo "ERROR: that password does not decrypt $KEYSTORE_PATH" >&2
        unset KEYSTORE_PASSWORD
        exit 1
      fi
      save_password_to_keychain "$KEYSTORE_PASSWORD"
      unset KEYSTORE_PASSWORD
      exit 0
      ;;
    [Rr]*)
      BACKUP="${KEYSTORE_PATH%.json}.$(date +%Y%m%d-%H%M%S).json"
      mv "$KEYSTORE_PATH" "$BACKUP"
      echo "Old keystore backed up to: $BACKUP"
      # Fall through to generation.
      ;;
    *)
      echo "Cancelled."
      exit 1
      ;;
  esac
fi

# ---- generation branch --------------------------------------------------

read -rsp "New keystore password (12+ chars): " KEYSTORE_PASSWORD
echo
read -rsp "Confirm:                            " KEYSTORE_PASSWORD_CONFIRM
echo

if [ "$KEYSTORE_PASSWORD" != "$KEYSTORE_PASSWORD_CONFIRM" ]; then
  echo "ERROR: passwords don't match" >&2
  unset KEYSTORE_PASSWORD KEYSTORE_PASSWORD_CONFIRM
  exit 1
fi
if [ "${#KEYSTORE_PASSWORD}" -lt 12 ]; then
  echo "ERROR: password must be at least 12 characters" >&2
  unset KEYSTORE_PASSWORD KEYSTORE_PASSWORD_CONFIRM
  exit 1
fi
unset KEYSTORE_PASSWORD_CONFIRM

export KEYSTORE_PASSWORD
trap 'unset KEYSTORE_PASSWORD' EXIT

npx hardhat run scripts/generate-keystore.ts

echo
save_password_to_keychain "$KEYSTORE_PASSWORD"
