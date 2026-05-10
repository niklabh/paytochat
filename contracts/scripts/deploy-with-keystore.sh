#!/usr/bin/env bash
# Wrapper that loads the deployer key from an encrypted JSON keystore
# instead of from `.env`. The plaintext key never touches disk; the
# password is pulled from the macOS Keychain (or prompted for) and
# decrypted in memory only for the duration of the deploy.
#
# Usage:
#   bash scripts/deploy-with-keystore.sh <network>
#
# Networks: sepolia, baseSepolia, base, arbitrum, optimism, polygon, mainnet
#
# Env (optional):
#   KEYSTORE_PATH       absolute path to the keystore JSON.
#                       Default: $HOME/.paytochat/deployer-keystore.json
#   KEYSTORE_PASSWORD   bypasses the Keychain / prompt step. Useful for CI;
#                       avoid in interactive shells (lands in shell history).

set -euo pipefail

NETWORK="${1:?usage: $0 <network>}"
KEYSTORE_PATH="${KEYSTORE_PATH:-$HOME/.paytochat/deployer-keystore.json}"

if [ ! -f "$KEYSTORE_PATH" ]; then
  cat >&2 <<'EOF'
ERROR: keystore not found at the configured KEYSTORE_PATH.

Generate one with:

  pnpm keystore:new

(That wrapper prompts for a password in a way that works in zsh, bash,
or fish, generates the encrypted keystore at the default path, and
offers to save the password to macOS Keychain.)
EOF
  exit 1
fi

if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  if command -v security >/dev/null 2>&1; then
    # The macOS keychain hit assigns straight into KEYSTORE_PASSWORD on
    # success; on failure the var stays empty and we fall through to the
    # interactive prompt.
    KEYSTORE_PASSWORD="$(security find-generic-password \
        -a "$USER" -s paytochat-deployer -w 2>/dev/null || true)"
  fi
  if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
    read -rsp "Keystore password: " KEYSTORE_PASSWORD
    echo
  fi
fi

if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  echo "ERROR: empty keystore password" >&2
  exit 1
fi

export KEYSTORE_PATH KEYSTORE_PASSWORD
trap 'unset KEYSTORE_PATH KEYSTORE_PASSWORD' EXIT

echo "deploying via keystore: $KEYSTORE_PATH"
exec npx hardhat run scripts/deploy.ts --network "$NETWORK"
