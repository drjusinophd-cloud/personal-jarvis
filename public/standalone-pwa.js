/**
 * J.A.R.V.I.S. Standalone iPhone / iPad / Mobile PWA Engine
 * Automatically activates ONLY when hosted as a serverless web app (e.g., GitHub Pages https://...github.io)
 * so family & friends who ONLY own an iPhone or iPad (no computer needed!) get their own 100% private,
 * encrypted, customizable Holographic AI Command Center right on their iPhone Home Screen!
 */
(function () {
  const nativeFetch = window.fetch.bind(window);
  const host = (window.location.hostname || '').toLowerCase();
  const forceStandalone =
    host.endsWith('.github.io') ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.netlify.app') ||
    host.endsWith('.vercel.app') ||
    window.location.protocol === 'file:' ||
    window.location.search.indexOf('standalone=1') >= 0;

  let standaloneActive = forceStandalone;
  let hubProbeDone = forceStandalone;

  const VAULT_STORAGE_KEY = 'jarvis_standalone_vault_v1';
  const STATE_STORAGE_KEY = 'jarvis_standalone_state_v1';
  const FILES_STORAGE_KEY = 'jarvis_standalone_files_v1';
  const SESSION_STORAGE_KEY = 'jarvis_standalone_session_v1';

  let activeSessionKeyMaterial = null; // Derived AES-GCM CryptoKey from user's passcode
  const geminiCooldowns = {};

  const DEFAULT_CONNECTORS = [
    { id: 'grok', name: 'xAI Grok (Grok 4.7 Brain + Web)', icon: '🦊', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://api.x.ai/v1/chat/completions', model: 'grok-4.7', portalUrl: 'https://console.x.ai', keyPlaceholder: 'xai-...', description: 'Run Grok 4.7 natively inside JARVIS Voice & AI Agents, or tap Open Grok Web (grok.com) in 1 tap!' },
    { id: 'muse', name: 'Muse AI (Autonomous Agent & Spaces)', icon: '🎨', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://muse.ai', extraLabel: 'Muse Space / Creative Note', description: '1-tap copy interactive Space & agent brief and launch Muse AI.' },
    { id: 'perplexity', name: 'Perplexity AI (Live Web Sonar)', icon: '🔎', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://api.perplexity.ai/chat/completions', model: 'sonar-pro', portalUrl: 'https://www.perplexity.ai/settings/api', keyPlaceholder: 'pplx-...', description: 'Real-time cited web research & live fact-checking brain.' },
    { id: 'openrouter', name: 'OpenRouter (300+ Models)', icon: '🌐', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini', portalUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-...', description: 'Unified gateway to 300+ frontier & open-weights models.' },
    { id: 'openai', name: 'OpenAI (ChatGPT / GPT-4o)', icon: '⚡', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', portalUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-...', description: 'Direct OpenAI executive reasoning, coding & writing brain.' },
    { id: 'deepseek', name: 'DeepSeek AI (V3 / R1)', icon: '🐋', category: 'ai_agents', kind: 'openai_compat', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', portalUrl: 'https://platform.deepseek.com/api_keys', keyPlaceholder: 'sk-...', description: 'High-speed technical reasoning & software architecture.' },
    { id: 'lovable', name: 'Lovable (1-Tap Auto-Fill App Builder)', icon: '💜', category: 'workspace_ops', kind: 'portal_bridge', portalUrl: 'https://lovable.dev', extraLabel: 'Preferred Stack / Design Note', keyPlaceholder: 'Optional Lovable API Key (lov_...)', description: '1-tap launch Lovable with your App, Funnel, or Project PRD pre-filled automatically via #prompt= URL!' },
    { id: 'emergent', name: 'Emergent Labs (Full-Stack AI Builder)', icon: '🚀', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://emergent.sh', extraLabel: 'Stack / MCP Note', description: '1-tap copy full-stack app blueprint & launch Emergent Labs.' },
    { id: 'mindsmith', name: 'Mindsmith AI (Interactive Courses)', icon: '🎓', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://www.mindsmith.ai', extraLabel: 'Learner Audience / Tone', description: 'Turn any Course syllabus or Book chapter into interactive lessons & quizzes in Mindsmith AI.' },
    { id: 'workshop', name: 'Workshop AI', icon: '🛠', category: 'workspace_ops', kind: 'portal_bridge', portalUrl: 'https://workshop.ai', description: '1-tap copy full-stack app & database blueprint & open Workshop AI.' },
    { id: 'hercules', name: 'Hercules AI', icon: '🏛', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://hercules.app', description: '1-tap copy SaaS & mobile app blueprint & open Hercules AI.' },
    { id: 'aiwritebook', name: 'AIWriteBook Studio', icon: '📚', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://aiwritebook.com', description: '1-tap copy your book packet & launch AIWriteBook directly.' },
    { id: 'konshus', name: 'Konshus AI (Long-Term Memory Vault)', icon: '🧠', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://konshus.ai', endpoint: 'https://konshus.ai/api/mcp', extraLabel: 'Konshus Memory Whisper / Briefing', description: 'Injects your portable Konshus AI memory profile into JARVIS, Projects & Agents.' },
    { id: 'obsidian', name: 'Obsidian Vault', icon: '💎', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://obsidian.md', description: 'Exports clean Markdown notes with YAML frontmatter for Obsidian.' },
    { id: 'googledocs', name: 'Google Docs', icon: '📄', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://docs.new', description: '1-tap copy formatted document & open a new Google Doc.' },
    { id: 'msword', name: 'Microsoft Word', icon: '📘', category: 'book_writing', kind: 'portal_bridge', portalUrl: 'https://word.cloud.microsoft', description: 'Exports formatted Microsoft Word (.doc) documents.' },
    { id: 'onedrive', name: 'Microsoft OneDrive', icon: '☁️', category: 'workspace_ops', kind: 'portal_bridge', portalUrl: 'https://onedrive.live.com', description: 'Exports & opens OneDrive for cross-device sync.' },
    { id: 'googledrive', name: 'Google Drive', icon: '📂', category: 'workspace_ops', kind: 'portal_bridge', portalUrl: 'https://drive.google.com', description: 'Exports & opens Google Drive.' },
    { id: 'vercel', name: 'Vercel Cloud Deploy', icon: '▲', category: 'workspace_ops', kind: 'webhook_rest', endpoint: 'https://api.vercel.com/v13/deployments', portalUrl: 'https://vercel.com/account/tokens', keyPlaceholder: 'Vercel Access Token', description: '1-tap publish any forged App or Funnel to a live https://...vercel.app URL!' },
    { id: 'asana', name: 'Asana Tasks', icon: '🎯', category: 'workspace_ops', kind: 'webhook_rest', endpoint: 'https://app.asana.com/api/1.0/tasks', portalUrl: 'https://app.asana.com/0/my-apps', extraLabel: 'Asana Project GID (Optional)', keyPlaceholder: '2/... Asana Personal Access Token', description: '1-tap push action items & agent tasks into Asana.' },
    { id: 'genspark', name: 'Genspark Super Agent', icon: '✨', category: 'ai_agents', kind: 'portal_bridge', portalUrl: 'https://www.genspark.ai', description: '1-tap copy research brief & launch Genspark workspace.' }
  ];

  function toHex(buf) {
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function fromHex(hex) {
    const clean = String(hex || '');
    const out = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  function randomHex(bytesLen) {
    const arr = new Uint8Array(bytesLen || 16);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    return toHex(arr);
  }

  async function derivePasscodeMaterial(passcode, saltHex) {
    const enc = new TextEncoder();
    const keyMat = await window.crypto.subtle.importKey('raw', enc.encode(String(passcode)), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
    const salt = fromHex(saltHex);
    const hashBits = await window.crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMat, 256);
    const aesKey = await window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMat,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return { hashHex: toHex(hashBits), aesKey };
  }

  async function encryptWithSessionKey(plain) {
    if (!plain) return '';
    if (!activeSessionKeyMaterial || !window.crypto?.subtle) {
      return 'b64:' + btoa(unescape(encodeURIComponent(String(plain))));
    }
    const iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);
    const cipherBuf = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      activeSessionKeyMaterial,
      new TextEncoder().encode(String(plain))
    );
    return 'gcm:' + toHex(iv) + ':' + toHex(cipherBuf);
  }

  async function decryptWithSessionKey(blob) {
    if (!blob) return '';
    const s = String(blob);
    if (s.startsWith('b64:')) {
      try { return decodeURIComponent(escape(atob(s.slice(4)))); } catch (e) { return ''; }
    }
    if (s.startsWith('gcm:') && activeSessionKeyMaterial && window.crypto?.subtle) {
      try {
        const parts = s.split(':');
        const iv = fromHex(parts[1]);
        const data = fromHex(parts[2]);
        const plainBuf = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, activeSessionKeyMaterial, data);
        return new TextDecoder().decode(plainBuf);
      } catch (e) {
        return '';
      }
    }
    return '';
  }

  function maskKey(k) {
    if (!k || k.length < 8) return k ? '••••' : '';
    return k.slice(0, 4) + '••••' + k.slice(-4);
  }

  function loadVault() {
    try {
      const raw = localStorage.getItem(VAULT_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { passHash: '', passSalt: '', networkMode: 'iphone_vault', agentToken: randomHex(16), geminiKeyEnc: '', hasGeminiKey: false, geminiMasked: '', connectors: {}, auditLog: [] };
  }

  function saveVault(v) {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(v));
  }

  function migrateLegacyOsNames(rawStr) {
    if (!rawStr || rawStr.indexOf('Sovereign') < 0) return rawStr;
    return rawStr
      .replace(/Sovereign Leader Daily OS/g, 'Transformational Leader OS')
      .replace(/Sovereign Leaders? OS/gi, 'Transformational Leader OS')
      .replace(/Sovereign Executive OS/g, 'Transformational Leader OS')
      .replace(/Sovereign Leader Full-Stack Platform/g, 'Transformational Leader OS')
      .replace(/Sovereign Leadership Operating System/g, 'Transformational Leader OS')
      .replace(/The Sovereign Leader/g, 'The Transformational Leader');
  }

  function loadFilesMap() {
    try {
      const raw = localStorage.getItem(FILES_STORAGE_KEY);
      if (raw) {
        const migrated = migrateLegacyOsNames(raw);
        if (migrated !== raw) localStorage.setItem(FILES_STORAGE_KEY, migrated);
        return JSON.parse(migrated);
      }
    } catch (e) {}
    return {};
  }

  function saveFilesMap(m) {
    localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(m));
  }

  function seedStandaloneState() {
    return {
      settings: {
        assistantName: 'J.A.R.V.I.S.',
        wakeWord: 'jarvis',
        voiceGender: 'male',
        avatarMode: 'holo_male',
        holoTint: true,
        brandName: 'Personal AI Studio',
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
        { id: 'auto-morning-brief', name: 'Daily Spoken Priority Briefing', actionType: 'morning_briefing', scheduleType: 'daily_time', dailyTime: '08:00', intervalMinutes: 60, payload: 'Summarize my active apps, books, courses, and goals.', enabled: true, lastRunAt: '', lastResult: 'Tap ▶ Run Now & Speak anytime!' }
      ],
      chat: [{
        id: randomHex(8),
        role: 'assistant',
        text: 'Welcome to your standalone iPhone & Mobile Personal AI! Tap "🛡 Security & Settings" to pick your AI Name, Voice, 3D Holographic Person (or upload any photo from your Camera Roll!), and paste your free Google Gemini API key.',
        sourceNode: 'IPHONE-VAULT',
        actionType: 'system',
        timestamp: new Date().toISOString()
      }]
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_STORAGE_KEY);
      if (raw) {
        const migrated = migrateLegacyOsNames(raw);
        if (migrated !== raw) localStorage.setItem(STATE_STORAGE_KEY, migrated);
        return JSON.parse(migrated);
      }
    } catch (e) {}
    const initial = seedStandaloneState();
    saveState(initial);
    return initial;
  }

  function saveState(st) {
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(st));
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function jsonResponse(status, obj) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function sanitizeSlug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }

  async function handleVirtualRequest(pathname, method, bodyText) {
    if (pathname.startsWith('/workspace/')) {
      const files = loadFilesMap();
      const cleanKey = pathname.split('?')[0];
      if (files[cleanKey] !== undefined) {
        const isHtml = cleanKey.endsWith('.html');
        return new Response(files[cleanKey], {
          status: 200,
          headers: { 'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8' }
        });
      }
      return new Response('Not found', { status: 404 });
    }

    const body = bodyText ? JSON.parse(bodyText) : {};
    const vault = loadVault();
    const sess = getSession();
    const isUnlocked = !!(sess && activeSessionKeyMaterial);

    if (pathname === '/api/auth/status') {
      return jsonResponse(200, {
        ok: true,
        standaloneMode: true,
        configured: !!vault.passHash,
        authenticated: isUnlocked,
        csrfToken: isUnlocked ? sess.csrfToken : '',
        canSetupFromThisIp: true
      });
    }

    if (method === 'POST' && pathname === '/api/auth/setup') {
      const pass = String(body.passcode || '');
      if (pass.length < 6) return jsonResponse(400, { ok: false, error: 'Passcode must be at least 6 characters.' });
      const salt = randomHex(16);
      const derived = await derivePasscodeMaterial(pass, salt);
      activeSessionKeyMaterial = derived.aesKey;
      vault.passSalt = salt;
      vault.passHash = derived.hashHex;
      vault.auditLog = [{ timestamp: new Date().toISOString(), event: 'DEVICE_VAULT_CREATED', ip: 'This Device', detail: 'Encrypted WebCrypto vault initialized' }];
      saveVault(vault);
      const csrfToken = randomHex(16);
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ csrfToken, ts: Date.now() }));
      return jsonResponse(200, { ok: true, csrfToken, standaloneMode: true });
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      const pass = String(body.passcode || '');
      if (!vault.passHash || !vault.passSalt) return jsonResponse(400, { ok: false, error: 'Set up passcode first.' });
      const derived = await derivePasscodeMaterial(pass, vault.passSalt);
      if (derived.hashHex !== vault.passHash) {
        return jsonResponse(401, { ok: false, error: 'Incorrect Passcode.' });
      }
      activeSessionKeyMaterial = derived.aesKey;
      const csrfToken = randomHex(16);
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ csrfToken, ts: Date.now() }));
      return jsonResponse(200, { ok: true, csrfToken, standaloneMode: true });
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      activeSessionKeyMaterial = null;
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return jsonResponse(200, { ok: true });
    }

    if (!isUnlocked) {
      return jsonResponse(401, { ok: false, error: 'Unlock your Personal AI Passcode first.' });
    }

    if (method === 'POST' && pathname === '/api/auth/change-passcode') {
      const pass = String(body.passcode || '');
      if (pass.length < 6) return jsonResponse(400, { ok: false, error: 'Passcode must be at least 6 characters.' });
      const oldGemini = await decryptWithSessionKey(vault.geminiKeyEnc);
      const decryptedConns = {};
      for (const cid of Object.keys(vault.connectors || {})) {
        decryptedConns[cid] = await decryptWithSessionKey(vault.connectors[cid].apiKeyEnc || '');
      }
      const salt = randomHex(16);
      const derived = await derivePasscodeMaterial(pass, salt);
      activeSessionKeyMaterial = derived.aesKey;
      vault.passSalt = salt;
      vault.passHash = derived.hashHex;
      if (oldGemini) vault.geminiKeyEnc = await encryptWithSessionKey(oldGemini);
      for (const cid of Object.keys(decryptedConns)) {
        if (decryptedConns[cid]) vault.connectors[cid].apiKeyEnc = await encryptWithSessionKey(decryptedConns[cid]);
      }
      saveVault(vault);
      return jsonResponse(200, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/security/info') {
      return jsonResponse(200, {
        ok: true,
        standaloneMode: true,
        networkMode: 'iphone_vault',
        agentToken: vault.agentToken,
        hasGeminiKeyInVault: !!vault.hasGeminiKey,
        geminiKeyMasked: vault.geminiMasked || '',
        auditLog: vault.auditLog || []
      });
    }

    if (method === 'POST' && pathname === '/api/security/network-mode') {
      return jsonResponse(200, { ok: true, networkMode: 'iphone_vault' });
    }

    if (method === 'POST' && pathname === '/api/security/rotate-agent-token') {
      vault.agentToken = randomHex(16);
      saveVault(vault);
      return jsonResponse(200, { ok: true, agentToken: vault.agentToken });
    }

    if (method === 'POST' && pathname === '/api/vault/gemini-key') {
      const k = String(body.apiKey || '').trim();
      vault.geminiKeyEnc = k ? await encryptWithSessionKey(k) : '';
      vault.hasGeminiKey = !!k;
      vault.geminiMasked = maskKey(k);
      vault.auditLog = [{ timestamp: new Date().toISOString(), event: 'GEMINI_KEY_ENCRYPTED', ip: 'This Device', detail: 'Stored in AES-256-GCM on-device vault' }, ...(vault.auditLog || [])].slice(0, 30);
      saveVault(vault);
      return jsonResponse(200, { ok: true, masked: vault.geminiMasked });
    }

    if (method === 'POST' && pathname === '/api/ai/gemini') {
      const gKey = await decryptWithSessionKey(vault.geminiKeyEnc);
      if (!gKey) {
        return jsonResponse(400, { ok: false, error: 'Open Security & Settings and paste your free Google Gemini API key first.' });
      }
      const requested = String(body.model || 'gemini-3.5-flash-lite');
      const isAudio = JSON.stringify(body.response_format || {}).indexOf('"audio"') >= 0;
      const models = isAudio
        ? [requested]
        : Array.from(new Set([requested, 'gemini-3.5-flash-lite', 'gemini-3.8-flash']));

      let lastResp = null;
      for (let i = 0; i < models.length; i++) {
        const m = models[i];
        if ((geminiCooldowns[m] || 0) > Date.now() && models.length > 1) continue;
        const payload = Object.assign({}, body, { model: m });
        if (m !== requested) delete payload.previous_interaction_id;

        const up = await nativeFetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': gKey
          },
          body: JSON.stringify(payload)
        });
        const txt = await up.text();
        lastResp = { status: up.status, text: txt };
        if (up.ok) {
          return new Response(txt, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        }
        if (up.status === 429 || up.status === 503) {
          geminiCooldowns[m] = Date.now() + 600000;
          continue;
        }
        break;
      }
      return new Response(lastResp ? lastResp.text : '{"error":"Unavailable"}', {
        status: lastResp ? lastResp.status : 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (method === 'GET' && pathname === '/api/connectors/status') {
      const savedMap = vault.connectors || {};
      const merged = [];
      for (const d of DEFAULT_CONNECTORS) {
        const sv = savedMap[d.id] || {};
        const isPortal = d.kind === 'portal_bridge';
        merged.push({
          ...d,
          endpoint: sv.endpoint || d.endpoint || '',
          portalUrl: sv.portalUrl || d.portalUrl || '',
          model: sv.model || d.model || '',
          extraId: sv.extraId || '',
          maskedKey: sv.maskedKey || '',
          configured: isPortal ? true : !!sv.hasKey
        });
      }
      const st = loadState();
      return jsonResponse(200, {
        ok: true,
        connectors: merged,
        configuredCount: merged.filter((c) => c.configured).length,
        activeAiProvider: st.settings?.activeAiProvider || 'auto'
      });
    }

    if (method === 'POST' && pathname === '/api/connectors/save') {
      vault.connectors = vault.connectors || {};
      if (body.delete) {
        delete vault.connectors[body.id];
      } else {
        const prev = vault.connectors[body.id] || {};
        const keep = body.apiKey === '__KEEP__';
        const enc = keep ? (prev.apiKeyEnc || '') : (body.apiKey ? await encryptWithSessionKey(body.apiKey) : '');
        const hasKey = keep ? !!prev.hasKey : !!body.apiKey;
        const maskedKey = keep ? (prev.maskedKey || '') : maskKey(body.apiKey || '');
        vault.connectors[body.id] = {
          id: body.id,
          name: body.name || prev.name || body.id,
          kind: body.kind || prev.kind || 'openai_compat',
          category: body.category || prev.category || 'ai_agents',
          endpoint: body.endpoint ?? prev.endpoint ?? '',
          portalUrl: body.portalUrl ?? prev.portalUrl ?? '',
          model: body.model ?? prev.model ?? '',
          extraId: body.extraId ?? prev.extraId ?? '',
          isCustom: !!(body.isCustom || prev.isCustom),
          apiKeyEnc: enc,
          hasKey,
          maskedKey
        };
      }
      saveVault(vault);
      return jsonResponse(200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/connectors/test') {
      return jsonResponse(200, { ok: true, message: 'Saved in on-device encrypted vault!' });
    }

    if (method === 'POST' && pathname === '/api/connectors/ai-query') {
      const provId = body.provider;
      const def = DEFAULT_CONNECTORS.find((x) => x.id === provId) || {};
      const sv = (vault.connectors || {})[provId] || {};
      const apiKey = await decryptWithSessionKey(sv.apiKeyEnc || '');
      if (!apiKey) return jsonResponse(400, { ok: false, error: 'Add API key in Connectors first.' });
      const endpoint = sv.endpoint || def.endpoint;
      const model = sv.model || def.model;
      const sys = `You are ${body.context?.assistantName || 'J.A.R.V.I.S.'}. Return ONLY valid JSON: {"action":"chat","spokenReply":"..."} answering clearly in 2-5 conversational sentences.`;
      const up = await nativeFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: String(body.prompt || '') }] })
      });
      const data = await up.json();
      const txt = data?.choices?.[0]?.message?.content || '';
      const m = txt.match(/\{[\s\S]*\}/);
      return jsonResponse(200, { ok: true, plan: m ? JSON.parse(m[0]) : { action: 'chat', spokenReply: txt } });
    }

    if (method === 'GET' && pathname === '/api/state') {
      return jsonResponse(200, {
        ok: true,
        standaloneMode: true,
        hasVaultGeminiKey: !!vault.hasGeminiKey,
        networkMode: 'ON-DEVICE',
        configuredConnectorCount: Object.values(vault.connectors || {}).filter((x) => x.hasKey).length,
        state: loadState(),
        host: { machineName: 'iPhone / Standalone PWA', port: 443, ips: [window.location.host] },
        nodes: [
          { nodeId: 'IOS-PRIME', name: 'This iPhone / Mobile Device', os: 'iOS / Mobile WebKit', arch: 'On-Device AES-256 Vault', ip: 'HTTPS Direct', online: true, cpuLoad: 8, memUsedPct: 32 }
        ]
      });
    }

    if (method === 'POST' && pathname === '/api/settings') {
      const st = loadState();
      st.settings = Object.assign({}, st.settings || {}, body);
      saveState(st);
      return jsonResponse(200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/chat/log') {
      const st = loadState();
      st.chat = st.chat || [];
      st.chat.push({
        id: randomHex(8),
        role: body.role || 'user',
        text: body.text || '',
        sourceNode: body.sourceNode || 'IOS-PRIME',
        actionType: body.actionType || 'chat',
        timestamp: new Date().toISOString()
      });
      if (st.chat.length > 80) st.chat = st.chat.slice(-80);
      saveState(st);
      return jsonResponse(200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/chat/clear') {
      const st = loadState();
      st.chat = [];
      saveState(st);
      return jsonResponse(200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/workspace/save') {
      const category = ['apps', 'business', 'books', 'courses'].includes(body.category) ? body.category : 'apps';
      const title = body.title || 'Untitled Creation';
      const slug = sanitizeSlug(body.slug || title) || ('item-' + Date.now());
      const id = body.id || `${category}-${slug}`;
      const filesMap = loadFilesMap();
      const savedFiles = [];
      for (const [fname, content] of Object.entries(body.files || {})) {
        const key = `/workspace/${category}/${slug}/${fname}`;
        filesMap[key] = String(content ?? '');
        savedFiles.push(fname);
      }
      saveFilesMap(filesMap);
      const primary = savedFiles.includes('index.html') ? 'index.html' : (savedFiles[0] || 'index.html');
      const previewUrl = `/workspace/${category}/${slug}/${primary}`;
      const record = { id, category, slug, title, summary: body.summary || '', createdByNode: 'IOS-PRIME', updatedAt: new Date().toISOString(), previewUrl, savedFiles, data: body.data || {} };
      const st = loadState();
      st[category] = st[category] || [];
      const idx = st[category].findIndex((x) => x.id === id);
      if (idx >= 0) st[category][idx] = record;
      else st[category].unshift(record);
      saveState(st);
      return jsonResponse(200, { ok: true, item: record, previewUrl });
    }

    if (method === 'POST' && pathname.startsWith('/api/automations/')) {
      const st = loadState();
      st.automations = st.automations || [];
      if (pathname.endsWith('/save')) {
        st.automations.unshift({ id: 'auto-' + Date.now(), ...body, lastRunAt: '', lastResult: 'Ready' });
      } else if (pathname.endsWith('/toggle')) {
        const f = st.automations.find((x) => x.id === body.id);
        if (f) f.enabled = !f.enabled;
      } else if (pathname.endsWith('/delete')) {
        st.automations = st.automations.filter((x) => x.id !== body.id);
      } else if (pathname.endsWith('/run-now')) {
        const aiName = st.settings?.assistantName || 'J.A.R.V.I.S.';
        const summary = `${aiName} mobile briefing ready: ${st.apps?.length || 0} apps, ${st.books?.length || 0} books, and ${st.courses?.length || 0} courses saved on your device.`;
        const f = st.automations.find((x) => x.id === body.id);
        if (f) { f.lastRunAt = new Date().toISOString(); f.lastResult = summary; }
        saveState(st);
        return jsonResponse(200, { ok: true, summary });
      }
      saveState(st);
      return jsonResponse(200, { ok: true });
    }

    if (method === 'POST' && (pathname === '/api/projects/save' || pathname === '/api/agents/save')) {
      const coll = pathname.indexOf('/projects/') >= 0 ? 'projects' : 'agents';
      const prefix = coll === 'projects' ? 'proj-' : 'agent-';
      const id = sanitizeSlug(body.id || '') || (prefix + Date.now());
      const item = Object.assign({}, body, { id, updatedAt: new Date().toISOString() });
      const st = loadState();
      st[coll] = st[coll] || [];
      const idx = st[coll].findIndex((x) => x.id === id);
      if (idx >= 0) st[coll][idx] = item;
      else st[coll].unshift(item);
      saveState(st);
      return jsonResponse(200, { ok: true, item });
    }

    if (method === 'POST' && (pathname === '/api/projects/delete' || pathname === '/api/agents/delete')) {
      const coll = pathname.indexOf('/projects/') >= 0 ? 'projects' : 'agents';
      const st = loadState();
      st[coll] = (st[coll] || []).filter((x) => x.id !== body.id);
      saveState(st);
      return jsonResponse(200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/connectors/vercel-deploy') {
      const sv = (vault.connectors || {}).vercel || {};
      const key = await decryptWithSessionKey(sv.apiKeyEnc || '');
      if (!key) return jsonResponse(400, { ok: false, error: 'Save your Vercel Access Token in Connectors first.' });
      const up = await nativeFetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          name: 'jarvis-' + (sanitizeSlug(body.name || 'app') || 'app'),
          files: [{ file: 'index.html', data: String(body.html || '<h1>JARVIS</h1>') }],
          projectSettings: { framework: null },
          target: 'production'
        })
      });
      const parsed = await up.json();
      if (!up.ok) return jsonResponse(502, { ok: false, error: parsed?.error?.message || ('Vercel HTTP ' + up.status) });
      const depUrl = parsed.url ? (parsed.url.startsWith('http') ? parsed.url : `https://${parsed.url}`) : '';
      return jsonResponse(200, { ok: true, url: depUrl });
    }

    if (method === 'POST' && pathname === '/api/connectors/asana-task') {
      const sv = (vault.connectors || {}).asana || {};
      const key = await decryptWithSessionKey(sv.apiKeyEnc || '');
      if (!key) return jsonResponse(400, { ok: false, error: 'Save your Asana Personal Access Token in Connectors first.' });
      let wsGid = '';
      if (!sv.extraId) {
        try {
          const meRes = await nativeFetch('https://app.asana.com/api/1.0/users/me', { headers: { Authorization: `Bearer ${key}` } });
          const meJson = await meRes.json();
          wsGid = meJson?.data?.workspaces?.[0]?.gid || '';
        } catch (e) {}
      }
      const dataObj = { name: String(body.name || 'JARVIS Action Item'), notes: String(body.notes || '') };
      if (sv.extraId) dataObj.projects = [String(sv.extraId).trim()];
      else if (wsGid) dataObj.workspace = wsGid;
      const up = await nativeFetch('https://app.asana.com/api/1.0/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ data: dataObj })
      });
      const parsed = await up.json();
      if (!up.ok) return jsonResponse(502, { ok: false, error: parsed?.errors?.[0]?.message || ('Asana HTTP ' + up.status) });
      return jsonResponse(200, { ok: true, url: parsed?.data?.permalink_url || 'https://app.asana.com' });
    }

    if (method === 'POST' && pathname === '/api/nodes/dispatch') {
      return jsonResponse(200, { ok: true, queuedTargets: ['IOS-PRIME'] });
    }

    return jsonResponse(404, { ok: false, error: 'Endpoint unavailable in standalone mode.' });
  }

  window.fetch = async function (input, init) {
    const rawUrl = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    let pathname = rawUrl;
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      if (parsed.origin === window.location.origin) {
        pathname = parsed.pathname;
      }
    } catch (e) {}

    const isHubRoute = pathname.startsWith('/api/') || pathname.startsWith('/workspace/');
    if (!isHubRoute) {
      return nativeFetch(input, init);
    }

    if (!hubProbeDone && pathname === '/api/auth/status') {
      hubProbeDone = true;
      try {
        const probe = await nativeFetch(input, init);
        const ctype = (probe.headers.get('content-type') || '').toLowerCase();
        if (probe.ok && ctype.indexOf('application/json') >= 0) {
          standaloneActive = false;
          return probe;
        }
      } catch (e) {}
      standaloneActive = true;
      window.JARVIS_STANDALONE_PWA = true;
    }

    if (!standaloneActive) {
      return nativeFetch(input, init);
    }

    window.JARVIS_STANDALONE_PWA = true;
    const method = (init && init.method ? init.method : 'GET').toUpperCase();
    const bodyText = init && typeof init.body === 'string' ? init.body : '';
    return handleVirtualRequest(pathname, method, bodyText);
  };
})();
