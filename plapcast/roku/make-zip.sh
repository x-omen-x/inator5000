#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p dist
rm -f dist/PlapCast-Roku.zip
zip -qr dist/PlapCast-Roku.zip manifest source components

echo "Built: $ROOT/dist/PlapCast-Roku.zip"
