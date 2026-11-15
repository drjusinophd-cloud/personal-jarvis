# J.A.R.V.I.S. Multi-Laptop Executive Command Center

> **1-Click MacBook Setup (Terminal or Antigravity on macOS):**
> ```bash
> git clone https://github.com/drjusinophd-cloud/jarvis-command-center.git ~/jarvis-command-center
> ```
> *(Or paste into your MacBook Antigravity chat: `Clone https://github.com/drjusinophd-cloud/jarvis-command-center.git into ~/jarvis-command-center`)*

A voice-interactive holographic command center designed to operate across **4 laptops** (**1 Windows Primary Hub + 3 MacBooks**) with real-time workspace synchronization, spoken voice feedback, **Google Gemini / Gemini Live Audio**, and four built-in venture studios:

1. **App Forge (`Apps`)**: Build, preview, edit, and run interactive web applications by voice or prompt.
2. **Empire Builder (`Business`)**: Unite your apps, leadership books, and courses into a high-converting landing page, 3-tier value ladder, revenue simulator, and 5-day email launch funnel.
3. **Leadership Studio (`Books & Courses`)**:
   - **Book Architect**: Generate leadership book outlines, chapter manuscripts, print/PDF digital readers, and Scrivener/Kindle-ready `.md` exports.
   - **Course Architect**: Build 6-module leadership courses with video teleprompter scripts, leadership action labs, and an interactive student portal.
4. **Multi-Laptop & iOS Fleet Matrix (`Fleet`)**: Monitor and dispatch actions across `WINDOWS-PRIME`, `MACBOOK-ALPHA`, `MACBOOK-BETA`, `MACBOOK-GAMMA`, and `IOS-PRIME` (iPhone/iPad Home Screen PWA).
5. **Scheduled Automations (`⚙ Automations`)**: Run daily or recurring executive voice briefings, 3-MacBook workspace syncs, ClickUp sprints, Notion status digests, and outbound webhooks.
6. **Encrypted Connectors & Sources (`🔌 Connectors`)**: Connect Viktor AI, ClickUp, AIWriteBook, Sudowrite, KDP, Notion, Cursor IDE, Gemini, Claude, OpenAI, OpenRouter, Hermes, OpenClaw, and Ollama.

---

## 1. Quick Start on This Windows Laptop

Double-click [`Start-Jarvis.bat`](./Start-Jarvis.bat) or run in PowerShell:

```powershell
.\Start-Jarvis.ps1
```

- Automatically runs the native compiled Windows hub (`bin\JarvisHub.exe` — zero external runtime installs required) on port `7777` and opens `http://localhost:7777`.
- *(Optional)* If hosting the hub on a MacBook with Node.js or Bun installed, run `node server.mjs` or `bun server.mjs`.

---

## 2. Connecting Your 3 MacBooks

### Option A: Zero-Install Browser HUD (Wi-Fi or Tailscale)
1. Look at the **MacBook Link URL** shown in the bottom-left sidebar of your Windows JARVIS HUD (e.g., `http://192.168.1.x:7777` on local Wi-Fi, or `http://100.x.y.z:7777` over [Tailscale](https://tailscale.com) from anywhere in the world).
2. *(First time on Windows Wi-Fi)* If Windows Firewall prompts you, allow `JarvisHub.exe` on Private Networks (or run once in Admin PowerShell: `New-NetFirewallRule -DisplayName "Jarvis Hub 7777" -Direction Inbound -LocalPort 7777 -Protocol TCP -Action Allow`).
3. Open that URL in **Chrome** or **Safari** on each of your 3 MacBooks and select its identity in the top-right dropdown (`MacBook #1 Alpha`, `MacBook #2 Beta`, `MacBook #3 Gamma`).
   - On macOS, JARVIS automatically selects macOS's British **`Daniel`** voice for authentic spoken replies!

### Option B: Background macOS Fleet Agent (Remote Voice Alerts + File Sync)
To let JARVIS speak alerts remotely on your MacBooks (`say -v Daniel`), open project previews remotely, and sync generated apps/books/courses into `~/JarvisWorkspace`, run in Terminal on each MacBook:

```bash
# MacBook #1
curl -fsSL http://<WINDOWS_HUB_IP>:7777/agents/macbook-node.sh | bash -s -- http://<WINDOWS_HUB_IP>:7777 MACBOOK-ALPHA

# MacBook #2
curl -fsSL http://<WINDOWS_HUB_IP>:7777/agents/macbook-node.sh | bash -s -- http://<WINDOWS_HUB_IP>:7777 MACBOOK-BETA

# MacBook #3
curl -fsSL http://<WINDOWS_HUB_IP>:7777/agents/macbook-node.sh | bash -s -- http://<WINDOWS_HUB_IP>:7777 MACBOOK-GAMMA
```

*(For full local folder file download sync of all HTML/Markdown assets, use `python3 agents/macbook-node.py --hub http://<WINDOWS_HUB_IP>:7777 --node MACBOOK-ALPHA`.)*

---

## 3. Enabling Google Gemini & Gemini Live Voice

1. Click **⚙ Settings & API Key** in the top-right corner of the HUD.
2. Paste your **Google Gemini API Key** (`gemini-3.8-flash`, `gemini-4-argon`, or `gemini-4-carbon` via the Gemini Interactions API).
3. You can now use:
   - **Click Orb / Spacebar Push-to-Talk** or **🎧 Wake Word ("Hey Jarvis")** for hands-free voice commands that trigger full custom app code, book prose, and course generation with stateful multi-turn memory.
   - **⚡ Gemini Live Audio** (`gemini-3.8-live`) for real-time low-latency WebSocket voice streaming with live input/output transcriptions and barge-in interruption handling.

---

## 4. Encrypted Connectors Ecosystem (`🔌 Connectors Hub`)

Open **🔌 Connectors Hub** in the left sidebar to configure and test integrations encrypted with **Windows DPAPI** (`workspace\connectors-vault.dpapi`):
- **AI Brains**: Google Gemini, Anthropic Claude, OpenAI, OpenRouter (300+ models), Nous Hermes, OpenClaw Gateway, Local Ollama, plus custom OpenAI-compatible APIs (DeepSeek, xAI Grok, Perplexity, Groq, Mistral).
- **Creation & Project Bridges**:
  - **Cursor AI IDE**: 1-click `↗ Cursor` button in App Forge, Business Empire, and Leadership Studio opens the project folder directly inside Cursor IDE.
  - **Notion**: 1-click `📝 Notion` button exports Book Manuscripts, Course Curriculums, App Specs, and Funnel Playbooks into Notion pages.
  - **ClickUp**: 1-click `✅ ClickUp` button (or voice command `"Add a ClickUp task to..."`) creates tasks in your ClickUp list.
  - **Universal Webhooks**: Push assets to n8n, Make.com, Zapier, Slack, Discord, or GoHighLevel.
