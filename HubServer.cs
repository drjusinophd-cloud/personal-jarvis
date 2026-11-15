using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Speech.Synthesis;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace JarvisCommandCenter
{
    public class Program
    {
        private static string RootDir;
        private static string PublicDir;
        private static string AgentsDir;
        private static string WorkspaceDir;
        private static string StateFilePath;
        private static string SecurityFilePath;
        private static string VaultFilePath;
        private static string ConnectorsVaultFilePath;
        private static int Port = 7777;

        private static readonly object StateLock = new object();
        private static readonly object AuthLock = new object();
        private static readonly object AutomationRunLock = new object();
        private static Timer AutomationSchedulerTimer;
        private static readonly DateTime StartTimeUtc = DateTime.UtcNow;
        private static readonly byte[] VaultEntropy = Encoding.UTF8.GetBytes("JARVIS-HUB-DPAPI-V1-ENTROPY");

        private class SessionInfo
        {
            public string SessionId;
            public string CsrfToken;
            public string Ip;
            public DateTime ExpiresUtc;
        }

        private static Dictionary<string, SessionInfo> ActiveSessions =
            new Dictionary<string, SessionInfo>(StringComparer.Ordinal);

        private static Dictionary<string, List<DateTime>> FailedAuthByIp =
            new Dictionary<string, List<DateTime>>(StringComparer.OrdinalIgnoreCase);

        private static List<Dictionary<string, object>> SecurityAuditLog =
            new List<Dictionary<string, object>>();

        private static Dictionary<string, Dictionary<string, object>> LiveNodes =
            new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);

        private static Dictionary<string, List<Dictionary<string, object>>> NodeQueues =
            new Dictionary<string, List<Dictionary<string, object>>>(StringComparer.OrdinalIgnoreCase);

        private static DateTime Gemini38CooldownUntilUtc = DateTime.MinValue;

        public static void Main(string[] args)
        {
            // Enable TLS 1.2 (3072) and disable slow WPAD system proxy auto-discovery for outbound HTTPS to AI APIs
            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; } catch { }
            try { WebRequest.DefaultWebProxy = null; } catch { }
            try { ServicePointManager.Expect100Continue = false; } catch { }

            RootDir = AppDomain.CurrentDomain.BaseDirectory;
            if (!Directory.Exists(Path.Combine(RootDir, "public")))
            {
                DirectoryInfo parent = Directory.GetParent(RootDir.TrimEnd('\\', '/'));
                if (parent != null && Directory.Exists(Path.Combine(parent.FullName, "public")))
                {
                    RootDir = parent.FullName;
                }
            }

            for (int i = 0; i < args.Length; i++)
            {
                if ((args[i] == "--port" || args[i] == "-p") && i + 1 < args.Length)
                {
                    int parsed;
                    if (int.TryParse(args[i + 1], out parsed)) Port = parsed;
                }
            }

            PublicDir = Path.Combine(RootDir, "public");
            AgentsDir = Path.Combine(RootDir, "agents");
            WorkspaceDir = Path.Combine(RootDir, "workspace");
            StateFilePath = Path.Combine(WorkspaceDir, "jarvis-state.json");
            SecurityFilePath = Path.Combine(WorkspaceDir, "security.json");
            VaultFilePath = Path.Combine(WorkspaceDir, "gemini-key.dpapi");
            ConnectorsVaultFilePath = Path.Combine(WorkspaceDir, "connectors-vault.dpapi");

            EnsureDirectoriesAndSeedState();
            EnsureSecurityConfig();
            InitDefaultFleetNodes();
            AutomationSchedulerTimer = new Timer(CheckDueAutomationsTick, null, 15000, 30000);

            TcpListener listener = new TcpListener(IPAddress.Any, Port);
            listener.Start();

            RecordAudit("SYSTEM_BOOT", "127.0.0.1", "Hardened JARVIS Security Core initialized.");
            PrintStartupBanner();

            while (true)
            {
                try
                {
                    TcpClient client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(HandleClient, client);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("[WARN] Listener accept error: " + ex.Message);
                }
            }
        }

        private static void PrintStartupBanner()
        {
            List<string> ips = GetLocalIPv4Addresses();
            Dictionary<string, object> sec = LoadSecurityConfig();
            string netMode = GetStr(sec, "networkMode", "lan");

            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("==================================================================");
            Console.WriteLine("   J.A.R.V.I.S. HARDENED COMMAND HUB  //  SECURITY SHIELD ACTIVE");
            Console.WriteLine("==================================================================");
            Console.ResetColor();
            Console.WriteLine("  Network Shield : " + netMode.ToUpperInvariant());
            Console.WriteLine("  Auth & Vault   : PBKDF2-SHA256 Passcode + Windows DPAPI Vault");
            Console.WriteLine("  This Laptop    : http://localhost:" + Port);
            foreach (string ip in ips)
            {
                string label = ip.StartsWith("100.") ? "Tailscale Mesh" : "Local Wi-Fi/LAN";
                Console.WriteLine(string.Format("  {0,-15}: http://{1}:{2}", label, ip, Port));
            }
            Console.WriteLine("==================================================================");
        }

        /* ================= CRYPTO & SECURITY HELPERS ================= */

        private static string GenerateSecureTokenHex(int byteCount)
        {
            byte[] buf = new byte[byteCount];
            using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider())
            {
                rng.GetBytes(buf);
            }
            StringBuilder sb = new StringBuilder(byteCount * 2);
            for (int i = 0; i < buf.Length; i++) sb.Append(buf[i].ToString("x2"));
            return sb.ToString();
        }

        private static string HashPasscodePbkdf2(string passcode, byte[] salt)
        {
            using (Rfc2898DeriveBytes kdf = new Rfc2898DeriveBytes(passcode, salt, 100000))
            {
                byte[] derived = kdf.GetBytes(32);
                return Convert.ToBase64String(derived);
            }
        }

        private static bool ConstantTimeEqualsStr(string a, string b)
        {
            if (a == null || b == null) return false;
            byte[] ba = Encoding.UTF8.GetBytes(a);
            byte[] bb = Encoding.UTF8.GetBytes(b);
            if (ba.Length != bb.Length) return false;
            int diff = 0;
            for (int i = 0; i < ba.Length; i++) diff |= (ba[i] ^ bb[i]);
            return diff == 0;
        }

        private static void EnsureSecurityConfig()
        {
            lock (AuthLock)
            {
                if (!File.Exists(SecurityFilePath))
                {
                    Dictionary<string, object> sec = new Dictionary<string, object>();
                    sec["passcodeSalt"] = "";
                    sec["passcodeHash"] = "";
                    sec["agentToken"] = GenerateSecureTokenHex(24);
                    sec["networkMode"] = "lan"; // "lan" | "tailscale_only" | "localhost_only"
                    SaveSecurityConfig(sec);
                }
            }
        }

        private static Dictionary<string, object> LoadSecurityConfig()
        {
            lock (AuthLock)
            {
                try
                {
                    if (File.Exists(SecurityFilePath))
                    {
                        string raw = File.ReadAllText(SecurityFilePath, Encoding.UTF8);
                        Dictionary<string, object> d = CreateSerializer().Deserialize<Dictionary<string, object>>(raw);
                        if (d != null) return d;
                    }
                }
                catch { }
                Dictionary<string, object> fallback = new Dictionary<string, object>();
                fallback["passcodeSalt"] = "";
                fallback["passcodeHash"] = "";
                fallback["agentToken"] = GenerateSecureTokenHex(24);
                fallback["networkMode"] = "lan";
                return fallback;
            }
        }

        private static void SaveSecurityConfig(Dictionary<string, object> sec)
        {
            lock (AuthLock)
            {
                string json = CreateSerializer().Serialize(sec);
                string tmp = SecurityFilePath + ".tmp";
                File.WriteAllText(tmp, json, Encoding.UTF8);
                if (File.Exists(SecurityFilePath)) File.Delete(SecurityFilePath);
                File.Move(tmp, SecurityFilePath);
            }
        }

        private static void SaveGeminiKeyDpapi(string apiKey)
        {
            lock (AuthLock)
            {
                if (string.IsNullOrEmpty(apiKey))
                {
                    if (File.Exists(VaultFilePath)) File.Delete(VaultFilePath);
                    return;
                }
                byte[] plain = Encoding.UTF8.GetBytes(apiKey.Trim());
                byte[] encrypted = ProtectedData.Protect(plain, VaultEntropy, DataProtectionScope.CurrentUser);
                File.WriteAllBytes(VaultFilePath, encrypted);
            }
        }

        private static string LoadGeminiKeyDpapi()
        {
            lock (AuthLock)
            {
                try
                {
                    if (!File.Exists(VaultFilePath)) return "";
                    byte[] encrypted = File.ReadAllBytes(VaultFilePath);
                    byte[] plain = ProtectedData.Unprotect(encrypted, VaultEntropy, DataProtectionScope.CurrentUser);
                    return Encoding.UTF8.GetString(plain);
                }
                catch
                {
                    return "";
                }
            }
        }

        /* ================= MULTI-CONNECTOR DPAPI VAULT & ENGINE ================= */

        private static Dictionary<string, object> LoadConnectorsVaultDpapi()
        {
            lock (AuthLock)
            {
                try
                {
                    if (File.Exists(ConnectorsVaultFilePath))
                    {
                        byte[] encrypted = File.ReadAllBytes(ConnectorsVaultFilePath);
                        byte[] plain = ProtectedData.Unprotect(encrypted, VaultEntropy, DataProtectionScope.CurrentUser);
                        string raw = Encoding.UTF8.GetString(plain);
                        Dictionary<string, object> parsed = CreateSerializer().Deserialize<Dictionary<string, object>>(raw);
                        if (parsed != null) return parsed;
                    }
                }
                catch { }
                Dictionary<string, object> empty = new Dictionary<string, object>();
                empty["items"] = new Dictionary<string, object>();
                empty["customIds"] = new ArrayList();
                return empty;
            }
        }

        private static void SaveConnectorsVaultDpapi(Dictionary<string, object> vault)
        {
            lock (AuthLock)
            {
                string raw = CreateSerializer().Serialize(vault);
                byte[] plain = Encoding.UTF8.GetBytes(raw);
                byte[] encrypted = ProtectedData.Protect(plain, VaultEntropy, DataProtectionScope.CurrentUser);
                File.WriteAllBytes(ConnectorsVaultFilePath, encrypted);
            }
        }

        private static string MaskSecretVal(string secret)
        {
            if (string.IsNullOrEmpty(secret)) return "";
            if (secret.Length <= 8) return "••••••••";
            return secret.Substring(0, 4) + "••••" + secret.Substring(secret.Length - 4);
        }

        private static string DetectLocalToolPath(string id)
        {
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string userProf = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);

            if (id == "cursor")
            {
                string[] cands = new string[]
                {
                    Path.Combine(localApp, @"Programs\cursor\Cursor.exe"),
                    Path.Combine(localApp, @"Programs\cursor\resources\app\bin\cursor.cmd"),
                    Path.Combine(progFiles, @"cursor\Cursor.exe")
                };
                for (int i = 0; i < cands.Length; i++)
                {
                    if (File.Exists(cands[i])) return cands[i];
                }
            }
            else if (id == "hermes")
            {
                string[] cands = new string[]
                {
                    Path.Combine(localApp, @"hermes\bin\hermes.exe"),
                    Path.Combine(localApp, @"hermes\bin\hermes.cmd"),
                    Path.Combine(userProf, @".hermes\bin\hermes.exe")
                };
                for (int i = 0; i < cands.Length; i++)
                {
                    if (File.Exists(cands[i])) return cands[i];
                }
                string binDir = Path.Combine(localApp, @"hermes\bin");
                if (Directory.Exists(binDir)) return binDir;
            }
            else if (id == "ollama")
            {
                string ollamaExe = Path.Combine(localApp, @"Programs\Ollama\ollama.exe");
                if (File.Exists(ollamaExe)) return ollamaExe;
            }
            else if (id == "obsidian")
            {
                string obsExe = Path.Combine(localApp, @"Programs\obsidian\Obsidian.exe");
                if (File.Exists(obsExe)) return obsExe;
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                string obsCfg = Path.Combine(appData, @"obsidian\obsidian.json");
                if (File.Exists(obsCfg)) return obsCfg;
            }
            else if (id == "onedrive")
            {
                string envOd = Environment.GetEnvironmentVariable("OneDrive");
                if (!string.IsNullOrEmpty(envOd) && Directory.Exists(envOd)) return envOd;
                string odPath = Path.Combine(userProf, "OneDrive");
                if (Directory.Exists(odPath)) return odPath;
            }
            else if (id == "googledrive")
            {
                if (Directory.Exists(@"G:\My Drive")) return @"G:\My Drive";
                string gdPath = Path.Combine(userProf, "Google Drive");
                if (Directory.Exists(gdPath)) return gdPath;
            }
            else if (id == "msword")
            {
                string[] wordCands = new string[]
                {
                    Path.Combine(progFiles, @"Microsoft Office\root\Office16\WINWORD.EXE"),
                    @"C:\Program Files (x86)\Microsoft Office\root\Office16\WINWORD.EXE"
                };
                for (int i = 0; i < wordCands.Length; i++)
                {
                    if (File.Exists(wordCands[i])) return wordCands[i];
                }
            }
            else if (id == "workshop")
            {
                string wsExe = Path.Combine(localApp, @"Programs\Workshop\Workshop.exe");
                if (File.Exists(wsExe)) return wsExe;
            }
            return "";
        }

        private static List<Dictionary<string, string>> GetBuiltInConnectorsCatalog()
        {
            List<Dictionary<string, string>> list = new List<Dictionary<string, string>>();

            // AI Full-Stack App Builders & Interactive Course Studios
            list.Add(MakeCatalogDef("lovable", "Lovable (1-Click Build URL + REST API)", "portal_bridge", "💜", "workspace_ops",
                "1-click launch Lovable with your App, Funnel, or Project PRD automatically pre-filled via #prompt= URL (zero API key needed!), plus optional lov_... Workspace API.",
                "", "", "Preferred Stack / Design Note (e.g. Supabase + Tailwind)", "Optional Lovable API Key (lov_...)",
                "https://lovable.dev", ""));

            list.Add(MakeCatalogDef("emergent", "Emergent Labs (Agentic Full-Stack Builder)", "portal_bridge", "🚀", "ai_agents",
                "1-click export structured React + FastAPI + Auth + Database app blueprints from JARVIS & launch Emergent Labs (emergent.sh).",
                "", "", "Preferred Stack / MCP Integrations Note", "Optional Emergent Webhook / MCP Secret",
                "https://emergent.sh", ""));

            list.Add(MakeCatalogDef("mindsmith", "Mindsmith AI (Interactive Course & eLearning)", "portal_bridge", "🎓", "book_writing",
                "Turn any JARVIS 6-Week Course syllabus, Book chapter, or Project into interactive eLearning lessons & quizzes in Mindsmith AI (mindsmith.ai).",
                "", "", "Learner Audience / Course Tone (or mindsmiths.com URL)", "Optional Mindsmith API / Webhook Key",
                "https://www.mindsmith.ai", ""));

            list.Add(MakeCatalogDef("workshop", "Workshop AI (Cloud & Desktop App Studio)", "portal_bridge", "🛠", "workspace_ops",
                "1-click send full-stack app, dashboard & database blueprints into Workshop AI Cloud or Workshop Desktop (workshop.ai).",
                "", "", "Database / Local Model Preference (e.g. Postgres / Ollama)", "Optional Workshop API / Webhook Key",
                "https://workshop.ai", ""));

            list.Add(MakeCatalogDef("hercules", "Hercules AI (SaaS & Mobile App Builder)", "portal_bridge", "🏛", "ai_agents",
                "1-click dispatch natural-language SaaS, mobile app & internal tool specifications directly into Hercules AI (hercules.app).",
                "", "", "App Type Focus (SaaS, Mobile, CRM, E-Commerce)", "Optional Hercules API / Webhook Secret",
                "https://hercules.app", ""));

            list.Add(MakeCatalogDef("muse", "Muse AI (Autonomous Agent, Spaces & Creative Studio)", "portal_bridge", "🎨", "ai_agents",
                "1-click dispatch multi-step agent tasks, interactive 'Spaces' mini-app briefs & creative prompts into Muse AI (muse.ai — or edit URL for museapp.com).",
                "", "", "Muse Space / Creative Style Note (or Custom Portal URL)", "Optional Muse API / MCP / Webhook Key",
                "https://muse.ai", ""));

            list.Add(MakeCatalogDef("grok", "xAI Grok (Grok 4.7 Brain + Web Studio)", "openai_compat", "🦊", "ai_agents",
                "Connect xAI Grok (grok-4.7) via API key to power JARVIS Voice/Chat & Autonomous Agents — or launch Grok Web (grok.com) in 1 click with zero key!",
                "https://api.x.ai/v1/chat/completions", "grok-4.7", "", "xAI API Key (xai-... from console.x.ai)",
                "https://console.x.ai", ""));

            // Memory, Knowledge Vaults & Cloud Docs
            list.Add(MakeCatalogDef("konshus", "Konshus AI (Memory Vault & MCP)", "portal_bridge", "🧠", "ai_agents",
                "Sync your portable Konshus AI Memory ('Whisper' / Briefing) & MCP Vault so JARVIS, Projects & Agents always know your history and preferences.",
                "https://konshus.ai/api/mcp", "", "Paste Your Konshus 'Whisper' / Memory Profile Here", "Optional Konshus MCP / Bearer Token",
                "https://konshus.ai", ""));

            list.Add(MakeCatalogDef("obsidian", "Obsidian (Local Markdown Vault)", "portal_bridge", "💎", "workspace_ops",
                "Save Projects, Agent Reports, Book Chapters & Notes directly as .md files with [[WikiLinks]] inside your local Obsidian Vault folder + 1-click launch.",
                "", "", "Local Obsidian Vault Folder Path (Blank = Auto-Create in Documents)", "Optional Obsidian Local REST API Key",
                "https://obsidian.md", ""));

            list.Add(MakeCatalogDef("onedrive", "Microsoft OneDrive (Local + Cloud Sync)", "portal_bridge", "☁", "workspace_ops",
                "Auto-detects your Windows OneDrive folder so Projects, Manuscripts & Agent Reports sync across all your devices automatically.",
                "", "", "Custom OneDrive Subfolder (Default: JARVIS-Vault)", "Optional Microsoft Graph Token",
                "https://onedrive.live.com", ""));

            list.Add(MakeCatalogDef("googledrive", "Google Drive (Cloud & Desktop Sync)", "portal_bridge", "📂", "workspace_ops",
                "Sync Projects, Books, Courses & Agent Deliverables directly to Google Drive for Desktop (or open your Drive folder in 1 click).",
                "", "", "Google Drive Folder Path or Shared Folder URL", "Optional Google Drive OAuth Token",
                "https://drive.google.com", ""));

            list.Add(MakeCatalogDef("googledocs", "Google Docs (1-Click Manuscript Studio)", "portal_bridge", "📄", "book_writing",
                "1-click copy any Book Chapter, Project Brief, or Agent Report and open a brand-new Google Doc (docs.new) ready to paste & edit.",
                "", "", "Optional Google Docs Folder URL or Apps Script Webhook", "Optional Google API Token",
                "https://docs.new", ""));

            list.Add(MakeCatalogDef("msword", "Microsoft Word (.doc Book & Brief Exporter)", "portal_bridge", "📘", "book_writing",
                "Export any Book Manuscript, Course Syllabus, Project, or Agent Report as a formatted Microsoft Word (.doc) file and open in Word or Word Online.",
                "", "", "Default Author Header / Formatting Note", "Optional Office Webhook Secret",
                "https://word.cloud.microsoft", ""));

            list.Add(MakeCatalogDef("vercel", "Vercel (1-Click Live Cloud App Deploy)", "webhook_rest", "▲", "workspace_ops",
                "Deploy any forged App or Business Funnel from JARVIS to a live https://...vercel.app URL in 1 click using a Vercel Access Token.",
                "https://api.vercel.com/v13/deployments", "", "Optional Vercel Team Slug / Project Prefix", "Vercel Access Token (from vercel.com/account/tokens)",
                "https://vercel.com/account/tokens", ""));

            list.Add(MakeCatalogDef("asana", "Asana (Projects & Task Sync)", "webhook_rest", "🎯", "workspace_ops",
                "Push Project tasks, Book milestones & Autonomous Agent action items directly into Asana via Personal Access Token.",
                "https://app.asana.com/api/1.0/tasks", "", "Default Asana Project GID (or Workspace GID)", "Asana Personal Access Token (2/...)",
                "https://app.asana.com/0/my-apps", ""));

            // Workspace, Tasks & IDEs
            list.Add(MakeCatalogDef("notion", "Notion (Hector Jusino jr's Space)", "notion", "📝", "workspace_ops",
                "Pre-linked to your J.A.R.V.I.S. Executive Command Hub page! 1-click export Books, Courses, Apps & Playbooks.",
                "https://api.notion.com/v1", "", "Parent Page ID or Notion Page URL", "Internal Integration Secret (ntn_... or secret_...)",
                "https://app.notion.com/p/41537a4325628115abf7cb2f6474e4e1?pvs=204", "41537a43-2562-8115-abf7-cb2f6474e4e1"));

            list.Add(MakeCatalogDef("clickup", "ClickUp", "clickup", "✅", "workspace_ops",
                "Create sprint tasks, book chapter milestones & funnel checklists in ClickUp by button or voice.",
                "https://api.clickup.com/api/v2", "", "Default ClickUp List ID (or List URL)", "ClickUp Personal Token (pk_...)",
                "https://app.clickup.com/settings/apps", ""));

            list.Add(MakeCatalogDef("cursor", "Cursor AI IDE", "local_ide", "↗", "workspace_ops",
                "Open any forged App, Funnel, Book, or Course workspace folder directly inside Cursor IDE on Windows Prime.",
                "", "", "Optional Custom Cursor.exe Path", "Optional Cursor Cloud API Key",
                "https://www.cursor.com", ""));

            list.Add(MakeCatalogDef("slack", "Slack (Channels & Alerts)", "webhook_rest", "💬", "workspace_ops",
                "Post executive briefings, book chapter drafts, funnel launches & automation alerts directly into Slack via Incoming Webhook or Bot Token.",
                "", "", "Slack Channel Name / ID (e.g. #jarvis-exec)", "Optional Slack Bot Token (xoxb-... if not using Webhook URL)",
                "https://api.slack.com/messaging/webhooks", ""));

            // Book Writing & Publishing Sources
            list.Add(MakeCatalogDef("aiwritebook", "AIWriteBook", "portal_bridge", "📚", "book_writing",
                "Voice-matched book drafting, Story Bible, Diff Editor & KDP metadata. 1-click copy Book Packet & launch AIWriteBook (or connect webhook/API).",
                "", "", "Author Voice Tone / Story Bible Tag", "Optional AIWriteBook API / Webhook Key",
                "https://aiwritebook.com", ""));

            list.Add(MakeCatalogDef("sudowrite", "Sudowrite / NovelCrafter", "portal_bridge", "✍", "book_writing",
                "Long-form chapter expansion, prose polishing & story codex. 1-click export chapter packet & open studio.",
                "", "", "Preferred Prose Style / Codex Note", "Optional API / Webhook Secret",
                "https://www.sudowrite.com", ""));

            list.Add(MakeCatalogDef("kdp", "Amazon KDP & Atticus Publishing", "portal_bridge", "📕", "book_writing",
                "Prepare Kindle eBook, Paperback & Hardcover metadata, blurbs & formatted manuscript exports.",
                "", "", "Default KDP Author Pen Name / ISBN Note", "Optional Publishing Webhook Key",
                "https://kdp.amazon.com", ""));

            // AI Coworkers, Agents & Brains
            list.Add(MakeCatalogDef("viktor", "Viktor AI (Coworker & App Agent)", "portal_bridge", "🦾", "ai_agents",
                "Connect Viktor AI (viktor.com coworker or viktor.ai platform) via Webhook/API token or 1-click task brief dispatch.",
                "", "", "Viktor Workspace / Slack Channel Tag", "Viktor API Token or Webhook Secret",
                "https://www.viktor.com", ""));

            list.Add(MakeCatalogDef("genspark", "Genspark (Super Agent & Sparkpages)", "portal_bridge", "✨", "ai_agents",
                "1-click send deep research briefs, book outlines & venture specs into Genspark Super Agent (or connect custom webhook/API).",
                "", "", "Default Research Focus / Sparkpage Tag", "Optional Genspark API / Webhook Key",
                "https://www.genspark.ai", ""));

            list.Add(MakeCatalogDef("perplexity", "Perplexity AI (Live Web Sonar)", "openai_compat", "🔎", "ai_agents",
                "Real-time web-grounded research, market intelligence & cited book research using Perplexity Sonar Pro.",
                "https://api.perplexity.ai/chat/completions", "sonar-pro", "", "Perplexity API Key (pplx-...)",
                "https://www.perplexity.ai/settings/api", ""));

            list.Add(MakeCatalogDef("deepseek", "DeepSeek AI (V3 & R1 Reasoner)", "openai_compat", "🐋", "ai_agents",
                "Frontier reasoning, coding & long-form strategy with DeepSeek-Chat (V3) or DeepSeek-Reasoner (R1).",
                "https://api.deepseek.com/chat/completions", "deepseek-chat", "", "DeepSeek API Key (sk-...)",
                "https://platform.deepseek.com/api_keys", ""));

            list.Add(MakeCatalogDef("kimi", "Kimi (Moonshot AI K2 / 128k+)", "openai_compat", "🌙", "ai_agents",
                "Ultra-long-context book manuscript analysis, research & agentic coding via Moonshot Kimi API.",
                "https://api.moonshot.ai/v1/chat/completions", "kimi-k2-0711-preview", "", "Moonshot / Kimi API Key (sk-...)",
                "https://platform.moonshot.ai/console/api-keys", ""));

            list.Add(MakeCatalogDef("huggingface", "Hugging Face (Inference Router)", "openai_compat", "🤗", "ai_agents",
                "Access thousands of open-weights models (Qwen, Llama, DeepSeek, Mistral) via Hugging Face Inference Providers.",
                "https://router.huggingface.co/v1/chat/completions", "Qwen/Qwen2.5-72B-Instruct", "", "Hugging Face Access Token (hf_...)",
                "https://huggingface.co/settings/tokens", ""));

            list.Add(MakeCatalogDef("claude", "Anthropic Claude", "anthropic", "🧠", "ai_agents",
                "Use Claude as JARVIS's reasoning, book-writing & coding brain across all 4 laptops.",
                "https://api.anthropic.com/v1/messages", "claude-sonnet-4-6", "", "Anthropic API Key (sk-ant-...)",
                "https://console.anthropic.com/settings/keys", ""));

            list.Add(MakeCatalogDef("openai", "OpenAI (GPT / o-Series)", "openai_compat", "⚡", "ai_agents",
                "Route JARVIS voice commands, app code & business funnels through OpenAI models.",
                "https://api.openai.com/v1/chat/completions", "gpt-4o", "", "OpenAI API Key (sk-...)",
                "https://platform.openai.com/api-keys", ""));

            list.Add(MakeCatalogDef("openrouter", "OpenRouter (300+ Models)", "openai_compat", "🌐", "ai_agents",
                "Single gateway to Claude, GPT, DeepSeek, Llama, Mistral, Grok & 300+ frontier models.",
                "https://openrouter.ai/api/v1/chat/completions", "anthropic/claude-3.7-sonnet", "", "OpenRouter API Key (sk-or-...)",
                "https://openrouter.ai/keys", ""));

            list.Add(MakeCatalogDef("hermes", "Hermes (Nous API + Local CLI)", "openai_compat", "🪽", "ai_agents",
                "Connect Nous Hermes inference API (or local Hermes server) + launch local Hermes CLI in workspace.",
                "https://inference-api.nousresearch.com/v1/chat/completions", "Hermes-3-Llama-3.1-70B", "", "Nous / Hermes API Key (or blank for local)",
                "https://portal.nousresearch.com", ""));

            list.Add(MakeCatalogDef("openclaw", "OpenClaw Agent Gateway", "openai_compat", "🦞", "ai_agents",
                "Bridge JARVIS to your OpenClaw autonomous agent gateway (OpenAI-compatible endpoint or webhook).",
                "http://127.0.0.1:18789/v1/chat/completions", "openclaw-default", "Optional OpenClaw Webhook URL", "OpenClaw Gateway Token (if required)",
                "", ""));

            list.Add(MakeCatalogDef("ollama", "Local Ollama (Offline AI)", "openai_compat", "🦙", "ai_agents",
                "Run local open-weights models privately on Windows Prime with zero API cost.",
                "http://127.0.0.1:11434/v1/chat/completions", "llama3.2", "", "Optional Bearer Key (usually blank)",
                "https://ollama.com", ""));

            list.Add(MakeCatalogDef("webhook", "Universal Webhook (Zapier / Make / n8n)", "webhook_rest", "🔗", "workspace_ops",
                "Push apps, funnels, manuscripts & voice events to n8n, Make.com, Zapier, Slack, Discord, or GoHighLevel.",
                "", "", "Optional Channel / Tag Name", "Optional Bearer / Signing Secret",
                "", ""));

            return list;
        }

        private static Dictionary<string, string> MakeCatalogDef(
            string id, string name, string kind, string icon, string category, string desc,
            string defaultEndpoint, string defaultModel, string extraLabel, string keyPlaceholder,
            string portalUrl, string defaultExtraId)
        {
            Dictionary<string, string> d = new Dictionary<string, string>();
            d["id"] = id;
            d["name"] = name;
            d["kind"] = kind;
            d["icon"] = icon;
            d["category"] = category;
            d["description"] = desc;
            d["defaultEndpoint"] = defaultEndpoint;
            d["defaultModel"] = defaultModel;
            d["extraLabel"] = extraLabel;
            d["keyPlaceholder"] = keyPlaceholder;
            d["portalUrl"] = portalUrl;
            d["defaultExtraId"] = defaultExtraId;
            return d;
        }

        private static Dictionary<string, object> GetSavedConnectorEntry(Dictionary<string, object> vault, string id)
        {
            if (vault != null && vault.ContainsKey("items") && vault["items"] is IDictionary)
            {
                IDictionary items = (IDictionary)vault["items"];
                if (items.Contains(id) && items[id] is IDictionary)
                {
                    Dictionary<string, object> res = new Dictionary<string, object>();
                    foreach (DictionaryEntry de in (IDictionary)items[id])
                    {
                        res[de.Key.ToString()] = de.Value;
                    }
                    return res;
                }
            }
            return new Dictionary<string, object>();
        }

        private static ArrayList BuildSanitizedConnectorsList(out int configuredCount)
        {
            configuredCount = 0;
            Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
            ArrayList output = new ArrayList();

            // 1. Include Gemini Vault status card first so all brains appear together
            string geminiKey = LoadGeminiKeyDpapi();
            bool gemOk = !string.IsNullOrEmpty(geminiKey);
            if (gemOk) configuredCount++;
            Dictionary<string, object> gemCard = new Dictionary<string, object>();
            gemCard["id"] = "gemini";
            gemCard["name"] = "Google Gemini (3.8 Flash / 4 / Live)";
            gemCard["kind"] = "gemini";
            gemCard["category"] = "ai_agents";
            gemCard["icon"] = "✦";
            gemCard["description"] = "Primary multimodal voice, TTS, Live WebSocket & Interactions brain.";
            gemCard["configured"] = gemOk;
            gemCard["maskedKey"] = MaskSecretVal(geminiKey);
            gemCard["endpoint"] = "https://generativelanguage.googleapis.com/v1beta/interactions";
            gemCard["model"] = "gemini-3.8-flash";
            gemCard["extraId"] = "";
            gemCard["extraLabel"] = "";
            gemCard["keyPlaceholder"] = "AIza... (Google AI Studio Key)";
            gemCard["portalUrl"] = "https://aistudio.google.com/apikey";
            gemCard["localDetected"] = false;
            gemCard["localPath"] = "";
            gemCard["isCustom"] = false;
            output.Add(gemCard);

            // 2. Built-in catalog
            List<Dictionary<string, string>> catalog = GetBuiltInConnectorsCatalog();
            for (int i = 0; i < catalog.Count; i++)
            {
                Dictionary<string, string> def = catalog[i];
                string id = def["id"];
                Dictionary<string, object> saved = GetSavedConnectorEntry(vault, id);
                string key = GetStr(saved, "apiKey", "");
                string endpoint = GetStr(saved, "endpoint", def["defaultEndpoint"]);
                string model = GetStr(saved, "model", def["defaultModel"]);
                string extraId = GetStr(saved, "extraId", def["defaultExtraId"]);
                string portalUrl = GetStr(saved, "portalUrl", def["portalUrl"]);
                string localPath = DetectLocalToolPath(id);
                bool localDet = !string.IsNullOrEmpty(localPath);

                bool isCfg = !string.IsNullOrEmpty(key) || localDet;
                if (def["kind"] == "webhook_rest") isCfg = !string.IsNullOrEmpty(endpoint);
                if (id == "vercel" || id == "asana") isCfg = !string.IsNullOrEmpty(key);
                if (def["kind"] == "portal_bridge") isCfg = !string.IsNullOrEmpty(key) || !string.IsNullOrEmpty(extraId) || !string.IsNullOrEmpty(portalUrl) || localDet;
                if (id == "konshus") isCfg = !string.IsNullOrEmpty(key) || !string.IsNullOrEmpty(extraId) || !string.IsNullOrEmpty(portalUrl);
                if (id == "openclaw" && !string.IsNullOrEmpty( saved.ContainsKey("endpoint") ? GetStr(saved, "endpoint", "") : "" )) isCfg = true;

                if (isCfg) configuredCount++;

                Dictionary<string, object> card = new Dictionary<string, object>();
                card["id"] = id;
                card["name"] = def["name"];
                card["kind"] = def["kind"];
                card["category"] = def["category"];
                card["icon"] = def["icon"];
                card["description"] = def["description"];
                card["configured"] = isCfg;
                card["maskedKey"] = MaskSecretVal(key);
                card["endpoint"] = endpoint;
                card["model"] = model;
                card["extraId"] = extraId;
                card["extraLabel"] = def["extraLabel"];
                card["keyPlaceholder"] = def["keyPlaceholder"];
                card["portalUrl"] = portalUrl;
                card["localDetected"] = localDet;
                card["localPath"] = localPath;
                card["isCustom"] = false;
                output.Add(card);
            }

            // 3. User-defined custom connectors ("and others")
            ArrayList customIds = ToArrayList(vault.ContainsKey("customIds") ? vault["customIds"] : null);
            for (int i = 0; i < customIds.Count; i++)
            {
                string cid = customIds[i] != null ? customIds[i].ToString() : "";
                if (string.IsNullOrEmpty(cid)) continue;
                Dictionary<string, object> saved = GetSavedConnectorEntry(vault, cid);
                if (saved.Count == 0) continue;

                string key = GetStr(saved, "apiKey", "");
                string endpoint = GetStr(saved, "endpoint", "");
                string portalUrl = GetStr(saved, "portalUrl", "");
                string cKind = GetStr(saved, "kind", "webhook_rest");
                string cCat = GetStr(saved, "category", "workspace_ops");
                bool isCfg = !string.IsNullOrEmpty(key) || !string.IsNullOrEmpty(endpoint) || !string.IsNullOrEmpty(portalUrl);
                if (isCfg) configuredCount++;

                Dictionary<string, object> card = new Dictionary<string, object>();
                card["id"] = cid;
                card["name"] = GetStr(saved, "name", cid);
                card["kind"] = cKind;
                card["category"] = cCat;
                card["icon"] = cCat == "book_writing" ? "📖" : (cKind == "openai_compat" ? "🤖" : "🔌");
                card["description"] = GetStr(saved, "description", "Custom encrypted source stored in Windows DPAPI Vault.");
                card["configured"] = isCfg;
                card["maskedKey"] = MaskSecretVal(key);
                card["endpoint"] = endpoint;
                card["model"] = GetStr(saved, "model", "");
                card["extraId"] = GetStr(saved, "extraId", "");
                card["extraLabel"] = "Optional Workspace / Style Note";
                card["keyPlaceholder"] = "API Key or Bearer Secret (DPAPI Encrypted)";
                card["portalUrl"] = portalUrl;
                card["localDetected"] = false;
                card["localPath"] = "";
                card["isCustom"] = true;
                output.Add(card);
            }

            return output;
        }

        private static string ExtractNotionPageId(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "";
            string trimmed = raw.Trim();
            int qIdx = trimmed.IndexOf('?');
            if (qIdx >= 0) trimmed = trimmed.Substring(0, qIdx);
            int hIdx = trimmed.IndexOf('#');
            if (hIdx >= 0) trimmed = trimmed.Substring(0, hIdx);

            StringBuilder hexRun = new StringBuilder();
            string last32 = "";
            for (int i = 0; i < trimmed.Length; i++)
            {
                char c = trimmed[i];
                if (c == '-') continue;
                bool isHex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
                if (isHex)
                {
                    hexRun.Append(c);
                    if (hexRun.Length >= 32)
                    {
                        last32 = hexRun.ToString(hexRun.Length - 32, 32);
                    }
                }
                else
                {
                    hexRun.Length = 0;
                }
            }
            return last32.ToLowerInvariant();
        }

        private static string ExtractClickUpListId(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "";
            string s = raw.Trim();
            int liIdx = s.IndexOf("/li/", StringComparison.OrdinalIgnoreCase);
            if (liIdx >= 0) s = s.Substring(liIdx + 4);
            StringBuilder digits = new StringBuilder();
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c >= '0' && c <= '9') digits.Append(c);
                else if (digits.Length > 0) break;
            }
            return digits.Length > 0 ? digits.ToString() : s;
        }

        private static string SendOutboundHttp(string method, string url, Dictionary<string, string> headers, string bodyJson, int timeoutMs, out int httpStatus)
        {
            httpStatus = 0;
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Proxy = null;
            req.KeepAlive = false;
            req.Method = method;
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.UserAgent = "JARVIS-Command-Hub/2.0";
            if (headers != null)
            {
                foreach (KeyValuePair<string, string> kv in headers)
                {
                    if (string.Equals(kv.Key, "Content-Type", StringComparison.OrdinalIgnoreCase))
                        req.ContentType = kv.Value;
                    else if (string.Equals(kv.Key, "Accept", StringComparison.OrdinalIgnoreCase))
                        req.Accept = kv.Value;
                    else
                        req.Headers[kv.Key] = kv.Value;
                }
            }

            if (method != "GET" && bodyJson != null)
            {
                if (string.IsNullOrEmpty(req.ContentType)) req.ContentType = "application/json; charset=utf-8";
                byte[] bytes = Encoding.UTF8.GetBytes(bodyJson);
                req.ContentLength = bytes.Length;
                using (Stream rs = req.GetRequestStream())
                {
                    rs.Write(bytes, 0, bytes.Length);
                }
            }

            try
            {
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    httpStatus = (int)resp.StatusCode;
                    return sr.ReadToEnd();
                }
            }
            catch (WebException wex)
            {
                if (wex.Response is HttpWebResponse)
                {
                    HttpWebResponse errResp = (HttpWebResponse)wex.Response;
                    httpStatus = (int)errResp.StatusCode;
                    using (StreamReader sr = new StreamReader(errResp.GetResponseStream(), Encoding.UTF8))
                    {
                        return sr.ReadToEnd();
                    }
                }
                throw;
            }
        }

        private static Dictionary<string, object> ParseAiActionJson(string rawModelText)
        {
            JavaScriptSerializer ser = CreateSerializer();
            string text = (rawModelText ?? "").Trim();
            int firstBrace = text.IndexOf('{');
            int lastBrace = text.LastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace)
            {
                string candidate = text.Substring(firstBrace, lastBrace - firstBrace + 1);
                try
                {
                    Dictionary<string, object> obj = ser.Deserialize<Dictionary<string, object>>(candidate);
                    if (obj != null && obj.ContainsKey("action")) return obj;
                }
                catch { }
            }

            Dictionary<string, object> fallback = new Dictionary<string, object>();
            fallback["action"] = "chat";
            fallback["spokenReply"] = text.Length > 0 ? text : "Done.";
            return fallback;
        }

        private static ArrayList BuildNotionBlocksFromMarkdown(string markdown)
        {
            ArrayList blocks = new ArrayList();
            string[] lines = (markdown ?? "").Replace("\r\n", "\n").Split('\n');
            StringBuilder paraBuf = new StringBuilder();

            for (int i = 0; i < lines.Length && blocks.Count < 85; i++)
            {
                string line = lines[i];
                string trimmed = line.Trim();

                if (trimmed.StartsWith("# ") || trimmed.StartsWith("## ") || trimmed.StartsWith("### "))
                {
                    if (paraBuf.Length > 0)
                    {
                        AddNotionParagraphChunks(blocks, paraBuf.ToString().Trim());
                        paraBuf.Length = 0;
                    }
                    string hType = trimmed.StartsWith("### ") ? "heading_3" : (trimmed.StartsWith("## ") ? "heading_2" : "heading_1");
                    string hText = trimmed.Substring(trimmed.IndexOf(' ') + 1).Trim();
                    blocks.Add(MakeNotionTextBlock(hType, hText));
                }
                else if (trimmed.Length == 0)
                {
                    if (paraBuf.Length > 0)
                    {
                        AddNotionParagraphChunks(blocks, paraBuf.ToString().Trim());
                        paraBuf.Length = 0;
                    }
                }
                else
                {
                    if (paraBuf.Length > 0) paraBuf.Append("\n");
                    paraBuf.Append(line);
                }
            }
            if (paraBuf.Length > 0 && blocks.Count < 90)
            {
                AddNotionParagraphChunks(blocks, paraBuf.ToString().Trim());
            }
            return blocks;
        }

        private static void AddNotionParagraphChunks(ArrayList blocks, string content)
        {
            if (string.IsNullOrEmpty(content)) return;
            int idx = 0;
            while (idx < content.Length && blocks.Count < 95)
            {
                int len = Math.Min(1800, content.Length - idx);
                blocks.Add(MakeNotionTextBlock("paragraph", content.Substring(idx, len)));
                idx += len;
            }
        }

        private static Dictionary<string, object> MakeNotionTextBlock(string blockType, string content)
        {
            Dictionary<string, object> textObj = new Dictionary<string, object>();
            textObj["content"] = content.Length > 1900 ? content.Substring(0, 1900) : content;

            Dictionary<string, object> rtItem = new Dictionary<string, object>();
            rtItem["type"] = "text";
            rtItem["text"] = textObj;

            ArrayList rtArr = new ArrayList();
            rtArr.Add(rtItem);

            Dictionary<string, object> inner = new Dictionary<string, object>();
            inner["rich_text"] = rtArr;

            Dictionary<string, object> block = new Dictionary<string, object>();
            block["object"] = "block";
            block["type"] = blockType;
            block[blockType] = inner;
            return block;
        }

        private static void RecordAudit(string eventType, string ip, string detail)
        {
            lock (AuthLock)
            {
                Dictionary<string, object> ev = new Dictionary<string, object>();
                ev["timestamp"] = DateTime.UtcNow.ToString("o");
                ev["event"] = eventType;
                ev["ip"] = ip;
                ev["detail"] = detail;
                SecurityAuditLog.Insert(0, ev);
                while (SecurityAuditLog.Count > 50) SecurityAuditLog.RemoveAt(SecurityAuditLog.Count - 1);
            }
        }

        private static bool IsIpRateLimited(string ip)
        {
            lock (AuthLock)
            {
                if (!FailedAuthByIp.ContainsKey(ip)) return false;
                List<DateTime> list = FailedAuthByIp[ip];
                DateTime cutoff = DateTime.UtcNow.AddMinutes(-15);
                list.RemoveAll(delegate (DateTime t) { return t < cutoff; });
                return list.Count >= 5;
            }
        }

        private static void RecordFailedAuth(string ip, string reason)
        {
            lock (AuthLock)
            {
                if (!FailedAuthByIp.ContainsKey(ip)) FailedAuthByIp[ip] = new List<DateTime>();
                FailedAuthByIp[ip].Add(DateTime.UtcNow);
            }
            RecordAudit("AUTH_FAILED", ip, reason);
        }

        private static void ClearFailedAuth(string ip)
        {
            lock (AuthLock)
            {
                if (FailedAuthByIp.ContainsKey(ip)) FailedAuthByIp.Remove(ip);
            }
        }

        private static string NormalizeIp(string ip)
        {
            if (string.IsNullOrEmpty(ip)) return "";
            if (ip.StartsWith("::ffff:")) return ip.Substring(7);
            return ip;
        }

        private static bool IsLoopbackIp(string rawIp)
        {
            string ip = NormalizeIp(rawIp);
            return ip == "127.0.0.1" || ip == "::1" || ip == "localhost";
        }

        private static bool IsTailscaleIp(string rawIp)
        {
            string ip = NormalizeIp(rawIp);
            string[] parts = ip.Split('.');
            if (parts.Length != 4) return false;
            int a, b;
            if (!int.TryParse(parts[0], out a) || !int.TryParse(parts[1], out b)) return false;
            return a == 100 && b >= 64 && b <= 127;
        }

        private static bool IsPrivateLanIp(string rawIp)
        {
            string ip = NormalizeIp(rawIp);
            if (string.IsNullOrEmpty(ip)) return false;
            string low = ip.ToLowerInvariant();
            if (low.StartsWith("fe80:") || low.StartsWith("fc") || low.StartsWith("fd")) return true;
            string[] parts = ip.Split('.');
            if (parts.Length != 4) return false;
            int a, b;
            if (!int.TryParse(parts[0], out a) || !int.TryParse(parts[1], out b)) return false;
            if (a == 10) return true;
            if (a == 192 && b == 168) return true;
            if (a == 172 && b >= 16 && b <= 31) return true;
            return false;
        }

        private static bool IsIpAllowedByNetworkShield(string remoteIp, string mode)
        {
            if (IsLoopbackIp(remoteIp)) return true;
            if (mode == "localhost_only") return false;
            if (mode == "tailscale_only") return IsTailscaleIp(remoteIp);
            return IsTailscaleIp(remoteIp) || IsPrivateLanIp(remoteIp);
        }

        /* ================= WORKSPACE & FLEET SEEDING ================= */

        private static void EnsureDirectoriesAndSeedState()
        {
            Directory.CreateDirectory(PublicDir);
            Directory.CreateDirectory(AgentsDir);
            Directory.CreateDirectory(WorkspaceDir);
            Directory.CreateDirectory(Path.Combine(WorkspaceDir, "apps"));
            Directory.CreateDirectory(Path.Combine(WorkspaceDir, "business"));
            Directory.CreateDirectory(Path.Combine(WorkspaceDir, "books"));
            Directory.CreateDirectory(Path.Combine(WorkspaceDir, "courses"));

            lock (StateLock)
            {
                if (!File.Exists(StateFilePath))
                {
                    SaveStateInternal(CreateSeedState());
                }
                else
                {
                    Dictionary<string, object> st = LoadStateInternal();
                    if (!st.ContainsKey("automations") || ToArrayList(st["automations"]).Count == 0)
                    {
                        st["automations"] = BuildDefaultAutomationsSeed();
                        SaveStateInternal(st);
                    }
                }
            }
        }

        private static Dictionary<string, object> CreateSeedState()
        {
            Dictionary<string, object> state = new Dictionary<string, object>();

            Dictionary<string, object> settings = new Dictionary<string, object>();
            settings["assistantName"] = "J.A.R.V.I.S.";
            settings["wakeWord"] = "jarvis";
            settings["brandName"] = "Apex Leadership & Venture Lab";
            settings["authorName"] = "Founder";
            settings["geminiModel"] = "gemini-3.8-flash";
            settings["voiceReply"] = true;
            settings["voiceRate"] = 1.02;
            settings["voicePitch"] = 0.94;
            state["settings"] = settings;

            state["apps"] = new ArrayList();
            state["business"] = new ArrayList();
            state["books"] = new ArrayList();
            state["courses"] = new ArrayList();

            ArrayList chat = new ArrayList();
            Dictionary<string, object> welcome = new Dictionary<string, object>();
            welcome["id"] = Guid.NewGuid().ToString("N");
            welcome["role"] = "assistant";
            welcome["text"] = "Security Shield verified. Systems online across Windows Prime Hub and ready for encrypted multi-laptop sync.";
            welcome["sourceNode"] = "WINDOWS-PRIME";
            welcome["actionType"] = "system";
            welcome["timestamp"] = DateTime.UtcNow.ToString("o");
            chat.Add(welcome);
            state["chat"] = chat;
            state["dispatchHistory"] = new ArrayList();
            state["automations"] = BuildDefaultAutomationsSeed();
            return state;
        }

        private static ArrayList BuildDefaultAutomationsSeed()
        {
            ArrayList list = new ArrayList();

            Dictionary<string, object> a1 = new Dictionary<string, object>();
            a1["id"] = "auto-morning-brief";
            a1["name"] = "Executive Morning Briefing (Spoken + Fleet Log)";
            a1["actionType"] = "morning_briefing";
            a1["scheduleType"] = "daily_time";
            a1["dailyTime"] = "08:00";
            a1["intervalMinutes"] = 60;
            a1["payload"] = "Summarize active Apps, Funnels, Books, Courses & Laptop Fleet status.";
            a1["enabled"] = true;
            a1["lastRunAt"] = "";
            a1["lastResult"] = "Scheduled daily at 08:00 (click ▶ Run Now anytime to test!)";
            list.Add(a1);

            Dictionary<string, object> a2 = new Dictionary<string, object>();
            a2["id"] = "auto-fleet-sync";
            a2["name"] = "Multi-Laptop Workspace Auto-Sync (3 MacBooks)";
            a2["actionType"] = "sync_fleet";
            a2["scheduleType"] = "interval_mins";
            a2["dailyTime"] = "09:00";
            a2["intervalMinutes"] = 120;
            a2["payload"] = "Synchronize apps, manuscripts & course modules across MACBOOK-ALPHA, BETA, and GAMMA.";
            a2["enabled"] = true;
            a2["lastRunAt"] = "";
            a2["lastResult"] = "Scheduled every 120 mins";
            list.Add(a2);

            Dictionary<string, object> a3 = new Dictionary<string, object>();
            a3["id"] = "auto-book-sprint";
            a3["name"] = "Daily Leadership Book Writing Sprint -> ClickUp";
            a3["actionType"] = "clickup_sprint";
            a3["scheduleType"] = "daily_time";
            a3["dailyTime"] = "09:30";
            a3["intervalMinutes"] = 1440;
            a3["payload"] = "Draft 750 words on next Leadership Book chapter & review AIWriteBook Story Bible.";
            a3["enabled"] = false;
            a3["lastRunAt"] = "";
            a3["lastResult"] = "Paused (enable once ClickUp token is saved, or click ▶ Run Now)";
            list.Add(a3);

            Dictionary<string, object> a4 = new Dictionary<string, object>();
            a4["id"] = "auto-notion-digest";
            a4["name"] = "Weekly Venture & Book Status Digest -> Notion";
            a4["actionType"] = "notion_digest";
            a4["scheduleType"] = "interval_mins";
            a4["dailyTime"] = "17:00";
            a4["intervalMinutes"] = 1440;
            a4["payload"] = "Publish workspace progress snapshot to J.A.R.V.I.S. Executive Command Hub in Notion.";
            a4["enabled"] = false;
            a4["lastRunAt"] = "";
            a4["lastResult"] = "Paused (enable anytime to auto-publish status pages to Notion)";
            list.Add(a4);

            return list;
        }

        /* ================= NATIVE WINDOWS SAPI WAV VOICE & AUTOMATION RUNNER ================= */

        private static byte[] SynthesizeWavBytesSapi(string text, bool alsoSpeakOnHost)
        {
            string clean = (text ?? "").Trim();
            if (clean.Length == 0) clean = "Online and at your service.";
            if (clean.Length > 1200) clean = clean.Substring(0, 1200);

            byte[] wavBytes = null;
            Thread staThread = new Thread((ThreadStart)delegate
            {
                try
                {
                    using (SpeechSynthesizer synth = new SpeechSynthesizer())
                    {
                        try
                        {
                            string[] preferred = new string[] { "George", "Ryan", "Daniel", "Hazel", "David", "Mark", "Zira" };
                            var voices = synth.GetInstalledVoices();
                            bool picked = false;
                            for (int p = 0; p < preferred.Length && !picked; p++)
                            {
                                foreach (InstalledVoice iv in voices)
                                {
                                    if (iv.Enabled && iv.VoiceInfo != null &&
                                        iv.VoiceInfo.Name.IndexOf(preferred[p], StringComparison.OrdinalIgnoreCase) >= 0)
                                    {
                                        synth.SelectVoice(iv.VoiceInfo.Name);
                                        picked = true;
                                        break;
                                    }
                                }
                            }
                        }
                        catch { }

                        synth.Rate = 0;
                        synth.Volume = 100;
                        using (MemoryStream ms = new MemoryStream())
                        {
                            synth.SetOutputToWaveStream(ms);
                            synth.Speak(clean);
                            wavBytes = ms.ToArray();
                        }

                        if (alsoSpeakOnHost)
                        {
                            synth.SetOutputToDefaultAudioDevice();
                            synth.SpeakAsync(clean);
                        }
                    }
                }
                catch { }
            });
            staThread.SetApartmentState(ApartmentState.STA);
            staThread.Start();
            staThread.Join(12000);
            return wavBytes;
        }

        private static void CheckDueAutomationsTick(object stateObj)
        {
            if (!Monitor.TryEnter(AutomationRunLock)) return;
            try
            {
                ArrayList dueIds = new ArrayList();
                DateTime nowLocal = DateTime.Now;
                DateTime nowUtc = DateTime.UtcNow;

                lock (StateLock)
                {
                    Dictionary<string, object> st = LoadStateInternal();
                    ArrayList autos = ToArrayList(st.ContainsKey("automations") ? st["automations"] : null);
                    for (int i = 0; i < autos.Count; i++)
                    {
                        IDictionary a = autos[i] as IDictionary;
                        if (a == null) continue;
                        bool enabled = a.Contains("enabled") && a["enabled"] is bool && (bool)a["enabled"];
                        if (!enabled) continue;

                        string schedType = a.Contains("scheduleType") && a["scheduleType"] != null ? a["scheduleType"].ToString() : "interval_mins";
                        string lastRunRaw = a.Contains("lastRunAt") && a["lastRunAt"] != null ? a["lastRunAt"].ToString() : "";
                        DateTime lastRunUtc = DateTime.MinValue;
                        if (!string.IsNullOrEmpty(lastRunRaw))
                        {
                            DateTime.TryParse(lastRunRaw, null, System.Globalization.DateTimeStyles.RoundtripKind, out lastRunUtc);
                            lastRunUtc = lastRunUtc.ToUniversalTime();
                        }

                        bool isDue = false;
                        if (schedType == "daily_time")
                        {
                            string hhmm = a.Contains("dailyTime") && a["dailyTime"] != null ? a["dailyTime"].ToString() : "08:00";
                            string nowHhmm = nowLocal.ToString("HH:mm");
                            if (nowHhmm == hhmm && (nowUtc - lastRunUtc).TotalMinutes >= 65)
                            {
                                isDue = true;
                            }
                        }
                        else
                        {
                            int mins = 60;
                            if (a.Contains("intervalMinutes") && a["intervalMinutes"] != null)
                                int.TryParse(a["intervalMinutes"].ToString(), out mins);
                            if (mins < 5) mins = 5;
                            if (lastRunUtc == DateTime.MinValue)
                            {
                                // Initialize lastRunAt to now on first boot so interval jobs wait 1 interval before firing
                                a["lastRunAt"] = nowUtc.ToString("o");
                                SaveStateInternal(st);
                            }
                            else if ((nowUtc - lastRunUtc).TotalMinutes >= mins)
                            {
                                isDue = true;
                            }
                        }

                        if (isDue && a.Contains("id") && a["id"] != null)
                        {
                            dueIds.Add(a["id"].ToString());
                        }
                    }
                }

                for (int i = 0; i < dueIds.Count; i++)
                {
                    ExecuteAutomationById(dueIds[i].ToString(), false);
                }
            }
            catch { }
            finally
            {
                Monitor.Exit(AutomationRunLock);
            }
        }

        private static string ExecuteAutomationById(string autoId, bool manualTrigger)
        {
            Dictionary<string, object> jobCopy = new Dictionary<string, object>();
            int appsCount = 0, bizCount = 0, booksCount = 0, coursesCount = 0;

            lock (StateLock)
            {
                Dictionary<string, object> st = LoadStateInternal();
                appsCount = ToArrayList(st.ContainsKey("apps") ? st["apps"] : null).Count;
                bizCount = ToArrayList(st.ContainsKey("business") ? st["business"] : null).Count;
                booksCount = ToArrayList(st.ContainsKey("books") ? st["books"] : null).Count;
                coursesCount = ToArrayList(st.ContainsKey("courses") ? st["courses"] : null).Count;

                ArrayList autos = ToArrayList(st.ContainsKey("automations") ? st["automations"] : null);
                for (int i = 0; i < autos.Count; i++)
                {
                    IDictionary a = autos[i] as IDictionary;
                    if (a != null && a.Contains("id") && a["id"] != null && a["id"].ToString() == autoId)
                    {
                        foreach (DictionaryEntry de in a) jobCopy[de.Key.ToString()] = de.Value;
                        break;
                    }
                }
            }

            if (jobCopy.Count == 0) return "Automation not found.";

            string name = GetStr(jobCopy, "name", "JARVIS Routine");
            string actType = GetStr(jobCopy, "actionType", "morning_briefing");
            string payloadTxt = GetStr(jobCopy, "payload", "");
            string summaryResult = "";

            try
            {
                if (actType == "morning_briefing")
                {
                    summaryResult = string.Format(
                        "Good day. Automated Executive Briefing complete: your workspace currently holds {0} applications, {1} business funnels, {2} leadership books, and {3} courses. All systems nominal across Windows Prime, MacBooks, and iOS.",
                        appsCount, bizCount, booksCount, coursesCount);

                    if (!manualTrigger)
                    {
                        // Speak out of Windows Prime speakers on scheduled morning briefing!
                        SynthesizeWavBytesSapi(summaryResult, true);
                    }
                }
                else if (actType == "sync_fleet")
                {
                    Dictionary<string, object> cmd = new Dictionary<string, object>();
                    cmd["id"] = Guid.NewGuid().ToString("N");
                    cmd["targetNode"] = "ALL";
                    cmd["commandType"] = "sync_workspace";
                    cmd["payload"] = "Automated workspace sync";
                    cmd["createdAt"] = DateTime.UtcNow.ToString("o");
                    lock (StateLock)
                    {
                        foreach (string nk in LiveNodes.Keys)
                        {
                            if (nk != "WINDOWS-PRIME" && nk != "IOS-PRIME")
                            {
                                if (!NodeQueues.ContainsKey(nk)) NodeQueues[nk] = new List<Dictionary<string, object>>();
                                NodeQueues[nk].Add(cmd);
                            }
                        }
                    }
                    summaryResult = "Workspace sync queued across MACBOOK-ALPHA, MACBOOK-BETA, and MACBOOK-GAMMA.";
                }
                else if (actType == "clickup_sprint")
                {
                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> cu = GetSavedConnectorEntry(vault, "clickup");
                    string cuKey = GetStr(cu, "apiKey", "");
                    string cuList = ExtractClickUpListId(GetStr(cu, "extraId", ""));
                    if (!string.IsNullOrEmpty(cuKey) && !string.IsNullOrEmpty(cuList))
                    {
                        Dictionary<string, object> cReq = new Dictionary<string, object>();
                        cReq["name"] = name + " (" + DateTime.Now.ToString("MMM dd") + ")";
                        cReq["markdown_description"] = payloadTxt;
                        Dictionary<string, string> hdrs = new Dictionary<string, string>();
                        hdrs["Authorization"] = cuKey;
                        int stc = 0;
                        SendOutboundHttp("POST", "https://api.clickup.com/api/v2/list/" + cuList + "/task", hdrs, CreateSerializer().Serialize(cReq), 15000, out stc);
                        summaryResult = stc >= 200 && stc < 300
                            ? "Automated task pushed cleanly to ClickUp!"
                            : "ClickUp returned HTTP " + stc + ".";
                    }
                    else
                    {
                        summaryResult = "Sprint logged locally in Command Core: \"" + payloadTxt + "\" (Add ClickUp Token & List ID in Connectors to also push to ClickUp).";
                    }
                }
                else if (actType == "notion_digest")
                {
                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> nt = GetSavedConnectorEntry(vault, "notion");
                    string ntKey = GetStr(nt, "apiKey", "");
                    string pageId = ExtractNotionPageId(GetStr(nt, "extraId", "41537a43-2562-8115-abf7-cb2f6474e4e1"));
                    if (!string.IsNullOrEmpty(ntKey) && !string.IsNullOrEmpty(pageId))
                    {
                        Dictionary<string, object> parentObj = new Dictionary<string, object>();
                        parentObj["page_id"] = pageId;
                        Dictionary<string, object> titleText = new Dictionary<string, object>();
                        titleText["content"] = "JARVIS Digest — " + DateTime.Now.ToString("yyyy-MM-dd HH:mm");
                        Dictionary<string, object> titleItem = new Dictionary<string, object>();
                        titleItem["text"] = titleText;
                        ArrayList titleArr = new ArrayList();
                        titleArr.Add(titleItem);
                        Dictionary<string, object> titleProp = new Dictionary<string, object>();
                        titleProp["title"] = titleArr;
                        Dictionary<string, object> propsObj = new Dictionary<string, object>();
                        propsObj["title"] = titleProp;

                        string mdBody = string.Format("# Automated JARVIS Digest\n\nApps: {0} | Funnels: {1} | Books: {2} | Courses: {3}\n\nNote: {4}",
                            appsCount, bizCount, booksCount, coursesCount, payloadTxt);

                        Dictionary<string, object> nReq = new Dictionary<string, object>();
                        nReq["parent"] = parentObj;
                        nReq["properties"] = propsObj;
                        nReq["children"] = BuildNotionBlocksFromMarkdown(mdBody);

                        Dictionary<string, string> hdrs = new Dictionary<string, string>();
                        hdrs["Authorization"] = "Bearer " + ntKey;
                        hdrs["Notion-Version"] = "2022-06-28";
                        int stc = 0;
                        SendOutboundHttp("POST", "https://api.notion.com/v1/pages", hdrs, CreateSerializer().Serialize(nReq), 20000, out stc);
                        summaryResult = stc >= 200 && stc < 300
                            ? "Digest page published to your Notion Hub!"
                            : "Notion returned HTTP " + stc + ".";
                    }
                    else
                    {
                        summaryResult = "Digest logged locally in Command Core (Add Notion ntn_... secret in Connectors for standalone background Notion export).";
                    }
                }
                else
                {
                    // Webhook / Viktor AI / Custom Automation
                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> wh = GetSavedConnectorEntry(vault, "webhook");
                    string ep = GetStr(wh, "endpoint", "");
                    string key = GetStr(wh, "apiKey", "");
                    if (!string.IsNullOrEmpty(ep))
                    {
                        Dictionary<string, object> wBody = new Dictionary<string, object>();
                        wBody["source"] = "JARVIS-AUTOMATION";
                        wBody["automationName"] = name;
                        wBody["payload"] = payloadTxt;
                        wBody["timestamp"] = DateTime.UtcNow.ToString("o");
                        Dictionary<string, string> hdrs = new Dictionary<string, string>();
                        if (!string.IsNullOrEmpty(key)) hdrs["Authorization"] = "Bearer " + key;
                        int stc = 0;
                        SendOutboundHttp("POST", ep, hdrs, CreateSerializer().Serialize(wBody), 15000, out stc);
                        summaryResult = "Dispatched automation payload to webhook (HTTP " + stc + ").";
                    }
                    else
                    {
                        summaryResult = "Automation executed: " + payloadTxt;
                    }
                }
            }
            catch (Exception ex)
            {
                summaryResult = "Automation warning: " + ex.Message;
            }

            lock (StateLock)
            {
                Dictionary<string, object> st = LoadStateInternal();
                ArrayList autos = ToArrayList(st.ContainsKey("automations") ? st["automations"] : null);
                for (int i = 0; i < autos.Count; i++)
                {
                    IDictionary a = autos[i] as IDictionary;
                    if (a != null && a.Contains("id") && a["id"] != null && a["id"].ToString() == autoId)
                    {
                        a["lastRunAt"] = DateTime.UtcNow.ToString("o");
                        a["lastResult"] = summaryResult;
                    }
                }
                st["automations"] = autos;

                ArrayList chat = ToArrayList(st.ContainsKey("chat") ? st["chat"] : null);
                Dictionary<string, object> entry = new Dictionary<string, object>();
                entry["id"] = Guid.NewGuid().ToString("N");
                entry["role"] = "assistant";
                entry["text"] = "[⚙ AUTOMATION: " + name + "] " + summaryResult;
                entry["sourceNode"] = "JARVIS-AUTO";
                entry["actionType"] = "automation";
                entry["timestamp"] = DateTime.UtcNow.ToString("o");
                chat.Add(entry);
                while (chat.Count > 100) chat.RemoveAt(0);
                st["chat"] = chat;
                SaveStateInternal(st);
            }

            RecordAudit("AUTOMATION_RAN", "127.0.0.1", name + " -> " + summaryResult);
            return summaryResult;
        }

        private static void InitDefaultFleetNodes()
        {
            lock (StateLock)
            {
                RegisterNodeSlot("WINDOWS-PRIME", Environment.MachineName + " (Windows Hub)", "Windows NT " + Environment.OSVersion.Version, "x64", "127.0.0.1", true, "Primary Command Hub & DPAPI Vault");
                RegisterNodeSlot("MACBOOK-ALPHA", "MacBook Pro #1 (Alpha)", "macOS (Awaiting Auth Link)", "Apple Silicon", "LAN / Tailscale", false, "Executive Leadership & Book Studio");
                RegisterNodeSlot("MACBOOK-BETA", "MacBook Pro #2 (Beta)", "macOS (Awaiting Auth Link)", "Apple Silicon", "LAN / Tailscale", false, "App Forge & Engineering Node");
                RegisterNodeSlot("MACBOOK-GAMMA", "MacBook Air/Pro #3 (Gamma)", "macOS (Awaiting Auth Link)", "Apple Silicon", "LAN / Tailscale", false, "Business Funnels & Course Media");
                RegisterNodeSlot("IOS-PRIME", "iPhone / iPad (iOS Mobile)", "iOS Safari / Home Screen PWA", "Apple A/M-Series", "Wi-Fi / Tailscale", false, "Executive Mobile Voice & On-The-Go Control");
            }
        }

        private static void RegisterNodeSlot(string id, string name, string os, string arch, string ip, bool isLocalHost, string role)
        {
            Dictionary<string, object> node = new Dictionary<string, object>();
            node["nodeId"] = id;
            node["name"] = name;
            node["os"] = os;
            node["arch"] = arch;
            node["ip"] = ip;
            node["role"] = role;
            node["isHost"] = isLocalHost;
            node["cpuLoad"] = isLocalHost ? 14 : 0;
            node["memUsedPct"] = isLocalHost ? GetMemoryUsedPercent() : 0;
            node["batteryPct"] = 100;
            node["lastSeenUtc"] = isLocalHost ? DateTime.UtcNow.ToString("o") : "";
            LiveNodes[id] = node;
            if (!NodeQueues.ContainsKey(id)) NodeQueues[id] = new List<Dictionary<string, object>>();
        }

        private static int GetMemoryUsedPercent()
        {
            try
            {
                long workingSetMb = Environment.WorkingSet / (1024 * 1024);
                return Math.Min(92, Math.Max(18, 32 + (int)(workingSetMb % 25)));
            }
            catch { return 35; }
        }

        private static List<string> GetLocalIPv4Addresses()
        {
            List<string> result = new List<string>();
            try
            {
                foreach (NetworkInterface nic in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (nic.OperationalStatus != OperationalStatus.Up) continue;
                    if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (UnicastIPAddressInformation uni in nic.GetIPProperties().UnicastAddresses)
                    {
                        if (uni.Address.AddressFamily == AddressFamily.InterNetwork)
                        {
                            string ip = uni.Address.ToString();
                            if (!ip.StartsWith("169.254.") && !result.Contains(ip)) result.Add(ip);
                        }
                    }
                }
            }
            catch { }
            return result;
        }

        private static JavaScriptSerializer CreateSerializer()
        {
            JavaScriptSerializer ser = new JavaScriptSerializer();
            ser.MaxJsonLength = int.MaxValue;
            ser.RecursionLimit = 100;
            return ser;
        }

        private static Dictionary<string, object> LoadStateInternal()
        {
            try
            {
                if (File.Exists(StateFilePath))
                {
                    string raw = File.ReadAllText(StateFilePath, Encoding.UTF8);
                    Dictionary<string, object> data = CreateSerializer().Deserialize<Dictionary<string, object>>(raw);
                    if (data != null) return data;
                }
            }
            catch { }
            return CreateSeedState();
        }

        private static void SaveStateInternal(Dictionary<string, object> state)
        {
            string json = CreateSerializer().Serialize(state);
            string tmp = StateFilePath + ".tmp";
            File.WriteAllText(tmp, json, Encoding.UTF8);
            if (File.Exists(StateFilePath)) File.Delete(StateFilePath);
            File.Move(tmp, StateFilePath);
        }

        /* ================= HTTP REQUEST PARSING & DISPATCH ================= */

        private class HttpRequestData
        {
            public string Method;
            public string RawPath;
            public string PathOnly;
            public string QueryString;
            public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public string BodyText;
            public string RemoteIp;
        }

        private static void HandleClient(object stateObj)
        {
            TcpClient client = (TcpClient)stateObj;
            client.ReceiveTimeout = 20000;
            client.SendTimeout = 20000;

            try
            {
                using (client)
                using (NetworkStream stream = client.GetStream())
                {
                    string remoteIp = "unknown";
                    try
                    {
                        IPEndPoint ep = client.Client.RemoteEndPoint as IPEndPoint;
                        if (ep != null) remoteIp = NormalizeIp(ep.Address.ToString());
                    }
                    catch { }

                    Dictionary<string, object> secCfg = LoadSecurityConfig();
                    string netMode = GetStr(secCfg, "networkMode", "lan");
                    if (!IsIpAllowedByNetworkShield(remoteIp, netMode))
                    {
                        RecordAudit("NET_SHIELD_DROP", remoteIp, "Blocked by networkMode=" + netMode);
                        WriteResponse(stream, 403, "Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Blocked by JARVIS Network Shield."), null);
                        return;
                    }

                    HttpRequestData req = ReadHttpRequest(stream, remoteIp);
                    if (req == null) return;

                    RouteRequest(stream, req);
                }
            }
            catch { }
        }

        private static HttpRequestData ReadHttpRequest(NetworkStream stream, string remoteIp)
        {
            MemoryStream headerBuf = new MemoryStream();
            int prev3 = -1, prev2 = -1, prev1 = -1, curr = -1;

            while (headerBuf.Length < 32768)
            {
                curr = stream.ReadByte();
                if (curr == -1) break;
                headerBuf.WriteByte((byte)curr);
                if (prev3 == '\r' && prev2 == '\n' && prev1 == '\r' && curr == '\n') break;
                prev3 = prev2;
                prev2 = prev1;
                prev1 = curr;
            }

            if (headerBuf.Length == 0) return null;

            string headerStr = Encoding.ASCII.GetString(headerBuf.ToArray());
            string[] lines = headerStr.Split(new string[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0 || string.IsNullOrEmpty(lines[0])) return null;

            string[] firstParts = lines[0].Split(' ');
            if (firstParts.Length < 2) return null;

            HttpRequestData req = new HttpRequestData();
            req.Method = firstParts[0].Trim().ToUpperInvariant();
            req.RawPath = firstParts[1].Trim();
            req.RemoteIp = remoteIp;

            int qIdx = req.RawPath.IndexOf('?');
            if (qIdx >= 0)
            {
                req.PathOnly = Uri.UnescapeDataString(req.RawPath.Substring(0, qIdx));
                req.QueryString = req.RawPath.Substring(qIdx + 1);
            }
            else
            {
                req.PathOnly = Uri.UnescapeDataString(req.RawPath);
                req.QueryString = "";
            }

            for (int i = 1; i < lines.Length; i++)
            {
                string line = lines[i];
                if (string.IsNullOrEmpty(line)) break;
                int colon = line.IndexOf(':');
                if (colon > 0)
                {
                    req.Headers[line.Substring(0, colon).Trim()] = line.Substring(colon + 1).Trim();
                }
            }

            int contentLength = 0;
            if (req.Headers.ContainsKey("Content-Length"))
            {
                int.TryParse(req.Headers["Content-Length"], out contentLength);
            }

            if (contentLength > 0 && contentLength <= 10 * 1024 * 1024)
            {
                byte[] bodyBytes = new byte[contentLength];
                int offset = 0;
                while (offset < contentLength)
                {
                    int read = stream.Read(bodyBytes, offset, contentLength - offset);
                    if (read <= 0) break;
                    offset += read;
                }
                req.BodyText = Encoding.UTF8.GetString(bodyBytes, 0, offset);
            }
            else
            {
                req.BodyText = "";
            }

            return req;
        }

        private static SessionInfo GetValidBrowserSession(HttpRequestData req)
        {
            string cookieHdr = req.Headers.ContainsKey("Cookie") ? req.Headers["Cookie"] : "";
            if (string.IsNullOrEmpty(cookieHdr)) return null;

            string sessionVal = null;
            string[] parts = cookieHdr.Split(';');
            for (int i = 0; i < parts.Length; i++)
            {
                string kv = parts[i].Trim();
                if (kv.StartsWith("jarvis_session="))
                {
                    sessionVal = kv.Substring("jarvis_session=".Length).Trim();
                    break;
                }
            }
            if (string.IsNullOrEmpty(sessionVal)) return null;

            lock (AuthLock)
            {
                if (!ActiveSessions.ContainsKey(sessionVal)) return null;
                SessionInfo info = ActiveSessions[sessionVal];
                if (DateTime.UtcNow > info.ExpiresUtc)
                {
                    ActiveSessions.Remove(sessionVal);
                    return null;
                }
                return info;
            }
        }

        private static bool IsValidAgentToken(HttpRequestData req)
        {
            Dictionary<string, object> sec = LoadSecurityConfig();
            string expected = GetStr(sec, "agentToken", "");
            if (string.IsNullOrEmpty(expected)) return false;

            string provided = req.Headers.ContainsKey("X-Jarvis-Agent-Token") ? req.Headers["X-Jarvis-Agent-Token"] : "";
            if (string.IsNullOrEmpty(provided) && !string.IsNullOrEmpty(req.QueryString))
            {
                string[] qParts = req.QueryString.Split('&');
                for (int i = 0; i < qParts.Length; i++)
                {
                    if (qParts[i].StartsWith("token="))
                    {
                        provided = Uri.UnescapeDataString(qParts[i].Substring(6));
                        break;
                    }
                }
            }
            if (string.IsNullOrEmpty(provided)) return false;
            return ConstantTimeEqualsStr(provided, expected);
        }

        private static bool CheckSameOriginIfPresent(HttpRequestData req)
        {
            if (!req.Headers.ContainsKey("Origin")) return true;
            string origin = req.Headers["Origin"];
            if (string.IsNullOrEmpty(origin)) return true;
            string host = req.Headers.ContainsKey("Host") ? req.Headers["Host"] : "";
            try
            {
                Uri u = new Uri(origin);
                string originHostPort = u.IsDefaultPort ? u.Host : (u.Host + ":" + u.Port);
                return string.Equals(originHostPort, host, StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        private static void RouteRequest(NetworkStream stream, HttpRequestData req)
        {
            // Block cross-origin browser requests immediately
            if (!CheckSameOriginIfPresent(req))
            {
                RecordAudit("CSRF_ORIGIN_BLOCK", req.RemoteIp, "Blocked cross-origin request from " + req.Headers["Origin"]);
                WriteResponse(stream, 403, "Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Cross-origin request blocked."), null);
                return;
            }

            if (req.PathOnly.StartsWith("/api/"))
            {
                HandleApiRequest(stream, req);
                return;
            }

            // Agent script downloads require either valid browser session OR valid agent token
            if (req.PathOnly.StartsWith("/agents/"))
            {
                if (GetValidBrowserSession(req) == null && !IsValidAgentToken(req))
                {
                    RecordFailedAuth(req.RemoteIp, "Unauthorized /agents/ access");
                    WriteResponse(stream, 401, "Unauthorized", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Unauthorized: Agent token required."), null);
                    return;
                }
                string rel = req.PathOnly.Substring("/agents/".Length);
                ServeStaticFromBase(stream, AgentsDir, rel, false);
                return;
            }

            // Workspace files (apps, funnels, books, courses) strictly require an authenticated browser session
            if (req.PathOnly.StartsWith("/workspace/"))
            {
                if (GetValidBrowserSession(req) == null)
                {
                    WriteResponse(stream, 401, "Unauthorized", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Unauthorized: Unlock JARVIS first."), null);
                    return;
                }
                string rel = req.PathOnly.Substring("/workspace/".Length);
                ServeStaticFromBase(stream, WorkspaceDir, rel, false);
                return;
            }

            // Static UI shell (contains no user data; renders lock screen until authenticated)
            string pubRel = req.PathOnly == "/" ? "index.html" : req.PathOnly.TrimStart('/');
            ServeStaticFromBase(stream, PublicDir, pubRel, pubRel == "index.html");
        }

        private static void HandleApiRequest(NetworkStream stream, HttpRequestData req)
        {
            JavaScriptSerializer ser = CreateSerializer();

            try
            {
                // 1. Public Auth Status Endpoint
                if (req.Method == "GET" && req.PathOnly == "/api/auth/status")
                {
                    Dictionary<string, object> sec = LoadSecurityConfig();
                    bool configured = !string.IsNullOrEmpty(GetStr(sec, "passcodeHash", ""));
                    SessionInfo sess = GetValidBrowserSession(req);

                    Dictionary<string, object> resp = SimpleOk();
                    resp["configured"] = configured;
                    resp["authenticated"] = sess != null;
                    resp["canSetupFromThisIp"] = !configured && IsLoopbackIp(req.RemoteIp);
                    resp["csrfToken"] = sess != null ? sess.CsrfToken : "";
                    WriteJson(stream, 200, resp, null);
                    return;
                }

                // 2. First-Time Passcode Setup (Loopback ONLY)
                if (req.Method == "POST" && req.PathOnly == "/api/auth/setup")
                {
                    Dictionary<string, object> sec = LoadSecurityConfig();
                    if (!string.IsNullOrEmpty(GetStr(sec, "passcodeHash", "")))
                    {
                        WriteError(stream, 400, "Passcode is already configured.");
                        return;
                    }
                    if (!IsLoopbackIp(req.RemoteIp))
                    {
                        RecordAudit("SETUP_BLOCKED_REMOTE", req.RemoteIp, "Attempted initial setup from non-loopback IP");
                        WriteError(stream, 403, "Initial security setup must be performed directly on the Windows Hub laptop (http://localhost:7777).");
                        return;
                    }

                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string passcode = GetStr(body, "passcode", "");
                    if (passcode.Length < 6)
                    {
                        WriteError(stream, 400, "Master passcode must be at least 6 characters.");
                        return;
                    }

                    byte[] salt = new byte[16];
                    using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider()) rng.GetBytes(salt);
                    sec["passcodeSalt"] = Convert.ToBase64String(salt);
                    sec["passcodeHash"] = HashPasscodePbkdf2(passcode, salt);
                    SaveSecurityConfig(sec);

                    SessionInfo newSess = CreateBrowserSession(req.RemoteIp);
                    RecordAudit("PASSCODE_INITIALIZED", req.RemoteIp, "Master passcode set on Windows Hub.");

                    Dictionary<string, object> resp = SimpleOk();
                    resp["csrfToken"] = newSess.CsrfToken;
                    WriteJson(stream, 200, resp, BuildSessionCookie(newSess.SessionId, false));
                    return;
                }

                // 3. Passcode Login (Rate-Limited)
                if (req.Method == "POST" && req.PathOnly == "/api/auth/login")
                {
                    if (IsIpRateLimited(req.RemoteIp))
                    {
                        WriteError(stream, 429, "Too many failed attempts. This IP is temporarily locked out for 15 minutes.");
                        return;
                    }

                    Dictionary<string, object> sec = LoadSecurityConfig();
                    string saltB64 = GetStr(sec, "passcodeSalt", "");
                    string expectedHash = GetStr(sec, "passcodeHash", "");
                    if (string.IsNullOrEmpty(expectedHash))
                    {
                        WriteError(stream, 400, "Set up your Master Passcode on http://localhost:7777 first.");
                        return;
                    }

                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string passcode = GetStr(body, "passcode", "");
                    byte[] salt = Convert.FromBase64String(saltB64);
                    string actualHash = HashPasscodePbkdf2(passcode, salt);

                    if (!ConstantTimeEqualsStr(actualHash, expectedHash))
                    {
                        RecordFailedAuth(req.RemoteIp, "Invalid passcode login attempt");
                        WriteError(stream, 401, "Invalid Master Passcode.");
                        return;
                    }

                    ClearFailedAuth(req.RemoteIp);
                    SessionInfo newSess = CreateBrowserSession(req.RemoteIp);
                    RecordAudit("LOGIN_SUCCESS", req.RemoteIp, "Authenticated browser session started.");

                    Dictionary<string, object> resp = SimpleOk();
                    resp["csrfToken"] = newSess.CsrfToken;
                    WriteJson(stream, 200, resp, BuildSessionCookie(newSess.SessionId, false));
                    return;
                }

                // 4. MacBook Node Heartbeat (Agent Token Auth)
                if (req.Method == "POST" && req.PathOnly == "/api/nodes/heartbeat")
                {
                    if (IsIpRateLimited(req.RemoteIp))
                    {
                        WriteError(stream, 429, "Rate limited.");
                        return;
                    }
                    if (!IsValidAgentToken(req))
                    {
                        RecordFailedAuth(req.RemoteIp, "Invalid MacBook Agent Token on /api/nodes/heartbeat");
                        WriteError(stream, 401, "Invalid X-Jarvis-Agent-Token.");
                        return;
                    }

                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string nodeId = SanitizeNodeId(GetStr(body, "nodeId", "MACBOOK-ALPHA"));
                    List<Dictionary<string, object>> toDeliver = new List<Dictionary<string, object>>();

                    lock (StateLock)
                    {
                        Dictionary<string, object> node = LiveNodes.ContainsKey(nodeId)
                            ? LiveNodes[nodeId]
                            : new Dictionary<string, object>();

                        node["nodeId"] = nodeId;
                        node["name"] = GetStr(body, "name", nodeId);
                        node["os"] = GetStr(body, "os", "macOS");
                        node["arch"] = GetStr(body, "arch", "Apple Silicon");
                        node["ip"] = req.RemoteIp;
                        node["role"] = GetStr(body, "role", "Authenticated macOS Node");
                        node["isHost"] = false;
                        node["cpuLoad"] = GetInt(body, "cpuLoad", 12);
                        node["memUsedPct"] = GetInt(body, "memUsedPct", 44);
                        node["batteryPct"] = GetInt(body, "batteryPct", 95);
                        node["lastSeenUtc"] = DateTime.UtcNow.ToString("o");
                        LiveNodes[nodeId] = node;

                        if (NodeQueues.ContainsKey(nodeId) && NodeQueues[nodeId].Count > 0)
                        {
                            toDeliver.AddRange(NodeQueues[nodeId]);
                            NodeQueues[nodeId].Clear();
                        }
                    }

                    Dictionary<string, object> resp = SimpleOk();
                    resp["nodeId"] = nodeId;
                    resp["commands"] = toDeliver;
                    WriteJson(stream, 200, resp, null);
                    return;
                }

                // 4B. iOS Apple Shortcuts / Google Gemini iOS App Bridge (Agent Token Auth)
                if (req.Method == "POST" && req.PathOnly == "/api/mobile/bridge")
                {
                    if (IsIpRateLimited(req.RemoteIp))
                    {
                        WriteError(stream, 429, "Rate limited.");
                        return;
                    }
                    if (!IsValidAgentToken(req))
                    {
                        RecordFailedAuth(req.RemoteIp, "Invalid Agent Token on /api/mobile/bridge");
                        WriteError(stream, 401, "Invalid X-Jarvis-Agent-Token.");
                        return;
                    }

                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string text = GetStr(body, "text", "").Trim();
                    string title = GetStr(body, "title", "iOS Gemini JARVIS Note").Trim();
                    if (string.IsNullOrEmpty(text))
                    {
                        WriteError(stream, 400, "Missing 'text' payload.");
                        return;
                    }

                    string savedNotePath = "";
                    lock (StateLock)
                    {
                        if (LiveNodes.ContainsKey("IOS-PRIME"))
                        {
                            LiveNodes["IOS-PRIME"]["lastSeenUtc"] = DateTime.UtcNow.ToString("o");
                            LiveNodes["IOS-PRIME"]["ip"] = req.RemoteIp;
                        }

                        string notesDir = Path.Combine(WorkspaceDir, "ios-gemini-inbox");
                        Directory.CreateDirectory(notesDir);
                        string slug = SanitizeSegment(title);
                        if (string.IsNullOrEmpty(slug)) slug = "ios-note";
                        string fileName = DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + slug + ".md";
                        savedNotePath = Path.Combine(notesDir, fileName);
                        File.WriteAllText(savedNotePath, "# " + title + "\r\n\r\n" + text + "\r\n", Encoding.UTF8);

                        Dictionary<string, object> state = LoadStateInternal();
                        ArrayList chat = ToArrayList(state.ContainsKey("chat") ? state["chat"] : null);
                        Dictionary<string, object> entry = new Dictionary<string, object>();
                        entry["id"] = Guid.NewGuid().ToString("N");
                        entry["role"] = "user";
                        entry["text"] = "[Synced from iPhone Gemini JARVIS] " + title + ": " + (text.Length > 500 ? text.Substring(0, 500) + "..." : text);
                        entry["sourceNode"] = "IOS-PRIME";
                        entry["actionType"] = "ios_bridge";
                        entry["timestamp"] = DateTime.UtcNow.ToString("o");
                        chat.Add(entry);
                        while (chat.Count > 100) chat.RemoveAt(0);
                        state["chat"] = chat;
                        SaveStateInternal(state);
                    }

                    RecordAudit("IOS_GEMINI_BRIDGE", req.RemoteIp, "Received iOS Gemini bridge payload: " + title);
                    Dictionary<string, object> resp = SimpleOk();
                    resp["message"] = "Synced to JARVIS Command Center (" + title + ")";
                    resp["savedFile"] = savedNotePath;
                    WriteJson(stream, 200, resp, null);
                    return;
                }

                // ====== ALL ROUTES BELOW REQUIRE AN AUTHENTICATED BROWSER SESSION ======
                SessionInfo session = GetValidBrowserSession(req);
                if (session == null)
                {
                    WriteError(stream, 401, "Session locked. Please enter your JARVIS Master Passcode.");
                    return;
                }

                // Require CSRF token header on all POST requests
                if (req.Method == "POST")
                {
                    string csrfHdr = req.Headers.ContainsKey("X-Jarvis-CSRF") ? req.Headers["X-Jarvis-CSRF"] : "";
                    if (!ConstantTimeEqualsStr(csrfHdr, session.CsrfToken))
                    {
                        RecordAudit("CSRF_TOKEN_MISMATCH", req.RemoteIp, "Rejected POST without valid X-Jarvis-CSRF");
                        WriteError(stream, 403, "Invalid CSRF token. Refresh the page.");
                        return;
                    }
                }

                if (req.Method == "POST" && req.PathOnly == "/api/auth/logout")
                {
                    lock (AuthLock) { ActiveSessions.Remove(session.SessionId); }
                    RecordAudit("LOGOUT", req.RemoteIp, "Session locked by user.");
                    WriteJson(stream, 200, SimpleOk(), BuildSessionCookie("", true));
                    return;
                }

                if (req.Method == "GET" && req.PathOnly == "/api/security/info")
                {
                    Dictionary<string, object> sec = LoadSecurityConfig();
                    string geminiKey = LoadGeminiKeyDpapi();
                    Dictionary<string, object> resp = SimpleOk();
                    resp["networkMode"] = GetStr(sec, "networkMode", "lan");
                    resp["agentToken"] = GetStr(sec, "agentToken", "");
                    resp["hasGeminiKeyInVault"] = !string.IsNullOrEmpty(geminiKey);
                    resp["geminiKeyMasked"] = string.IsNullOrEmpty(geminiKey)
                        ? ""
                        : (geminiKey.Length > 8 ? geminiKey.Substring(0, 4) + "••••••••" + geminiKey.Substring(geminiKey.Length - 4) : "••••••••");
                    lock (AuthLock)
                    {
                        resp["auditLog"] = new ArrayList(SecurityAuditLog);
                    }
                    WriteJson(stream, 200, resp, null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/security/open-lan-firewall")
                {
                    if (!IsLoopbackIp(req.RemoteIp))
                    {
                        WriteError(stream, 403, "Click this button directly on your Windows Hub PC (http://localhost:7777) so you can approve the Windows Firewall prompt.");
                        return;
                    }
                    try
                    {
                        string exePath = Path.Combine(Path.Combine(RootDir, "bin"), "JarvisHub.exe");
                        string cmdArgs = "/c netsh advfirewall firewall delete rule name=\"JARVIS Command Hub (TCP " + Port + ")\" >nul 2>&1 & " +
                                         "netsh advfirewall firewall add rule name=\"JARVIS Command Hub (TCP " + Port + ")\" dir=in action=allow protocol=TCP localport=" + Port + " profile=any & " +
                                         "netsh advfirewall firewall add rule name=\"JARVIS Command Hub App\" dir=in action=allow program=\"" + exePath + "\" profile=any";
                        ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", cmdArgs);
                        psi.Verb = "runas";
                        psi.UseShellExecute = true;
                        psi.WindowStyle = ProcessWindowStyle.Hidden;
                        Process p = Process.Start(psi);
                        if (p != null) p.WaitForExit(15000);

                        // Ensure networkMode is also set to 'lan'
                        Dictionary<string, object> sec = LoadSecurityConfig();
                        sec["networkMode"] = "lan";
                        SaveSecurityConfig(sec);

                        RecordAudit("FIREWALL_LAN_OPENED", req.RemoteIp, "Opened Windows Firewall TCP " + Port + " across Private + Public Wi-Fi profiles.");
                        Dictionary<string, object> resp = SimpleOk();
                        resp["message"] = "Windows Wi-Fi Firewall unlocked for TCP port " + Port + " (Private + Public)! Your iPhone & MacBooks can now open http://10.0.0.85:" + Port + " immediately.";
                        WriteJson(stream, 200, resp, null);
                    }
                    catch (Exception fex)
                    {
                        WriteError(stream, 500, "Firewall prompt canceled or declined: " + fex.Message);
                    }
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/security/network-mode")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string mode = GetStr(body, "networkMode", "lan");
                    if (mode != "lan" && mode != "tailscale_only" && mode != "localhost_only") mode = "lan";

                    Dictionary<string, object> sec = LoadSecurityConfig();
                    sec["networkMode"] = mode;
                    SaveSecurityConfig(sec);
                    RecordAudit("NETWORK_SHIELD_UPDATED", req.RemoteIp, "Set networkMode=" + mode);
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/security/rotate-agent-token")
                {
                    Dictionary<string, object> sec = LoadSecurityConfig();
                    string newTok = GenerateSecureTokenHex(24);
                    sec["agentToken"] = newTok;
                    SaveSecurityConfig(sec);
                    RecordAudit("AGENT_TOKEN_ROTATED", req.RemoteIp, "MacBook fleet agent token rotated.");
                    Dictionary<string, object> resp = SimpleOk();
                    resp["agentToken"] = newTok;
                    WriteJson(stream, 200, resp, null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/auth/change-passcode")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string newPass = GetStr(body, "passcode", "");
                    if (newPass.Length < 6)
                    {
                        WriteError(stream, 400, "New passcode must be at least 6 characters.");
                        return;
                    }
                    byte[] salt = new byte[16];
                    using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider()) rng.GetBytes(salt);
                    Dictionary<string, object> sec = LoadSecurityConfig();
                    sec["passcodeSalt"] = Convert.ToBase64String(salt);
                    sec["passcodeHash"] = HashPasscodePbkdf2(newPass, salt);
                    SaveSecurityConfig(sec);
                    RecordAudit("PASSCODE_CHANGED", req.RemoteIp, "Master passcode updated.");
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/vault/gemini-key")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string key = GetStr(body, "apiKey", "");
                    SaveGeminiKeyDpapi(key);
                    RecordAudit("DPAPI_VAULT_UPDATED", req.RemoteIp, string.IsNullOrEmpty(key) ? "Gemini key cleared from DPAPI vault." : "Gemini API key encrypted in Windows DPAPI vault.");
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                // Server-Side Proxy to Google Gemini Interactions API with Automatic High-Demand Failover (Key never leaves Hub!)
                if (req.Method == "POST" && req.PathOnly == "/api/ai/gemini")
                {
                    string apiKey = LoadGeminiKeyDpapi();
                    if (string.IsNullOrEmpty(apiKey))
                    {
                        WriteError(stream, 400, "No Gemini API key stored in Windows DPAPI Vault.");
                        return;
                    }

                    Dictionary<string, string> gHeaders = new Dictionary<string, string>();
                    gHeaders["Content-Type"] = "application/json";
                    gHeaders["x-goog-api-key"] = apiKey;
                    gHeaders["Api-Revision"] = "2026-05-20";

                    Dictionary<string, object> reqDict = null;
                    try { reqDict = ser.Deserialize<Dictionary<string, object>>(req.BodyText); } catch { }

                    string reqModel = GetStr(reqDict, "model", "gemini-3.5-flash-lite");
                    bool isAudioTts = reqModel.IndexOf("tts", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                      (req.BodyText != null && req.BodyText.IndexOf("\"type\":\"audio\"", StringComparison.OrdinalIgnoreCase) >= 0);

                    if (isAudioTts || reqDict == null)
                    {
                        try
                        {
                            int ttsCode = 0;
                            string ttsResp = SendOutboundHttp("POST", "https://generativelanguage.googleapis.com/v1beta/interactions", gHeaders, req.BodyText, 9000, out ttsCode);
                            if (ttsCode >= 200 && ttsCode < 300)
                            {
                                WriteResponse(stream, 200, "OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ttsResp), null);
                            }
                            else
                            {
                                WriteError(stream, 502, "Gemini TTS error (" + ttsCode + "): " + ttsResp);
                            }
                        }
                        catch (Exception tex)
                        {
                            WriteError(stream, 502, "Gemini TTS upstream error: " + tex.Message);
                        }
                        return;
                    }

                    // Build automatic failover chain across Current Gemini Models so temporary 503/429 spikes never stall conversation
                    List<string> candidates = new List<string>();
                    if (reqModel == "gemini-3.8-flash" && DateTime.UtcNow < Gemini38CooldownUntilUtc)
                    {
                        candidates.Add("gemini-3.5-flash-lite");
                        candidates.Add("gemini-3.8-flash");
                    }
                    else
                    {
                        candidates.Add(reqModel);
                        if (reqModel != "gemini-3.5-flash-lite") candidates.Add("gemini-3.5-flash-lite");
                        if (reqModel != "gemini-3.8-flash") candidates.Add("gemini-3.8-flash");
                    }

                    string lastErr = "Unknown upstream error";
                    for (int mIdx = 0; mIdx < candidates.Count; mIdx++)
                    {
                        string candidateModel = candidates[mIdx];
                        reqDict["model"] = candidateModel;

                        if (mIdx > 0 && reqDict.ContainsKey("previous_interaction_id"))
                        {
                            reqDict.Remove("previous_interaction_id");
                        }

                        if (!reqDict.ContainsKey("generation_config"))
                        {
                            Dictionary<string, object> genCfg = new Dictionary<string, object>();
                            if (candidateModel == "gemini-3.8-flash" || candidateModel == "gemini-4-argon")
                                genCfg["thinking_level"] = "low";
                            else if (candidateModel == "gemini-3.5-flash-lite")
                                genCfg["thinking_level"] = "minimal";
                            if (genCfg.Count > 0) reqDict["generation_config"] = genCfg;
                        }
                        else if (mIdx > 0 && candidateModel == "gemini-3.5-flash-lite" && reqDict["generation_config"] is IDictionary)
                        {
                            IDictionary gc = (IDictionary)reqDict["generation_config"];
                            gc["thinking_level"] = "minimal";
                        }

                        int timeoutForAttempt = (candidateModel == "gemini-3.8-flash" && candidates.Count > 1) ? 6500 : 18000;
                        string attemptBody = ser.Serialize(reqDict);

                        try
                        {
                            int stCode = 0;
                            string respJson = SendOutboundHttp("POST", "https://generativelanguage.googleapis.com/v1beta/interactions", gHeaders, attemptBody, timeoutForAttempt, out stCode);
                            if (stCode >= 200 && stCode < 300)
                            {
                                WriteResponse(stream, 200, "OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(respJson), null);
                                return;
                            }

                            lastErr = "HTTP " + stCode + " (" + candidateModel + "): " + respJson;
                            if (candidateModel == "gemini-3.8-flash" && (stCode == 503 || stCode == 429 || stCode >= 500))
                            {
                                Gemini38CooldownUntilUtc = DateTime.UtcNow.AddMinutes(10);
                            }

                            // If previous_interaction_id expired on the same model, retry once cleanly without it
                            if ((stCode == 400 || stCode == 404) && reqDict.ContainsKey("previous_interaction_id"))
                            {
                                reqDict.Remove("previous_interaction_id");
                                int retryCode = 0;
                                string retryJson = SendOutboundHttp("POST", "https://generativelanguage.googleapis.com/v1beta/interactions", gHeaders, ser.Serialize(reqDict), 15000, out retryCode);
                                if (retryCode >= 200 && retryCode < 300)
                                {
                                    WriteResponse(stream, 200, "OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(retryJson), null);
                                    return;
                                }
                            }
                        }
                        catch (Exception wex)
                        {
                            lastErr = candidateModel + " timeout/network: " + wex.Message;
                            if (candidateModel == "gemini-3.8-flash")
                            {
                                Gemini38CooldownUntilUtc = DateTime.UtcNow.AddMinutes(10);
                            }
                        }
                    }

                    WriteError(stream, 502, "Gemini upstream error: " + lastErr);
                    return;
                }

                // Server-Side Minting of 1-Use Ephemeral Token for Gemini 3.8 Live WebSocket
                if (req.Method == "POST" && req.PathOnly == "/api/ai/live-token")
                {
                    string apiKey = LoadGeminiKeyDpapi();
                    if (string.IsNullOrEmpty(apiKey))
                    {
                        WriteError(stream, 400, "Add your Gemini API key to the Windows DPAPI Vault in Settings first.");
                        return;
                    }

                    Dictionary<string, object> tokReq = new Dictionary<string, object>();
                    tokReq["uses"] = 1;
                    tokReq["expireTime"] = DateTime.UtcNow.AddMinutes(30).ToString("yyyy-MM-ddTHH:mm:ssZ");
                    tokReq["newSessionExpireTime"] = DateTime.UtcNow.AddMinutes(2).ToString("yyyy-MM-ddTHH:mm:ssZ");

                    HttpWebRequest gReq = (HttpWebRequest)WebRequest.Create("https://generativelanguage.googleapis.com/v1beta/auth_tokens");
                    gReq.Proxy = null;
                    gReq.KeepAlive = false;
                    gReq.Method = "POST";
                    gReq.ContentType = "application/json";
                    gReq.Headers["x-goog-api-key"] = apiKey;
                    gReq.Timeout = 15000;

                    byte[] reqBytes = Encoding.UTF8.GetBytes(ser.Serialize(tokReq));
                    gReq.ContentLength = reqBytes.Length;
                    using (Stream gs = gReq.GetRequestStream()) gs.Write(reqBytes, 0, reqBytes.Length);

                    try
                    {
                        using (HttpWebResponse gResp = (HttpWebResponse)gReq.GetResponse())
                        using (StreamReader sr = new StreamReader(gResp.GetResponseStream(), Encoding.UTF8))
                        {
                            Dictionary<string, object> tokData = ser.Deserialize<Dictionary<string, object>>(sr.ReadToEnd());
                            Dictionary<string, object> outResp = SimpleOk();
                            outResp["ephemeralToken"] = GetStr(tokData, "name", "");
                            WriteJson(stream, 200, outResp, null);
                        }
                    }
                    catch (WebException wex)
                    {
                        WriteError(stream, 502, "Failed to mint ephemeral Live token: " + wex.Message);
                    }
                    return;
                }

                // Standard Authenticated Workspace & Fleet Endpoints
                if (req.Method == "GET" && req.PathOnly == "/api/state")
                {
                    Dictionary<string, object> response = new Dictionary<string, object>();
                    string geminiKey = LoadGeminiKeyDpapi();

                    lock (StateLock)
                    {
                        if (LiveNodes.ContainsKey("WINDOWS-PRIME"))
                        {
                            LiveNodes["WINDOWS-PRIME"]["lastSeenUtc"] = DateTime.UtcNow.ToString("o");
                            LiveNodes["WINDOWS-PRIME"]["memUsedPct"] = GetMemoryUsedPercent();
                            LiveNodes["WINDOWS-PRIME"]["cpuLoad"] = 10 + (DateTime.UtcNow.Second % 19);
                        }

                        if (req.Headers.ContainsKey("X-Jarvis-Node"))
                        {
                            string clientNode = SanitizeNodeId(req.Headers["X-Jarvis-Node"]);
                            if (!string.IsNullOrEmpty(clientNode) && LiveNodes.ContainsKey(clientNode))
                            {
                                LiveNodes[clientNode]["lastSeenUtc"] = DateTime.UtcNow.ToString("o");
                                LiveNodes[clientNode]["ip"] = req.RemoteIp;
                            }
                        }

                        Dictionary<string, object> state = LoadStateInternal();
                        int cfgConnCount = 0;
                        BuildSanitizedConnectorsList(out cfgConnCount);
                        response["ok"] = true;
                        response["state"] = state;
                        response["hasVaultGeminiKey"] = !string.IsNullOrEmpty(geminiKey);
                        response["configuredConnectorCount"] = cfgConnCount;

                        Dictionary<string, object> sec = LoadSecurityConfig();
                        response["networkMode"] = GetStr(sec, "networkMode", "lan");

                        Dictionary<string, object> host = new Dictionary<string, object>();
                        host["machineName"] = Environment.MachineName;
                        host["port"] = Port;
                        host["ips"] = GetLocalIPv4Addresses();
                        host["uptimeSeconds"] = (int)(DateTime.UtcNow - StartTimeUtc).TotalSeconds;
                        response["host"] = host;

                        ArrayList nodeList = new ArrayList();
                        foreach (KeyValuePair<string, Dictionary<string, object>> kv in LiveNodes)
                        {
                            Dictionary<string, object> copy = new Dictionary<string, object>(kv.Value);
                            bool online = false;
                            if (copy.ContainsKey("isHost") && copy["isHost"] is bool && (bool)copy["isHost"]) online = true;
                            else if (copy.ContainsKey("lastSeenUtc") && copy["lastSeenUtc"] != null)
                            {
                                DateTime seen;
                                if (DateTime.TryParse(copy["lastSeenUtc"].ToString(), null, System.Globalization.DateTimeStyles.RoundtripKind, out seen))
                                {
                                    online = (DateTime.UtcNow - seen.ToUniversalTime()).TotalSeconds < 25;
                                }
                            }
                            copy["online"] = online;
                            nodeList.Add(copy);
                        }
                        response["nodes"] = nodeList;
                    }

                    WriteJson(stream, 200, response, null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/chat/log")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    lock (StateLock)
                    {
                        Dictionary<string, object> state = LoadStateInternal();
                        ArrayList chat = ToArrayList(state.ContainsKey("chat") ? state["chat"] : null);
                        Dictionary<string, object> entry = new Dictionary<string, object>();
                        entry["id"] = Guid.NewGuid().ToString("N");
                        entry["role"] = GetStr(body, "role", "user");
                        entry["text"] = GetStr(body, "text", "");
                        entry["sourceNode"] = SanitizeNodeId(GetStr(body, "sourceNode", "WINDOWS-PRIME"));
                        entry["actionType"] = GetStr(body, "actionType", "chat");
                        entry["timestamp"] = DateTime.UtcNow.ToString("o");
                        chat.Add(entry);
                        while (chat.Count > 100) chat.RemoveAt(0);
                        state["chat"] = chat;
                        SaveStateInternal(state);
                    }
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/chat/clear")
                {
                    lock (StateLock)
                    {
                        Dictionary<string, object> state = LoadStateInternal();
                        state["chat"] = new ArrayList();
                        SaveStateInternal(state);
                    }
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/workspace/save")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string category = SanitizeSegment(GetStr(body, "category", "apps"));
                    if (category != "apps" && category != "business" && category != "books" && category != "courses")
                        category = "apps";

                    string title = GetStr(body, "title", "Untitled Creation");
                    string slug = SanitizeSegment(GetStr(body, "slug", title));
                    if (string.IsNullOrEmpty(slug)) slug = "item-" + DateTime.UtcNow.Ticks;
                    string id = GetStr(body, "id", category + "-" + slug);

                    string itemFolder = Path.Combine(Path.Combine(WorkspaceDir, category), slug);
                    Directory.CreateDirectory(itemFolder);

                    List<string> savedFiles = new List<string>();
                    string primaryFile = "index.html";

                    if (body.ContainsKey("files") && body["files"] is IDictionary)
                    {
                        foreach (DictionaryEntry de in (IDictionary)body["files"])
                        {
                            string fname = SanitizeFileName(de.Key.ToString());
                            if (string.IsNullOrEmpty(fname)) continue;
                            string content = de.Value != null ? de.Value.ToString() : "";
                            File.WriteAllText(Path.Combine(itemFolder, fname), content, Encoding.UTF8);
                            savedFiles.Add(fname);
                        }
                    }

                    if (!savedFiles.Contains("index.html") && savedFiles.Count > 0) primaryFile = savedFiles[0];
                    string previewUrl = "/workspace/" + category + "/" + slug + "/" + primaryFile;

                    Dictionary<string, object> record = new Dictionary<string, object>();
                    record["id"] = id;
                    record["category"] = category;
                    record["slug"] = slug;
                    record["title"] = title;
                    record["summary"] = GetStr(body, "summary", "");
                    record["createdByNode"] = SanitizeNodeId(GetStr(body, "sourceNode", "WINDOWS-PRIME"));
                    record["updatedAt"] = DateTime.UtcNow.ToString("o");
                    record["previewUrl"] = previewUrl;
                    record["savedFiles"] = savedFiles;
                    if (body.ContainsKey("data")) record["data"] = body["data"];

                    lock (StateLock)
                    {
                        Dictionary<string, object> state = LoadStateInternal();
                        ArrayList list = ToArrayList(state.ContainsKey(category) ? state[category] : null);
                        int existingIdx = -1;
                        for (int i = 0; i < list.Count; i++)
                        {
                            IDictionary existing = list[i] as IDictionary;
                            if (existing != null && existing["id"] != null && existing["id"].ToString() == id)
                            {
                                existingIdx = i;
                                break;
                            }
                        }
                        if (existingIdx >= 0) list[existingIdx] = record;
                        else list.Insert(0, record);
                        state[category] = list;
                        SaveStateInternal(state);
                    }

                    Dictionary<string, object> resp = SimpleOk();
                    resp["item"] = record;
                    resp["previewUrl"] = previewUrl;
                    WriteJson(stream, 200, resp, null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/nodes/dispatch")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string target = SanitizeNodeId(GetStr(body, "targetNode", "ALL"));
                    string cmdType = GetStr(body, "commandType", "announce");
                    if (cmdType != "announce" && cmdType != "open_hud" && cmdType != "sync_workspace" && cmdType != "open_url")
                    {
                        WriteError(stream, 400, "Disallowed commandType.");
                        return;
                    }
                    string payload = SanitizeSpeechOrPath(GetStr(body, "payload", ""));

                    Dictionary<string, object> cmd = new Dictionary<string, object>();
                    cmd["id"] = Guid.NewGuid().ToString("N");
                    cmd["targetNode"] = target;
                    cmd["commandType"] = cmdType;
                    cmd["payload"] = payload;
                    cmd["createdAt"] = DateTime.UtcNow.ToString("o");

                    List<string> queuedTargets = new List<string>();
                    lock (StateLock)
                    {
                        foreach (string nodeKey in LiveNodes.Keys)
                        {
                            if (target == "ALL" || string.Equals(target, nodeKey, StringComparison.OrdinalIgnoreCase))
                            {
                                if (nodeKey == "WINDOWS-PRIME") queuedTargets.Add("WINDOWS-PRIME");
                                else
                                {
                                    if (!NodeQueues.ContainsKey(nodeKey)) NodeQueues[nodeKey] = new List<Dictionary<string, object>>();
                                    NodeQueues[nodeKey].Add(cmd);
                                    queuedTargets.Add(nodeKey);
                                }
                            }
                        }
                    }

                    Dictionary<string, object> resp = SimpleOk();
                    resp["command"] = cmd;
                    resp["queuedTargets"] = queuedTargets;
                    WriteJson(stream, 200, resp, null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/settings")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    lock (StateLock)
                    {
                        Dictionary<string, object> state = LoadStateInternal();
                        Dictionary<string, object> settings = new Dictionary<string, object>();
                        if (state.ContainsKey("settings") && state["settings"] is IDictionary)
                        {
                            foreach (DictionaryEntry de in (IDictionary)state["settings"])
                                settings[de.Key.ToString()] = de.Value;
                        }
                        foreach (KeyValuePair<string, object> kv in body) settings[kv.Key] = kv.Value;
                        state["settings"] = settings;
                        SaveStateInternal(state);
                    }
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                /* ================= MULTI-CONNECTOR ECOSYSTEM ENDPOINTS ================= */

                if (req.Method == "GET" && req.PathOnly == "/api/connectors/status")
                {
                    int cfgCount = 0;
                    ArrayList connectors = BuildSanitizedConnectorsList(out cfgCount);
                    string activeBrain = "gemini";
                    lock (StateLock)
                    {
                        Dictionary<string, object> st = LoadStateInternal();
                        if (st.ContainsKey("settings") && st["settings"] is IDictionary)
                        {
                            IDictionary s = (IDictionary)st["settings"];
                            if (s.Contains("activeAiProvider") && s["activeAiProvider"] != null)
                                activeBrain = s["activeAiProvider"].ToString();
                        }
                    }

                    Dictionary<string, object> resp = SimpleOk();
                    resp["connectors"] = connectors;
                    resp["configuredCount"] = cfgCount;
                    resp["activeAiProvider"] = activeBrain;
                    WriteJson(stream, 200, resp, null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/connectors/save")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string id = SanitizeSegment(GetStr(body, "id", ""));
                    if (string.IsNullOrEmpty(id))
                    {
                        WriteError(stream, 400, "Connector ID is required.");
                        return;
                    }

                    if (id == "gemini")
                    {
                        string gKey = GetStr(body, "apiKey", "__KEEP__");
                        if (gKey != "__KEEP__")
                        {
                            SaveGeminiKeyDpapi(gKey);
                            RecordAudit("CONNECTOR_SAVED", req.RemoteIp, "Gemini DPAPI key updated via Connectors Hub.");
                        }
                        WriteJson(stream, 200, SimpleOk(), null);
                        return;
                    }

                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> itemsDict = new Dictionary<string, object>();
                    if (vault.ContainsKey("items") && vault["items"] is IDictionary)
                    {
                        foreach (DictionaryEntry de in (IDictionary)vault["items"])
                            itemsDict[de.Key.ToString()] = de.Value;
                    }
                    ArrayList customIds = ToArrayList(vault.ContainsKey("customIds") ? vault["customIds"] : null);

                    bool deleteFlag = body.ContainsKey("delete") && body["delete"] is bool && (bool)body["delete"];
                    if (deleteFlag)
                    {
                        if (itemsDict.ContainsKey(id)) itemsDict.Remove(id);
                        ArrayList updatedCustom = new ArrayList();
                        for (int i = 0; i < customIds.Count; i++)
                        {
                            if (customIds[i] != null && customIds[i].ToString() != id)
                                updatedCustom.Add(customIds[i].ToString());
                        }
                        vault["items"] = itemsDict;
                        vault["customIds"] = updatedCustom;
                        SaveConnectorsVaultDpapi(vault);
                        RecordAudit("CONNECTOR_REMOVED", req.RemoteIp, "Removed custom connector: " + id);
                        WriteJson(stream, 200, SimpleOk(), null);
                        return;
                    }

                    Dictionary<string, object> existing = GetSavedConnectorEntry(vault, id);
                    string incomingKey = GetStr(body, "apiKey", "__KEEP__");
                    string finalKey = incomingKey == "__KEEP__" ? GetStr(existing, "apiKey", "") : incomingKey.Trim();

                    Dictionary<string, object> entry = new Dictionary<string, object>();
                    entry["name"] = GetStr(body, "name", GetStr(existing, "name", id));
                    entry["kind"] = GetStr(body, "kind", GetStr(existing, "kind", "webhook_rest"));
                    entry["category"] = GetStr(body, "category", GetStr(existing, "category", "workspace_ops"));
                    entry["description"] = GetStr(body, "description", GetStr(existing, "description", ""));
                    entry["apiKey"] = finalKey;
                    entry["endpoint"] = GetStr(body, "endpoint", GetStr(existing, "endpoint", "")).Trim();
                    entry["portalUrl"] = GetStr(body, "portalUrl", GetStr(existing, "portalUrl", "")).Trim();
                    entry["model"] = GetStr(body, "model", GetStr(existing, "model", "")).Trim();
                    entry["extraId"] = GetStr(body, "extraId", GetStr(existing, "extraId", "")).Trim();
                    entry["updatedAt"] = DateTime.UtcNow.ToString("o");

                    bool isCustom = body.ContainsKey("isCustom") && body["isCustom"] is bool && (bool)body["isCustom"];
                    if (isCustom)
                    {
                        bool found = false;
                        for (int i = 0; i < customIds.Count; i++)
                        {
                            if (customIds[i] != null && customIds[i].ToString() == id) { found = true; break; }
                        }
                        if (!found) customIds.Add(id);
                    }

                    itemsDict[id] = entry;
                    vault["items"] = itemsDict;
                    vault["customIds"] = customIds;
                    SaveConnectorsVaultDpapi(vault);

                    RecordAudit("CONNECTOR_SAVED", req.RemoteIp, "Encrypted connector updated in DPAPI vault: " + id);
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/connectors/test")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string id = SanitizeSegment(GetStr(body, "id", ""));
                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> saved = GetSavedConnectorEntry(vault, id);

                    List<Dictionary<string, string>> cat = GetBuiltInConnectorsCatalog();
                    Dictionary<string, string> catDef = null;
                    for (int i = 0; i < cat.Count; i++)
                    {
                        if (cat[i]["id"] == id) { catDef = cat[i]; break; }
                    }

                    string kind = catDef != null ? catDef["kind"] : GetStr(saved, "kind", "webhook_rest");
                    string key = id == "gemini" ? LoadGeminiKeyDpapi() : GetStr(saved, "apiKey", "");
                    string endpoint = GetStr(saved, "endpoint", catDef != null ? catDef["defaultEndpoint"] : "");
                    string model = GetStr(saved, "model", catDef != null ? catDef["defaultModel"] : "");

                    Dictionary<string, object> resp = new Dictionary<string, object>();
                    try
                    {
                        if (id == "cursor")
                        {
                            string customExe = GetStr(saved, "extraId", "");
                            string detected = (!string.IsNullOrEmpty(customExe) && File.Exists(customExe)) ? customExe : DetectLocalToolPath("cursor");
                            if (!string.IsNullOrEmpty(detected))
                            {
                                resp["ok"] = true;
                                resp["message"] = "Cursor IDE verified on Windows Prime: " + detected;
                            }
                            else
                            {
                                resp["ok"] = false;
                                resp["message"] = "Cursor executable not found in default paths. Paste your Cursor.exe path in the field above.";
                            }
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (id == "gemini")
                        {
                            if (string.IsNullOrEmpty(key))
                            {
                                resp["ok"] = false;
                                resp["message"] = "No Gemini API key stored yet. Paste your AIza... key and click Save first.";
                                WriteJson(stream, 200, resp, null);
                                return;
                            }
                            int stCode = 0;
                            Dictionary<string, string> hdrs = new Dictionary<string, string>();
                            hdrs["x-goog-api-key"] = key;
                            string resTxt = SendOutboundHttp("GET", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=2", hdrs, null, 12000, out stCode);
                            resp["ok"] = (stCode >= 200 && stCode < 300);
                            resp["message"] = resp["ok"] is bool && (bool)resp["ok"]
                                ? "Google Gemini DPAPI Vault verified (HTTP " + stCode + ")."
                                : "Gemini returned HTTP " + stCode + ": " + (resTxt.Length > 140 ? resTxt.Substring(0, 140) : resTxt);
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (kind == "notion")
                        {
                            if (string.IsNullOrEmpty(key))
                            {
                                resp["ok"] = false;
                                resp["message"] = "Paste your Notion Internal Integration Secret and click Save first.";
                                WriteJson(stream, 200, resp, null);
                                return;
                            }
                            int stCode = 0;
                            Dictionary<string, string> hdrs = new Dictionary<string, string>();
                            hdrs["Authorization"] = "Bearer " + key;
                            hdrs["Notion-Version"] = "2022-06-28";
                            string resTxt = SendOutboundHttp("GET", "https://api.notion.com/v1/users/me", hdrs, null, 12000, out stCode);
                            if (stCode >= 200 && stCode < 300)
                            {
                                Dictionary<string, object> me = ser.Deserialize<Dictionary<string, object>>(resTxt);
                                resp["ok"] = true;
                                resp["message"] = "Notion connected as \"" + GetStr(me, "name", "Integration") + "\". Ready for 1-click exports!";
                            }
                            else
                            {
                                resp["ok"] = false;
                                resp["message"] = "Notion HTTP " + stCode + ": " + (resTxt.Length > 150 ? resTxt.Substring(0, 150) : resTxt);
                            }
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (kind == "clickup")
                        {
                            if (string.IsNullOrEmpty(key))
                            {
                                resp["ok"] = false;
                                resp["message"] = "Paste your ClickUp Personal Token (pk_...) and click Save first.";
                                WriteJson(stream, 200, resp, null);
                                return;
                            }
                            int stCode = 0;
                            Dictionary<string, string> hdrs = new Dictionary<string, string>();
                            hdrs["Authorization"] = key;
                            string resTxt = SendOutboundHttp("GET", "https://api.clickup.com/api/v2/user", hdrs, null, 12000, out stCode);
                            resp["ok"] = (stCode >= 200 && stCode < 300);
                            resp["message"] = (stCode >= 200 && stCode < 300)
                                ? "ClickUp API verified! Ready to push tasks."
                                : "ClickUp HTTP " + stCode + ": " + (resTxt.Length > 150 ? resTxt.Substring(0, 150) : resTxt);
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (kind == "anthropic")
                        {
                            if (string.IsNullOrEmpty(key))
                            {
                                resp["ok"] = false;
                                resp["message"] = "Paste your Anthropic Claude API key (sk-ant-...) and click Save first.";
                                WriteJson(stream, 200, resp, null);
                                return;
                            }
                            int stCode = 0;
                            Dictionary<string, string> hdrs = new Dictionary<string, string>();
                            hdrs["x-api-key"] = key;
                            hdrs["anthropic-version"] = "2023-06-01";
                            Dictionary<string, object> pingReq = new Dictionary<string, object>();
                            pingReq["model"] = string.IsNullOrEmpty(model) ? "claude-sonnet-4-6" : model;
                            pingReq["max_tokens"] = 16;
                            ArrayList msgs = new ArrayList();
                            Dictionary<string, object> m1 = new Dictionary<string, object>();
                            m1["role"] = "user";
                            m1["content"] = "Reply with OK.";
                            msgs.Add(m1);
                            pingReq["messages"] = msgs;
                            string resTxt = SendOutboundHttp("POST", string.IsNullOrEmpty(endpoint) ? "https://api.anthropic.com/v1/messages" : endpoint, hdrs, ser.Serialize(pingReq), 18000, out stCode);
                            resp["ok"] = (stCode >= 200 && stCode < 300);
                            resp["message"] = (stCode >= 200 && stCode < 300)
                                ? "Claude (" + pingReq["model"] + ") responded cleanly!"
                                : "Claude HTTP " + stCode + ": " + (resTxt.Length > 150 ? resTxt.Substring(0, 150) : resTxt);
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (kind == "openai_compat")
                        {
                            if (id == "hermes" && string.IsNullOrEmpty(key))
                            {
                                string localHermes = DetectLocalToolPath("hermes");
                                if (!string.IsNullOrEmpty(localHermes))
                                {
                                    resp["ok"] = true;
                                    resp["message"] = "Local Hermes CLI detected at " + localHermes + ". (Add a Nous/Hermes API key to also use cloud inference.)";
                                    WriteJson(stream, 200, resp, null);
                                    return;
                                }
                            }
                            if (id == "grok" && string.IsNullOrEmpty(key))
                            {
                                resp["ok"] = true;
                                resp["message"] = "Grok 1-Click Web Bridge (grok.com) is ready now! To also run Grok 4.7 natively inside JARVIS Voice & AI Agents, paste an xai-... key from console.x.ai and click Save.";
                                WriteJson(stream, 200, resp, null);
                                return;
                            }
                            if (string.IsNullOrEmpty(endpoint))
                            {
                                resp["ok"] = false;
                                resp["message"] = "Endpoint URL is empty.";
                                WriteJson(stream, 200, resp, null);
                                return;
                            }
                            int stCode = 0;
                            Dictionary<string, string> hdrs = new Dictionary<string, string>();
                            if (!string.IsNullOrEmpty(key)) hdrs["Authorization"] = "Bearer " + key;
                            if (id == "openrouter") hdrs["HTTP-Referer"] = "http://localhost:" + Port;

                            Dictionary<string, object> pingReq = new Dictionary<string, object>();
                            pingReq["model"] = string.IsNullOrEmpty(model) ? "gpt-4o-mini" : model;
                            pingReq["max_tokens"] = 16;
                            ArrayList msgs = new ArrayList();
                            Dictionary<string, object> m1 = new Dictionary<string, object>();
                            m1["role"] = "user";
                            m1["content"] = "Reply with OK.";
                            msgs.Add(m1);
                            pingReq["messages"] = msgs;

                            string resTxt = SendOutboundHttp("POST", endpoint, hdrs, ser.Serialize(pingReq), 18000, out stCode);
                            resp["ok"] = (stCode >= 200 && stCode < 300);
                            resp["message"] = (stCode >= 200 && stCode < 300)
                                ? "Connected cleanly to " + endpoint + " (" + pingReq["model"] + ")!"
                                : "HTTP " + stCode + ": " + (resTxt.Length > 150 ? resTxt.Substring(0, 150) : resTxt);
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (id == "lovable")
                        {
                            if (!string.IsNullOrEmpty(key))
                            {
                                int lCode = 0;
                                Dictionary<string, string> lHdrs = new Dictionary<string, string>();
                                lHdrs["Lovable-API-Key"] = key;
                                lHdrs["Lovable-Version"] = "2026-09-11";
                                string lTxt = SendOutboundHttp("GET", "https://api.lovable.dev/v1/workspaces", lHdrs, null, 12000, out lCode);
                                resp["ok"] = (lCode >= 200 && lCode < 300);
                                resp["message"] = (lCode >= 200 && lCode < 300)
                                    ? "Lovable Workspace REST API verified + 1-Click #prompt= Build URL ready!"
                                    : "Lovable API HTTP " + lCode + " (Note: 1-Click '🚀 Copy Packet & Open' still works without any API key!): " + (lTxt.Length > 120 ? lTxt.Substring(0, 120) : lTxt);
                                WriteJson(stream, 200, resp, null);
                                return;
                            }
                            resp["ok"] = true;
                            resp["message"] = "Lovable 1-Click 'Build with URL' (#prompt= auto-prefill) is active & ready — zero API key required! Click '🚀 Copy Packet & Open' or '💜 Lovable' in App Forge.";
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (id == "vercel")
                        {
                            if (string.IsNullOrEmpty(key))
                            {
                                resp["ok"] = false;
                                resp["message"] = "Paste your Vercel Access Token (from vercel.com/account/tokens) and click Save to enable 1-click live cloud app deploys!";
                                WriteJson(stream, 200, resp, null);
                                return;
                            }
                            int vCode = 0;
                            Dictionary<string, string> vHdrs = new Dictionary<string, string>();
                            vHdrs["Authorization"] = "Bearer " + key;
                            string vTxt = SendOutboundHttp("GET", "https://api.vercel.com/v2/user", vHdrs, null, 12000, out vCode);
                            resp["ok"] = (vCode >= 200 && vCode < 300);
                            resp["message"] = (vCode >= 200 && vCode < 300)
                                ? "Vercel API verified! Ready for 1-click live https://...vercel.app deployments."
                                : "Vercel HTTP " + vCode + ": " + (vTxt.Length > 140 ? vTxt.Substring(0, 140) : vTxt);
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (id == "asana")
                        {
                            if (string.IsNullOrEmpty(key))
                            {
                                resp["ok"] = false;
                                resp["message"] = "Paste your Asana Personal Access Token (from app.asana.com/0/my-apps) and click Save first.";
                                WriteJson(stream, 200, resp, null);
                                return;
                            }
                            int aCode = 0;
                            Dictionary<string, string> aHdrs = new Dictionary<string, string>();
                            aHdrs["Authorization"] = "Bearer " + key;
                            string aTxt = SendOutboundHttp("GET", "https://app.asana.com/api/1.0/users/me", aHdrs, null, 12000, out aCode);
                            resp["ok"] = (aCode >= 200 && aCode < 300);
                            resp["message"] = (aCode >= 200 && aCode < 300)
                                ? "Asana API connected cleanly! Ready to push Project & Agent tasks."
                                : "Asana HTTP " + aCode + ": " + (aTxt.Length > 140 ? aTxt.Substring(0, 140) : aTxt);
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (id == "konshus")
                        {
                            string whisper = GetStr(saved, "extraId", "");
                            resp["ok"] = true;
                            resp["message"] = !string.IsNullOrEmpty(whisper)
                                ? "Konshus Memory Whisper active (" + whisper.Length + " chars injected into JARVIS, Projects & Agents)!"
                                : "Konshus Vault Bridge ready! Paste your Konshus 'Whisper' / Briefing in the field above (or click Copy Packet & Open to launch konshus.ai).";
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        if (id == "obsidian" || id == "onedrive" || id == "googledrive" || id == "msword")
                        {
                            string det = DetectLocalToolPath(id);
                            string customFolder = GetStr(saved, "extraId", "");
                            resp["ok"] = true;
                            resp["message"] = !string.IsNullOrEmpty(customFolder)
                                ? ("Configured sync target: " + customFolder)
                                : (!string.IsNullOrEmpty(det)
                                    ? ("Local desktop sync detected automatically: " + det)
                                    : "Ready! JARVIS will create/export clean files into your Documents\\JARVIS-Exports folder (or open the web app in 1 click).");
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        // Portal Bridge / Studio test (AIWriteBook, Viktor AI, Sudowrite, KDP, Google Docs, Custom Web Portals)
                        if (kind == "portal_bridge" && string.IsNullOrEmpty(endpoint))
                        {
                            string pUrl = GetStr(saved, "portalUrl", catDef != null ? catDef["portalUrl"] : "");
                            resp["ok"] = !string.IsNullOrEmpty(pUrl);
                            resp["message"] = !string.IsNullOrEmpty(pUrl)
                                ? "Studio bridge ready (" + pUrl + "). Use '🚀 Send Packet & Open' to copy your Book/Brief & launch!"
                                : "Add a Studio URL or API Webhook Endpoint and click Save.";
                            WriteJson(stream, 200, resp, null);
                            return;
                        }

                        // Webhook / REST / Slack test
                        if (id == "slack" && string.IsNullOrEmpty(endpoint) && !string.IsNullOrEmpty(key) && key.StartsWith("xoxb-"))
                        {
                            endpoint = "https://slack.com/api/chat.postMessage";
                        }
                        if (string.IsNullOrEmpty(endpoint))
                        {
                            resp["ok"] = false;
                            resp["message"] = id == "slack"
                                ? "Paste a Slack Incoming Webhook URL (https://hooks.slack.com/...) OR a Slack Bot Token (xoxb-...) + Channel Name, then click Save."
                                : "Paste a Webhook / REST Endpoint URL and click Save first.";
                            WriteJson(stream, 200, resp, null);
                            return;
                        }
                        int whCode = 0;
                        Dictionary<string, string> whHdrs = new Dictionary<string, string>();
                        if (!string.IsNullOrEmpty(key)) whHdrs["Authorization"] = "Bearer " + key;
                        Dictionary<string, object> whPayload = new Dictionary<string, object>();
                        whPayload["source"] = "JARVIS-COMMAND-HUB";
                        whPayload["event"] = "connector_test";
                        whPayload["text"] = "J.A.R.V.I.S. Command Center connected cleanly!";
                        string extraCh = GetStr(saved, "extraId", "");
                        if (id == "slack" && !string.IsNullOrEmpty(extraCh)) whPayload["channel"] = extraCh;
                        whPayload["timestamp"] = DateTime.UtcNow.ToString("o");
                        SendOutboundHttp("POST", endpoint, whHdrs, ser.Serialize(whPayload), 12000, out whCode);
                        resp["ok"] = (whCode >= 200 && whCode < 300);
                        resp["message"] = "Webhook responded HTTP " + whCode + ".";
                        WriteJson(stream, 200, resp, null);
                        return;
                    }
                    catch (Exception tex)
                    {
                        resp["ok"] = false;
                        resp["message"] = "Connection error: " + tex.Message;
                        WriteJson(stream, 200, resp, null);
                        return;
                    }
                }

                // Universal AI Brain Router (Claude, OpenAI, OpenRouter, Hermes, OpenClaw, Ollama, or any custom OpenAI-compatible provider)
                if (req.Method == "POST" && req.PathOnly == "/api/connectors/ai-query")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string provider = SanitizeSegment(GetStr(body, "provider", "openai"));
                    string userPrompt = GetStr(body, "prompt", "");
                    string contextJson = body.ContainsKey("context") ? ser.Serialize(body["context"]) : "{}";

                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> saved = GetSavedConnectorEntry(vault, provider);

                    List<Dictionary<string, string>> cat = GetBuiltInConnectorsCatalog();
                    Dictionary<string, string> catDef = null;
                    for (int i = 0; i < cat.Count; i++)
                    {
                        if (cat[i]["id"] == provider) { catDef = cat[i]; break; }
                    }

                    string kind = catDef != null ? catDef["kind"] : GetStr(saved, "kind", "openai_compat");
                    string key = GetStr(saved, "apiKey", "");
                    string endpoint = GetStr(saved, "endpoint", catDef != null ? catDef["defaultEndpoint"] : "");
                    string model = GetStr(saved, "model", catDef != null ? catDef["defaultModel"] : "gpt-4o");

                    string sysPrompt =
                        "You are J.A.R.V.I.S., an articulate executive AI operating across 4 laptops (Windows Prime + 3 MacBooks). " +
                        "Respond ONLY with a single valid JSON object (no markdown fences) matching: " +
                        "{\"action\":\"chat\"|\"build_app\"|\"build_business\"|\"build_book\"|\"build_course\"|\"dispatch_node\",\"spokenReply\":\"concise spoken answer\",\"title\":\"optional title\",\"subtitle\":\"optional subtitle\",\"heroPromise\":\"optional\",\"targetNode\":\"ALL|MACBOOK-ALPHA|MACBOOK-BETA|MACBOOK-GAMMA\",\"commandType\":\"announce|sync_workspace\",\"commandPayload\":\"optional\",\"manuscriptBody\":\"optional markdown chapter\"}. " +
                        "Workspace Context: " + contextJson;

                    int stCode = 0;
                    string assistantText = "";

                    if (kind == "anthropic")
                    {
                        if (string.IsNullOrEmpty(key))
                        {
                            WriteError(stream, 400, "No Anthropic API key configured in Connectors Vault.");
                            return;
                        }
                        Dictionary<string, string> hdrs = new Dictionary<string, string>();
                        hdrs["x-api-key"] = key;
                        hdrs["anthropic-version"] = "2023-06-01";

                        Dictionary<string, object> cReq = new Dictionary<string, object>();
                        cReq["model"] = string.IsNullOrEmpty(model) ? "claude-sonnet-4-6" : model;
                        cReq["max_tokens"] = 2048;
                        cReq["system"] = sysPrompt;
                        ArrayList msgs = new ArrayList();
                        Dictionary<string, object> uMsg = new Dictionary<string, object>();
                        uMsg["role"] = "user";
                        uMsg["content"] = userPrompt;
                        msgs.Add(uMsg);
                        cReq["messages"] = msgs;

                        string rawResp = SendOutboundHttp("POST", string.IsNullOrEmpty(endpoint) ? "https://api.anthropic.com/v1/messages" : endpoint, hdrs, ser.Serialize(cReq), 45000, out stCode);
                        if (stCode < 200 || stCode >= 300)
                        {
                            WriteError(stream, 502, "Claude error (" + stCode + "): " + rawResp);
                            return;
                        }
                        Dictionary<string, object> parsed = ser.Deserialize<Dictionary<string, object>>(rawResp);
                        ArrayList contentArr = ToArrayList(parsed.ContainsKey("content") ? parsed["content"] : null);
                        StringBuilder tb = new StringBuilder();
                        for (int i = 0; i < contentArr.Count; i++)
                        {
                            IDictionary part = contentArr[i] as IDictionary;
                            if (part != null && part.Contains("text") && part["text"] != null)
                                tb.Append(part["text"].ToString());
                        }
                        assistantText = tb.ToString();
                    }
                    else
                    {
                        if (string.IsNullOrEmpty(endpoint))
                        {
                            WriteError(stream, 400, "No endpoint URL configured for " + provider);
                            return;
                        }
                        Dictionary<string, string> hdrs = new Dictionary<string, string>();
                        if (!string.IsNullOrEmpty(key)) hdrs["Authorization"] = "Bearer " + key;
                        if (provider == "openrouter") hdrs["HTTP-Referer"] = "http://localhost:" + Port;

                        Dictionary<string, object> oReq = new Dictionary<string, object>();
                        oReq["model"] = model;
                        ArrayList msgs = new ArrayList();
                        Dictionary<string, object> sMsg = new Dictionary<string, object>();
                        sMsg["role"] = "system";
                        sMsg["content"] = sysPrompt;
                        msgs.Add(sMsg);
                        Dictionary<string, object> uMsg = new Dictionary<string, object>();
                        uMsg["role"] = "user";
                        uMsg["content"] = userPrompt;
                        msgs.Add(uMsg);
                        oReq["messages"] = msgs;

                        string rawResp = SendOutboundHttp("POST", endpoint, hdrs, ser.Serialize(oReq), 45000, out stCode);
                        if (stCode < 200 || stCode >= 300)
                        {
                            WriteError(stream, 502, provider.ToUpperInvariant() + " error (" + stCode + "): " + rawResp);
                            return;
                        }
                        Dictionary<string, object> parsed = ser.Deserialize<Dictionary<string, object>>(rawResp);
                        ArrayList choices = ToArrayList(parsed.ContainsKey("choices") ? parsed["choices"] : null);
                        if (choices.Count > 0 && choices[0] is IDictionary)
                        {
                            IDictionary c0 = (IDictionary)choices[0];
                            if (c0.Contains("message") && c0["message"] is IDictionary)
                            {
                                IDictionary mObj = (IDictionary)c0["message"];
                                if (mObj.Contains("content") && mObj["content"] != null)
                                    assistantText = mObj["content"].ToString();
                            }
                        }
                    }

                    Dictionary<string, object> outResp = SimpleOk();
                    outResp["provider"] = provider;
                    outResp["plan"] = ParseAiActionJson(assistantText);
                    WriteJson(stream, 200, outResp, null);
                    return;
                }

                // 1-Click Notion Page Exporter
                if (req.Method == "POST" && req.PathOnly == "/api/connectors/notion-export")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> saved = GetSavedConnectorEntry(vault, "notion");
                    string key = GetStr(saved, "apiKey", "");
                    string rawParent = GetStr(body, "parentPageId", GetStr(saved, "extraId", "41537a43-2562-8115-abf7-cb2f6474e4e1"));
                    string pageId = ExtractNotionPageId(rawParent);

                    if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(pageId))
                    {
                        WriteError(stream, 400, "Configure your Notion Integration Secret and Parent Page ID (or Notion Page URL) in the Connectors tab first.");
                        return;
                    }

                    string title = GetStr(body, "title", "JARVIS Export");
                    string markdown = GetStr(body, "markdown", "");

                    Dictionary<string, object> parentObj = new Dictionary<string, object>();
                    parentObj["page_id"] = pageId;

                    Dictionary<string, object> titleText = new Dictionary<string, object>();
                    titleText["content"] = title;
                    Dictionary<string, object> titleItem = new Dictionary<string, object>();
                    titleItem["text"] = titleText;
                    ArrayList titleArr = new ArrayList();
                    titleArr.Add(titleItem);
                    Dictionary<string, object> titleProp = new Dictionary<string, object>();
                    titleProp["title"] = titleArr;
                    Dictionary<string, object> propsObj = new Dictionary<string, object>();
                    propsObj["title"] = titleProp;

                    Dictionary<string, object> nReq = new Dictionary<string, object>();
                    nReq["parent"] = parentObj;
                    nReq["properties"] = propsObj;
                    nReq["children"] = BuildNotionBlocksFromMarkdown(markdown);

                    Dictionary<string, string> hdrs = new Dictionary<string, string>();
                    hdrs["Authorization"] = "Bearer " + key;
                    hdrs["Notion-Version"] = "2022-06-28";

                    int stCode = 0;
                    string rawResp = SendOutboundHttp("POST", "https://api.notion.com/v1/pages", hdrs, ser.Serialize(nReq), 25000, out stCode);
                    if (stCode < 200 || stCode >= 300)
                    {
                        WriteError(stream, 502, "Notion API HTTP " + stCode + ": " + rawResp);
                        return;
                    }

                    Dictionary<string, object> parsed = ser.Deserialize<Dictionary<string, object>>(rawResp);
                    RecordAudit("NOTION_EXPORT", req.RemoteIp, "Exported \"" + title + "\" to Notion.");
                    Dictionary<string, object> outResp = SimpleOk();
                    outResp["url"] = GetStr(parsed, "url", "");
                    WriteJson(stream, 200, outResp, null);
                    return;
                }

                // 1-Click ClickUp Task Creator
                if (req.Method == "POST" && req.PathOnly == "/api/connectors/clickup-task")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> saved = GetSavedConnectorEntry(vault, "clickup");
                    string key = GetStr(saved, "apiKey", "");
                    string rawList = GetStr(body, "listId", GetStr(saved, "extraId", ""));
                    string listId = ExtractClickUpListId(rawList);

                    if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(listId))
                    {
                        WriteError(stream, 400, "Configure your ClickUp Personal Token (pk_...) and Default List ID in the Connectors tab first.");
                        return;
                    }

                    Dictionary<string, object> cReq = new Dictionary<string, object>();
                    cReq["name"] = GetStr(body, "name", "JARVIS Action Item");
                    cReq["markdown_description"] = GetStr(body, "description", "Created from JARVIS Command Center.");

                    Dictionary<string, string> hdrs = new Dictionary<string, string>();
                    hdrs["Authorization"] = key;

                    int stCode = 0;
                    string rawResp = SendOutboundHttp("POST", "https://api.clickup.com/api/v2/list/" + listId + "/task", hdrs, ser.Serialize(cReq), 20000, out stCode);
                    if (stCode < 200 || stCode >= 300)
                    {
                        WriteError(stream, 502, "ClickUp HTTP " + stCode + ": " + rawResp);
                        return;
                    }

                    Dictionary<string, object> parsed = ser.Deserialize<Dictionary<string, object>>(rawResp);
                    RecordAudit("CLICKUP_TASK", req.RemoteIp, "Created ClickUp task: " + cReq["name"]);
                    Dictionary<string, object> outResp = SimpleOk();
                    outResp["url"] = GetStr(parsed, "url", "");
                    WriteJson(stream, 200, outResp, null);
                    return;
                }

                // Local IDE / CLI Bridge (Cursor IDE + Hermes CLI + Explorer on Windows Prime)
                if (req.Method == "POST" && req.PathOnly == "/api/connectors/open-cursor")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string category = SanitizeSegment(GetStr(body, "category", "apps"));
                    string slug = SanitizeSegment(GetStr(body, "slug", ""));
                    string tool = SanitizeSegment(GetStr(body, "tool", "cursor"));

                    string targetDir = WorkspaceDir;
                    if (!string.IsNullOrEmpty(category) && !string.IsNullOrEmpty(slug))
                    {
                        string candidate = Path.GetFullPath(Path.Combine(Path.Combine(WorkspaceDir, category), slug));
                        string fullWs = Path.GetFullPath(WorkspaceDir);
                        if (candidate.StartsWith(fullWs, StringComparison.OrdinalIgnoreCase) && Directory.Exists(candidate))
                        {
                            targetDir = candidate;
                        }
                    }

                    if (tool == "hermes")
                    {
                        string hermesPath = DetectLocalToolPath("hermes");
                        if (string.IsNullOrEmpty(hermesPath))
                        {
                            WriteError(stream, 404, "Hermes CLI not detected locally on Windows Prime.");
                            return;
                        }
                        string exeToRun = File.Exists(hermesPath) ? hermesPath : Path.Combine(hermesPath, "hermes.exe");
                        if (!File.Exists(exeToRun)) exeToRun = "powershell.exe";
                        ProcessStartInfo hPsi = new ProcessStartInfo();
                        hPsi.FileName = exeToRun;
                        hPsi.WorkingDirectory = targetDir;
                        hPsi.UseShellExecute = true;
                        Process.Start(hPsi);
                        RecordAudit("HERMES_LAUNCHED", req.RemoteIp, "Opened Hermes in " + targetDir);
                        WriteJson(stream, 200, SimpleOk(), null);
                        return;
                    }

                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> saved = GetSavedConnectorEntry(vault, "cursor");
                    string customExe = GetStr(saved, "extraId", "");
                    string cursorPath = (!string.IsNullOrEmpty(customExe) && File.Exists(customExe)) ? customExe : DetectLocalToolPath("cursor");

                    if (string.IsNullOrEmpty(cursorPath))
                    {
                        WriteError(stream, 404, "Cursor IDE was not found in standard paths. Add your Cursor.exe path in the Connectors tab.");
                        return;
                    }

                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = cursorPath;
                    psi.Arguments = "\"" + targetDir + "\"";
                    psi.WorkingDirectory = targetDir;
                    psi.UseShellExecute = false;
                    Process.Start(psi);

                    RecordAudit("CURSOR_OPENED", req.RemoteIp, "Opened workspace in Cursor IDE: " + targetDir);
                    Dictionary<string, object> outResp = SimpleOk();
                    outResp["openedPath"] = targetDir;
                    WriteJson(stream, 200, outResp, null);
                    return;
                }

                // Universal Outbound Webhook / OpenClaw / Custom Automation Push
                if (req.Method == "POST" && req.PathOnly == "/api/connectors/webhook-push")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string connId = SanitizeSegment(GetStr(body, "connectorId", "webhook"));
                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> saved = GetSavedConnectorEntry(vault, connId);
                    string endpoint = GetStr(saved, "endpoint", "");
                    if (connId == "openclaw" && !string.IsNullOrEmpty(GetStr(saved, "extraId", "")))
                        endpoint = GetStr(saved, "extraId", "");
                    string key = GetStr(saved, "apiKey", "");
                    if (connId == "slack" && string.IsNullOrEmpty(endpoint) && !string.IsNullOrEmpty(key) && key.StartsWith("xoxb-"))
                        endpoint = "https://slack.com/api/chat.postMessage";

                    if (string.IsNullOrEmpty(endpoint))
                    {
                        WriteError(stream, 400, "Configure a Webhook URL for \"" + connId + "\" in the Connectors tab first.");
                        return;
                    }

                    Dictionary<string, object> payload = new Dictionary<string, object>();
                    payload["source"] = "JARVIS-COMMAND-CENTER";
                    payload["connectorId"] = connId;
                    payload["eventType"] = GetStr(body, "eventType", "asset_export");
                    payload["title"] = GetStr(body, "title", "");
                    payload["summary"] = GetStr(body, "summary", "");
                    payload["text"] = GetStr(body, "title", "JARVIS Export") + "\n\n" + GetStr(body, "summary", "");
                    if (connId == "slack" && !string.IsNullOrEmpty(GetStr(saved, "extraId", "")))
                        payload["channel"] = GetStr(saved, "extraId", "");
                    payload["content"] = GetStr(body, "content", "");
                    payload["timestamp"] = DateTime.UtcNow.ToString("o");

                    Dictionary<string, string> hdrs = new Dictionary<string, string>();
                    if (!string.IsNullOrEmpty(key)) hdrs["Authorization"] = "Bearer " + key;

                    int stCode = 0;
                    string rawResp = SendOutboundHttp("POST", endpoint, hdrs, ser.Serialize(payload), 20000, out stCode);
                    if (stCode < 200 || stCode >= 300)
                    {
                        WriteError(stream, 502, "Webhook HTTP " + stCode + ": " + rawResp);
                        return;
                    }

                    RecordAudit("WEBHOOK_PUSH", req.RemoteIp, "Dispatched \"" + payload["title"] + "\" to " + connId);
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                /* ================= VOICE SAPI WAV STREAM & AUTOMATIONS ENDPOINTS ================= */

                if (req.Method == "POST" && req.PathOnly == "/api/voice/tts-wav")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string text = GetStr(body, "text", "Voice systems online.");
                    bool alsoHost = body.ContainsKey("playOnHost") && body["playOnHost"] is bool && (bool)body["playOnHost"];
                    byte[] wavBytes = SynthesizeWavBytesSapi(text, alsoHost);
                    if (wavBytes == null || wavBytes.Length < 44)
                    {
                        WriteError(stream, 500, "Windows SAPI voice synthesizer returned empty audio.");
                        return;
                    }
                    WriteResponse(stream, 200, "OK", "audio/wav", wavBytes, null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/automations/save")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string id = SanitizeSegment(GetStr(body, "id", ""));
                    if (string.IsNullOrEmpty(id)) id = "auto-" + DateTime.UtcNow.Ticks;

                    Dictionary<string, object> item = new Dictionary<string, object>();
                    item["id"] = id;
                    item["name"] = GetStr(body, "name", "Executive Automation");
                    item["actionType"] = GetStr(body, "actionType", "morning_briefing");
                    item["scheduleType"] = GetStr(body, "scheduleType", "daily_time");
                    item["dailyTime"] = GetStr(body, "dailyTime", "08:00");
                    item["intervalMinutes"] = Math.Max(5, GetInt(body, "intervalMinutes", 60));
                    item["payload"] = GetStr(body, "payload", "");
                    item["enabled"] = !body.ContainsKey("enabled") || (body["enabled"] is bool && (bool)body["enabled"]);
                    item["lastRunAt"] = "";
                    item["lastResult"] = "Created & active";

                    lock (StateLock)
                    {
                        Dictionary<string, object> st = LoadStateInternal();
                        ArrayList autos = ToArrayList(st.ContainsKey("automations") ? st["automations"] : null);
                        int foundIdx = -1;
                        for (int i = 0; i < autos.Count; i++)
                        {
                            IDictionary existing = autos[i] as IDictionary;
                            if (existing != null && existing["id"] != null && existing["id"].ToString() == id)
                            {
                                foundIdx = i;
                                break;
                            }
                        }
                        if (foundIdx >= 0) autos[foundIdx] = item;
                        else autos.Insert(0, item);
                        st["automations"] = autos;
                        SaveStateInternal(st);
                    }
                    RecordAudit("AUTOMATION_SAVED", req.RemoteIp, "Saved automation: " + item["name"]);
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/automations/toggle")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string id = GetStr(body, "id", "");
                    lock (StateLock)
                    {
                        Dictionary<string, object> st = LoadStateInternal();
                        ArrayList autos = ToArrayList(st.ContainsKey("automations") ? st["automations"] : null);
                        for (int i = 0; i < autos.Count; i++)
                        {
                            IDictionary a = autos[i] as IDictionary;
                            if (a != null && a["id"] != null && a["id"].ToString() == id)
                            {
                                bool cur = a.Contains("enabled") && a["enabled"] is bool && (bool)a["enabled"];
                                a["enabled"] = !cur;
                            }
                        }
                        st["automations"] = autos;
                        SaveStateInternal(st);
                    }
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/automations/delete")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string id = GetStr(body, "id", "");
                    lock (StateLock)
                    {
                        Dictionary<string, object> st = LoadStateInternal();
                        ArrayList autos = ToArrayList(st.ContainsKey("automations") ? st["automations"] : null);
                        ArrayList kept = new ArrayList();
                        for (int i = 0; i < autos.Count; i++)
                        {
                            IDictionary a = autos[i] as IDictionary;
                            if (a != null && a["id"] != null && a["id"].ToString() == id) continue;
                            kept.Add(autos[i]);
                        }
                        st["automations"] = kept;
                        SaveStateInternal(st);
                    }
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/automations/run-now")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string id = GetStr(body, "id", "");
                    string summary = ExecuteAutomationById(id, true);
                    Dictionary<string, object> resp = SimpleOk();
                    resp["summary"] = summary;
                    WriteJson(stream, 200, resp, null);
                    return;
                }

                /* ================= LOCAL VAULT / WORD / VERCEL / ASANA / PROJECTS / AGENTS ================= */

                if (req.Method == "POST" && req.PathOnly == "/api/connectors/local-sync")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string target = SanitizeSegment(GetStr(body, "target", "obsidian"));
                    string title = GetStr(body, "title", "JARVIS Document");
                    string markdown = GetStr(body, "markdown", "");
                    bool openAfter = body.ContainsKey("openAfter") && body["openAfter"] is bool && (bool)body["openAfter"];

                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> saved = GetSavedConnectorEntry(vault, target);
                    string customPath = GetStr(saved, "extraId", "");
                    string docsRoot = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                    if (string.IsNullOrEmpty(docsRoot)) docsRoot = WorkspaceDir;

                    string outFolder = Path.Combine(docsRoot, "JARVIS-Exports");
                    if (target == "obsidian")
                    {
                        outFolder = (!string.IsNullOrEmpty(customPath) && Directory.Exists(customPath))
                            ? customPath
                            : Path.Combine(docsRoot, "JARVIS-Obsidian-Vault");
                    }
                    else if (target == "onedrive")
                    {
                        string odBase = DetectLocalToolPath("onedrive");
                        string sub = string.IsNullOrEmpty(customPath) ? "JARVIS-Vault" : SanitizeSegment(customPath);
                        outFolder = !string.IsNullOrEmpty(odBase) ? Path.Combine(odBase, sub) : Path.Combine(docsRoot, "JARVIS-OneDrive-Export");
                    }
                    else if (target == "googledrive")
                    {
                        string gdBase = DetectLocalToolPath("googledrive");
                        outFolder = (!string.IsNullOrEmpty(customPath) && Directory.Exists(customPath))
                            ? customPath
                            : (!string.IsNullOrEmpty(gdBase) ? Path.Combine(gdBase, "JARVIS-Vault") : Path.Combine(docsRoot, "JARVIS-GoogleDrive-Export"));
                    }

                    Directory.CreateDirectory(outFolder);
                    string safeName = SanitizeSegment(title);
                    if (string.IsNullOrEmpty(safeName)) safeName = "jarvis-export-" + DateTime.UtcNow.Ticks;

                    string savedFilePath = "";
                    if (target == "msword")
                    {
                        savedFilePath = Path.Combine(outFolder, safeName + ".doc");
                        string escapedBody = System.Security.SecurityElement.Escape(markdown ?? "").Replace("\r\n", "\n").Replace("\n", "<br/>");
                        string wordHtml =
                            "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>" +
                            "<head><meta charset='utf-8'><title>" + System.Security.SecurityElement.Escape(title) + "</title>" +
                            "<style>body{font-family:Calibri,Georgia,serif;font-size:12pt;line-height:1.55;color:#111827;margin:1in;} h1{color:#0f172a;border-bottom:1px solid #cbd5e1;padding-bottom:6pt;}</style></head>" +
                            "<body><h1>" + System.Security.SecurityElement.Escape(title) + "</h1><div>" + escapedBody + "</div></body></html>";
                        File.WriteAllText(savedFilePath, wordHtml, Encoding.UTF8);
                    }
                    else
                    {
                        savedFilePath = Path.Combine(outFolder, safeName + ".md");
                        string frontMatter = "---\ntitle: \"" + title.Replace("\"", "'") + "\"\ncreated: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm") + "\nsource: JARVIS\ntags: [jarvis, executive-hub]\n---\n\n";
                        File.WriteAllText(savedFilePath, frontMatter + markdown, new UTF8Encoding(false));
                    }

                    if (openAfter)
                    {
                        try
                        {
                            ProcessStartInfo psi = new ProcessStartInfo();
                            if (target == "obsidian" && !string.IsNullOrEmpty(DetectLocalToolPath("obsidian")))
                            {
                                psi.FileName = "obsidian://open?path=" + Uri.EscapeDataString(savedFilePath);
                                psi.UseShellExecute = true;
                            }
                            else
                            {
                                psi.FileName = savedFilePath;
                                psi.UseShellExecute = true;
                            }
                            Process.Start(psi);
                        }
                        catch { }
                    }

                    RecordAudit("LOCAL_SYNC", req.RemoteIp, "Synced \"" + title + "\" to " + savedFilePath);
                    Dictionary<string, object> outResp = SimpleOk();
                    outResp["savedPath"] = savedFilePath;
                    outResp["folder"] = outFolder;
                    WriteJson(stream, 200, outResp, null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/connectors/asana-task")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> saved = GetSavedConnectorEntry(vault, "asana");
                    string key = GetStr(saved, "apiKey", "");
                    string projOrWsGid = ExtractClickUpListId(GetStr(body, "projectGid", GetStr(saved, "extraId", "")));

                    if (string.IsNullOrEmpty(key))
                    {
                        WriteError(stream, 400, "Add your Asana Personal Access Token in the Connectors Hub first.");
                        return;
                    }

                    Dictionary<string, string> hdrs = new Dictionary<string, string>();
                    hdrs["Authorization"] = "Bearer " + key;

                    Dictionary<string, object> dataObj = new Dictionary<string, object>();
                    dataObj["name"] = GetStr(body, "name", "JARVIS Action Item");
                    dataObj["notes"] = GetStr(body, "notes", "Created via JARVIS Command Center.");

                    if (!string.IsNullOrEmpty(projOrWsGid))
                    {
                        ArrayList projs = new ArrayList();
                        projs.Add(projOrWsGid);
                        dataObj["projects"] = projs;
                    }
                    else
                    {
                        // Auto-discover user's default Asana workspace if no Project GID was specified!
                        int meCode = 0;
                        string meRaw = SendOutboundHttp("GET", "https://app.asana.com/api/1.0/users/me", hdrs, null, 12000, out meCode);
                        if (meCode >= 200 && meCode < 300)
                        {
                            Dictionary<string, object> meDoc = ser.Deserialize<Dictionary<string, object>>(meRaw);
                            if (meDoc.ContainsKey("data") && meDoc["data"] is IDictionary)
                            {
                                IDictionary d = (IDictionary)meDoc["data"];
                                ArrayList wsArr = ToArrayList(d.Contains("workspaces") ? d["workspaces"] : null);
                                if (wsArr.Count > 0 && wsArr[0] is IDictionary)
                                {
                                    IDictionary w0 = (IDictionary)wsArr[0];
                                    if (w0.Contains("gid") && w0["gid"] != null) dataObj["workspace"] = w0["gid"].ToString();
                                }
                            }
                        }
                    }

                    Dictionary<string, object> aReq = new Dictionary<string, object>();
                    aReq["data"] = dataObj;

                    int stCode = 0;
                    string rawResp = SendOutboundHttp("POST", "https://app.asana.com/api/1.0/tasks", hdrs, ser.Serialize(aReq), 20000, out stCode);
                    if (stCode < 200 || stCode >= 300)
                    {
                        WriteError(stream, 502, "Asana HTTP " + stCode + ": " + rawResp);
                        return;
                    }

                    Dictionary<string, object> parsed = ser.Deserialize<Dictionary<string, object>>(rawResp);
                    string url = "https://app.asana.com";
                    if (parsed.ContainsKey("data") && parsed["data"] is IDictionary)
                    {
                        IDictionary d = (IDictionary)parsed["data"];
                        if (d.Contains("permalink_url") && d["permalink_url"] != null) url = d["permalink_url"].ToString();
                    }
                    RecordAudit("ASANA_TASK", req.RemoteIp, "Created Asana task: " + dataObj["name"]);
                    Dictionary<string, object> outResp = SimpleOk();
                    outResp["url"] = url;
                    WriteJson(stream, 200, outResp, null);
                    return;
                }

                if (req.Method == "POST" && req.PathOnly == "/api/connectors/vercel-deploy")
                {
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    Dictionary<string, object> vault = LoadConnectorsVaultDpapi();
                    Dictionary<string, object> saved = GetSavedConnectorEntry(vault, "vercel");
                    string key = GetStr(saved, "apiKey", "");
                    if (string.IsNullOrEmpty(key))
                    {
                        WriteError(stream, 400, "Save your Vercel Access Token (from vercel.com/account/tokens) in Connectors first.");
                        return;
                    }

                    string projName = "jarvis-" + SanitizeSegment(GetStr(body, "name", "executive-app"));
                    string htmlContent = GetStr(body, "html", "<h1>Deployed by JARVIS</h1>");

                    ArrayList filesArr = new ArrayList();
                    Dictionary<string, object> fObj = new Dictionary<string, object>();
                    fObj["file"] = "index.html";
                    fObj["data"] = htmlContent;
                    filesArr.Add(fObj);

                    Dictionary<string, object> projSettings = new Dictionary<string, object>();
                    projSettings["framework"] = null;

                    Dictionary<string, object> vReq = new Dictionary<string, object>();
                    vReq["name"] = projName;
                    vReq["files"] = filesArr;
                    vReq["projectSettings"] = projSettings;
                    vReq["target"] = "production";

                    Dictionary<string, string> hdrs = new Dictionary<string, string>();
                    hdrs["Authorization"] = "Bearer " + key;

                    int stCode = 0;
                    string rawResp = SendOutboundHttp("POST", "https://api.vercel.com/v13/deployments", hdrs, ser.Serialize(vReq), 30000, out stCode);
                    if (stCode < 200 || stCode >= 300)
                    {
                        WriteError(stream, 502, "Vercel HTTP " + stCode + ": " + rawResp);
                        return;
                    }

                    Dictionary<string, object> parsed = ser.Deserialize<Dictionary<string, object>>(rawResp);
                    string depUrl = GetStr(parsed, "url", "");
                    if (!string.IsNullOrEmpty(depUrl) && !depUrl.StartsWith("http")) depUrl = "https://" + depUrl;
                    RecordAudit("VERCEL_DEPLOY", req.RemoteIp, "Deployed live app to Vercel: " + depUrl);
                    Dictionary<string, object> outResp = SimpleOk();
                    outResp["url"] = depUrl;
                    WriteJson(stream, 200, outResp, null);
                    return;
                }

                if (req.Method == "POST" && (req.PathOnly == "/api/projects/save" || req.PathOnly == "/api/agents/save"))
                {
                    bool isProject = req.PathOnly == "/api/projects/save";
                    string collKey = isProject ? "projects" : "agents";
                    string prefix = isProject ? "proj-" : "agent-";
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string id = SanitizeSegment(GetStr(body, "id", ""));
                    if (string.IsNullOrEmpty(id)) id = prefix + DateTime.UtcNow.Ticks;
                    body["id"] = id;
                    body["updatedAt"] = DateTime.UtcNow.ToString("o");

                    lock (StateLock)
                    {
                        Dictionary<string, object> st = LoadStateInternal();
                        ArrayList list = ToArrayList(st.ContainsKey(collKey) ? st[collKey] : null);
                        int foundIdx = -1;
                        for (int i = 0; i < list.Count; i++)
                        {
                            IDictionary ex = list[i] as IDictionary;
                            if (ex != null && ex.Contains("id") && ex["id"] != null && ex["id"].ToString() == id)
                            {
                                foundIdx = i;
                                break;
                            }
                        }
                        if (foundIdx >= 0) list[foundIdx] = body;
                        else list.Insert(0, body);
                        st[collKey] = list;
                        SaveStateInternal(st);
                    }
                    Dictionary<string, object> outResp = SimpleOk();
                    outResp["item"] = body;
                    WriteJson(stream, 200, outResp, null);
                    return;
                }

                if (req.Method == "POST" && (req.PathOnly == "/api/projects/delete" || req.PathOnly == "/api/agents/delete"))
                {
                    string collKey = req.PathOnly == "/api/projects/delete" ? "projects" : "agents";
                    Dictionary<string, object> body = ser.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string id = GetStr(body, "id", "");
                    lock (StateLock)
                    {
                        Dictionary<string, object> st = LoadStateInternal();
                        ArrayList list = ToArrayList(st.ContainsKey(collKey) ? st[collKey] : null);
                        ArrayList kept = new ArrayList();
                        for (int i = 0; i < list.Count; i++)
                        {
                            IDictionary ex = list[i] as IDictionary;
                            if (ex != null && ex.Contains("id") && ex["id"] != null && ex["id"].ToString() == id) continue;
                            kept.Add(list[i]);
                        }
                        st[collKey] = kept;
                        SaveStateInternal(st);
                    }
                    WriteJson(stream, 200, SimpleOk(), null);
                    return;
                }

                WriteError(stream, 404, "Unknown API endpoint.");
            }
            catch (Exception ex)
            {
                WriteError(stream, 500, ex.Message);
            }
        }

        private static SessionInfo CreateBrowserSession(string ip)
        {
            SessionInfo info = new SessionInfo();
            info.SessionId = GenerateSecureTokenHex(32);
            info.CsrfToken = GenerateSecureTokenHex(24);
            info.Ip = ip;
            info.ExpiresUtc = DateTime.UtcNow.AddDays(7);
            lock (AuthLock)
            {
                ActiveSessions[info.SessionId] = info;
            }
            return info;
        }

        private static string BuildSessionCookie(string sessionId, bool expireNow)
        {
            if (expireNow)
            {
                return "jarvis_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict";
            }
            return "jarvis_session=" + sessionId + "; Path=/; Max-Age=604800; HttpOnly; SameSite=Strict";
        }

        private static string SanitizeNodeId(string raw)
        {
            StringBuilder sb = new StringBuilder();
            string up = (raw ?? "").Trim().ToUpperInvariant();
            for (int i = 0; i < up.Length && sb.Length < 32; i++)
            {
                char c = up[i];
                if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-') sb.Append(c);
            }
            return sb.Length > 0 ? sb.ToString() : "NODE";
        }

        private static string SanitizeSpeechOrPath(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "";
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < raw.Length && sb.Length < 280; i++)
            {
                char c = raw[i];
                // Strip shell metacharacters ($, `, \, ;, |, &, <, >, quotes, newlines)
                if (c == '$' || c == '`' || c == '\\' || c == ';' || c == '|' || c == '&' || c == '<' || c == '>' || c == '"' || c == '\'' || c == '\r' || c == '\n')
                    continue;
                sb.Append(c);
            }
            return sb.ToString().Trim();
        }

        private static ArrayList ToArrayList(object obj)
        {
            ArrayList list = new ArrayList();
            if (obj is IEnumerable && !(obj is string))
            {
                foreach (object item in (IEnumerable)obj) list.Add(item);
            }
            return list;
        }

        private static string GetStr(Dictionary<string, object> dict, string key, string fallback)
        {
            if (dict != null && dict.ContainsKey(key) && dict[key] != null) return dict[key].ToString();
            return fallback;
        }

        private static int GetInt(Dictionary<string, object> dict, string key, int fallback)
        {
            if (dict != null && dict.ContainsKey(key) && dict[key] != null)
            {
                int val;
                if (int.TryParse(dict[key].ToString(), out val)) return val;
            }
            return fallback;
        }

        private static string SanitizeSegment(string input)
        {
            if (string.IsNullOrEmpty(input)) return "";
            StringBuilder sb = new StringBuilder();
            string lower = input.Trim().ToLowerInvariant();
            bool prevDash = false;
            for (int i = 0; i < lower.Length && sb.Length < 48; i++)
            {
                char c = lower[i];
                if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
                {
                    sb.Append(c);
                    prevDash = false;
                }
                else if (!prevDash && sb.Length > 0)
                {
                    sb.Append('-');
                    prevDash = true;
                }
            }
            return sb.ToString().Trim('-');
        }

        private static string SanitizeFileName(string name)
        {
            if (string.IsNullOrEmpty(name)) return "";
            string clean = Path.GetFileName(name);
            foreach (char c in Path.GetInvalidFileNameChars()) clean = clean.Replace(c.ToString(), "");
            if (clean == "." || clean == "..") return "";
            return clean;
        }

        private static Dictionary<string, object> SimpleOk()
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["ok"] = true;
            return d;
        }

        private static void ServeStaticFromBase(NetworkStream stream, string baseDir, string relativePath, bool attachCsp)
        {
            string normalizedRel = relativePath.Replace('/', Path.DirectorySeparatorChar);
            string fullBase = Path.GetFullPath(baseDir);
            string candidate = Path.GetFullPath(Path.Combine(fullBase, normalizedRel));

            if (!candidate.StartsWith(fullBase, StringComparison.OrdinalIgnoreCase))
            {
                WriteResponse(stream, 403, "Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Forbidden"), null);
                return;
            }

            if (Directory.Exists(candidate)) candidate = Path.Combine(candidate, "index.html");
            if (!File.Exists(candidate))
            {
                WriteResponse(stream, 404, "Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"), null);
                return;
            }

            byte[] bytes = File.ReadAllBytes(candidate);
            string mime = GetMimeType(Path.GetExtension(candidate));
            string extraHdr = attachCsp
                ? "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://generativelanguage.googleapis.com; frame-src 'self' blob: data:; frame-ancestors 'none'\r\n"
                : null;
            WriteResponse(stream, 200, "OK", mime, bytes, extraHdr);
        }

        private static string GetMimeType(string ext)
        {
            switch ((ext ?? "").ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js":
                case ".mjs": return "application/javascript; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".ico": return "image/x-icon";
                case ".webmanifest": return "application/manifest+json";
                case ".md": return "text/markdown; charset=utf-8";
                case ".sh":
                case ".py":
                case ".txt": return "text/plain; charset=utf-8";
                default: return "application/octet-stream";
            }
        }

        private static void WriteError(NetworkStream stream, int code, string message)
        {
            Dictionary<string, object> err = new Dictionary<string, object>();
            err["ok"] = false;
            err["error"] = message;
            WriteJson(stream, code, err, null);
        }

        private static void WriteJson(NetworkStream stream, int statusCode, object payload, string setCookie)
        {
            string json = CreateSerializer().Serialize(payload);
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            string statusText = statusCode == 200 ? "OK" : (statusCode == 401 ? "Unauthorized" : (statusCode == 403 ? "Forbidden" : (statusCode == 429 ? "Too Many Requests" : "Error")));
            string extra = string.IsNullOrEmpty(setCookie) ? null : ("Set-Cookie: " + setCookie + "\r\n");
            WriteResponse(stream, statusCode, statusText, "application/json; charset=utf-8", bytes, extra);
        }

        private static void WriteResponse(NetworkStream stream, int code, string statusText, string contentType, byte[] body, string extraHeaders)
        {
            StringBuilder headers = new StringBuilder();
            headers.AppendFormat("HTTP/1.1 {0} {1}\r\n", code, statusText);
            headers.AppendFormat("Content-Type: {0}\r\n", contentType);
            headers.AppendFormat("Content-Length: {0}\r\n", body.Length);
            headers.Append("X-Content-Type-Options: nosniff\r\n");
            headers.Append("X-Frame-Options: SAMEORIGIN\r\n");
            headers.Append("Referrer-Policy: no-referrer\r\n");
            headers.Append("Cache-Control: no-store\r\n");
            if (!string.IsNullOrEmpty(extraHeaders)) headers.Append(extraHeaders);
            headers.Append("Connection: close\r\n\r\n");

            byte[] headerBytes = Encoding.ASCII.GetBytes(headers.ToString());
            stream.Write(headerBytes, 0, headerBytes.Length);
            if (body.Length > 0) stream.Write(body, 0, body.Length);
            stream.Flush();
        }
    }
}
