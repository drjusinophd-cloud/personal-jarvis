#!/usr/bin/env python3
"""
J.A.R.V.I.S. Hardened Python Fleet Agent (Token-Authenticated, No-Shell Subprocess)
Usage:
  python3 macbook-node.py --hub http://<HUB_IP>:7777 --node MACBOOK-ALPHA --token <AGENT_TOKEN>
"""
import argparse
import json
import os
import platform
import re
import subprocess
import time
import urllib.request

SAFE_TEXT_RE = re.compile(r"[^a-zA-Z0-9 .,!?/:_-]")

def post_json(url, payload, token):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Jarvis-Agent-Token": token
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))

def speak_mac(text):
    clean = SAFE_TEXT_RE.sub("", str(text or ""))[:240]
    if clean and platform.system() == "Darwin":
        subprocess.Popen(["/usr/bin/say", "-v", "Daniel", clean], shell=False)

def open_hub_url(hub, rel_or_hub):
    target = hub if not rel_or_hub else (f"{hub}{rel_or_hub}" if rel_or_hub.startswith("/") else "")
    if target.startswith(hub) and platform.system() == "Darwin":
        subprocess.Popen(["/usr/bin/open", target], shell=False)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hub", required=True)
    parser.add_argument("--node", default="MACBOOK-ALPHA")
    parser.add_argument("--token", required=True)
    args = parser.parse_args()

    hub = args.hub.rstrip("/")
    node_id = args.node.upper()
    token = args.token.strip()

    print(f"[JARVIS] Authenticated link active: {node_id} -> {hub}")
    speak_mac(f"Jarvis secure node {node_id} online.")

    while True:
        try:
            payload = {
                "nodeId": node_id,
                "name": f"{platform.node()} ({node_id})",
                "os": f"{platform.system()} {platform.release()}",
                "arch": platform.machine(),
                "cpuLoad": 14,
                "memUsedPct": 44,
                "batteryPct": 98,
                "role": "Authenticated macOS Agent"
            }
            res = post_json(f"{hub}/api/nodes/heartbeat", payload, token)
            for cmd in res.get("commands", []):
                ctype = cmd.get("commandType", "")
                cpayload = cmd.get("payload", "")
                if ctype == "announce":
                    speak_mac(cpayload)
                elif ctype == "open_hud":
                    open_hub_url(hub, "")
                elif ctype == "open_url":
                    open_hub_url(hub, cpayload)
        except Exception as exc:
            print(f"[AUTH/RETRY] {exc}")
        time.sleep(5)

if __name__ == "__main__":
    main()
