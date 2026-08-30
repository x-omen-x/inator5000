#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run Omen's Plapinator Private LAN host."
  echo "Install Node.js, then run this file again."
  read -r -p "Press return to close..."
  exit 1
fi
exec node tools/plap-lan-host.mjs
