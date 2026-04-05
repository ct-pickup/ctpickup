#!/usr/bin/env bash
# Fetches coach JPEGs from a running Next.js site into public/coaches/.
# Filenames match coachPhotoSrc(slug) -> /coaches/{slug}.jpg
#
# Usage:
#   npm run download-coach-photos
#   BASE_URL=https://your-domain.com npm run download-coach-photos

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/public/coaches"
BASE_URL="${BASE_URL:-http://localhost:3000}"

mkdir -p "${OUT}"

for slug in gabriel-chavez arian-recinos matt-mcleod mason-christiansen leah-delaurentiis patrick-odonohue; do
  url="${BASE_URL%/}/coaches/${slug}.jpg"
  dest="${OUT}/${slug}.jpg"
  echo "Fetching ${url} -> ${dest}"
  curl -fsSL "${url}" -o "${dest}"
done

echo "Done. Files in ${OUT}"
