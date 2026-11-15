#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================================================"
echo "  PERSONAL J.A.R.V.I.S. AI COMMAND CENTER — 1-CLICK MAC INSTALLER"
echo "============================================================================"

xattr -cr . 2>/dev/null || true

RUNNER=""
if command -v node >/dev/null 2>&1; then
  RUNNER="node"
elif command -v bun >/dev/null 2>&1; then
  RUNNER="bun"
fi

if [ -z "$RUNNER" ]; then
  echo ""
  echo "Almost ready! macOS needs the free Node.js runtime (1-minute install):"
  echo "  -> Opening https://nodejs.org — download and run the macOS PKG installer,"
  echo "     then double-click Install-For-Family-Mac.command once more!"
  open "https://nodejs.org"
  read -r -p "Press Enter after installing Node.js to close..."
  exit 0
fi

if ! lsof -iTCP:7777 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup "$RUNNER" "$(pwd)/server.mjs" >/tmp/jarvis-mac-hub.log 2>&1 &
  sleep 1.5
fi

if [ -f "public/install-mac-app.sh" ]; then
  bash "public/install-mac-app.sh" "http://localhost:7777" || true
fi

open "http://localhost:7777"
echo ""
echo "SUCCESS! Your Personal AI Command Center is live at http://localhost:7777"
echo "and installed on your Mac Desktop! Customize your AI name, voice, and"
echo "3D Holographic Person inside 'Security & Settings'."
