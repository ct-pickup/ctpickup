#!/usr/bin/env bash
# Push EXPO_PUBLIC_* entries from mobile/.env to EAS (production, preview, development).
# Prerequisites: npm run eas:login && npm run eas:init (once per machine/project).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! npx eas whoami &>/dev/null; then
  echo "Not logged in to Expo. Run: cd mobile && npm run eas:login"
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Missing $ROOT/.env — copy .env.example and fill values."
  exit 1
fi

# Linked project (eas init creates .eas/project.json)
if [[ ! -f "$ROOT/.eas/project.json" ]]; then
  echo "No .eas/project.json — run: npm run eas:init"
  exit 1
fi

push_var() {
  local name="$1"
  local value="$2"
  local visibility="$3"
  # Prevent EAS CLI from consuming our loop stdin.
  npx eas env:create \
    --name "$name" \
    --value "$value" \
    --environment production \
    --environment preview \
    --environment development \
    --visibility "$visibility" \
    --non-interactive \
    --force </dev/null
}

while IFS= read -r raw || [[ -n "$raw" ]]; do
  line="${raw//$'\r'/}"
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// /}" ]] && continue
  if [[ "$line" =~ ^(EXPO_PUBLIC_[A-Za-z0-9_]+)=(.*)$ ]]; then
    name="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    # Strip optional surrounding quotes
    if [[ "$value" =~ ^\".*\"$ ]]; then value="${value:1:-1}"; fi
    if [[ "$value" =~ ^\'.*\'$ ]]; then value="${value:1:-1}"; fi
    vis="plaintext"
    if [[ "$name" == *"ANON_KEY"* ]] || [[ "$name" == *"SECRET"* ]]; then
      vis="sensitive"
    fi
    echo "Pushing $name ($vis)…"
    push_var "$name" "$value" "$vis"
  fi
done < "$ROOT/.env"

echo "Done. Verify in expo.dev → Project → Environment variables."
