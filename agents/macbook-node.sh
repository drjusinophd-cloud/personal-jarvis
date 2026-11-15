#!/usr/bin/env bash
# ==============================================================================
# J.A.R.V.I.S. Hardened macOS Fleet Agent (Authenticated + Shell-Free NSTask)
# Copy your authenticated 1-line launch command directly from the Fleet Matrix tab
# in your unlocked JARVIS HUD!
# ==============================================================================

set -u

HUB_URL="${1:-http://localhost:7777}"
NODE_ID="${2:-MACBOOK-ALPHA}"
AGENT_TOKEN="${3:-}"

if [ -z "$AGENT_TOKEN" ]; then
  echo "[ERROR] Missing AGENT_TOKEN. Copy the authenticated command from your JARVIS Fleet Matrix tab."
  exit 1
fi

HOST_LABEL="$(scutil --get ComputerName 2>/dev/null || hostname)"
OS_VER="macOS $(sw_vers -productVersion 2>/dev/null || uname -r)"
ARCH="$(uname -m)"
SYNC_DIR="$HOME/JarvisWorkspace"
mkdir -p "$SYNC_DIR"
chmod 700 "$SYNC_DIR"

echo "============================================================"
echo "  J.A.R.V.I.S. HARDENED MACBOOK AGENT // $NODE_ID"
echo "  Machine : $HOST_LABEL ($OS_VER / $ARCH)"
echo "  Hub URL : $HUB_URL (Token-Authenticated)"
echo "============================================================"

if [ -x /usr/bin/say ]; then
  /usr/bin/say -v Daniel "Jarvis secure link established for $NODE_ID." 2>/dev/null &
fi

while true; do
  BATT="$(pmset -g batt 2>/dev/null | grep -Eo '[0-9]+%' | head -n1 | tr -d '%')"
  BATT="${BATT:-100}"

  LOAD_RAW="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')"
  CPU_PCT="$(awk -v l="${LOAD_RAW:-0.4}" 'BEGIN { v = int(l * 18); if (v < 4) v = 4; if (v > 98) v = 98; print v }')"

  MEM_PCT=42
  if command -v memory_pressure >/dev/null 2>&1; then
    FREE_PCT="$(memory_pressure 2>/dev/null | grep 'System-wide memory free percentage' | grep -Eo '[0-9]+' | head -n1)"
    if [ -n "${FREE_PCT:-}" ]; then
      MEM_PCT=$((100 - FREE_PCT))
    fi
  fi

  PAYLOAD=$(printf '{"nodeId":"%s","name":"%s","os":"%s","arch":"%s","cpuLoad":%d,"memUsedPct":%d,"batteryPct":%d,"role":"Authenticated macOS Node"}' \
    "$NODE_ID" "$HOST_LABEL ($NODE_ID)" "$OS_VER" "$ARCH" "$CPU_PCT" "$MEM_PCT" "$BATT")

  RESP="$(curl -fsS -X POST "$HUB_URL/api/nodes/heartbeat" \
    -H "Content-Type: application/json" \
    -H "X-Jarvis-Agent-Token: $AGENT_TOKEN" \
    -d "$PAYLOAD" 2>/dev/null || true)"

  if [ -n "$RESP" ] && echo "$RESP" | grep -q '"commandType"'; then
    osascript -l JavaScript - "$RESP" "$HUB_URL" <<'JXA' 2>/dev/null || true
ObjC.import('Foundation');

function execDirect(binPath, args) {
  var task = $.NSTask.alloc.init;
  task.launchPath = binPath;
  task.arguments = args;
  task.launch;
}

function run(argv) {
  var data = JSON.parse(argv[0]);
  var hubUrl = argv[1];
  var cmds = data.commands || [];
  for (var i = 0; i < cmds.length; i++) {
    var c = cmds[i];
    var t = c.commandType || '';
    var p = String(c.payload || '').replace(/[^a-zA-Z0-9 .,!?/:_-]/g, '').slice(0, 240);

    if (t === 'announce' && p) {
      execDirect('/usr/bin/say', ['-v', 'Daniel', p]);
    } else if (t === 'open_hud') {
      execDirect('/usr/bin/open', [hubUrl]);
    } else if (t === 'sync_workspace') {
      var homeDir = $.NSHomeDirectory().js;
      var repoDir = homeDir + '/jarvis-command-center';
      var fm = $.NSFileManager.defaultManager;
      if (fm.fileExistsAtPath(repoDir + '/.git')) {
        execDirect('/usr/bin/git', ['-C', repoDir, 'pull', '--ff-only']);
      } else {
        execDirect('/usr/bin/git', ['clone', 'https://github.com/drjusinophd-cloud/jarvis-command-center.git', repoDir]);
      }
      execDirect('/usr/bin/say', ['-v', 'Daniel', 'Workspace synchronized from GitHub.']);
    } else if (t === 'open_url' && p) {
      var targetUrl = p.indexOf('/') === 0 ? (hubUrl + p) : '';
      if (targetUrl.indexOf(hubUrl) === 0) {
        execDirect('/usr/bin/open', [targetUrl]);
      }
    }
  }
}
JXA
    echo "[$(date +%H:%M:%S)] Executed verified Hub command."
  fi

  sleep 5
done
