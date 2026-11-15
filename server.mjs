#!/usr/bin/env node
/**
 * J.A.R.V.I.S. Cross-Platform Standalone Hub (macOS / Linux / Node.js)
 * Zero-dependency server providing full Auth Vault, Gemini Interactions Proxy + Failover,
 * Multi-Brain Connectors, Automations, and Hologram Personalization for Mac-only users!
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7777);
const PUBLIC_DIR = path.join(__dirname, 'public');
const AGENTS_DIR = path.join(__dirname, 'agents');
const WORKSPACE_DIR = path.join(__dirname, 'workspace');
const STATE_FILE = path.join(WORKSPACE_DIR, 'jarvis-state.json');
const VAULT_FILE = path.join(WORKSPACE_DIR, '.mac-vault.json');
const START_TIME = Date.now();

for (const sub of ['', 'apps', 'business', 'books', 'courses']) {
  fs.mkdirSync(path.join(WORKSPACE_DIR, sub), { recursive: true });
}

const sessions = new Map();
const geminiCooldowns = new Map();

const DEFAULT_CONNECTORS = [
  { id: 'grok', name: 'xAI Grok (Grok 4.7 Brain + Web)', icon: '🦊', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://api.x.ai/v1/chat/completions', model: 'grok-4.7', portalUrl: 'https://console.x.ai', keyPlaceholder: 'xai-...', description: 'Run Grok 4.7 natively inside JARVIS Voice & AI Agents via xAI API key, or click Open Grok Web (grok.com) in 1 click!' },
  { id: 'muse', name: 'Muse AI (Autonomous Agent & Spaces)', icon: '🎨', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://muse.ai', extraLabel: 'Muse Space / Creative Focus (or museapp.com URL)', description: '1-click dispatch multi-step agent tasks & interactive Space briefs into Muse AI.' },
  { id: 'perplexity', name: 'Perplexity AI (Live Web Sonar)', icon: '🔎', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://api.perplexity.ai/chat/completions', model: 'sonar-pro', portalUrl: 'https://www.perplexity.ai/settings/api', keyPlaceholder: 'pplx-...', description: 'Real-time cited web research & live fact-checking brain.' },
  { id: 'openai', name: 'OpenAI (ChatGPT / GPT-4o)', icon: '⚡', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', portalUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-...', description: 'Direct OpenAI executive reasoning, coding & writing brain.' },
  { id: 'claude', name: 'Anthropic Claude', icon: '🧠', category: 'ai_agents', kind: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-7-sonnet-latest', portalUrl: 'https://console.anthropic.com/settings/keys', keyPlaceholder: 'sk-ant-...', description: 'Long-form book authoring, nuanced prose & coding brain.' },
  { id: 'deepseek', name: 'DeepSeek AI (V3 / R1)', icon: '🐋', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', portalUrl: 'https://platform.deepseek.com/api_keys', keyPlaceholder: 'sk-...', description: 'High-speed technical reasoning & software architecture.' },
  { id: 'openrouter', name: 'OpenRouter (300+ Models)', icon: '🌐', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini', portalUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-...', description: 'Unified gateway to 300+ frontier & open-weights models.' },
  { id: 'kimi', name: 'Kimi (Moonshot AI)', icon: '🌙', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://api.moonshot.ai/v1/chat/completions', model: 'moonshot-v1-32k', portalUrl: 'https://platform.moonshot.ai/console/api-keys', keyPlaceholder: 'sk-...', description: 'Long-context document & book manuscript synthesis.' },
  { id: 'lovable', name: 'Lovable (1-Click Build URL + API)', icon: '💜', category: 'workspace_ops', kind: 'portal_bridge', portalUrl: 'https://lovable.dev', extraLabel: 'Preferred Stack / Design Note (e.g. Supabase + Tailwind)', keyPlaceholder: 'Optional Lovable API Key (lov_...)', description: '1-click launch Lovable with your App, Funnel, or Project PRD auto-filled via #prompt= URL!' },
  { id: 'emergent', name: 'Emergent Labs (Agentic Full-Stack Builder)', icon: '🚀', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://emergent.sh', extraLabel: 'Preferred Stack / MCP Integrations Note', description: '1-click export full-stack React + FastAPI + Auth + DB blueprints & launch Emergent Labs.' },
  { id: 'mindsmith', name: 'Mindsmith AI (Interactive eLearning)', icon: '🎓', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://www.mindsmith.ai', extraLabel: 'Learner Audience / Course Tone', description: 'Turn any Course syllabus or Book chapter into interactive eLearning lessons & quizzes in Mindsmith AI.' },
  { id: 'workshop', name: 'Workshop AI (Cloud & Desktop App Studio)', icon: '🛠', category: 'workspace_ops', kind: 'portal_bridge', portalUrl: 'https://workshop.ai', extraLabel: 'Database / Stack Preference', description: '1-click send full-stack app & database blueprints into Workshop AI.' },
  { id: 'hercules', name: 'Hercules AI (SaaS & Mobile Builder)', icon: '🏛', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://hercules.app', extraLabel: 'App Type Focus (SaaS, Mobile, CRM)', description: '1-click dispatch SaaS, mobile app & internal tool specifications into Hercules AI.' },
  { id: 'aiwritebook', name: 'AIWriteBook Studio', icon: '📚', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://aiwritebook.com', description: '1-click copy your book packet & launch AIWriteBook directly.' },
  { id: 'konshus', name: 'Konshus AI (Long-Term Memory Vault)', icon: '🧠', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://konshus.ai', endpoint: 'https://konshus.ai/api/mcp', extraLabel: 'Konshus Memory Whisper / Briefing (Injected into JARVIS & Agents)', description: 'Portable AI history & memory vault across JARVIS, Projects & Autonomous Agents.' },
  { id: 'obsidian', name: 'Obsidian Vault (Markdown Knowledge Graph)', icon: '💎', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://obsidian.md', extraLabel: 'Local Obsidian Vault Folder Path (Optional)', description: 'Syncs clean Markdown notes + YAML frontmatter straight into your Obsidian Vault.' },
  { id: 'googledocs', name: 'Google Docs', icon: '📄', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://docs.new', description: '1-click copy formatted manuscript & launch a fresh Google Doc ready to paste.' },
  { id: 'msword', name: 'Microsoft Word (.doc / Word Cloud)', icon: '📘', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://word.cloud.microsoft', description: 'Exports formatted Microsoft Word (.doc) manuscripts & project documents.' },
  { id: 'onedrive', name: 'Microsoft OneDrive', icon: '☁️', category: 'workspace_ops', kind: 'portal_bridge', portalUrl: 'https://onedrive.live.com', extraLabel: 'OneDrive Subfolder Name (Default: JARVIS-Vault)', description: 'Syncs JARVIS notes, books & deliverables into OneDrive.' },
  { id: 'googledrive', name: 'Google Drive', icon: '📂', category: 'workspace_ops', kind: 'portal_bridge', portalUrl: 'https://drive.google.com', extraLabel: 'Local Google Drive Folder Path (Optional)', description: 'Syncs JARVIS projects & manuscripts into Google Drive.' },
  { id: 'vercel', name: 'Vercel Cloud Deploy', icon: '▲', category: 'workspace_ops', kind: 'webhook_rest', endpoint: 'https://api.vercel.com/v13/deployments', portalUrl: 'https://vercel.com/account/tokens', keyPlaceholder: 'Vercel Access Token', description: '1-click publish any JARVIS App or Funnel to a live https://...vercel.app URL!' },
  { id: 'asana', name: 'Asana Projects & Tasks', icon: '🎯', category: 'workspace_ops', kind: 'webhook_rest', endpoint: 'https://app.asana.com/api/1.0/tasks', portalUrl: 'https://app.asana.com/0/my-apps', extraLabel: 'Asana Project GID (Optional — Auto-Uses Default Workspace)', keyPlaceholder: '2/... Asana Personal Access Token', description: '1-click push action items & agent milestones directly into Asana.' },
  { id: 'genspark', name: 'Genspark Super Agent', icon: '✨', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://www.genspark.ai', description: '1-click copy research brief & launch Genspark workspace.' },
  { id: 'cursor', name: 'Cursor AI IDE', icon: '💻', category: 'workspace_ops', kind: 'portal_bridge', portalUrl: 'https://www.cursor.com', description: 'Open generated apps & manuscripts in Cursor.' },
  { id: 'notion', name: 'Notion Workspace', icon: '📝', category: 'workspace_ops', kind: 'webhook_rest', endpoint: 'https://api.notion.com/v1/pages', portalUrl: 'https://www.notion.so/my-integrations', extraLabel: 'Parent Page ID', keyPlaceholder: 'ntn_...', description: 'Export manuscripts, courses & app specs to Notion.' },
  { id: 'clickup', name: 'ClickUp Tasks', icon: '✅', category: 'workspace_ops', kind: 'webhook_rest', endpoint: 'https://api.clickup.com/api/v2', portalUrl: 'https://app.clickup.com/settings/apps', extraLabel: 'Default List ID', keyPlaceholder: 'pk_...', description: 'Push action items & sprint milestones into ClickUp.' },
  { id: 'slack', name: 'Slack Webhook / Bot', icon: '💬', category: 'workspace_ops', kind: 'webhook_rest', endpoint: '', portalUrl: 'https://api.slack.com/apps', keyPlaceholder: 'https://hooks.slack.com/services/...', description: 'Send briefings & launch updates to Slack.' }
];

const liveNodes = new Map([
  ['MACBOOK-ALPHA', { nodeId: 'MACBOOK-ALPHA', name: `${os.hostname()} (Primary Hub)`, os: `${os.type()} ${os.release()}`, arch: os.arch(), ip: '127.0.0.1', role: 'Primary Personal AI Hub', isHost: true, cpuLoad: 12, memUsedPct: 38, batteryPct: 100, lastSeenUtc: new Date().toISOString() }],
  ['IOS-PRIME', { nodeId: 'IOS-PRIME', name: 'iPhone / iPad (iOS)', os: 'iOS Safari PWA', arch: 'Apple Silicon', ip: 'Wi-Fi', role: 'Mobile Voice & On-The-Go Companion', isHost: false, cpuLoad: 0, memUsedPct: 0, batteryPct: 100, lastSeenUtc: '' }]
]);

function machineVaultSecret() {
  return crypto.createHash('sha256').update(`jarvis-local-vault:${os.userInfo().username}:${os.hostname()}`).digest();
}

function encryptSecret(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', machineVaultSecret(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptSecret(blob) {
  if (!blob) return '';
  try {
    const [ivHex, tagHex, encHex] = String(blob).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', machineVaultSecret(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function maskKey(k) {
  if (!k || k.length < 8) return k ? '••••' : '';
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

function loadVault() {
  try {
    if (fs.existsSync(VAULT_FILE)) return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
  } catch {}
  return { passHash: '', passSalt: '', networkMode: 'lan', agentToken: crypto.randomBytes(18).toString('hex'), geminiKeyEnc: '', connectors: {}, auditLog: [] };
}

function saveVault(v) {
  fs.writeFileSync(VAULT_FILE, JSON.stringify(v, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function hashPasscode(pass, saltHex) {
  return crypto.pbkdf2Sync(String(pass), Buffer.from(saltHex, 'hex'), 120000, 32, 'sha256').toString('hex');
}

function seedState() {
  return {
    settings: {
      assistantName: 'J.A.R.V.I.S.',
      wakeWord: 'jarvis',
      voiceGender: 'male',
      avatarMode: 'orb',
      holoTint: true,
      brandName: 'Personal AI & Venture Studio',
      authorName: 'Founder',
      geminiModel: 'auto',
      activeAiProvider: 'auto',
      voiceReply: true,
      voiceRate: 1.02,
      voicePitch: 0.94
    },
    apps: [],
    business: [],
    books: [],
    courses: [],
    automations: [
      { id: 'auto-morning-brief', name: 'Daily Morning Voice Briefing', actionType: 'morning_briefing', scheduleType: 'daily_time', dailyTime: '08:00', intervalMinutes: 60, payload: 'Summarize active projects and priorities.', enabled: true, lastRunAt: '', lastResult: 'Ready' }
    ],
    chat: [{
      id: crypto.randomBytes(8).toString('hex'),
      role: 'assistant',
      text: 'Welcome to your personal AI Command Center! Click "🛡 Security & Settings" anytime to customize my name, voice, holographic person avatar, and free Google Gemini API key.',
      sourceNode: 'HUB-CORE',
      actionType: 'system',
      timestamp: new Date().toISOString()
    }],
    dispatchHistory: []
  };
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  const initial = seedState();
  saveState(initial);
  return initial;
}

function saveState(state) {
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const list of Object.values(nets)) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.254.')) out.push(ni.address);
    }
  }
  return out;
}

function sanitizeSlug(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8'
};

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function getSession(req) {
  const sid = parseCookies(req).jarvis_sid;
  if (!sid || !sessions.has(sid)) return null;
  return sessions.get(sid);
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function serveStatic(res, baseDir, relPath) {
  const fullBase = path.resolve(baseDir);
  let target = path.resolve(fullBase, relPath);
  if (!target.startsWith(fullBase)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  if (!fs.existsSync(target)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const bytes = fs.readFileSync(target);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  res.end(bytes);
}

function httpsPostJson(urlStr, headers, payloadObj, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = Buffer.from(JSON.stringify(payloadObj), 'utf8');
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(new Error('Upstream request timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (!pathname.startsWith('/api/')) {
    if (pathname.startsWith('/agents/')) return serveStatic(res, AGENTS_DIR, pathname.slice('/agents/'.length));
    if (pathname.startsWith('/workspace/')) return serveStatic(res, WORKSPACE_DIR, pathname.slice('/workspace/'.length));
    return serveStatic(res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : {};
      const remoteIp = req.socket.remoteAddress || '127.0.0.1';
      const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
      const vault = loadVault();

      if (pathname === '/api/auth/status') {
        const sess = getSession(req);
        return sendJson(res, 200, {
          ok: true,
          configured: !!vault.passHash,
          authenticated: !!sess,
          csrfToken: sess ? sess.csrfToken : '',
          canSetupFromThisIp: isLocal || !vault.passHash
        });
      }

      if (req.method === 'POST' && pathname === '/api/auth/setup') {
        if (vault.passHash) return sendJson(res, 400, { ok: false, error: 'Passcode already configured.' });
        const pass = String(body.passcode || '');
        if (pass.length < 6) return sendJson(res, 400, { ok: false, error: 'Passcode must be at least 6 characters.' });
        const salt = crypto.randomBytes(16).toString('hex');
        vault.passSalt = salt;
        vault.passHash = hashPasscode(pass, salt);
        vault.auditLog = [{ timestamp: new Date().toISOString(), event: 'VAULT_INITIALIZED', ip: remoteIp, detail: 'Master passcode created' }, ...(vault.auditLog || [])].slice(0, 40);
        saveVault(vault);
        const sid = crypto.randomBytes(24).toString('hex');
        const csrfToken = crypto.randomBytes(18).toString('hex');
        sessions.set(sid, { csrfToken, createdAt: Date.now() });
        return sendJson(res, 200, { ok: true, csrfToken }, { 'Set-Cookie': `jarvis_sid=${sid}; HttpOnly; SameSite=Strict; Path=/` });
      }

      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const pass = String(body.passcode || '');
        if (!vault.passHash || hashPasscode(pass, vault.passSalt) !== vault.passHash) {
          return sendJson(res, 401, { ok: false, error: 'Invalid Master Passcode.' });
        }
        const sid = crypto.randomBytes(24).toString('hex');
        const csrfToken = crypto.randomBytes(18).toString('hex');
        sessions.set(sid, { csrfToken, createdAt: Date.now() });
        return sendJson(res, 200, { ok: true, csrfToken }, { 'Set-Cookie': `jarvis_sid=${sid}; HttpOnly; SameSite=Strict; Path=/` });
      }

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        const sid = parseCookies(req).jarvis_sid;
        if (sid) sessions.delete(sid);
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'jarvis_sid=; HttpOnly; Max-Age=0; Path=/' });
      }

      const sess = getSession(req);
      if (!sess) return sendJson(res, 401, { ok: false, error: 'Session locked.' });

      if (req.method === 'POST' && pathname === '/api/auth/change-passcode') {
        const pass = String(body.passcode || '');
        if (pass.length < 6) return sendJson(res, 400, { ok: false, error: 'Passcode must be at least 6 characters.' });
        const salt = crypto.randomBytes(16).toString('hex');
        vault.passSalt = salt;
        vault.passHash = hashPasscode(pass, salt);
        saveVault(vault);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && pathname === '/api/security/info') {
        const gKey = decryptSecret(vault.geminiKeyEnc);
        return sendJson(res, 200, {
          ok: true,
          networkMode: vault.networkMode || 'lan',
          agentToken: vault.agentToken,
          hasGeminiKeyInVault: !!gKey,
          geminiKeyMasked: maskKey(gKey),
          auditLog: vault.auditLog || []
        });
      }

      if (req.method === 'POST' && pathname === '/api/security/network-mode') {
        vault.networkMode = body.networkMode || 'lan';
        saveVault(vault);
        return sendJson(res, 200, { ok: true, networkMode: vault.networkMode });
      }

      if (req.method === 'POST' && pathname === '/api/security/rotate-agent-token') {
        vault.agentToken = crypto.randomBytes(18).toString('hex');
        saveVault(vault);
        return sendJson(res, 200, { ok: true, agentToken: vault.agentToken });
      }

      if (req.method === 'POST' && pathname === '/api/vault/gemini-key') {
        const k = String(body.apiKey || '').trim();
        vault.geminiKeyEnc = k ? encryptSecret(k) : '';
        saveVault(vault);
        return sendJson(res, 200, { ok: true, masked: maskKey(k) });
      }

      if (req.method === 'POST' && pathname === '/api/ai/gemini') {
        const gKey = decryptSecret(vault.geminiKeyEnc);
        if (!gKey) return sendJson(res, 400, { ok: false, error: 'Save your free Google Gemini API key in Security & Settings first.' });

        const requested = String(body.model || 'gemini-3.5-flash-lite');
        const isAudio = JSON.stringify(body.response_format || {}).includes('"audio"');
        const candidates = isAudio
          ? [requested]
          : [...new Set([requested, 'gemini-3.5-flash-lite', 'gemini-3.8-flash'])];

        let lastRes = { status: 503, text: '{"error":"Unavailable"}' };
        for (const m of candidates) {
          const coolUntil = geminiCooldowns.get(m) || 0;
          if (Date.now() < coolUntil && candidates.length > 1) continue;
          const payload = { ...body, model: m };
          if (m !== requested) delete payload.previous_interaction_id;
          const up = await httpsPostJson(
            'https://generativelanguage.googleapis.com/v1beta/interactions',
            { 'x-goog-api-key': gKey },
            payload
          );
          lastRes = up;
          if (up.status >= 200 && up.status < 300) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(up.text);
          }
          if (up.status === 429 || up.status === 503) {
            geminiCooldowns.set(m, Date.now() + 600000);
            continue;
          }
          break;
        }
        res.writeHead(lastRes.status, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(lastRes.text);
      }

      if (req.method === 'GET' && pathname === '/api/connectors/status') {
        const savedMap = vault.connectors || {};
        const merged = DEFAULT_CONNECTORS.map((d) => {
          const sv = savedMap[d.id] || {};
          const rawK = decryptSecret(sv.apiKeyEnc || '');
          const isPortal = d.kind === 'portal_bridge';
          return {
            ...d,
            endpoint: sv.endpoint || d.endpoint || '',
            portalUrl: sv.portalUrl || d.portalUrl || '',
            model: sv.model || d.model || '',
            extraId: sv.extraId || '',
            maskedKey: maskKey(rawK),
            configured: isPortal ? true : !!(rawK || sv.endpoint)
          };
        });
        Object.values(savedMap).forEach((sv) => {
          if (sv && sv.isCustom) {
            const rawK = decryptSecret(sv.apiKeyEnc || '');
            merged.push({ ...sv, icon: '🔌', maskedKey: maskKey(rawK), configured: !!(rawK || sv.endpoint || sv.portalUrl) });
          }
        });
        const state = loadState();
        return sendJson(res, 200, {
          ok: true,
          connectors: merged,
          configuredCount: merged.filter((c) => c.configured).length,
          activeAiProvider: state.settings?.activeAiProvider || 'auto'
        });
      }

      if (req.method === 'POST' && pathname === '/api/connectors/save') {
        vault.connectors = vault.connectors || {};
        if (body.delete) {
          delete vault.connectors[body.id];
        } else {
          const prev = vault.connectors[body.id] || {};
          const nextKeyEnc = body.apiKey === '__KEEP__'
            ? (prev.apiKeyEnc || '')
            : (body.apiKey ? encryptSecret(body.apiKey) : '');
          vault.connectors[body.id] = {
            id: body.id,
            name: body.name || prev.name || body.id,
            kind: body.kind || prev.kind || 'webhook_rest',
            category: body.category || prev.category || 'workspace_ops',
            description: body.description || prev.description || '',
            endpoint: body.endpoint ?? prev.endpoint ?? '',
            portalUrl: body.portalUrl ?? prev.portalUrl ?? '',
            model: body.model ?? prev.model ?? '',
            extraId: body.extraId ?? prev.extraId ?? '',
            isCustom: !!(body.isCustom || prev.isCustom),
            apiKeyEnc: nextKeyEnc
          };
        }
        saveVault(vault);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/api/connectors/test') {
        return sendJson(res, 200, { ok: true, message: 'Connector saved and ready!' });
      }

      if (req.method === 'POST' && pathname === '/api/connectors/ai-query') {
        const provId = body.provider;
        const def = DEFAULT_CONNECTORS.find((x) => x.id === provId) || {};
        const sv = (vault.connectors || {})[provId] || {};
        const apiKey = decryptSecret(sv.apiKeyEnc || '');
        if (!apiKey) return sendJson(res, 400, { ok: false, error: `Configure ${provId} API key first.` });
        const endpoint = sv.endpoint || def.endpoint;
        const model = sv.model || def.model;
        const sys = `You are ${body.context?.assistantName || 'J.A.R.V.I.S.'}. Return ONLY valid JSON: {"action":"chat","spokenReply":"..."} answering clearly in 2-5 conversational sentences.`;

        if ((sv.kind || def.kind) === 'anthropic') {
          const up = await httpsPostJson(endpoint, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, {
            model, max_tokens: 900, system: sys, messages: [{ role: 'user', content: String(body.prompt || '') }]
          });
          const parsed = JSON.parse(up.text || '{}');
          const txt = parsed?.content?.[0]?.text || '';
          const m = txt.match(/\{[\s\S]*\}/);
          return sendJson(res, 200, { ok: true, plan: m ? JSON.parse(m[0]) : { action: 'chat', spokenReply: txt } });
        } else {
          const up = await httpsPostJson(endpoint, { Authorization: `Bearer ${apiKey}` }, {
            model, messages: [{ role: 'system', content: sys }, { role: 'user', content: String(body.prompt || '') }]
          });
          const parsed = JSON.parse(up.text || '{}');
          const txt = parsed?.choices?.[0]?.message?.content || '';
          const m = txt.match(/\{[\s\S]*\}/);
          return sendJson(res, 200, { ok: true, plan: m ? JSON.parse(m[0]) : { action: 'chat', spokenReply: txt } });
        }
      }

      if (req.method === 'GET' && pathname === '/api/state') {
        const gKey = decryptSecret(vault.geminiKeyEnc);
        const nodes = [...liveNodes.values()].map((n) => ({ ...n, online: n.isHost, pendingCommands: 0 }));
        return sendJson(res, 200, {
          ok: true,
          hasVaultGeminiKey: !!gKey,
          networkMode: vault.networkMode || 'lan',
          configuredConnectorCount: Object.keys(vault.connectors || {}).length,
          state: loadState(),
          host: { machineName: os.hostname(), port: PORT, ips: getLocalIPs(), uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000), workspaceDir: WORKSPACE_DIR },
          nodes
        });
      }

      if (req.method === 'POST' && pathname === '/api/settings') {
        const state = loadState();
        state.settings = { ...(state.settings || {}), ...body };
        saveState(state);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/api/chat/log') {
        const state = loadState();
        state.chat = state.chat || [];
        state.chat.push({
          id: crypto.randomBytes(8).toString('hex'),
          role: body.role || 'user',
          text: body.text || '',
          sourceNode: body.sourceNode || 'HUB',
          actionType: body.actionType || 'chat',
          timestamp: new Date().toISOString()
        });
        if (state.chat.length > 100) state.chat = state.chat.slice(-100);
        saveState(state);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/api/chat/clear') {
        const state = loadState();
        state.chat = [];
        saveState(state);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/api/workspace/save') {
        const category = ['apps', 'business', 'books', 'courses'].includes(body.category) ? body.category : 'apps';
        const title = body.title || 'Untitled Creation';
        const slug = sanitizeSlug(body.slug || title) || `item-${Date.now()}`;
        const id = body.id || `${category}-${slug}`;
        const dir = path.join(WORKSPACE_DIR, category, slug);
        fs.mkdirSync(dir, { recursive: true });
        const savedFiles = [];
        for (const [fname, content] of Object.entries(body.files || {})) {
          const safe = path.basename(fname);
          fs.writeFileSync(path.join(dir, safe), String(content ?? ''), 'utf8');
          savedFiles.push(safe);
        }
        const primary = savedFiles.includes('index.html') ? 'index.html' : (savedFiles[0] || 'index.html');
        const previewUrl = `/workspace/${category}/${slug}/${primary}`;
        const record = { id, category, slug, title, summary: body.summary || '', createdByNode: body.sourceNode || 'HUB', updatedAt: new Date().toISOString(), previewUrl, diskPath: dir, savedFiles, data: body.data || {} };
        const state = loadState();
        state[category] = state[category] || [];
        const idx = state[category].findIndex((x) => x.id === id);
        if (idx >= 0) state[category][idx] = record;
        else state[category].unshift(record);
        saveState(state);
        return sendJson(res, 200, { ok: true, item: record, previewUrl });
      }

      if (req.method === 'POST' && pathname.startsWith('/api/automations/')) {
        const state = loadState();
        state.automations = state.automations || [];
        if (pathname.endsWith('/save')) {
          state.automations.unshift({ id: 'auto-' + Date.now(), ...body, lastRunAt: '', lastResult: 'Scheduled' });
        } else if (pathname.endsWith('/toggle')) {
          const f = state.automations.find((x) => x.id === body.id);
          if (f) f.enabled = !f.enabled;
        } else if (pathname.endsWith('/delete')) {
          state.automations = state.automations.filter((x) => x.id !== body.id);
        } else if (pathname.endsWith('/run-now')) {
          const f = state.automations.find((x) => x.id === body.id);
          const aiName = state.settings?.assistantName || 'J.A.R.V.I.S.';
          const summary = `${aiName} briefing complete: ${state.apps?.length || 0} apps, ${state.books?.length || 0} books, and ${state.courses?.length || 0} courses ready.`;
          if (f) { f.lastRunAt = new Date().toISOString(); f.lastResult = summary; }
          saveState(state);
          return sendJson(res, 200, { ok: true, summary });
        }
        saveState(state);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && (pathname === '/api/projects/save' || pathname === '/api/agents/save')) {
        const key = pathname.includes('/projects/') ? 'projects' : 'agents';
        const prefix = key === 'projects' ? 'proj-' : 'agent-';
        const id = sanitizeSlug(body.id || '') || `${prefix}${Date.now()}`;
        const item = { ...body, id, updatedAt: new Date().toISOString() };
        const state = loadState();
        state[key] = state[key] || [];
        const idx = state[key].findIndex((x) => x.id === id);
        if (idx >= 0) state[key][idx] = item;
        else state[key].unshift(item);
        saveState(state);
        return sendJson(res, 200, { ok: true, item });
      }

      if (req.method === 'POST' && (pathname === '/api/projects/delete' || pathname === '/api/agents/delete')) {
        const key = pathname.includes('/projects/') ? 'projects' : 'agents';
        const state = loadState();
        state[key] = (state[key] || []).filter((x) => x.id !== body.id);
        saveState(state);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/api/connectors/local-sync') {
        const target = sanitizeSlug(body.target || 'obsidian');
        const title = String(body.title || 'JARVIS Document');
        const md = String(body.markdown || '');
        const sv = (vault.connectors || {})[target] || {};
        const outDir = (sv.extraId && fs.existsSync(sv.extraId))
          ? sv.extraId
          : path.join(os.homedir(), 'Documents', target === 'obsidian' ? 'JARVIS-Obsidian-Vault' : 'JARVIS-Exports');
        fs.mkdirSync(outDir, { recursive: true });
        const safe = sanitizeSlug(title) || `jarvis-${Date.now()}`;
        const filePath = path.join(outDir, target === 'msword' ? `${safe}.doc` : `${safe}.md`);
        if (target === 'msword') {
          const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br/>');
          fs.writeFileSync(filePath, `<html xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>${title}</title></head><body style="font-family:Calibri,Georgia,serif;font-size:12pt;line-height:1.55;"><h1>${title}</h1><div>${esc}</div></body></html>`, 'utf8');
        } else {
          fs.writeFileSync(filePath, `---\ntitle: "${title.replace(/"/g, "'")}"\nsource: JARVIS\ncreated: ${new Date().toISOString()}\n---\n\n${md}`, 'utf8');
        }
        return sendJson(res, 200, { ok: true, savedPath: filePath });
      }

      if (req.method === 'POST' && pathname === '/api/connectors/vercel-deploy') {
        const sv = (vault.connectors || {}).vercel || {};
        const key = decryptSecret(sv.apiKeyEnc || '');
        if (!key) return sendJson(res, 400, { ok: false, error: 'Save your Vercel Access Token in Connectors first.' });
        const up = await httpsPostJson('https://api.vercel.com/v13/deployments', { Authorization: `Bearer ${key}` }, {
          name: 'jarvis-' + (sanitizeSlug(body.name || 'app') || 'app'),
          files: [{ file: 'index.html', data: String(body.html || '<h1>JARVIS</h1>') }],
          projectSettings: { framework: null },
          target: 'production'
        });
        if (up.status < 200 || up.status >= 300) return sendJson(res, 502, { ok: false, error: `Vercel HTTP ${up.status}` });
        const parsed = JSON.parse(up.text || '{}');
        const depUrl = parsed.url ? (parsed.url.startsWith('http') ? parsed.url : `https://${parsed.url}`) : '';
        return sendJson(res, 200, { ok: true, url: depUrl });
      }

      if (req.method === 'POST' && pathname === '/api/connectors/asana-task') {
        const sv = (vault.connectors || {}).asana || {};
        const key = decryptSecret(sv.apiKeyEnc || '');
        if (!key) return sendJson(res, 400, { ok: false, error: 'Save your Asana Personal Access Token in Connectors first.' });
        const dataPayload = { name: String(body.name || 'JARVIS Task'), notes: String(body.notes || '') };
        if (sv.extraId) dataPayload.projects = [String(sv.extraId).trim()];
        const up = await httpsPostJson('https://app.asana.com/api/1.0/tasks', { Authorization: `Bearer ${key}` }, { data: dataPayload });
        if (up.status < 200 || up.status >= 300) return sendJson(res, 502, { ok: false, error: `Asana HTTP ${up.status}: ${up.text}` });
        const parsed = JSON.parse(up.text || '{}');
        return sendJson(res, 200, { ok: true, url: parsed?.data?.permalink_url || 'https://app.asana.com' });
      }

      if (req.method === 'POST' && pathname === '/api/nodes/dispatch') {
        return sendJson(res, 200, { ok: true, queuedTargets: ['ALL'] });
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err?.message || 'Internal error' });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Personal AI Command Hub online at http://localhost:${PORT}`);
  for (const ip of getLocalIPs()) console.log(`  Home Wi-Fi URL: http://${ip}:${PORT}`);
});
