#!/usr/bin/env bash
# ==============================================================================
# J.A.R.V.I.S. // Native macOS Desktop & Voice Bridge Builder
# Creates "JARVIS Command Center.app" on your MacBook Desktop & Applications
# AND installs a lightweight localhost:7777 -> Windows Hub Voice Bridge so
# macOS Chrome & Safari grant 100% Native Microphone, Wake Word & Clap Access!
# ==============================================================================

set -euo pipefail

HUB_URL="${1:-http://10.0.0.85:7777}"
NODE_ID="${2:-MACBOOK-ALPHA}"
APP_NAME="JARVIS Command Center"
BRIDGE_SCRIPT="$HOME/.jarvis-mac-voice-bridge.py"

cat > "$BRIDGE_SCRIPT" <<'PYEOF'
#!/usr/bin/env python3
"""
J.A.R.V.I.S. macOS Localhost Voice & Sync Bridge
Runs on http://localhost:7777 on your MacBook and transparently bridges to your
Windows Command Hub (e.g. http://10.0.0.85:7777). Because macOS browsers treat
http://localhost:7777 as a 100% Secure Context, Live Microphone, "Hi Jarvis"
Wake Word, Continuous Voice Conversation, and Clap Wake all work natively!
"""
import sys
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

UPSTREAM = (sys.argv[1] if len(sys.argv) > 1 else "http://10.0.0.85:7777").rstrip("/")
LOCAL_PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 7777
UPSTREAM_HOST = UPSTREAM.split("://", 1)[-1]

HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"}

class JarvisBridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _proxy(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length > 0 else None
        target = UPSTREAM + self.path

        req = urllib.request.Request(target, data=body, method=self.command)
        for k, v in self.headers.items():
            kl = k.lower()
            if kl in HOP_HEADERS or kl in ("host", "origin", "referer"):
                continue
            req.add_header(k, v)
        req.add_header("Host", UPSTREAM_HOST)
        if self.headers.get("Origin"):
            req.add_header("Origin", UPSTREAM)

        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = resp.read()
                self.send_response(resp.status)
                for rk, rv in resp.getheaders():
                    if rk.lower() in HOP_HEADERS or rk.lower() == "content-length":
                        continue
                    self.send_header(rk, rv)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if data:
                    self.wfile.write(data)
        except urllib.error.HTTPError as herr:
            data = herr.read() if herr.fp else b""
            self.send_response(herr.code)
            for rk, rv in herr.headers.items():
                if rk.lower() in HOP_HEADERS or rk.lower() == "content-length":
                    continue
                self.send_header(rk, rv)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if data:
                self.wfile.write(data)
        except Exception as ex:
            msg = ("JARVIS Windows Hub (" + UPSTREAM + ") unreachable: " + str(ex)).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def do_GET(self):
        self._proxy()

    def do_POST(self):
        self._proxy()

    def do_HEAD(self):
        self._proxy()

if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", LOCAL_PORT), JarvisBridgeHandler)
    srv.serve_forever()
PYEOF
chmod +x "$BRIDGE_SCRIPT"

create_bundle() {
  local DEST_DIR="$1"
  local APP_BUNDLE="$DEST_DIR/$APP_NAME.app"
  mkdir -p "$APP_BUNDLE/Contents/MacOS"
  mkdir -p "$APP_BUNDLE/Contents/Resources"

  cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>JarvisAppLauncher</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.drjusino.jarvis.commandcenter</string>
  <key>CFBundleName</key>
  <string>JARVIS Command Center</string>
  <key>CFBundleDisplayName</key>
  <string>JARVIS Command Center</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>2.1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

  cat > "$APP_BUNDLE/Contents/MacOS/JarvisAppLauncher" <<LAUNCHER
#!/usr/bin/env bash
WINDOWS_HUB="$HUB_URL"
LOCAL_URL="http://localhost:7777"

# 1. If Windows Hub is reachable on Home Wi-Fi, run the Localhost Voice Bridge on 127.0.0.1:7777
#    so Chrome & Safari treat MacBook Alpha as a 100% Secure Context (full Mic + Wake Word + Clap)!
if curl -fsS --max-time 2 "\$WINDOWS_HUB/api/auth/status" >/dev/null 2>&1; then
  if ! curl -fsS --max-time 1 "\$LOCAL_URL/api/auth/status" >/dev/null 2>&1; then
    if command -v python3 >/dev/null 2>&1; then
      nohup python3 "\$HOME/.jarvis-mac-voice-bridge.py" "\$WINDOWS_HUB" 7777 >/tmp/jarvis-mac-bridge.log 2>&1 &
      sleep 0.8
    fi
  fi
  if curl -fsS --max-time 1 "\$LOCAL_URL/api/auth/status" >/dev/null 2>&1; then
    TARGET_URL="\$LOCAL_URL"
  else
    TARGET_URL="\$WINDOWS_HUB"
  fi
else
  # 2. Offline / Traveling away from Windows Hub: run local Node hub if present, else Cloud HTTPS PWA!
  if [ -f "\$HOME/jarvis-command-center/server.mjs" ] && command -v node >/dev/null 2>&1; then
    if ! curl -fsS --max-time 1 "\$LOCAL_URL/api/auth/status" >/dev/null 2>&1; then
      nohup node "\$HOME/jarvis-command-center/server.mjs" >/tmp/jarvis-mac-hub.log 2>&1 &
      sleep 1.2
    fi
    TARGET_URL="\$LOCAL_URL"
  else
    TARGET_URL="https://drjusinophd-cloud.github.io/personal-jarvis/"
  fi
fi

# Open in a dedicated standalone app window with Secure Origin flag for LAN IP fallback
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="\$TARGET_URL" --unsafely-treat-insecure-origin-as-secure="\$WINDOWS_HUB"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -na "Microsoft Edge" --args --app="\$TARGET_URL" --unsafely-treat-insecure-origin-as-secure="\$WINDOWS_HUB"
elif [ -d "/Applications/Brave Browser.app" ]; then
  open -na "Brave Browser" --args --app="\$TARGET_URL" --unsafely-treat-insecure-origin-as-secure="\$WINDOWS_HUB"
else
  open "\$TARGET_URL"
fi
LAUNCHER

  chmod +x "$APP_BUNDLE/Contents/MacOS/JarvisAppLauncher"

  # Download or copy Arc Reactor PNG and build native macOS .icns icon
  local TMP_PNG="/tmp/jarvis-icon-$$.png"
  local ICONSET="/tmp/AppIcon-$$.iconset"
  if curl -fsSL --max-time 4 "$HUB_URL/jarvis-icon.png" -o "$TMP_PNG" 2>/dev/null || \
     [ -f "$HOME/jarvis-command-center/public/jarvis-icon.png" ]; then
    if [ ! -s "$TMP_PNG" ] && [ -f "$HOME/jarvis-command-center/public/jarvis-icon.png" ]; then
      cp "$HOME/jarvis-command-center/public/jarvis-icon.png" "$TMP_PNG"
    fi
    if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
      mkdir -p "$ICONSET"
      sips -z 16 16     "$TMP_PNG" --out "$ICONSET/icon_16x16.png" >/dev/null 2>&1 || true
      sips -z 32 32     "$TMP_PNG" --out "$ICONSET/icon_16x16@2x.png" >/dev/null 2>&1 || true
      sips -z 32 32     "$TMP_PNG" --out "$ICONSET/icon_32x32.png" >/dev/null 2>&1 || true
      sips -z 64 64     "$TMP_PNG" --out "$ICONSET/icon_32x32@2x.png" >/dev/null 2>&1 || true
      sips -z 128 128   "$TMP_PNG" --out "$ICONSET/icon_128x128.png" >/dev/null 2>&1 || true
      sips -z 256 256   "$TMP_PNG" --out "$ICONSET/icon_128x128@2x.png" >/dev/null 2>&1 || true
      sips -z 256 256   "$TMP_PNG" --out "$ICONSET/icon_256x256.png" >/dev/null 2>&1 || true
      iconutil -c icns "$ICONSET" -o "$APP_BUNDLE/Contents/Resources/AppIcon.icns" >/dev/null 2>&1 || true
      rm -rf "$ICONSET" "$TMP_PNG"
    fi
  fi
  touch "$APP_BUNDLE"
}

mkdir -p "$HOME/Applications"
create_bundle "$HOME/Desktop"
create_bundle "$HOME/Applications"

# Start the localhost:7777 Voice Bridge immediately right now too!
if curl -fsS --max-time 2 "$HUB_URL/api/auth/status" >/dev/null 2>&1; then
  pkill -f ".jarvis-mac-voice-bridge.py" >/dev/null 2>&1 || true
  if command -v python3 >/dev/null 2>&1; then
    nohup python3 "$BRIDGE_SCRIPT" "$HUB_URL" 7777 >/tmp/jarvis-mac-bridge.log 2>&1 &
    sleep 0.8
  fi
fi

echo "=================================================================="
echo "  SUCCESS! Updated '$APP_NAME.app' + macOS Voice Bridge!"
echo "  Open http://localhost:7777 (or double-click '$APP_NAME.app')"
echo "  for 100% Live Microphone, 'Hi Jarvis' Wake Word & Clap Wake!"
echo "=================================================================="
