/**
 * J.A.R.V.I.S. Hardened HUD Orchestrator — Session Auth, CSRF, DPAPI Vault & Zero-Trust Previews
 */
(function () {
  const Gen = window.JarvisGenerators;
  const Voice = window.JarvisVoiceAndBrain;

  let serverData = {
    state: { settings: {}, projects: [], agents: [], apps: [], business: [], books: [], courses: [], automations: [], chat: [] },
    host: { ips: [], port: 7777 },
    nodes: [],
    hasVaultGeminiKey: false,
    networkMode: 'lan'
  };

  let securityInfo = { agentToken: '', networkMode: 'lan', geminiKeyMasked: '', auditLog: [] };
  let connectorsData = { connectors: [], configuredCount: 0, activeAiProvider: 'auto' };
  let lastAutoRoutedLabel = '';
  let sessionCsrfToken = '';
  let isAuthenticated = false;
  let authModeSetup = false;

  let activeProjectId = localStorage.getItem('jarvis_active_project_id') || '';
  let selectedProjectViewId = '';
  const runningAgentIds = new Set();

  let activeAppItem = null;
  let activeBizItem = null;
  let activeLeadItem = null;
  let voiceMuted = false;
  let handsFreeOn = false;
  let clapWakeOn = false;
  let wakeAutoArmedOnce = false;
  let bootSeeded = false;
  let projectsAgentsSeeded = false;

  const savedDevice = localStorage.getItem('jarvis_device_node');
  const isMacBrowser = /Macintosh|Mac OS X/i.test(navigator.userAgent || '');
  const isIosBrowser = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (isMacBrowser && navigator.maxTouchPoints > 1);
  let currentDeviceNode = savedDevice || (isIosBrowser ? 'IOS-PRIME' : (isMacBrowser ? 'MACBOOK-ALPHA' : 'WINDOWS-PRIME'));

  const el = (id) => document.getElementById(id);
  const setWaveMode = Voice.startWaveVisualizer(el('waveCanvas'));
  Voice.configureVaultAccess(
    () => sessionCsrfToken,
    () => !!serverData.hasVaultGeminiKey
  );

  function updateEngineBadge() {
    const hasKey = !!serverData.hasVaultGeminiKey;
    const settings = serverData.state?.settings || {};
    const provider = settings.activeAiProvider || connectorsData.activeAiProvider || 'auto';
    const shield = (serverData.networkMode || 'lan').toUpperCase();

    if (provider === 'auto') {
      if (lastAutoRoutedLabel) {
        el('aiEngineBadge').textContent = `🛡 ${shield} • 🧭 AUTO → ${lastAutoRoutedLabel}`;
      } else {
        el('aiEngineBadge').textContent = hasKey || (connectorsData.configuredCount > 0)
          ? `🛡 ${shield} • 🧭 AUTO-SMART MODEL ROUTER`
          : `🛡 ${shield} • INSTANT ENGINE (ADD KEY IN 🔌/🛡)`;
      }
    } else if (provider === 'gemini') {
      const model = settings.geminiModel || 'auto';
      el('aiEngineBadge').textContent = hasKey
        ? `🛡 ${shield} • GEMINI (${model.toUpperCase()})`
        : `🛡 ${shield} • INSTANT ENGINE (ADD KEY IN 🔌/🛡)`;
    } else if (provider === 'instant') {
      el('aiEngineBadge').textContent = `🛡 ${shield} • BUILT-IN INSTANT ENGINE`;
    } else {
      el('aiEngineBadge').textContent = `🛡 ${shield} • BRAIN: ${provider.toUpperCase()}`;
    }
  }

  function isBrainConfigured(id) {
    if (id === 'gemini') return !!serverData.hasVaultGeminiKey;
    const found = (connectorsData.connectors || []).find((c) => c.id === id);
    if (!found) return false;
    if (found.kind === 'portal_bridge' || found.kind === 'webhook_rest' || found.kind === 'local_ide') return false;
    return !!found.configured;
  }

  function buildSmartModelCandidates(prompt, directIntent, settings) {
    const p = String(prompt || '').toLowerCase();
    const chosenBrain = settings.activeAiProvider || connectorsData.activeAiProvider || 'auto';
    const configuredGeminiModel = settings.geminiModel || 'auto';

    // Determine task complexity & domain specialty
    const isResearchTask = /\b(latest|current|today|news|2025|2026|market|competitor|competitors|trend|trends|citation|citations|search|look up|fact check|perplexity|industry|statistics)\b/.test(p);
    const isWritingOrCourseTask =
      directIntent === 'build_book' || directIntent === 'build_course' || directIntent === 'build_business' ||
      /\b(write|chapter|book|manuscript|essay|story|keynote|speech|course|curriculum|syllabus|funnel|copywriting|rewrite|outline|foreword)\b/.test(p);
    const isCodingOrDeepStrategyTask =
      directIntent === 'build_app' ||
      /\b(build|code|app|application|dashboard|calculator|scorecard|html|javascript|python|algorithm|analyze|strategy|framework|architecture|roi|financial|compare|deep dive)\b/.test(p);

    // Pick optimal Gemini tier for this task ('gemini-3.8-flash' for deep builds/writing/strategy; 'gemini-3.5-flash-lite' for instant <2.5s voice Q&A)
    const autoGeminiTier = (isResearchTask || isWritingOrCourseTask || isCodingOrDeepStrategyTask)
      ? 'gemini-3.8-flash'
      : 'gemini-3.5-flash-lite';
    const effectiveGeminiModel = (!configuredGeminiModel || configuredGeminiModel === 'auto')
      ? autoGeminiTier
      : configuredGeminiModel;

    // If user locked a specific single provider, try it first, then fall back to any other configured brain so JARVIS never stalls!
    if (chosenBrain !== 'auto' && chosenBrain !== 'instant') {
      const lockedQueue = [{ provider: chosenBrain, geminiModel: effectiveGeminiModel, tag: chosenBrain === 'gemini' ? effectiveGeminiModel.toUpperCase() : chosenBrain.toUpperCase() }];
      if (chosenBrain !== 'gemini' && isBrainConfigured('gemini')) {
        lockedQueue.push({ provider: 'gemini', geminiModel: autoGeminiTier, tag: autoGeminiTier.toUpperCase() });
      }
      return lockedQueue;
    }

    if (chosenBrain === 'instant') return [];

    // Autonomous Multi-Model Task Router across all connected AI brains!
    let preferredProviders = [];
    let taskRoleLabel = 'FAST VOICE';

    if (isResearchTask) {
      taskRoleLabel = 'RESEARCH';
      preferredProviders = ['perplexity', 'grok', 'openrouter', 'gemini', 'openai', 'claude', 'deepseek', 'kimi'];
    } else if (isWritingOrCourseTask) {
      taskRoleLabel = 'AUTHORING';
      preferredProviders = ['claude', 'kimi', 'openai', 'grok', 'gemini', 'deepseek', 'openrouter'];
    } else if (isCodingOrDeepStrategyTask) {
      taskRoleLabel = 'ARCHITECT';
      preferredProviders = ['deepseek', 'claude', 'grok', 'openai', 'gemini', 'openrouter', 'huggingface'];
    } else {
      taskRoleLabel = 'FAST CHAT';
      preferredProviders = ['gemini', 'grok', 'openai', 'claude', 'deepseek', 'kimi', 'openrouter', 'hermes', 'ollama'];
    }

    // Include any custom OpenAI-compatible AI connectors as backup candidates too
    (connectorsData.connectors || []).forEach((c) => {
      if (c.isCustom && c.kind === 'openai_compat' && c.configured && !preferredProviders.includes(c.id)) {
        preferredProviders.push(c.id);
      }
    });

    const activeQueue = [];
    for (let i = 0; i < preferredProviders.length; i++) {
      const prov = preferredProviders[i];
      if (isBrainConfigured(prov)) {
        const gModel = prov === 'gemini' ? autoGeminiTier : '';
        const display = prov === 'gemini'
          ? `${autoGeminiTier.replace('gemini-', 'GEMINI-').toUpperCase()} (${taskRoleLabel})`
          : `${prov.toUpperCase()} (${taskRoleLabel})`;
        activeQueue.push({ provider: prov, geminiModel: gModel, tag: display });
      }
    }
    return activeQueue;
  }

  /* ================= AUTHENTICATED API HELPERS ================= */
  async function apiGet(path) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'X-Jarvis-Node': currentDeviceNode }
    });
    if (res.status === 401 && path !== '/api/auth/status') {
      showLockScreen();
      throw new Error('Unauthorized');
    }
    return res.json();
  }

  async function apiPost(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Jarvis-Node': currentDeviceNode,
        'X-Jarvis-CSRF': sessionCsrfToken
      },
      body: JSON.stringify(payload || {})
    });
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      showLockScreen();
      throw new Error('Unauthorized');
    }
    return res.json();
  }

  /* ================= AUTH VAULT & LOCK SCREEN ================= */
  async function checkAuthStatus() {
    try {
      const st = await apiGet('/api/auth/status');
      if (st && st.authenticated) {
        sessionCsrfToken = st.csrfToken || '';
        isAuthenticated = true;
        el('authLockModal').classList.remove('open');
        await migrateLegacyBrowserKeyIfPresent();
        await loadSecurityInfo();
        await loadConnectorsStatus();
        await refreshState();
        await armAutoWakeSensorsOnOpen();
        return;
      }
      isAuthenticated = false;
      authModeSetup = !st.configured;
      showLockScreen(st);
    } catch (e) {}
  }

  function showLockScreen(statusObj) {
    isAuthenticated = false;
    el('authLockModal').classList.add('open');
    el('authErrorMsg').style.display = 'none';
    el('authPasscodeInput').value = '';

    if (statusObj && !statusObj.configured) {
      if (statusObj.standaloneMode || window.JARVIS_STANDALONE_PWA) {
        authModeSetup = true;
        el('authSubtitle').textContent = 'Welcome! Create a private Passcode (6+ characters) stored encrypted solely on this iPhone / device.';
        el('btnAuthSubmit').textContent = '📱 Initialize Personal AI Vault';
      } else if (statusObj.canSetupFromThisIp) {
        authModeSetup = true;
        el('authSubtitle').textContent = 'First-Time Security Setup: Create a Master Passcode (6+ characters) to protect JARVIS across all 4 laptops.';
        el('btnAuthSubmit').textContent = '🛡 Initialize Encrypted Vault';
      } else {
        authModeSetup = false;
        el('authSubtitle').textContent = 'Open http://localhost:7777 on your Windows Hub laptop once to set your initial Master Passcode.';
        el('btnAuthSubmit').textContent = 'Retry Status Check';
      }
    } else {
      authModeSetup = false;
      el('authSubtitle').textContent = 'Session locked. Enter your Master Passcode to unlock your Personal AI.';
      el('btnAuthSubmit').textContent = '🔓 Unlock Command Center';
    }
  }

  el('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = el('authPasscodeInput').value;
    el('authErrorMsg').style.display = 'none';

    const endpoint = authModeSetup ? '/api/auth/setup' : '/api/auth/login';
    const res = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: pass })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      el('authErrorMsg').textContent = data.error || 'Authentication failed.';
      el('authErrorMsg').style.display = 'block';
      return;
    }

    sessionCsrfToken = data.csrfToken || '';
    isAuthenticated = true;
    el('authPasscodeInput').value = '';
    el('authLockModal').classList.remove('open');
    Voice.playFx('complete');
    await migrateLegacyBrowserKeyIfPresent();
    await loadSecurityInfo();
    await loadConnectorsStatus();
    await refreshState();
    await armAutoWakeSensorsOnOpen();
  });

  el('btnLockHud').addEventListener('click', async () => {
    try { await apiPost('/api/auth/logout', {}); } catch (e) {}
    Voice.stopSpeaking();
    Voice.setHandsFreeMode(false, true);
    Voice.setClapWakeMode(false);
    handsFreeOn = false;
    clapWakeOn = false;
    wakeAutoArmedOnce = false;
    syncWakeToggleButtons();
    showLockScreen({ configured: true });
  });

  async function migrateLegacyBrowserKeyIfPresent() {
    const legacyKey = (localStorage.getItem('jarvis_gemini_api_key') || '').trim();
    if (legacyKey) {
      try {
        await apiPost('/api/vault/gemini-key', { apiKey: legacyKey });
        localStorage.removeItem('jarvis_gemini_api_key');
      } catch (e) {}
    }
  }

  async function loadSecurityInfo() {
    try {
      const info = await apiGet('/api/security/info');
      if (info && info.ok) securityInfo = info;
    } catch (e) {}
  }

  /* ================= NAVIGATION ================= */
  function switchView(viewName) {
    if (!viewName) return;
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === viewName);
    });
    document.querySelectorAll('.view-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `view-${viewName}`);
    });
    if (viewName === 'connectors' && isAuthenticated) {
      loadConnectorsStatus();
    }
  }

  document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  /* ================= VOICE STATE & TRANSCRIPTS ================= */
  function setOrbBadgeLabels(txt) {
    if (el('orbLabel')) el('orbLabel').textContent = txt;
    if (el('holoOrbBadge')) el('holoOrbBadge').textContent = txt;
  }

  Voice.onStateChange((mode) => {
    setWaveMode(mode);
    const orb = el('reactorOrb');
    const dockMic = el('btnDockMic');
    const aiName = window.JARVIS_ASSISTANT_NAME || 'J.A.R.V.I.S.';
    const wakeWordCap = (window.JARVIS_WAKE_WORD || 'Jarvis').replace(/^./, (c) => c.toUpperCase());
    orb.classList.remove('listening', 'speaking', 'thinking');
    dockMic.classList.remove('listening');

    if (mode === 'listening') {
      orb.classList.add('listening');
      dockMic.classList.add('listening');
      const conversing = Voice.isConversing && Voice.isConversing();
      setOrbBadgeLabels(conversing ? 'LIVE MIC' : (handsFreeOn ? 'WAKE ON' : 'DONE ✓'));
      el('voiceStatusText').textContent = conversing
        ? '🟢 CONVERSATION ACTIVE — SPEAK ANY QUESTION OR FOLLOW-UP FREELY!'
        : (handsFreeOn
            ? `WAKE READY — ASK A QUESTION, SAY "HI ${wakeWordCap.toUpperCase()}", OR CLAP 2X`
            : 'LISTENING — SPEAK FREELY (CLICK AVATAR/ORB OR PAUSE 2.5S WHEN DONE)');
    } else if (mode === 'speaking') {
      orb.classList.add('speaking');
      setOrbBadgeLabels('SPEAKING');
      const eng = (Voice.getLastVoiceEngine && Voice.getLastVoiceEngine()) || 'voice';
      el('voiceStatusText').textContent = `🔊 ${aiName.toUpperCase()} SPEAKING (${eng.toUpperCase()})...`;
    } else if (mode === 'thinking') {
      orb.classList.add('thinking');
      setOrbBadgeLabels('WORKING');
      el('voiceStatusText').textContent = 'ARCHITECTING & SYNCHRONIZING...';
    } else {
      setOrbBadgeLabels(clapWakeOn ? 'CLAP ON' : 'SPEAK');
      el('voiceStatusText').textContent = clapWakeOn
        ? 'CLAP 2X TO WAKE — OR CLICK AVATAR/ORB, PRESS SPACE, OR TYPE BELOW'
        : 'STANDBY — CLICK AVATAR/ORB, PRESS SPACE, OR TYPE BELOW';
    }
  });

  if (Voice.onStatusHint) {
    Voice.onStatusHint((hint) => {
      if (hint && el('voiceStatusText')) el('voiceStatusText').textContent = hint;
    });
  }

  function buildTimeOfDayGreeting() {
    const hr = new Date().getHours();
    const salutation = hr < 12 ? 'Good morning' : (hr < 17 ? 'Good afternoon' : 'Good evening');
    const st = serverData.state || {};
    const s = st.settings || {};
    const aiName = s.assistantName || 'J.A.R.V.I.S.';
    const founder = (s.authorName && s.authorName !== 'Founder')
      ? s.authorName
      : 'friend';
    const appCount = (st.apps || []).length;
    const leadCount = (st.books || []).length + (st.courses || []).length;
    return `${salutation}, ${founder}. ${aiName} online and at your service, with ${appCount} apps and ${leadCount} books and courses ready. How may I assist you?`;
  }

  if (Voice.onWake) {
    Voice.onWake(async ({ source, phrase }) => {
      if (!isAuthenticated) return;
      if (Voice.unlockAudioGesture) Voice.unlockAudioGesture();
      await apiPost('/api/chat/log', {
        role: 'user',
        text: source === 'clap' ? '👏 [Double-Clap Wake]' : (phrase || 'Hi Jarvis'),
        sourceNode: currentDeviceNode,
        actionType: 'wake'
      });
      await jarvisReplyAndLog(buildTimeOfDayGreeting(), 'wake_greeting');
      if (Voice.openFollowUpListeningWindow) Voice.openFollowUpListeningWindow();
      if (el('voiceStatusText')) {
        el('voiceStatusText').textContent = '🟢 AWAKE & LISTENING — SPEAK YOUR COMMAND FREELY...';
      }
    });
  }

  Voice.onTranscript(({ draft, interim, final }) => {
    if (!isAuthenticated) return;
    if (draft && document.activeElement !== el('commandInput')) {
      el('commandInput').value = draft;
    }
    if (interim) el('voiceStatusText').textContent = 'HEARING: "' + interim + '"';
    if (final) {
      el('commandInput').value = final;
      handleUserCommand(final);
    }
  });

  async function jarvisReplyAndLog(text, actionType) {
    await apiPost('/api/chat/log', {
      role: 'assistant',
      text,
      sourceNode: 'JARVIS-CORE',
      actionType: actionType || 'reply'
    });
    await refreshState();
    const settings = serverData.state.settings || {};
    await Voice.speak(text, {
      muted: voiceMuted || settings.voiceReply === false,
      rate: settings.voiceRate || 1.02,
      pitch: settings.voicePitch || 0.94,
      useGeminiTts: !!serverData.hasVaultGeminiKey,
      csrfToken: sessionCsrfToken
    });
    if (Voice.openFollowUpListeningWindow) {
      Voice.openFollowUpListeningWindow();
    }
  }

  function getKonshusMemoryWhisper() {
    const c = (connectorsData.connectors || []).find((x) => x.id === 'konshus');
    return c && c.extraId ? String(c.extraId).trim() : '';
  }

  function getActiveProjectObj() {
    if (!activeProjectId) return null;
    return (serverData.state?.projects || []).find((p) => p.id === activeProjectId) || null;
  }

  /* ================= NATURAL LANGUAGE & MULTI-BRAIN CONNECTOR ROUTER ================= */
  function detectLocalIntent(prompt) {
    const p = prompt.toLowerCase().trim();
    const ww = (window.JARVIS_WAKE_WORD || 'jarvis').toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const greetRx = new RegExp(`^(hi|hello|hey|yo|good morning|good afternoon|good evening|wake up)(\\s+${ww})?[.!?]*$`, 'i');
    const wakeNameRx = new RegExp(`^${ww}(\\s+(are you there|wake up|online))?[.!?]*$`, 'i');
    if (greetRx.test(p) || wakeNameRx.test(p)) {
      return 'greet_jarvis';
    }

    // Explicit UI navigation & studio launch shortcuts
    if (/\b(run all|launch all|start all|execute all)\b/.test(p) && /\b(agents|agent team|autonomous agents)\b/.test(p)) return 'run_all_agents';
    if (/\b(run agent team|run my autonomous agents)\b/.test(p)) return 'run_all_agents';
    if (/\b(open|show|view|go to)\b/.test(p) && /\b(projects|project studio)\b/.test(p)) return 'open_projects';
    if (/\b(open|show|view|go to|manage)\b/.test(p) && /\b(agents|ai agents|agent workforce)\b/.test(p)) return 'open_agents';
    if (/\b(morning briefing|run briefing|executive briefing|daily briefing)\b/.test(p)) return 'run_briefing';
    if (/\b(open|show|view|go to)\b/.test(p) && /\b(connectors|sources|integrations|plugins|plug-ins|plug ins)\b/.test(p)) return 'open_connectors';
    if (/\b(open|show|view|manage|list)\b/.test(p) && /\b(automation|automations|routines)\b/.test(p)) return 'open_automations';
    if (/\b(open in cursor|launch cursor)\b/.test(p)) return 'open_cursor';
    if (/\b(save to obsidian|sync to obsidian|send to obsidian|open obsidian)\b/.test(p)) return 'sync_obsidian';
    if (/\b(export to word|save to word|open in word|microsoft word)\b/.test(p) && /\b(export|save|send|open|create)\b/.test(p)) return 'export_word';
    if (/\b(send to google docs|open google docs|export to google docs)\b/.test(p)) return 'open_googledocs';
    if (/\b(deploy to vercel|publish to vercel|ship to vercel)\b/.test(p)) return 'deploy_vercel';
    if (/\b(create|add|push|send)\b/.test(p) && /\b(asana)\b/.test(p)) return 'asana_task';
    if (/\b(send to lovable|open lovable|open in lovable|build in lovable|launch lovable)\b/.test(p)) return 'send_lovable';
    if (/\b(send to emergent|open emergent|launch emergent|emergent labs)\b/.test(p)) return 'send_emergent';
    if (/\b(send to mindsmith|open mindsmith|launch mindsmith|mindsmiths)\b/.test(p)) return 'send_mindsmith';
    if (/\b(send to workshop|open workshop|launch workshop|workshop ai)\b/.test(p)) return 'send_workshop';
    if (/\b(send to hercules|open hercules|launch hercules|hercules ai|hercules au)\b/.test(p)) return 'send_hercules';
    if (/\b(send to muse|open muse|launch muse|muse ai|muse space)\b/.test(p)) return 'send_muse';
    if (/\b(send to grok|open grok|launch grok|open xai)\b/.test(p)) return 'send_grok';
    if (/\b(send to aiwritebook|open aiwritebook|launch aiwritebook)\b/.test(p)) return 'send_aiwritebook';
    if (/\b(send to viktor|open viktor|launch viktor)\b/.test(p)) return 'send_viktor';
    if (/\b(send to genspark|open genspark|launch genspark)\b/.test(p)) return 'send_genspark';
    if (/\b(post to slack|send to slack)\b/.test(p)) return 'send_slack';
    if (/\b(export to notion|send to notion|push to notion)\b/.test(p)) return 'export_notion';
    if (/\b(create|add|push|send)\b/.test(p) && /\b(clickup|click up)\s+task\b/.test(p)) return 'clickup_task';

    // Conversational questions ("how...", "what...", "do I...", "with the connectors...", "?", etc.)
    // MUST go straight to the Conversational AI Brain instead of triggering studio builders!
    const hasExplicitBuildRequest = /\b(build me|create me|create a|create an|generate a|generate an|write chapter|write my|write a|architect a|forge a|launch a)\b/.test(p);
    const isConversationalQuestion =
      p.includes('?') ||
      /^(what|how|why|when|where|who|which|can i|can we|can you explain|can you tell|could you|do i|do we|does|did|is it|is there|are there|with|about|tell me|explain|help me understand|should i|would)\b/.test(p);

    if (isConversationalQuestion && !hasExplicitBuildRequest) {
      return 'chat';
    }

    // Only trigger studio builders when an action/creation verb is paired with the target asset type
    const hasBuildVerb = /\b(build|create|make|forge|generate|write|draft|design|architect|launch)\b/.test(p);
    if (/\b(ping|broadcast|announce|sync)\b/.test(p) && /\b(macbook|macbooks|laptops|fleet)\b/.test(p)) return 'dispatch_node';
    if (hasBuildVerb && /\b(funnel|landing page|business empire|monetize)\b/.test(p)) return 'build_business';
    if (hasBuildVerb && /\b(book|chapter|manuscript)\b/.test(p)) return 'build_book';
    if (hasBuildVerb && /\b(course|curriculum|syllabus|modules|academy)\b/.test(p)) return 'build_course';
    if (hasBuildVerb && /\b(app|application|dashboard|tracker|portal|crm|saas|scorecard)\b/.test(p)) return 'build_app';

    return 'chat';
  }

  function buildSmartLocalConversationalFallback(prompt, aiError) {
    const p = String(prompt || '').toLowerCase();
    const s = serverData.state?.settings || {};
    const aiName = s.assistantName || 'J.A.R.V.I.S.';
    const owner = (s.authorName && s.authorName !== 'Founder') ? s.authorName : 'friend';
    if (/\b(connector|connectors|api key|api keys|direct|link|plug|perplexity|openai|claude|clickup|genspark|cursor)\b/.test(p)) {
      if (p.includes('where') || p.includes('show')) switchView('connectors');
      return `Great question, ${owner}. In your Connectors Hub, you get both options: studio tools like Cursor, AIWriteBook, Genspark, Viktor AI, Sudowrite, and Amazon KDP link directly in one click with zero API key needed—just click Send Packet and Open and log in normally. Cloud AI brains like Gemini, OpenAI, Claude, Perplexity, and DeepSeek, or workspace syncs like Notion and ClickUp, take an API key or Webhook URL in that card so I can talk to them directly behind the scenes.`;
    }
    if (/\b(who are you|what can you do|help|how does this work|capabilities)\b/.test(p)) {
      return `I am ${aiName}, your personal executive AI Command Center. You can talk with me back and forth naturally about leadership, business strategy, research, or any question on your mind—and whenever you ask me to build an app, write a book chapter, design a course, or launch a funnel, I will create it right in your workspace.`;
    }
    if (!serverData.hasVaultGeminiKey) {
      return `I heard you clearly, ${owner}. To enable full open-ended AI answers on any topic, click Security and Settings on the left, paste your free Google Gemini API key, and click Save—or select another AI brain in your Connectors tab.`;
    }
    return `I heard your question, ${owner}—my cloud AI connection had a brief pause on that request. Go ahead and ask me once more and I am right here listening.`;
  }

  async function handleUserCommand(rawText) {
    if (!isAuthenticated) return;
    if (Voice.unlockAudioGesture) Voice.unlockAudioGesture();
    const prompt = String(rawText || '').trim();
    if (!prompt) return;
    el('commandInput').value = '';

    await apiPost('/api/chat/log', {
      role: 'user',
      text: prompt,
      sourceNode: currentDeviceNode,
      actionType: 'command'
    });
    await refreshState();

    setWaveMode('thinking');
    el('reactorOrb').classList.remove('listening', 'speaking');
    el('reactorOrb').classList.add('thinking');
    setOrbBadgeLabels('WORKING');
    el('voiceStatusText').textContent = 'THINKING & PREPARING YOUR ANSWER...';

    // Direct connector & automation UI shortcuts execute immediately without needing LLM roundtrip
    const directIntent = detectLocalIntent(prompt);
    const immediateActions = new Set([
      'greet_jarvis', 'open_projects', 'open_agents', 'run_all_agents', 'open_automations',
      'run_briefing', 'open_cursor', 'sync_obsidian', 'export_word', 'open_googledocs',
      'deploy_vercel', 'asana_task', 'export_notion', 'clickup_task', 'open_connectors',
      'send_lovable', 'send_emergent', 'send_mindsmith', 'send_workshop', 'send_hercules',
      'send_muse', 'send_grok',
      'send_aiwritebook', 'send_viktor', 'send_genspark', 'send_slack'
    ]);
    if (immediateActions.has(directIntent)) {
      await executeActionPlan({ action: directIntent, prompt }, prompt);
      return;
    }

    const settings = serverData.state.settings || {};
    let plan = null;
    let lastAiError = '';

    const recentChat = (serverData.state.chat || [])
      .filter((m) => m && m.text && !String(m.text).startsWith('Security shield active on') && m.actionType !== 'wake' && m.actionType !== 'wake_greeting')
      .slice(-6)
      .map((m) => ({ role: m.role, text: String(m.text).slice(0, 280) }));

    const candidates = buildSmartModelCandidates(prompt, directIntent, settings);
    const activeProj = getActiveProjectObj();
    const konshusWhisper = getKonshusMemoryWhisper();
    const combinedPersonaParts = [settings.customPersona || ''];
    if (activeProj) {
      combinedPersonaParts.push(`[ACTIVE PROJECT: ${activeProj.name}] Instructions: ${activeProj.customInstructions || ''}\nProject Knowledge: ${String(activeProj.knowledgeNotes || '').slice(0, 2800)}`);
    }
    if (konshusWhisper) {
      combinedPersonaParts.push(`[KONSHUS AI MEMORY VAULT]: ${konshusWhisper.slice(0, 2400)}`);
    }

    const contextSummary = {
      currentLaptop: currentDeviceNode,
      assistantName: settings.assistantName || 'J.A.R.V.I.S.',
      brandName: settings.brandName,
      authorName: settings.authorName && settings.authorName !== 'Founder' ? settings.authorName : 'Founder',
      customPersona: combinedPersonaParts.filter(Boolean).join('\n\n'),
      activeProject: activeProj
        ? {
            id: activeProj.id,
            name: activeProj.name,
            customInstructions: activeProj.customInstructions || '',
            knowledgeBase: String(activeProj.knowledgeNotes || '').slice(0, 3200)
          }
        : null,
      konshusMemoryWhisper: konshusWhisper ? konshusWhisper.slice(0, 2400) : '',
      activeModelRouterMode: settings.activeAiProvider || 'auto',
      selectedSpecialistBrain: candidates[0]?.tag || 'INSTANT',
      recentChat,
      existingProjects: (serverData.state.projects || []).map((p) => p.name),
      existingAgents: (serverData.state.agents || []).map((a) => `${a.name} (${a.role})`),
      existingApps: (serverData.state.apps || []).map((a) => a.title),
      existingBooks: (serverData.state.books || []).map((b) => b.title),
      existingCourses: (serverData.state.courses || []).map((c) => c.title)
    };

    for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const cand = candidates[cIdx];
      el('voiceStatusText').textContent = `🧭 ROUTED TO ${cand.tag} — THINKING...`;
      try {
        if (cand.provider === 'gemini') {
          plan = await Voice.askGemini(prompt, contextSummary, sessionCsrfToken, cand.geminiModel);
        } else {
          const aiRes = await apiPost('/api/connectors/ai-query', {
            provider: cand.provider,
            prompt,
            context: contextSummary
          });
          if (aiRes && aiRes.ok && aiRes.plan) {
            plan = aiRes.plan;
          } else if (aiRes && aiRes.error) {
            throw new Error(aiRes.error);
          }
        }
        if (plan) {
          lastAutoRoutedLabel = cand.tag;
          updateEngineBadge();
          break;
        }
      } catch (err) {
        lastAiError = err?.message || String(err);
        console.warn(`[JARVIS Smart Router] ${cand.provider} fallback:`, err);
      }
    }

    if (!plan) {
      plan = { action: directIntent, prompt, aiError: lastAiError };
    }

    await executeActionPlan(plan, prompt);
  }

  async function executeActionPlan(plan, rawPrompt) {
    const settings = serverData.state.settings || {};
    const action = plan.action || 'chat';

    if (action === 'greet_jarvis') {
      await jarvisReplyAndLog(buildTimeOfDayGreeting(), 'wake_greeting');
      if (Voice.openFollowUpListeningWindow) Voice.openFollowUpListeningWindow();
      return;
    }

    if (action === 'open_projects') {
      switchView('projects');
      await jarvisReplyAndLog('Projects Studio open. Each project holds its own custom instructions, reference notes, uploaded files, and agent deliverables.', 'projects');
      return;
    }

    if (action === 'open_agents') {
      switchView('agents');
      await jarvisReplyAndLog('Autonomous Multi-Agent Workforce open. You can run any specialist agent solo or launch all active agents in parallel.', 'agents');
      return;
    }

    if (action === 'run_all_agents') {
      switchView('agents');
      await runAllAgentsInParallel();
      return;
    }

    if (action === 'sync_obsidian') {
      const proj = getActiveProjectObj() || (serverData.state?.projects || [])[0];
      const title = proj ? proj.name : (activeLeadItem?.title || 'JARVIS Note');
      const bodyMd = proj
        ? `# ${proj.name}\n\n## Instructions\n${proj.customInstructions || ''}\n\n## Knowledge Base\n${proj.knowledgeNotes || ''}\n\n## Deliverables\n${proj.deliverables || ''}`
        : (el('leadMdEditor')?.value || activeLeadItem?.summary || rawPrompt);
      await syncToLocalConnector('obsidian', title, bodyMd, true);
      return;
    }

    if (action === 'export_word') {
      const proj = getActiveProjectObj() || (serverData.state?.projects || [])[0];
      const title = activeLeadItem?.title || proj?.name || 'JARVIS Executive Document';
      const bodyMd = el('leadMdEditor')?.value || proj?.deliverables || rawPrompt;
      await syncToLocalConnector('msword', title, bodyMd, true);
      return;
    }

    if (action === 'open_googledocs') {
      const proj = getActiveProjectObj() || (serverData.state?.projects || [])[0];
      const title = activeLeadItem?.title || proj?.name || 'JARVIS Document';
      const bodyMd = el('leadMdEditor')?.value || proj?.deliverables || rawPrompt;
      await openInGoogleDocs(title, bodyMd);
      return;
    }

    if (action === 'deploy_vercel') {
      const html = el('appCodeEditor')?.value || '';
      if (activeAppItem && html) {
        await deployHtmlToVercel(activeAppItem.title, html);
      } else {
        switchView('apps');
        await jarvisReplyAndLog('Select or forge an App or Funnel, then click the Vercel button to publish a live cloud URL.', 'vercel');
      }
      return;
    }

    if (action === 'asana_task') {
      const cleanName = rawPrompt.replace(/^(hey jarvis,?\s*)?(create|add|make|send|push)?\s*(an?\s*)?(asana)\s*(task)?\s*(to|for|:)?\s*/i, '').trim() || 'JARVIS Executive Action Item';
      await pushTaskToAsana(cleanName, `Created via JARVIS on ${currentDeviceNode}.\nFull request: ${rawPrompt}`);
      return;
    }

    if (action === 'open_automations') {
      switchView('automations');
      await jarvisReplyAndLog('Autonomous Routines and Scheduled Automations studio open. You can schedule daily spoken briefings, ClickUp sprints, Notion digests, or MacBook syncs.', 'automations');
      return;
    }

    if (action === 'run_briefing') {
      switchView('automations');
      const res = await apiPost('/api/automations/run-now', { id: 'auto-morning-brief' });
      await refreshState();
      const s = serverData.state.settings || {};
      await Voice.speak(res.summary || 'Executive briefing complete.', {
        muted: voiceMuted || s.voiceReply === false,
        rate: s.voiceRate || 1.02,
        pitch: s.voicePitch || 0.94,
        useGeminiTts: !!serverData.hasVaultGeminiKey,
        csrfToken: sessionCsrfToken
      });
      return;
    }

    if (action === 'open_connectors') {
      switchView('connectors');
      await jarvisReplyAndLog('Connectors and Sources Hub open. Filter by Book Writing, AI Coworkers, or Workspace apps anytime.', 'connectors');
      return;
    }

    if (action === 'send_lovable') {
      await launchPortalStudioWithPacket('lovable', rawPrompt);
      return;
    }

    if (action === 'send_emergent') {
      await launchPortalStudioWithPacket('emergent', rawPrompt);
      return;
    }

    if (action === 'send_mindsmith') {
      await launchPortalStudioWithPacket('mindsmith', rawPrompt);
      return;
    }

    if (action === 'send_workshop') {
      await launchPortalStudioWithPacket('workshop', rawPrompt);
      return;
    }

    if (action === 'send_hercules') {
      await launchPortalStudioWithPacket('hercules', rawPrompt);
      return;
    }

    if (action === 'send_muse') {
      await launchPortalStudioWithPacket('muse', rawPrompt);
      return;
    }

    if (action === 'send_grok') {
      await launchPortalStudioWithPacket('grok', rawPrompt);
      return;
    }

    if (action === 'send_aiwritebook') {
      await launchPortalStudioWithPacket('aiwritebook');
      return;
    }

    if (action === 'send_viktor') {
      await launchPortalStudioWithPacket('viktor', rawPrompt);
      return;
    }

    if (action === 'send_genspark') {
      await launchPortalStudioWithPacket('genspark', rawPrompt);
      return;
    }

    if (action === 'send_slack') {
      const res = await apiPost('/api/connectors/webhook-push', {
        connectorId: 'slack',
        eventType: 'slack_dispatch',
        title: 'J.A.R.V.I.S. Executive Update',
        summary: rawPrompt
      });
      if (res.ok) {
        Voice.playFx('complete');
        await jarvisReplyAndLog('Dispatched your update directly to Slack.', 'slack');
      } else {
        switchView('connectors');
        await jarvisReplyAndLog('Configure your Slack Incoming Webhook URL or Bot Token in the Connectors Hub first.', 'connectors');
      }
      return;
    }

    if (action === 'open_cursor') {
      const target = activeAppItem || activeLeadItem || activeBizItem;
      await openWorkspaceInCursor(target ? target.category : 'apps', target ? target.slug : '');
      return;
    }

    if (action === 'export_notion') {
      const pLow = rawPrompt.toLowerCase();
      if (pLow.includes('app') && activeAppItem) {
        await pushItemToNotion(activeAppItem.title, `# ${activeAppItem.title}\n\n${activeAppItem.summary || ''}\n\nExported from JARVIS App Forge.`);
      } else if ((pLow.includes('funnel') || pLow.includes('playbook') || pLow.includes('business')) && activeBizItem) {
        await pushItemToNotion(activeBizItem.title + ' — Funnel Playbook', el('bizPlaybookEditor').value || activeBizItem.summary || '');
      } else if (activeLeadItem) {
        await pushItemToNotion(activeLeadItem.title, el('leadMdEditor').value || activeLeadItem.summary || '');
      } else {
        switchView('connectors');
        await jarvisReplyAndLog('Select a Book, Course, App, or Funnel—or configure Notion in the Connectors Hub first.', 'connectors');
      }
      return;
    }

    if (action === 'clickup_task') {
      const cleanName = rawPrompt.replace(/^(hey jarvis,?\s*)?(create|add|make|send|push)?\s*(a\s*)?(clickup|click up)\s*(task)?\s*(to|for|:)?\s*/i, '').trim() || 'JARVIS Executive Action Item';
      await pushTaskToClickUp(cleanName, `Created via JARVIS voice/command on ${currentDeviceNode}.\nFull prompt: ${rawPrompt}`);
      return;
    }

    if (action === 'build_app') {
      const pkg = Gen.buildAppPackage({
        prompt: rawPrompt,
        title: plan.title,
        tagline: plan.subtitle,
        customHtml: plan.customHtml
      });
      const saved = await apiPost('/api/workspace/save', { ...pkg, sourceNode: currentDeviceNode });
      Voice.playFx('complete');
      await refreshState();
      if (saved.item) selectAppAsset(saved.item);
      switchView('apps');
      await jarvisReplyAndLog(
        plan.spokenReply || `I have forged "${pkg.title}", isolated its preview in a zero-trust sandbox, and synchronized it across your laptops.`,
        'build_app'
      );
      return;
    }

    if (action === 'build_business') {
      const latestApp = (serverData.state.apps || [])[0]?.title || 'Transformational Leader OS';
      const latestBook = (serverData.state.books || [])[0]?.title || 'The Transformational Leader';
      const latestCourse = (serverData.state.courses || [])[0]?.title || 'Executive Leadership Accelerator';

      const pkg = Gen.buildBusinessPackage({
        prompt: rawPrompt,
        title: plan.title || settings.brandName,
        authorName: settings.authorName,
        featuredApp: latestApp,
        featuredBook: latestBook,
        featuredCourse: latestCourse,
        heroPromise: plan.heroPromise
      });
      const saved = await apiPost('/api/workspace/save', { ...pkg, sourceNode: currentDeviceNode });
      Voice.playFx('complete');
      await refreshState();
      if (saved.item) selectBizAsset(saved.item);
      switchView('business');
      await jarvisReplyAndLog(
        plan.spokenReply || `Your online business funnel "${pkg.title}" is live across your authenticated fleet.`,
        'build_business'
      );
      return;
    }

    if (action === 'build_book') {
      const pkg = Gen.buildBookPackage({
        prompt: rawPrompt,
        title: plan.title,
        subtitle: plan.subtitle,
        authorName: settings.authorName,
        chapters: plan.chapters,
        manuscriptBody: plan.manuscriptBody
      });
      const saved = await apiPost('/api/workspace/save', { ...pkg, sourceNode: currentDeviceNode });
      Voice.playFx('complete');
      await refreshState();
      if (saved.item) selectLeadAsset(saved.item);
      switchView('leadership');
      await jarvisReplyAndLog(
        plan.spokenReply || `Your leadership book "${pkg.title}" outline and chapter draft are ready.`,
        'build_book'
      );
      return;
    }

    if (action === 'build_course') {
      const pkg = Gen.buildCoursePackage({
        prompt: rawPrompt,
        title: plan.title,
        outcome: plan.subtitle,
        modules: plan.modules
      });
      const saved = await apiPost('/api/workspace/save', { ...pkg, sourceNode: currentDeviceNode });
      Voice.playFx('complete');
      await refreshState();
      if (saved.item) selectLeadAsset(saved.item);
      switchView('leadership');
      await jarvisReplyAndLog(
        plan.spokenReply || `Your 6-module leadership course "${pkg.title}" and student portal are ready.`,
        'build_course'
      );
      return;
    }

    if (action === 'dispatch_node') {
      let target = plan.targetNode || 'ALL';
      const pLower = rawPrompt.toLowerCase();
      if (pLower.includes('alpha') || pLower.includes('#1') || pLower.includes('macbook 1')) target = 'MACBOOK-ALPHA';
      else if (pLower.includes('beta') || pLower.includes('#2') || pLower.includes('macbook 2')) target = 'MACBOOK-BETA';
      else if (pLower.includes('gamma') || pLower.includes('#3') || pLower.includes('macbook 3')) target = 'MACBOOK-GAMMA';

      const cmdType = plan.commandType || (pLower.includes('sync') ? 'sync_workspace' : 'announce');
      const payload = plan.commandPayload || 'Jarvis Command Center synchronized and standing by.';
      await apiPost('/api/nodes/dispatch', { targetNode: target, commandType: cmdType, payload });
      Voice.playFx('complete');
      switchView('fleet');
      await jarvisReplyAndLog(
        plan.spokenReply || `Authenticated command "${cmdType}" queued for ${target}.`,
        'dispatch_node'
      );
      return;
    }

    const defaultChat = plan.spokenReply || buildSmartLocalConversationalFallback(rawPrompt, plan.aiError);
    await jarvisReplyAndLog(defaultChat, 'chat');
  }

  /* ================= ZERO-TRUST SANDBOXED IFRAME PREVIEWS ================= */
  async function loadSandboxedIframe(iframeEl, previewUrl, openBtnEl) {
    const res = await fetch(previewUrl + '?t=' + Date.now(), { credentials: 'same-origin' });
    if (!res.ok) return '';
    const html = await res.text();
    iframeEl.srcdoc = html;
    if (openBtnEl && window.JARVIS_STANDALONE_PWA) {
      openBtnEl.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    }
    return html;
  }

  async function selectAppAsset(item) {
    activeAppItem = item;
    el('appPreviewTitle').textContent = `APP WORKSPACE // ${item.title.toUpperCase()}`;
    el('btnAppOpenNew').href = item.previewUrl;
    const html = await loadSandboxedIframe(el('appPreviewIframe'), item.previewUrl, el('btnAppOpenNew'));
    if (html) el('appCodeEditor').value = html;
    renderAssetLists();
  }

  async function selectBizAsset(item) {
    activeBizItem = item;
    el('bizPreviewTitle').textContent = `FUNNEL // ${item.title.toUpperCase()}`;
    el('btnBizOpenNew').href = item.previewUrl;
    await loadSandboxedIframe(el('bizPreviewIframe'), item.previewUrl, el('btnBizOpenNew'));

    try {
      const pbRes = await fetch(`/workspace/business/${item.slug}/LAUNCH-PLAYBOOK.md?t=${Date.now()}`, { credentials: 'same-origin' });
      if (pbRes.ok) el('bizPlaybookEditor').value = await pbRes.text();
    } catch (e) {}
    renderAssetLists();
  }

  async function selectLeadAsset(item) {
    activeLeadItem = item;
    el('leadPreviewTitle').textContent = `${item.category.toUpperCase()} // ${item.title.toUpperCase()}`;
    el('btnLeadOpenNew').href = item.previewUrl;
    await loadSandboxedIframe(el('leadPreviewIframe'), item.previewUrl, el('btnLeadOpenNew'));

    const mdFile = item.category === 'books' ? 'MANUSCRIPT.md' : 'CURRICULUM.md';
    try {
      const mdRes = await fetch(`/workspace/${item.category}/${item.slug}/${mdFile}?t=${Date.now()}`, { credentials: 'same-origin' });
      if (mdRes.ok) el('leadMdEditor').value = await mdRes.text();
    } catch (e) {}
    renderAssetLists();
  }

  /* ================= PERSONALIZATION & HOLOGRAM PERSON STAGE ================= */
  function applyPersonalizationAndHologram(settings) {
    const s = settings || {};
    const aiName = (s.assistantName || 'J.A.R.V.I.S.').trim();
    const wakeWord = (s.wakeWord || 'jarvis').trim();
    window.JARVIS_ASSISTANT_NAME = aiName;
    window.JARVIS_WAKE_WORD = wakeWord;

    if (Voice.setVoicePreference) {
      Voice.setVoicePreference(s.voiceGender || 'male');
    }

    if (el('hudAssistantTitle')) el('hudAssistantTitle').textContent = aiName;
    document.title = `${aiName} // Personal Executive AI Command Center`;
    if (el('commandInput') && document.activeElement !== el('commandInput')) {
      el('commandInput').placeholder = `Speak or type to ${aiName} — ask any question, or say "Build me an app", "Write Chapter 1", "Create a course"...`;
    }
    if (el('btnOpenNotionHub')) {
      const isJusino = String(s.authorName || '').toLowerCase().includes('jusino');
      el('btnOpenNotionHub').href = isJusino
        ? 'https://app.notion.com/p/41537a4325628115abf7cb2f6474e4e1?pvs=204'
        : 'https://www.notion.so';
    }
    syncWakeToggleButtons();

    // Holographic Person / Custom Portrait vs Classic Arc Reactor Orb
    const mode = s.avatarMode || 'orb';
    const hasCustomImg = !!(s.customAvatarDataUrl && String(s.customAvatarDataUrl).startsWith('data:image/'));
    const orbWrap = el('reactorOrb');
    if (orbWrap) {
      orbWrap.classList.toggle('has-hologram', mode !== 'orb');
    }
    if (el('holoSvgMale')) {
      el('holoSvgMale').style.display = (mode === 'holo_male' || (mode === 'custom_photo' && !hasCustomImg)) ? 'block' : 'none';
    }
    if (el('holoSvgFemale')) {
      el('holoSvgFemale').style.display = mode === 'holo_female' ? 'block' : 'none';
    }
    if (el('holoCustomImg')) {
      if (mode === 'custom_photo' && hasCustomImg) {
        if (el('holoCustomImg').getAttribute('src') !== s.customAvatarDataUrl) {
          el('holoCustomImg').setAttribute('src', s.customAvatarDataUrl);
        }
        el('holoCustomImg').style.display = 'block';
        el('holoCustomImg').classList.toggle('cyan-tint', s.holoTint !== false);
      } else {
        el('holoCustomImg').style.display = 'none';
      }
    }

    if (el('btnQuickCycleAvatar')) {
      const modeLabels = {
        orb: '◉ Avatar: ORB',
        holo_male: '👤 Holo: PERSON (M)',
        holo_female: '👩 Holo: PERSON (F)',
        custom_photo: '🖼 Holo: PHOTO'
      };
      el('btnQuickCycleAvatar').textContent = modeLabels[mode] || '◉ Avatar: ORB';
      el('btnQuickCycleAvatar').classList.toggle('btn-primary', mode !== 'orb');
    }
  }

  /* ================= RENDER UI ================= */
  function renderState() {
    const st = serverData.state || {};
    const settings = st.settings || {};
    applyPersonalizationAndHologram(settings);
    const aiName = settings.assistantName || 'J.A.R.V.I.S.';
    updateEngineBadge();

    const projects = st.projects || [];
    const agents = st.agents || [];
    const apps = st.apps || [];
    const biz = st.business || [];
    const books = st.books || [];
    const courses = st.courses || [];
    const automations = st.automations || [];
    const nodes = serverData.nodes || [];
    const onlineCount = nodes.filter((n) => n.online).length;

    if (el('countProjects')) el('countProjects').textContent = projects.length;
    if (el('countAgents')) el('countAgents').textContent = agents.length;
    el('countApps').textContent = apps.length;
    el('countBusiness').textContent = biz.length;
    el('countLeadership').textContent = books.length + courses.length;
    el('countFleet').textContent = `${onlineCount}/${nodes.length || 5}`;
    if (el('countAutomations')) {
      el('countAutomations').textContent = automations.filter((a) => a.enabled).length;
    }
    if (el('countConnectors')) {
      const cfgConn = serverData.configuredConnectorCount ?? connectorsData.configuredCount ?? 0;
      el('countConnectors').textContent = cfgConn;
    }

    el('kpiApps').textContent = apps.length;
    el('kpiFunnels').textContent = biz.length;
    el('kpiBooksCourses').textContent = books.length + courses.length;
    el('kpiNodesOnline').textContent = `${onlineCount} / ${nodes.length || 5}`;

    const ips = serverData.host?.ips || [];
    const port = serverData.host?.port || 7777;
    const preferredIp = ips.find((ip) => ip.startsWith('100.')) || ips[0] || window.location.hostname || 'localhost';
    const hubUrl = `http://${preferredIp}:${port}`;
    const tok = securityInfo.agentToken || '<UNLOCK_TO_VIEW_TOKEN>';

    el('sidebarLanUrl').textContent = hubUrl;
    el('fleetLanUrlInline').textContent = hubUrl;
    if (el('macDesktopAppOneLiner')) {
      el('macDesktopAppOneLiner').textContent = `curl -fsSL "${hubUrl}/install-mac-app.sh" | bash -s -- "${hubUrl}"`;
    }
    if (el('iosWifiUrlInline')) el('iosWifiUrlInline').textContent = hubUrl;
    if (el('btnTopIosGem') && settings.iosGemUrl) el('btnTopIosGem').href = settings.iosGemUrl;
    el('macAgentOneLiner').textContent =
      `curl -fsSL -H "X-Jarvis-Agent-Token: ${tok}" "${hubUrl}/agents/macbook-node.sh" | bash -s -- "${hubUrl}" MACBOOK-ALPHA "${tok}"`;

    el('topFleetPills').innerHTML = nodes.map((n) => `
      <div class="node-pill ${n.online ? 'online' : ''}" onclick="document.querySelector('[data-view=fleet]').click()">
        <span class="node-dot"></span>
        <span>${escapeHtml(n.nodeId.replace('WINDOWS-', 'WIN-').replace('MACBOOK-', 'MAC-').replace('IOS-PRIME', 'IOS'))}</span>
      </div>
    `).join('');

    const chatEl = el('chatStream');
    chatEl.innerHTML = (st.chat || []).map((m) => {
      const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="chat-msg ${m.role === 'assistant' ? 'assistant' : 'user'}">
          <div class="chat-meta">
            <span>${m.role === 'assistant' ? escapeHtml(aiName) : escapeHtml(m.sourceNode || 'USER')}</span>
            <span>•</span>
            <span>${timeStr}</span>
          </div>
          <div>${escapeHtml(m.text)}</div>
        </div>`;
    }).join('');
    chatEl.scrollTop = chatEl.scrollHeight;

    el('fleetCardsGrid').innerHTML = nodes.map((n) => `
      <div class="laptop-card ${n.online ? 'online' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--cyan);">${escapeHtml(n.nodeId)}</div>
            <div style="font-size:15px;font-weight:700;">${escapeHtml(n.name)}</div>
          </div>
          <span class="hud-badge" style="${n.online ? 'border-color:var(--emerald);color:#6ee7b7;' : 'color:var(--text-muted);'}">
            ${n.online ? '● VERIFIED' : '○ STANDBY'}
          </span>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
          ${escapeHtml(n.os)} • ${escapeHtml(n.arch)} • IP: ${escapeHtml(n.ip)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
          <div>
            <div style="font-size:11px;color:var(--text-muted);">CPU Load (${Number(n.cpuLoad || 0)}%)</div>
            <div class="meter-bar"><div class="meter-fill" style="width:${Number(n.cpuLoad || 0)}%"></div></div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);">Memory (${Number(n.memUsedPct || 0)}%)</div>
            <div class="meter-bar"><div class="meter-fill" style="width:${Number(n.memUsedPct || 0)}%"></div></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm" onclick="window.jarvisFleetAction('${escapeHtml(n.nodeId)}', 'announce')">🔊 Voice Ping</button>
          <button class="btn btn-sm" onclick="window.jarvisFleetAction('${escapeHtml(n.nodeId)}', 'open_hud')">🖥 Open HUD</button>
          <button class="btn btn-sm btn-emerald" onclick="window.jarvisFleetAction('${escapeHtml(n.nodeId)}', 'sync_workspace')">🔄 Sync</button>
        </div>
      </div>
    `).join('');

    renderAssetLists();
    renderAutomationsGrid(automations);
    renderProjectsStudio(projects);
    renderAgentsStudio(agents, projects);

    if (!activeAppItem && apps.length > 0) selectAppAsset(apps[0]);
    if (!activeBizItem && biz.length > 0) selectBizAsset(biz[0]);
    if (!activeLeadItem && (books.length + courses.length) > 0) selectLeadAsset(books[0] || courses[0]);
  }

  function renderAutomationsGrid(automations) {
    const grid = el('automationsCardsGrid');
    if (!grid) return;
    const actionLabels = {
      morning_briefing: '🔊 Spoken Executive Briefing + Log',
      sync_fleet: '🔄 Sync Workspace Across 3 MacBooks',
      clickup_sprint: '✅ Create Sprint Task in ClickUp',
      notion_digest: '📝 Publish Status Digest Page to Notion',
      webhook_trigger: '🔗 Outbound Webhook / Viktor AI / n8n'
    };
    grid.innerHTML = (automations || []).map((a) => {
      const schedDesc = a.scheduleType === 'daily_time'
        ? `Daily @ ${escapeHtml(a.dailyTime || '08:00')}`
        : `Every ${Number(a.intervalMinutes || 60)} mins`;
      const lastRunStr = a.lastRunAt ? new Date(a.lastRunAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not yet run';
      return `
        <div class="hud-card" style="border-color:${a.enabled ? 'rgba(16,185,129,0.45)' : 'rgba(0,240,255,0.16)'};">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
            <div>
              <div style="font-size:14.5px;font-weight:700;color:#fff;">${escapeHtml(a.name)}</div>
              <div style="font-size:11.5px;color:var(--cyan);margin-top:2px;">${actionLabels[a.actionType] || escapeHtml(a.actionType)} • <strong>${schedDesc}</strong></div>
            </div>
            <span class="hud-badge" style="${a.enabled ? 'border-color:var(--emerald);color:#6ee7b7;' : 'color:var(--text-muted);'}">
              ${a.enabled ? '● ACTIVE' : '⏸ PAUSED'}
            </span>
          </div>
          ${a.payload ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${escapeHtml(a.payload)}</div>` : ''}
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;padding:6px 8px;background:rgba(0,0,0,0.28);border-radius:6px;">
            <strong>Last Run:</strong> ${escapeHtml(lastRunStr)}<br/>
            <strong>Status:</strong> ${escapeHtml(a.lastResult || 'Ready')}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-emerald" onclick="window.jarvisAutoAction('${escapeHtml(a.id)}', 'run')">▶ Run Now &amp; Speak</button>
            <button class="btn btn-sm" onclick="window.jarvisAutoAction('${escapeHtml(a.id)}', 'toggle')">${a.enabled ? '⏸ Pause' : '🟢 Enable'}</button>
            <button class="btn btn-sm" style="margin-left:auto;color:#fca5a5;" onclick="window.jarvisAutoAction('${escapeHtml(a.id)}', 'delete')" title="Delete Automation">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderAssetLists() {
    const st = serverData.state || {};
    const apps = st.apps || [];
    const biz = st.business || [];
    const lead = [...(st.books || []), ...(st.courses || [])];

    el('appsAssetList').innerHTML = apps.map((a) => `
      <div class="asset-item ${activeAppItem?.id === a.id ? 'active' : ''}" data-id="${escapeHtml(a.id)}">
        <div class="asset-title">⚡ ${escapeHtml(a.title)}</div>
        <div class="asset-sub">${escapeHtml(a.summary || '')}</div>
      </div>`).join('');
    el('appsAssetList').querySelectorAll('.asset-item').forEach((node) => {
      node.onclick = () => { const f = apps.find((x) => x.id === node.dataset.id); if (f) selectAppAsset(f); };
    });

    el('bizAssetList').innerHTML = biz.map((b) => `
      <div class="asset-item ${activeBizItem?.id === b.id ? 'active' : ''}" data-id="${escapeHtml(b.id)}">
        <div class="asset-title">◈ ${escapeHtml(b.title)}</div>
        <div class="asset-sub">${escapeHtml(b.summary || '')}</div>
      </div>`).join('');
    el('bizAssetList').querySelectorAll('.asset-item').forEach((node) => {
      node.onclick = () => { const f = biz.find((x) => x.id === node.dataset.id); if (f) selectBizAsset(f); };
    });

    el('leadershipAssetList').innerHTML = lead.map((l) => `
      <div class="asset-item ${activeLeadItem?.id === l.id ? 'active' : ''}" data-id="${escapeHtml(l.id)}">
        <div class="asset-title">${l.category === 'books' ? '📖' : '🎓'} ${escapeHtml(l.title)}</div>
        <div class="asset-sub">${escapeHtml(l.summary || '')}</div>
      </div>`).join('');
    el('leadershipAssetList').querySelectorAll('.asset-item').forEach((node) => {
      node.onclick = () => { const f = lead.find((x) => x.id === node.dataset.id); if (f) selectLeadAsset(f); };
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function seedStarterEcosystemIfEmpty() {
    if (bootSeeded) return;
    const st = serverData.state || {};
    const total = (st.apps?.length || 0) + (st.business?.length || 0) + (st.books?.length || 0) + (st.courses?.length || 0);
    bootSeeded = true;
    if (total > 0) return;

    const appPkg = Gen.buildAppPackage({ title: 'Transformational Leader OS', prompt: 'Executive OKR, habit, and clarity scorecard' });
    const bookPkg = Gen.buildBookPackage({ title: 'Leading With Unshakable Clarity', authorName: st.settings?.authorName || 'Founder' });
    const coursePkg = Gen.buildCoursePackage({ title: '6-Week Executive Leadership Accelerator' });
    const bizPkg = Gen.buildBusinessPackage({
      title: st.settings?.brandName || 'Apex Leadership & Venture Lab',
      authorName: st.settings?.authorName || 'Founder',
      featuredApp: appPkg.title,
      featuredBook: bookPkg.title,
      featuredCourse: coursePkg.title
    });
    await apiPost('/api/workspace/save', { ...appPkg, sourceNode: 'JARVIS-CORE' });
    await apiPost('/api/workspace/save', { ...bookPkg, sourceNode: 'JARVIS-CORE' });
    await apiPost('/api/workspace/save', { ...coursePkg, sourceNode: 'JARVIS-CORE' });
    await apiPost('/api/workspace/save', { ...bizPkg, sourceNode: 'JARVIS-CORE' });
  }

  async function seedProjectsAndAgentsIfEmpty() {
    if (projectsAgentsSeeded) return;
    projectsAgentsSeeded = true;
    const st = serverData.state || {};
    const owner = st.settings?.authorName || 'Founder';
    let needRefresh = false;

    let firstProjId = 'proj-leadership-flagship';
    let secondProjId = 'proj-ventures-lab';
    if (!st.projects || st.projects.length === 0) {
      needRefresh = true;
      await apiPost('/api/projects/save', {
        id: firstProjId,
        name: 'Book & Academy: Unshakable Clarity',
        customInstructions: `Act as ${owner}'s dedicated executive book ghostwriter, curriculum architect, and thought-leadership strategist. Write with clarity, warmth, actionable stories, and practical reflection frameworks.`,
        knowledgeNotes: `# Core Pillars\n1. Decisive Clarity Under Pressure\n2. High-Trust Team Architecture\n3. Daily Executive Scorecards & Cadence\n\nTarget Readers: Ambitious executives, founders, educators, and emerging leaders.`,
        deliverables: `# Project Deliverables & Working Notes\n- Ready for chapter outlines, research briefs, and autonomous agent reports.`
      });
      await apiPost('/api/projects/save', {
        id: secondProjId,
        name: 'AI Ventures & Digital Ecosystem',
        customInstructions: `Act as ${owner}'s Chief Product & Growth Strategist. Design high-value SaaS tools, coaching cohorts, and ethical conversion funnels uniting apps, books, and courses.`,
        knowledgeNotes: `# Ecosystem Value Ladder\n- Lead Magnet / App: Transformational Leader OS\n- Book ($29): Leading With Unshakable Clarity\n- Cohort / Course ($297+): 6-Week Executive Leadership Accelerator`,
        deliverables: `# Venture Launch Notes & Agent Briefs\n- Ready for funnel copy, Vercel deployment checks, and Asana/ClickUp sprint plans.`
      });
    } else {
      firstProjId = st.projects[0]?.id || '';
      secondProjId = st.projects[1]?.id || firstProjId;
    }

    if (!st.agents || st.agents.length === 0) {
      needRefresh = true;
      const starterAgents = [
        {
          id: 'agent-atlas-research',
          emoji: '🔎',
          name: 'Atlas',
          role: 'Executive Research & Trend Scout',
          preferredBrain: 'auto',
          projectId: firstProjId,
          scheduleMins: 0,
          enabled: true,
          systemPrompt: `You are Atlas, an elite executive research analyst working for ${owner}. Synthesize timely leadership insights, statistics, and practical examples in crisp structured Markdown.`,
          taskPrompt: 'Identify 3 high-impact leadership & organizational clarity challenges leaders face right now, with executive takeaways and book/keynote angles.',
          reports: []
        },
        {
          id: 'agent-scribe-author',
          emoji: '📖',
          name: 'Scribe',
          role: 'Book & Course Ghostwriter',
          preferredBrain: 'auto',
          projectId: firstProjId,
          scheduleMins: 0,
          enabled: true,
          systemPrompt: `You are Scribe, ${owner}'s senior book co-author and instructional designer. Write engaging, authoritative, human-centered prose and actionable exercises.`,
          taskPrompt: 'Draft a compelling 350-word opening leadership story and a 3-question Executive Reflection Checklist for our flagship book and course.',
          reports: []
        },
        {
          id: 'agent-vanguard-growth',
          emoji: '📈',
          name: 'Vanguard',
          role: 'Venture & Funnel Strategist',
          preferredBrain: 'auto',
          projectId: secondProjId,
          scheduleMins: 0,
          enabled: true,
          systemPrompt: `You are Vanguard, an online venture & conversion strategist for ${owner}. Focus on high-trust positioning, clear offers, and measurable execution.`,
          taskPrompt: 'Create a 5-step weekly growth & launch checklist connecting our Interactive App, Leadership Book, and 6-Week Course.',
          reports: []
        },
        {
          id: 'agent-chief-of-staff',
          emoji: '🧭',
          name: 'Chief of Staff',
          role: 'Daily Priority & Operations Synthesizer',
          preferredBrain: 'auto',
          projectId: secondProjId,
          scheduleMins: 0,
          enabled: true,
          systemPrompt: `You are ${owner}'s Chief of Staff AI. Turn complex ideas across projects into a calm, crystal-clear Top 3 Executive Action Plan ready for Asana, ClickUp, Notion, or Obsidian.`,
          taskPrompt: 'Review our active workspace projects, apps, books, and courses and produce today\'s Top 3 High-Leverage Executive Priorities.',
          reports: []
        }
      ];
      for (let i = starterAgents.length - 1; i >= 0; i--) {
        await apiPost('/api/agents/save', starterAgents[i]);
      }
    }
    return needRefresh;
  }

  async function refreshState() {
    if (!isAuthenticated) return;
    try {
      const data = await apiGet('/api/state');
      if (data && data.ok) {
        serverData = data;
        let didSeed = false;
        if (!bootSeeded) {
          await seedStarterEcosystemIfEmpty();
          didSeed = true;
        }
        if (!projectsAgentsSeeded) {
          const seededPA = await seedProjectsAndAgentsIfEmpty();
          if (seededPA) didSeed = true;
        }
        if (didSeed) {
          const fresh = await apiGet('/api/state');
          if (fresh && fresh.ok) serverData = fresh;
        }
        renderState();
      }
    } catch (e) {}
  }

  /* ================= UI EVENT BINDINGS ================= */
  el('currentDeviceSelect').value = currentDeviceNode;
  el('currentDeviceSelect').addEventListener('change', (e) => {
    currentDeviceNode = e.target.value;
    localStorage.setItem('jarvis_device_node', currentDeviceNode);
    refreshState();
  });

  el('reactorOrb').addEventListener('click', () => isAuthenticated && Voice.togglePushToTalk());
  el('btnDockMic').addEventListener('click', () => isAuthenticated && Voice.togglePushToTalk());

  const btnTestVoice = el('btnTestVoice');
  if (btnTestVoice) {
    btnTestVoice.addEventListener('click', async () => {
      if (!isAuthenticated) return;
      if (Voice.unlockAudioGesture) Voice.unlockAudioGesture();
      Voice.playFx('wake');
      const s = serverData.state?.settings || {};
      const aiName = s.assistantName || 'J.A.R.V.I.S.';
      const owner = (s.authorName && s.authorName !== 'Founder') ? s.authorName : 'friend';
      await Voice.speak(
        `${aiName} online and at your service, ${owner}. Voice conversation, holographic display, and smart model routing are active.`,
        {
          muted: false,
          rate: s.voiceRate || 1.02,
          pitch: s.voicePitch || (s.voiceGender === 'female' ? 1.04 : 0.94),
          useGeminiTts: !!serverData.hasVaultGeminiKey,
          csrfToken: sessionCsrfToken
        }
      );
    });
  }

  if (el('btnQuickCycleAvatar')) {
    el('btnQuickCycleAvatar').addEventListener('click', async () => {
      if (!isAuthenticated) return;
      const s = serverData.state?.settings || {};
      const hasCustom = !!(s.customAvatarDataUrl && String(s.customAvatarDataUrl).startsWith('data:image/'));
      const order = hasCustom
        ? ['orb', 'holo_male', 'holo_female', 'custom_photo']
        : ['orb', 'holo_male', 'holo_female'];
      const cur = s.avatarMode || 'orb';
      const next = order[(order.indexOf(cur) + 1) % order.length];
      let nextGender = s.voiceGender || 'male';
      if (next === 'holo_female') nextGender = 'female';
      else if (next === 'holo_male') nextGender = 'male';

      serverData.state.settings = { ...s, avatarMode: next, voiceGender: nextGender };
      applyPersonalizationAndHologram(serverData.state.settings);
      Voice.playFx('wake');
      await apiPost('/api/settings', { avatarMode: next, voiceGender: nextGender });
    });
  }

  function syncWakeToggleButtons() {
    const ww = (window.JARVIS_WAKE_WORD || 'Jarvis').trim();
    const capWake = ww ? (ww.charAt(0).toUpperCase() + ww.slice(1)) : 'Jarvis';
    if (el('btnHandsFree')) {
      el('btnHandsFree').textContent = `🎧 Voice Wake ("Hi ${capWake}"): ${handsFreeOn ? 'ON' : 'OFF'}`;
      el('btnHandsFree').classList.toggle('btn-emerald', handsFreeOn);
    }
    if (el('btnClapWake')) {
      el('btnClapWake').textContent = `👏 Clap Wake (2x): ${clapWakeOn ? 'ON' : 'OFF'}`;
      el('btnClapWake').classList.toggle('btn-emerald', clapWakeOn);
    }
  }

  async function armAutoWakeSensorsOnOpen() {
    if (wakeAutoArmedOnce || !isAuthenticated) return;
    wakeAutoArmedOnce = true;

    const secureMic = !Voice.isSecureMicAvailable || Voice.isSecureMicAvailable();
    if (!secureMic) {
      handsFreeOn = false;
      clapWakeOn = false;
      syncWakeToggleButtons();
      if (el('voiceStatusText')) {
        el('voiceStatusText').textContent = '🔊 SPOKEN REPLIES ACTIVE — FOR LIVE MAC MIC, OPEN http://localhost:7777 (JARVIS MAC APP) OR PRESS FN 2X TO DICTATE!';
      }
      return;
    }

    const wantVoice = localStorage.getItem('jarvis_voice_wake') !== 'false';
    const wantClap = localStorage.getItem('jarvis_clap_wake') !== 'false';
    const safariBrowser = Voice.isAppleSafari && Voice.isAppleSafari();

    // Apple Safari (macOS & iOS) requires a direct user click/tap before starting SpeechRecognition
    if (safariBrowser || isIosBrowser) {
      syncWakeToggleButtons();
      const armOnFirstSafariTap = async () => {
        if (!isAuthenticated) return;
        if (wantVoice && !handsFreeOn) {
          handsFreeOn = Voice.setHandsFreeMode(true, true);
        }
        if (wantClap && !clapWakeOn && Voice.setClapWakeMode) {
          clapWakeOn = await Voice.setClapWakeMode(true);
        }
        syncWakeToggleButtons();
      };
      window.addEventListener('click', armOnFirstSafariTap, { once: true });
      window.addEventListener('touchend', armOnFirstSafariTap, { once: true });
      return;
    }

    if (wantVoice) {
      handsFreeOn = Voice.setHandsFreeMode(true, true);
    }
    if (wantClap && Voice.setClapWakeMode) {
      clapWakeOn = await Voice.setClapWakeMode(true);
    }
    syncWakeToggleButtons();
  }

  if (el('btnClapWake')) {
    el('btnClapWake').addEventListener('click', async () => {
      if (!isAuthenticated) return;
      if (Voice.unlockAudioGesture) Voice.unlockAudioGesture();
      const next = !clapWakeOn;
      clapWakeOn = await Voice.setClapWakeMode(next);
      if (next && !clapWakeOn) {
        alert('Allow Microphone permission in your browser bar (or use localhost / Tailscale HTTPS on remote devices) to enable Clap-to-Wake.');
      }
      localStorage.setItem('jarvis_clap_wake', clapWakeOn ? 'true' : 'false');
      if (clapWakeOn) Voice.playFx('wake');
      syncWakeToggleButtons();
    });
  }

  el('btnHandsFree').addEventListener('click', () => {
    if (!isAuthenticated) return;
    if (Voice.unlockAudioGesture) Voice.unlockAudioGesture();
    handsFreeOn = Voice.setHandsFreeMode(!handsFreeOn);
    localStorage.setItem('jarvis_voice_wake', handsFreeOn ? 'true' : 'false');
    syncWakeToggleButtons();
  });

  el('btnMuteSpeech').addEventListener('click', () => {
    voiceMuted = !voiceMuted;
    if (voiceMuted) Voice.stopSpeaking();
    el('btnMuteSpeech').textContent = voiceMuted ? '🔇 Voice: MUTED' : '🔊 Voice: ON';
  });

  el('btnStopVoice').addEventListener('click', () => Voice.stopSpeaking());
  el('btnClearChat').addEventListener('click', async () => { await apiPost('/api/chat/clear', {}); refreshState(); });

  el('btnGeminiLive').addEventListener('click', async () => {
    if (!isAuthenticated) return;
    try {
      const active = await Voice.toggleGeminiLiveStream(sessionCsrfToken, (msg) => {
        el('voiceStatusText').textContent = msg.toUpperCase();
      });
      el('btnGeminiLive').textContent = active ? '⏹ Disconnect Gemini Live' : '⚡ Gemini Live Audio';
    } catch (err) {
      alert(err.message);
      openSettingsModal();
    }
  });

  document.querySelectorAll('.chip-btn').forEach((chip) => {
    chip.addEventListener('click', () => handleUserCommand(chip.dataset.prompt));
  });

  el('btnSendCommand').addEventListener('click', () => {
    Voice.finalizeAndStopListening(false);
    handleUserCommand(el('commandInput').value);
  });
  el('commandInput').addEventListener('focus', () => {
    Voice.cancelAutoSendBecauseUserIsTyping();
  });
  el('commandInput').addEventListener('input', () => {
    Voice.cancelAutoSendBecauseUserIsTyping();
  });
  el('commandInput').addEventListener('keydown', (e) => {
    Voice.cancelAutoSendBecauseUserIsTyping();
    if (e.key === 'Enter') {
      e.preventDefault();
      Voice.finalizeAndStopListening(false);
      handleUserCommand(el('commandInput').value);
    }
  });

  // Hold Spacebar = Walkie-Talkie Hold-to-Talk (ignores key auto-repeat!)
  window.addEventListener('keydown', (e) => {
    if (!isAuthenticated || e.repeat) return;
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      e.preventDefault();
      Voice.beginHoldToTalk();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (!isAuthenticated) return;
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      e.preventDefault();
      Voice.endHoldToTalk();
    }
  });

  // App Forge
  el('btnBuildApp').addEventListener('click', async () => {
    const title = el('appTitleInput').value.trim() || 'Executive Momentum Scorecard';
    const prompt = el('appPromptInput').value.trim() || `Build ${title} (${el('appTypeInput').value})`;
    await handleUserCommand(`Build me an application titled "${title}": ${prompt}`);
  });
  el('btnMonetizeApp').addEventListener('click', () => {
    el('bizAppInput').value = activeAppItem?.title || el('appTitleInput').value.trim() || 'Executive App';
    switchView('business');
  });
  el('btnAppTabPreview').addEventListener('click', () => { el('appIframeWrap').style.display = 'block'; el('appCodeWrap').style.display = 'none'; });
  el('btnAppTabCode').addEventListener('click', () => { el('appIframeWrap').style.display = 'none'; el('appCodeWrap').style.display = 'block'; });
  el('btnSaveAppCode').addEventListener('click', async () => {
    if (!activeAppItem) return;
    const saved = await apiPost('/api/workspace/save', {
      id: activeAppItem.id, category: 'apps', title: activeAppItem.title, slug: activeAppItem.slug,
      summary: activeAppItem.summary, sourceNode: currentDeviceNode, files: { 'index.html': el('appCodeEditor').value }
    });
    if (saved.item) selectAppAsset(saved.item);
  });

  // Business Simulator & Builder
  function updateRevenueSim() {
    const traffic = Number(el('simTraffic').value || 0);
    const convPct = Number(el('simConv').value || 0) / 100;
    const total = (Math.round(traffic * 0.045) * 29) + (Math.round(traffic * convPct) * 297) + (Math.max(1, Math.round(traffic * convPct * 0.06)) * 1490);
    el('simMrrOutput').textContent = '$' + total.toLocaleString() + '/mo';
  }
  el('simTraffic').addEventListener('input', updateRevenueSim);
  el('simConv').addEventListener('input', updateRevenueSim);
  updateRevenueSim();

  el('btnBuildBusiness').addEventListener('click', async () => {
    const s = serverData.state.settings || {};
    const pkg = Gen.buildBusinessPackage({
      title: el('bizTitleInput').value.trim() || s.brandName || 'Apex Leadership Venture',
      authorName: s.authorName || 'Founder',
      featuredApp: el('bizAppInput').value.trim() || activeAppItem?.title || 'Transformational Leader OS',
      featuredBook: el('bizBookInput').value.trim() || (serverData.state.books || [])[0]?.title || 'The Transformational Leader',
      featuredCourse: el('bizCourseInput').value.trim() || (serverData.state.courses || [])[0]?.title || '6-Week Leadership Accelerator',
      heroPromise: el('bizPromiseInput').value.trim() || undefined
    });
    const saved = await apiPost('/api/workspace/save', { ...pkg, sourceNode: currentDeviceNode });
    Voice.playFx('complete');
    await refreshState();
    if (saved.item) selectBizAsset(saved.item);
    await jarvisReplyAndLog(`Online business funnel "${pkg.title}" generated and live.`, 'build_business');
  });
  el('btnBizTabPage').addEventListener('click', () => { el('bizIframeWrap').style.display = 'block'; el('bizPlaybookWrap').style.display = 'none'; });
  el('btnBizTabPlaybook').addEventListener('click', () => { el('bizIframeWrap').style.display = 'none'; el('bizPlaybookWrap').style.display = 'block'; });

  // Leadership Studio
  el('tabBtnBookMode').addEventListener('click', () => {
    el('tabBtnBookMode').classList.add('btn-primary'); el('tabBtnCourseMode').classList.remove('btn-primary');
    el('bookFormPane').style.display = 'block'; el('courseFormPane').style.display = 'none';
  });
  el('tabBtnCourseMode').addEventListener('click', () => {
    el('tabBtnCourseMode').classList.add('btn-primary'); el('tabBtnBookMode').classList.remove('btn-primary');
    el('courseFormPane').style.display = 'block'; el('bookFormPane').style.display = 'none';
  });
  el('btnBuildBook').addEventListener('click', () => handleUserCommand(`Write my leadership book titled "${el('bookTitleInput').value.trim() || 'Leading With Unshakable Clarity'}". ${el('bookPromptInput').value.trim()}`));
  el('btnBuildCourse').addEventListener('click', () => handleUserCommand(`Create a 6-week leadership course titled "${el('courseTitleInput').value.trim() || 'Executive Leadership Accelerator'}". ${el('coursePromptInput').value.trim()}`));
  el('btnLeadTabPortal').addEventListener('click', () => { el('leadIframeWrap').style.display = 'block'; el('leadMdWrap').style.display = 'none'; });
  el('btnLeadTabMd').addEventListener('click', () => { el('leadIframeWrap').style.display = 'none'; el('leadMdWrap').style.display = 'block'; });
  el('btnDownloadLeadMd').addEventListener('click', () => {
    const blob = new Blob([el('leadMdEditor').value || '# Manuscript'], { type: 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (activeLeadItem?.slug || 'export') + '.md'; a.click();
  });

  // Fleet, iOS & Scheduled Automations Actions
  window.jarvisFleetAction = async function (nodeId, cmdType) {
    const payload = cmdType === 'announce' ? `Attention ${nodeId}. Jarvis secure hub online.` : '';
    await apiPost('/api/nodes/dispatch', { targetNode: nodeId, commandType: cmdType, payload });
    Voice.playFx('complete');
    refreshState();
  };
  el('btnSyncAllMacs').addEventListener('click', () => window.jarvisFleetAction('ALL', 'sync_workspace'));
  el('btnAnnounceAllMacs').addEventListener('click', () => window.jarvisFleetAction('ALL', 'announce'));

  if (el('btnOpenWindowsFirewall')) {
    el('btnOpenWindowsFirewall').addEventListener('click', async () => {
      el('btnOpenWindowsFirewall').textContent = '⏳ Approve Windows Prompt...';
      try {
        const res = await apiPost('/api/security/open-lan-firewall', {});
        if (res && res.ok) {
          Voice.playFx('complete');
          el('btnOpenWindowsFirewall').textContent = '✓ Wi-Fi Firewall Unlocked!';
          await jarvisReplyAndLog(res.message || 'Windows Wi-Fi Firewall unlocked for your iPhone and MacBooks.', 'security');
        } else {
          el('btnOpenWindowsFirewall').textContent = '🔓 Unlock Windows Wi-Fi Firewall (Port 7777)';
          alert((res && res.error) || 'Could not update Windows Firewall.');
        }
      } catch (err) {
        el('btnOpenWindowsFirewall').textContent = '🔓 Unlock Windows Wi-Fi Firewall (Port 7777)';
        alert('Firewall prompt canceled or unavailable.');
      }
    });
  }

  if (el('btnCopyMacInstaller')) {
    el('btnCopyMacInstaller').addEventListener('click', async () => {
      const cmd = (el('macDesktopAppOneLiner')?.textContent || '').trim();
      try {
        await navigator.clipboard.writeText(cmd);
        el('btnCopyMacInstaller').textContent = '✓ Copied!';
        setTimeout(() => { el('btnCopyMacInstaller').textContent = '📋 Copy Mac Command'; }, 2200);
      } catch (e) {}
    });
  }

  if (el('btnCopyCloudIosUrl')) {
    el('btnCopyCloudIosUrl').addEventListener('click', async () => {
      const urlText = 'https://drjusinophd-cloud.github.io/personal-jarvis/';
      try {
        await navigator.clipboard.writeText(urlText);
        el('btnCopyCloudIosUrl').textContent = '✓ Copied HTTPS iPhone Link!';
        setTimeout(() => { el('btnCopyCloudIosUrl').textContent = '📋 Copy Instant HTTPS iPhone Link'; }, 2200);
      } catch (e) {
        prompt('Copy this HTTPS link for your iPhone:', urlText);
      }
    });
  }

  if (el('btnCopyIosUrl')) {
    el('btnCopyIosUrl').addEventListener('click', async () => {
      const urlText = (el('iosWifiUrlInline')?.textContent || window.location.origin).trim();
      try {
        await navigator.clipboard.writeText(urlText);
        el('btnCopyIosUrl').textContent = '✓ Copied iPhone Link!';
        setTimeout(() => { el('btnCopyIosUrl').textContent = '📋 Copy iPhone Link'; }, 2200);
      } catch (e) {
        prompt('Copy this link to open on your iPhone in Safari:', urlText);
      }
    });
  }

  window.jarvisAutoAction = async function (id, act) {
    if (!isAuthenticated) return;
    if (Voice.unlockAudioGesture) Voice.unlockAudioGesture();
    if (act === 'run') {
      setWaveMode('thinking');
      el('voiceStatusText').textContent = 'RUNNING AUTOMATION WORKFLOW...';
      const res = await apiPost('/api/automations/run-now', { id });
      Voice.playFx('complete');
      await refreshState();
      const s = serverData.state?.settings || {};
      await Voice.speak(res.summary || 'Automation workflow completed.', {
        muted: voiceMuted || s.voiceReply === false,
        rate: s.voiceRate || 1.02,
        pitch: s.voicePitch || 0.94,
        useGeminiTts: !!serverData.hasVaultGeminiKey,
        csrfToken: sessionCsrfToken
      });
    } else if (act === 'toggle') {
      await apiPost('/api/automations/toggle', { id });
      await refreshState();
    } else if (act === 'delete') {
      await apiPost('/api/automations/delete', { id });
      await refreshState();
    }
  };

  if (el('btnSaveAutomation')) {
    el('btnSaveAutomation').addEventListener('click', async () => {
      if (!isAuthenticated) return;
      if (Voice.unlockAudioGesture) Voice.unlockAudioGesture();
      const name = (el('autoNameInput')?.value || '').trim() || 'Executive Scheduled Routine';
      const actionType = el('autoActionInput')?.value || 'morning_briefing';
      const scheduleType = el('autoSchedTypeInput')?.value || 'daily_time';
      const dailyTime = el('autoTimeInput')?.value || '08:00';
      const intervalMinutes = Math.max(5, Number(el('autoIntervalInput')?.value || 60));
      const payload = (el('autoPayloadInput')?.value || '').trim();

      await apiPost('/api/automations/save', {
        name,
        actionType,
        scheduleType,
        dailyTime,
        intervalMinutes,
        payload,
        enabled: true
      });
      if (el('autoNameInput')) el('autoNameInput').value = '';
      if (el('autoPayloadInput')) el('autoPayloadInput').value = '';
      Voice.playFx('complete');
      await refreshState();
      await jarvisReplyAndLog(`Automation "${name}" is now active on your Command Hub.`, 'automations');
    });
  }

  /* ================= MULTI-CONNECTOR ECOSYSTEM & 1-CLICK STUDIO BRIDGES ================= */
  let activeConnectorCategory = 'all';

  function setConnectorCategoryFilter(cat) {
    activeConnectorCategory = cat || 'all';
    document.querySelectorAll('.conn-cat-btn').forEach((b) => {
      b.classList.toggle('btn-primary', b.dataset.connCat === activeConnectorCategory);
    });
    renderConnectorsHub();
  }

  document.querySelectorAll('.conn-cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => setConnectorCategoryFilter(btn.dataset.connCat));
  });

  if (el('btnTopOpenConnectors')) {
    el('btnTopOpenConnectors').addEventListener('click', () => switchView('connectors'));
  }
  if (el('btnLeadBookSources')) {
    el('btnLeadBookSources').addEventListener('click', () => {
      switchView('connectors');
      setConnectorCategoryFilter('book_writing');
    });
  }

  async function loadConnectorsStatus() {
    if (!isAuthenticated) return;
    try {
      const res = await apiGet('/api/connectors/status');
      if (res && res.ok) {
        connectorsData = res;
        renderConnectorsHub();
        updateEngineBadge();
      }
    } catch (e) {}
  }

  function renderConnectorsHub() {
    const allList = connectorsData.connectors || [];
    const brainSel = el('activeAiBrainSelect');
    if (brainSel) {
      const staticOpts = [
        { v: 'auto', l: '🧭 Auto-Smart Router (Best Model Per Task)' },
        { v: 'gemini', l: '✦ Google Gemini (3.5 Lite / 3.8 Flash / 4)' },
        { v: 'grok', l: '🦊 xAI Grok (Grok 4.7)' },
        { v: 'claude', l: '🧠 Anthropic Claude' },
        { v: 'openai', l: '⚡ OpenAI (GPT-4o / o-Series)' },
        { v: 'perplexity', l: '🔎 Perplexity AI (Live Web Sonar)' },
        { v: 'deepseek', l: '🐋 DeepSeek AI (V3 / R1)' },
        { v: 'kimi', l: '🌙 Kimi (Moonshot AI)' },
        { v: 'huggingface', l: '🤗 Hugging Face Router' },
        { v: 'openrouter', l: '🌐 OpenRouter (300+ Models)' },
        { v: 'hermes', l: '🪽 Nous Hermes' },
        { v: 'openclaw', l: '🦞 OpenClaw Gateway' },
        { v: 'ollama', l: '🦙 Local Ollama (Offline)' },
        { v: 'instant', l: '⚙ Built-In Instant Engine' }
      ];
      allList.forEach((c) => {
        if (c.isCustom && c.kind === 'openai_compat') {
          staticOpts.push({ v: c.id, l: `🤖 ${c.name}` });
        }
      });
      const currentVal = serverData.state?.settings?.activeAiProvider || 'auto';
      brainSel.innerHTML = staticOpts.map((o) => `<option value="${escapeHtml(o.v)}">${escapeHtml(o.l)}</option>`).join('');
      brainSel.value = staticOpts.some((o) => o.v === currentVal) ? currentVal : 'auto';
    }

    const grid = el('connectorsCardsGrid');
    if (!grid) return;

    const list = activeConnectorCategory === 'all'
      ? allList
      : allList.filter((c) => (c.category || 'workspace_ops') === activeConnectorCategory);

    grid.innerHTML = list.map((c) => {
      const isReadyOutOfBox = c.configured || c.kind === 'portal_bridge';
      const badgeLabel = c.configured
        ? (c.maskedKey ? `● DPAPI (${c.maskedKey})` : (c.localDetected ? '● LOCAL DETECTED' : '● STUDIO LINKED'))
        : (c.kind === 'portal_bridge' ? '● 1-CLICK READY' : '○ NOT SET');
      const badgeStyle = isReadyOutOfBox
        ? 'border-color:var(--emerald);color:#6ee7b7;'
        : 'color:var(--text-muted);';

      const showEndpoint = c.kind === 'openai_compat' || c.kind === 'anthropic' || c.kind === 'webhook_rest' || c.kind === 'portal_bridge';
      const showPortal = c.kind === 'portal_bridge';
      const showModel = c.kind === 'openai_compat' || c.kind === 'anthropic';
      const showExtra = !!c.extraLabel;
      const portalLaunchLabel = c.id === 'lovable'
        ? '💜 Auto-Fill &amp; Open Lovable'
        : (c.id === 'mindsmith'
            ? '🎓 Export Course &amp; Open'
            : (c.id === 'muse'
                ? '🎨 Send Space Brief &amp; Open'
                : ((c.id === 'emergent' || c.id === 'workshop' || c.id === 'hercules')
                    ? '🚀 Copy Blueprint &amp; Open'
                    : '🚀 Copy Packet &amp; Open')));

      return `
        <div class="connector-card ${isReadyOutOfBox ? 'configured' : ''}" data-conn-id="${escapeHtml(c.id)}">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
              <div style="font-size:15px;font-weight:700;color:#fff;">${escapeHtml(c.icon)} ${escapeHtml(c.name)}</div>
              <span class="hud-badge" style="${badgeStyle};white-space:nowrap;">${escapeHtml(badgeLabel)}</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.45;margin-bottom:10px;">
              ${escapeHtml(c.description)}
              ${c.localPath ? `<div style="margin-top:4px;font-family:var(--font-mono);font-size:10.5px;color:var(--cyan);">Local: ${escapeHtml(c.localPath)}</div>` : ''}
            </div>

            ${showPortal ? `
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label" style="font-size:10px;">Studio / Workspace Portal URL</label>
              <input class="hud-input conn-portal-input" value="${escapeHtml(c.portalUrl || '')}" placeholder="https://..." />
            </div>` : ''}

            <div class="form-group" style="margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <label class="form-label" style="font-size:10px;">API Key / Secret ${c.maskedKey ? '(Blank keeps stored key)' : ''}</label>
                ${c.portalUrl && !showPortal ? `<a href="${escapeHtml(c.portalUrl)}" target="_blank" rel="noopener noreferrer" style="font-size:10px;color:var(--cyan);">Open Portal / Keys ↗</a>` : ''}
              </div>
              <div style="display:flex;gap:6px;">
                <input class="hud-input conn-key-input" type="password" placeholder="${escapeHtml(c.keyPlaceholder || 'API Key / Token')}" style="flex:1;" />
                <button class="btn btn-sm btn-conn-paste" type="button" title="1-Click Paste from Clipboard">📋 Paste</button>
                <button class="btn btn-sm btn-conn-vis" type="button" title="Show / Hide Key">👁</button>
              </div>
            </div>

            ${showEndpoint ? `
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label" style="font-size:10px;">${showPortal ? 'Optional Webhook / API Endpoint URL' : 'Endpoint / Gateway URL'}</label>
              <input class="hud-input conn-endpoint-input" value="${escapeHtml(c.endpoint || '')}" placeholder="https://..." />
            </div>` : ''}

            ${showModel ? `
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label" style="font-size:10px;">Model Name</label>
              <input class="hud-input conn-model-input" value="${escapeHtml(c.model || '')}" placeholder="Model ID" />
            </div>` : ''}

            ${showExtra ? `
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label" style="font-size:10px;">${escapeHtml(c.extraLabel)}</label>
              <input class="hud-input conn-extra-input" value="${escapeHtml(c.extraId || '')}" placeholder="${escapeHtml(c.extraLabel)}" />
            </div>` : ''}
          </div>

          <div>
            <div class="connector-status-msg" id="connMsg-${escapeHtml(c.id)}"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
              <button class="btn btn-sm btn-primary btn-conn-save" data-id="${escapeHtml(c.id)}">💾 Save</button>
              <button class="btn btn-sm btn-emerald btn-conn-test" data-id="${escapeHtml(c.id)}">⚡ Test</button>
              ${showPortal ? `<button class="btn btn-sm btn-amber btn-conn-portal-launch" data-id="${escapeHtml(c.id)}">${portalLaunchLabel}</button>` : ''}
              ${c.id === 'grok' ? `<button class="btn btn-sm btn-amber btn-conn-portal-launch" data-id="grok">🦊 Open Grok Web</button>` : ''}
              ${(c.id === 'obsidian' || c.id === 'onedrive' || c.id === 'googledrive' || c.id === 'msword') ? `<button class="btn btn-sm btn-amber btn-conn-local-sync" data-id="${escapeHtml(c.id)}">⚡ Sync / Export Now</button>` : ''}
              ${c.id === 'vercel' ? `<button class="btn btn-sm btn-amber btn-conn-vercel-deploy">▲ Deploy Active App</button>` : ''}
              ${c.id === 'asana' ? `<button class="btn btn-sm btn-amber btn-conn-asana-push">🎯 Send Test Task</button>` : ''}
              ${c.id === 'cursor' ? `<button class="btn btn-sm btn-amber btn-conn-launch-cursor">↗ Launch Cursor</button>` : ''}
              ${c.id === 'hermes' && c.localDetected ? `<button class="btn btn-sm btn-amber btn-conn-launch-hermes">🪽 Launch Hermes CLI</button>` : ''}
              ${c.isCustom ? `<button class="btn btn-sm btn-conn-delete" data-id="${escapeHtml(c.id)}" style="color:#fb7185;border-color:rgba(244,63,94,0.4);">🗑 Remove</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.btn-conn-save').forEach((btn) => {
      btn.onclick = () => saveConnectorFromCard(btn.dataset.id);
    });
    grid.querySelectorAll('.btn-conn-paste').forEach((btn) => {
      btn.onclick = async () => {
        const inp = btn.parentElement.querySelector('.conn-key-input');
        try {
          const clip = await navigator.clipboard.readText();
          if (inp && clip) { inp.value = clip.trim(); inp.type = 'text'; }
        } catch (e) {
          if (inp) inp.focus();
        }
      };
    });
    grid.querySelectorAll('.btn-conn-vis').forEach((btn) => {
      btn.onclick = () => {
        const inp = btn.parentElement.querySelector('.conn-key-input');
        if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
      };
    });
    grid.querySelectorAll('.btn-conn-test').forEach((btn) => {
      btn.onclick = () => testConnectorFromCard(btn.dataset.id);
    });
    grid.querySelectorAll('.btn-conn-portal-launch').forEach((btn) => {
      btn.onclick = () => launchPortalStudioWithPacket(btn.dataset.id);
    });
    grid.querySelectorAll('.btn-conn-delete').forEach((btn) => {
      btn.onclick = async () => {
        await apiPost('/api/connectors/save', { id: btn.dataset.id, delete: true });
        await loadConnectorsStatus();
        await refreshState();
      };
    });
    grid.querySelectorAll('.btn-conn-launch-cursor').forEach((btn) => {
      btn.onclick = () => openWorkspaceInCursor('apps', activeAppItem?.slug || '');
    });
    grid.querySelectorAll('.btn-conn-local-sync').forEach((btn) => {
      btn.onclick = () => {
        const t = btn.dataset.id;
        const proj = getActiveProjectObj() || (serverData.state?.projects || [])[0];
        const title = activeLeadItem?.title || proj?.name || 'JARVIS Executive Document';
        const md = el('leadMdEditor')?.value || proj?.deliverables || proj?.knowledgeNotes || '# Exported from JARVIS';
        syncToLocalConnector(t, title, md, true);
      };
    });
    grid.querySelectorAll('.btn-conn-vercel-deploy').forEach((btn) => {
      btn.onclick = () => {
        const html = el('appCodeEditor')?.value || '';
        if (!activeAppItem || !html) { alert('Select or forge an App in App Forge first.'); return; }
        deployHtmlToVercel(activeAppItem.title, html);
      };
    });
    grid.querySelectorAll('.btn-conn-asana-push').forEach((btn) => {
      btn.onclick = () => pushTaskToAsana('JARVIS Executive Sync Check', 'Verified 1-click Asana task creation from JARVIS Command Center.');
    });
    grid.querySelectorAll('.btn-conn-launch-hermes').forEach((btn) => {
      btn.onclick = async () => {
        const res = await apiPost('/api/connectors/open-cursor', { category: 'apps', slug: activeAppItem?.slug || '', tool: 'hermes' });
        showConnectorBanner('hermes', res.ok, res.ok ? 'Launched Hermes CLI in workspace!' : res.error);
      };
    });
  }

  function showConnectorBanner(id, ok, text) {
    const box = el('connMsg-' + id);
    if (!box) return;
    box.style.display = 'block';
    box.style.borderColor = ok ? 'rgba(16,185,129,0.55)' : 'rgba(244,63,94,0.55)';
    box.style.color = ok ? '#6ee7b7' : '#fda4af';
    box.textContent = text;
  }

  async function saveConnectorFromCard(id) {
    const card = document.querySelector(`.connector-card[data-conn-id="${id}"]`);
    if (!card) return;
    const rawKey = (card.querySelector('.conn-key-input')?.value || '').trim();
    const endpoint = card.querySelector('.conn-endpoint-input')?.value;
    const portalUrl = card.querySelector('.conn-portal-input')?.value;
    const model = card.querySelector('.conn-model-input')?.value;
    const extraId = card.querySelector('.conn-extra-input')?.value;
    const def = (connectorsData.connectors || []).find((x) => x.id === id) || {};

    const payload = {
      id,
      name: def.name || id,
      kind: def.kind || 'webhook_rest',
      category: def.category || 'workspace_ops',
      description: def.description || '',
      isCustom: !!def.isCustom,
      apiKey: rawKey ? rawKey : '__KEEP__'
    };
    if (endpoint !== undefined) payload.endpoint = endpoint.trim();
    if (portalUrl !== undefined) payload.portalUrl = portalUrl.trim();
    if (model !== undefined) payload.model = model.trim();
    if (extraId !== undefined) payload.extraId = extraId.trim();

    const res = await apiPost('/api/connectors/save', payload);
    await loadConnectorsStatus();
    await loadSecurityInfo();
    await refreshState();
    showConnectorBanner(id, !!res.ok, res.ok ? 'Encrypted & saved in Windows DPAPI Vault!' : (res.error || 'Failed to save'));
  }

  async function testConnectorFromCard(id) {
    const card = document.querySelector(`.connector-card[data-conn-id="${id}"]`);
    if (card) {
      const rawKey = (card.querySelector('.conn-key-input')?.value || '').trim();
      const endpointEl = card.querySelector('.conn-endpoint-input');
      const portalEl = card.querySelector('.conn-portal-input');
      const modelEl = card.querySelector('.conn-model-input');
      const extraEl = card.querySelector('.conn-extra-input');
      if (rawKey || endpointEl || portalEl || modelEl || extraEl) {
        await saveConnectorFromCard(id);
      }
    }
    showConnectorBanner(id, true, 'Testing live connection...');
    const res = await apiPost('/api/connectors/test', { id });
    showConnectorBanner(id, !!res.ok, res.message || res.error || 'Test completed.');
  }

  function buildAppSpecBrief() {
    const app = activeAppItem || (serverData.state?.apps || [])[0];
    const proj = getActiveProjectObj();
    if (!app) {
      return proj
        ? `Project "${proj.name}": ${proj.customInstructions || ''}\n${String(proj.knowledgeNotes || '').slice(0, 1200)}`
        : 'Executive Leadership & Daily Operating System web app with interactive KPI dashboard, goal tracker, notes vault, and clean dark glassmorphism UI.';
    }
    return [
      `App Title: ${app.title}`,
      `Executive Summary & Core Purpose: ${app.summary || 'Interactive full-stack web application'}`,
      proj ? `Linked Project Context (${proj.name}): ${String(proj.customInstructions || '').slice(0, 450)}` : ''
    ].filter(Boolean).join('\n');
  }

  function buildBizSpecBrief() {
    const biz = activeBizItem || (serverData.state?.business || [])[0];
    const playbook = (el('bizPlaybookEditor')?.value || '').slice(0, 1400);
    if (!biz) {
      return 'High-converting executive coaching & SaaS funnel landing page with hero value proposition, social proof, pricing tiers, lead capture form, and onboarding flow.';
    }
    return [
      `Venture / Funnel Title: ${biz.title}`,
      `Summary: ${biz.summary || ''}`,
      playbook ? `Funnel Copy & Playbook Highlights:\n${playbook}` : ''
    ].filter(Boolean).join('\n');
  }

  async function launchPortalStudioWithPacket(connectorId, customBrief) {
    const def = (connectorsData.connectors || []).find((x) => x.id === connectorId) || {};
    const s = serverData.state?.settings || {};
    const bookItem = activeLeadItem || (serverData.state?.courses || [])[0] || (serverData.state?.books || [])[0];
    const appItem = activeAppItem || (serverData.state?.apps || [])[0];
    const projItem = getActiveProjectObj();
    const mdText = el('leadMdEditor')?.value || bookItem?.summary || '';

    let packet = '';
    let targetUrl = '';
    let bannerMsg = '';
    let spokenMsg = '';

    if (connectorId === 'lovable') {
      const subjectTitle = appItem?.title || activeBizItem?.title || projItem?.name || 'Transformational Leader OS';
      const stackPref = def.extraId || 'React + TypeScript + Tailwind CSS + shadcn/ui + Supabase Auth & Database';
      packet = [
        `Build a polished, production-ready full-stack web application: "${subjectTitle}" for ${s.brandName || 'Apex Leadership & Venture Lab'} (${s.authorName || 'Dr. Hector Jusino'}).`,
        `Preferred Stack & Aesthetic: ${stackPref}. Crisp modern executive UI with responsive mobile + desktop layout.`,
        customBrief ? `\nCore Specification & Requirements:\n${customBrief}` : `\nCore Specification:\n${appItem?.summary || 'Interactive dashboard, authenticated user workspace, persistent data tables, analytics cards, and exportable reports.'}`,
        `\nInclude: clean navigation sidebar, interactive state & sample seed data so it works immediately on first preview, mobile-friendly views, and clear call-to-action flows.`
      ].join('\n');
      const basePortal = (def.portalUrl || 'https://lovable.dev').replace(/\/+$/, '');
      targetUrl = `${basePortal}/#prompt=${encodeURIComponent(packet.slice(0, 2400))}`;
      bannerMsg = 'Opened Lovable with your full-stack prompt automatically pre-filled (and copied to clipboard)!';
      spokenMsg = 'Launched Lovable with your full-stack app specification already pre-filled right inside the prompt box, and copied a backup to your clipboard.';
    } else if (connectorId === 'emergent' || connectorId === 'workshop' || connectorId === 'hercules') {
      const defaultPortals = {
        emergent: 'https://emergent.sh',
        workshop: 'https://workshop.ai',
        hercules: 'https://hercules.app'
      };
      const studioNames = {
        emergent: 'Emergent Labs',
        workshop: 'Workshop AI',
        hercules: 'Hercules AI'
      };
      const appTitle = appItem?.title || projItem?.name || 'Transformational Leader OS';
      packet = [
        `# FULL-STACK APPLICATION BLUEPRINT (${def.name || studioNames[connectorId]})`,
        `Founder / Brand: ${s.authorName || 'Dr. Hector Jusino'} — ${s.brandName || 'Apex Leadership & Venture Lab'}`,
        `Application Name: ${appTitle}`,
        `Stack / Preferences: ${def.extraId || (connectorId === 'emergent' ? 'React + Tailwind Frontend, FastAPI/Node Backend, Auth + Persistent Database' : 'Full-Stack Responsive Web & Mobile-Ready SaaS Architecture')}`,
        ``,
        `## 1. Product Vision & Core Specification`,
        customBrief || appItem?.summary || 'Build a full-stack interactive SaaS dashboard with authentication, clean data tables, real-time analytics cards, and workflow automation.',
        ``,
        `## 2. Core Modules & User Flows`,
        `- Executive Command Dashboard with live KPI metrics, search, and quick actions`,
        `- Authenticated Workspace with CRUD persistence, status tracking, and tagging`,
        `- Clean responsive UI (Desktop + iPhone/Mobile Safari) with polished visual hierarchy`,
        `- Export & sharing capabilities (Markdown / PDF / Webhook ready)`
      ].join('\n');
      targetUrl = def.portalUrl || defaultPortals[connectorId];
      bannerMsg = `Full-stack blueprint copied to clipboard & ${def.name || studioNames[connectorId]} opened! Press Ctrl+V to build.`;
      spokenMsg = `Copied your full-stack app blueprint to the clipboard and opened ${studioNames[connectorId]}. Just press Control V inside the builder.`;
    } else if (connectorId === 'mindsmith') {
      const courseItem = (activeLeadItem && activeLeadItem.category === 'courses')
        ? activeLeadItem
        : ((serverData.state?.courses || [])[0] || bookItem);
      const courseTitle = courseItem?.title || projItem?.name || 'Executive Leadership Mastery Course';
      const sourceMaterial = customBrief || el('leadMdEditor')?.value || courseItem?.summary || mdText;
      packet = [
        `# MINDSMITH AI INTERACTIVE eLEARNING & COURSE AUTHORING BRIEF`,
        `Instructor / Author: ${s.authorName || 'Dr. Hector Jusino'} (${s.brandName || 'Apex Leadership & Venture Lab'})`,
        `Course / Module Title: ${courseTitle}`,
        `Target Audience & Tone: ${def.extraId || 'Executive leaders, founders & high-performing professionals — engaging, practical, scenario-driven'}`,
        ``,
        `## Authoring Instructions for Mindsmith AI`,
        `Transform the syllabus/manuscript below into an interactive eLearning module featuring:`,
        `1. Clear Learning Objectives & Executive Hook`,
        `2. Bite-sized Interactive Lesson Cards (flip cards, accordions & callouts)`,
        `3. Real-World Leadership Scenario Decision Check`,
        `4. End-of-Module Knowledge Quiz (4–5 questions with explanations)`,
        ``,
        `## Source Curriculum / Manuscript`,
        String(sourceMaterial || '').slice(0, 6500)
      ].join('\n');
      targetUrl = def.portalUrl || 'https://www.mindsmith.ai';
      bannerMsg = 'Interactive eLearning course packet copied & Mindsmith AI opened! Press Ctrl+V inside Mindsmith.';
      spokenMsg = 'Copied your interactive eLearning curriculum packet to the clipboard and launched Mindsmith AI. Paste it inside Mindsmith to generate your interactive lessons and quizzes.';
    } else if (connectorId === 'muse') {
      const spaceTitle = appItem?.title || projItem?.name || bookItem?.title || 'Executive Command Space';
      packet = [
        `# MUSE AI AGENT & INTERACTIVE SPACE BRIEF`,
        `Founder / Brand: ${s.authorName || 'Dr. Hector Jusino'} — ${s.brandName || 'Apex Leadership & Venture Lab'}`,
        `Space / Workflow Name: ${spaceTitle}`,
        `Focus & Creative Style: ${def.extraId || 'Autonomous multi-step execution + clean interactive Space dashboard with tabs, trackers, and visual summaries'}`,
        ``,
        `## Mission & Space Specification`,
        customBrief || appItem?.summary || projItem?.customInstructions || 'Spin up an interactive Muse Space and autonomous workflow to track milestones, synthesize research, and manage daily executive priorities.',
        projItem?.knowledgeNotes ? `\n## Reference Context\n${String(projItem.knowledgeNotes).slice(0, 2500)}` : ''
      ].filter(Boolean).join('\n');
      targetUrl = def.portalUrl || 'https://muse.ai';
      bannerMsg = 'Muse AI Space & Agent brief copied to clipboard & Muse opened! Press Ctrl+V inside Muse.';
      spokenMsg = 'Copied your interactive Space and agent brief to the clipboard and launched Muse AI.';
    } else if (connectorId === 'grok') {
      const focusTopic = customBrief || projItem?.customInstructions || appItem?.summary || bookItem?.summary || 'Provide real-time strategic analysis, live trend synthesis, and sharp executive recommendations.';
      packet = [
        `Context: Executive briefing & strategy session for ${s.authorName || 'Dr. Hector Jusino'} (${s.brandName || 'Apex Leadership & Venture Lab'}).`,
        projItem ? `Active Project: ${projItem.name}` : '',
        `\nRequest:\n${focusTopic}`
      ].filter(Boolean).join('\n');
      targetUrl = 'https://grok.com';
      bannerMsg = 'Prompt copied to clipboard & Grok Web (grok.com) opened! (Tip: Add an xai-... key above to also run Grok 4.7 directly inside JARVIS!)';
      spokenMsg = 'Copied your executive prompt to the clipboard and opened Grok on the web.';
    } else if (connectorId === 'viktor') {
      packet = [
        `# J.A.R.V.I.S. EXECUTIVE BRIEF FOR VIKTOR AI`,
        `Founder: ${s.authorName || 'Dr. Hector Jusino'}`,
        `Venture: ${s.brandName || 'Apex Leadership & Venture Lab'}`,
        `Objective: ${customBrief || 'Coordinate launch tasks, research, and execution across active apps, book, and leadership course.'}`,
        `Active App: ${appItem?.title || 'Transformational Leader OS'}`,
        `Active Book/Course: ${bookItem?.title || 'Leading With Unshakable Clarity'}`,
        `Active Funnel: ${activeBizItem?.title || 'Apex Leadership & Venture Lab'}`
      ].join('\n');
      targetUrl = def.portalUrl || def.endpoint || 'https://www.viktor.com';
    } else {
      packet = [
        `# BOOK & STORY BIBLE PACKET (${def.name || 'AIWriteBook'})`,
        `Author: ${s.authorName || 'Dr. Hector Jusino'}`,
        `Title: ${bookItem?.title || 'Leading With Unshakable Clarity'}`,
        `Voice / Style Note: ${def.extraId || 'Authoritative, warm, actionable executive leadership prose'}`,
        ``,
        customBrief || mdText
      ].join('\n');
      targetUrl = def.portalUrl || def.endpoint || 'https://aiwritebook.com';
    }

    try {
      await navigator.clipboard.writeText(packet);
    } catch (e) {}

    if (def.endpoint && def.kind === 'portal_bridge') {
      try {
        await apiPost('/api/connectors/webhook-push', {
          connectorId,
          eventType: 'studio_packet',
          title: appItem?.title || bookItem?.title || 'JARVIS Packet',
          summary: customBrief || 'Exported from JARVIS Command Center',
          content: packet
        });
      } catch (e) {}
    }

    if (targetUrl) window.open(targetUrl, '_blank', 'noopener,noreferrer');
    Voice.playFx('complete');
    showConnectorBanner(connectorId, true, bannerMsg || ('Packet copied to clipboard & studio opened! Press Ctrl+V inside ' + (def.name || connectorId) + '.'));
    await jarvisReplyAndLog(spokenMsg || `Copied your formatted packet to the clipboard and launched ${def.name || connectorId}. Just press Control V inside the studio.`, 'connectors');
  }

  if (el('activeAiBrainSelect')) {
    el('activeAiBrainSelect').addEventListener('change', async (e) => {
      const chosen = e.target.value;
      connectorsData.activeAiProvider = chosen;
      await apiPost('/api/settings', { activeAiProvider: chosen });
      await refreshState();
      Voice.playFx('complete');
    });
  }

  if (el('btnRefreshConnectors')) {
    el('btnRefreshConnectors').addEventListener('click', loadConnectorsStatus);
  }

  if (el('btnPasteCustomKey')) {
    el('btnPasteCustomKey').onclick = async () => {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip) { el('customConnKey').value = clip.trim(); el('customConnKey').type = 'text'; }
      } catch (e) { el('customConnKey').focus(); }
    };
  }

  if (el('btnAddCustomConnector')) {
    el('btnAddCustomConnector').addEventListener('click', async () => {
      const name = el('customConnName').value.trim();
      if (!name) { alert('Enter a Source Name (e.g., AIWriteBook, Viktor AI, NovelCrafter, Atticus, Skool).'); return; }
      const category = el('customConnCategory') ? el('customConnCategory').value : 'book_writing';
      const kind = el('customConnKind').value;
      const urlVal = el('customConnEndpoint').value.trim();
      const model = el('customConnModel').value.trim();
      const apiKey = el('customConnKey').value.trim();
      const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      await apiPost('/api/connectors/save', {
        id,
        name,
        category,
        kind,
        endpoint: kind === 'portal_bridge' ? '' : urlVal,
        portalUrl: kind === 'portal_bridge' ? urlVal : '',
        model,
        apiKey,
        isCustom: true,
        description: kind === 'portal_bridge'
          ? 'Custom Studio Bridge — 1-click copy Book/Venture packet & launch portal.'
          : (kind === 'openai_compat' ? 'Custom OpenAI-compatible AI / Agent brain.' : 'Custom outbound webhook / automation connector.')
      });
      el('customConnName').value = '';
      el('customConnEndpoint').value = '';
      el('customConnModel').value = '';
      el('customConnKey').value = '';
      Voice.playFx('complete');
      setConnectorCategoryFilter(category);
      await loadConnectorsStatus();
      await refreshState();
    });
  }

  // Studio 1-Click Connector Bridges (Cursor, Notion, ClickUp, Webhook)
  async function openWorkspaceInCursor(category, slug) {
    const res = await apiPost('/api/connectors/open-cursor', { category: category || 'apps', slug: slug || '', tool: 'cursor' });
    if (res.ok) {
      Voice.playFx('complete');
      await jarvisReplyAndLog(`Opened ${slug || 'workspace'} in Cursor IDE on Windows Prime.`, 'cursor');
    } else {
      alert(res.error || 'Could not launch Cursor.');
      switchView('connectors');
    }
  }

  async function pushItemToNotion(title, markdown) {
    const res = await apiPost('/api/connectors/notion-export', { title, markdown });
    if (res.ok) {
      Voice.playFx('complete');
      await jarvisReplyAndLog(`Exported "${title}" directly into your Notion workspace.`, 'notion');
      if (res.url) window.open(res.url, '_blank', 'noopener,noreferrer');
    } else {
      alert(res.error || 'Configure Notion in the Connectors Hub first.');
      switchView('connectors');
    }
  }

  async function pushTaskToClickUp(name, description) {
    const res = await apiPost('/api/connectors/clickup-task', { name, description });
    if (res.ok) {
      Voice.playFx('complete');
      await jarvisReplyAndLog(`Created task "${name}" in ClickUp.`, 'clickup');
      if (res.url) window.open(res.url, '_blank', 'noopener,noreferrer');
    } else {
      alert(res.error || 'Configure your ClickUp Token & List ID in the Connectors Hub first.');
      switchView('connectors');
    }
  }

  async function pushAssetToWebhook(eventType, title, summary, content) {
    const res = await apiPost('/api/connectors/webhook-push', {
      connectorId: 'webhook',
      eventType,
      title,
      summary,
      content
    });
    if (res.ok) {
      Voice.playFx('complete');
      await jarvisReplyAndLog(`Dispatched "${title}" to your configured webhook automation.`, 'webhook');
    } else {
      alert(res.error || 'Add a Webhook URL in the Connectors Hub first.');
      switchView('connectors');
    }
  }

  if (el('btnAppOpenCursor')) el('btnAppOpenCursor').onclick = () => openWorkspaceInCursor('apps', activeAppItem?.slug || '');
  if (el('btnBizOpenCursor')) el('btnBizOpenCursor').onclick = () => openWorkspaceInCursor('business', activeBizItem?.slug || '');
  if (el('btnLeadOpenCursor')) el('btnLeadOpenCursor').onclick = () => openWorkspaceInCursor(activeLeadItem?.category || 'books', activeLeadItem?.slug || '');
  if (el('btnLeadAiWriteBook')) el('btnLeadAiWriteBook').onclick = () => launchPortalStudioWithPacket('aiwritebook');

  if (el('btnAppNotion')) el('btnAppNotion').onclick = () => {
    if (!activeAppItem) return;
    pushItemToNotion(`${activeAppItem.title} — App Spec`, `# ${activeAppItem.title}\n\n${activeAppItem.summary || ''}\n\nPreview URL: ${activeAppItem.previewUrl}`);
  };
  if (el('btnBizNotion')) el('btnBizNotion').onclick = () => {
    if (!activeBizItem) return;
    pushItemToNotion(`${activeBizItem.title} — Funnel Playbook`, el('bizPlaybookEditor').value || activeBizItem.summary || '');
  };
  if (el('btnLeadNotion')) el('btnLeadNotion').onclick = () => {
    if (!activeLeadItem) return;
    pushItemToNotion(activeLeadItem.title, el('leadMdEditor').value || activeLeadItem.summary || '');
  };

  if (el('btnAppClickUp')) el('btnAppClickUp').onclick = () => {
    if (!activeAppItem) return;
    pushTaskToClickUp(`Ship & QA App: ${activeAppItem.title}`, `${activeAppItem.summary || ''}\nWorkspace: workspace/apps/${activeAppItem.slug}`);
  };
  if (el('btnBizClickUp')) el('btnBizClickUp').onclick = () => {
    if (!activeBizItem) return;
    pushTaskToClickUp(`Launch Funnel: ${activeBizItem.title}`, el('bizPlaybookEditor').value || activeBizItem.summary || '');
  };
  if (el('btnLeadClickUp')) el('btnLeadClickUp').onclick = () => {
    if (!activeLeadItem) return;
    pushTaskToClickUp(`Complete ${activeLeadItem.category === 'books' ? 'Book Chapter' : 'Course Module'}: ${activeLeadItem.title}`, activeLeadItem.summary || '');
  };
  if (el('btnBizWebhook')) el('btnBizWebhook').onclick = () => {
    if (!activeBizItem) return;
    pushAssetToWebhook('business_funnel_export', activeBizItem.title, activeBizItem.summary || '', el('bizPlaybookEditor').value || '');
  };

  /* ================= NEW CONNECTORS: OBSIDIAN, ONEDRIVE, GDRIVE, WORD, GDOCS, VERCEL, ASANA ================= */
  function triggerClientFileDownload(filename, mime, contentStr) {
    const blob = new Blob([contentStr], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  async function syncToLocalConnector(target, title, markdown, openAfter) {
    const cleanTitle = (title || 'JARVIS Document').trim();
    const safeSlug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'jarvis-doc';
    try {
      if (!window.JARVIS_STANDALONE_PWA) {
        const res = await apiPost('/api/connectors/local-sync', {
          target,
          title: cleanTitle,
          markdown: markdown || '',
          openAfter: openAfter !== false
        });
        if (res && res.ok) {
          Voice.playFx('complete');
          const friendlyLabels = {
            obsidian: 'Obsidian Vault',
            msword: 'Microsoft Word (.doc)',
            onedrive: 'Microsoft OneDrive',
            googledrive: 'Google Drive'
          };
          showConnectorBanner(target, true, `Synced cleanly to ${res.savedPath || friendlyLabels[target] || target}!`);
          await jarvisReplyAndLog(`Saved "${cleanTitle}" directly to ${friendlyLabels[target] || target}${res.savedPath ? ' (' + res.savedPath + ')' : ''}.`, target);
          return;
        }
      }
    } catch (e) {}

    // Client-side universal fallback (works on iPhone, iPad, Mac & Cloud Web App!)
    if (target === 'msword') {
      const escaped = escapeHtml(markdown || '').replace(/\r?\n/g, '<br/>');
      const wordDoc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>${escapeHtml(cleanTitle)}</title><style>body{font-family:Calibri,Georgia,serif;font-size:12pt;line-height:1.55;margin:1in;} h1{border-bottom:1px solid #cbd5e1;padding-bottom:6pt;}</style></head><body><h1>${escapeHtml(cleanTitle)}</h1><div>${escaped}</div></body></html>`;
      triggerClientFileDownload(`${safeSlug}.doc`, 'application/msword', wordDoc);
      Voice.playFx('complete');
      await jarvisReplyAndLog(`Downloaded formatted Microsoft Word document "${safeSlug}.doc".`, 'msword');
    } else {
      const fm = `---\ntitle: "${cleanTitle.replace(/"/g, "'")}"\nsource: JARVIS\ncreated: ${new Date().toISOString()}\n---\n\n${markdown || ''}`;
      triggerClientFileDownload(`${safeSlug}.md`, 'text/markdown;charset=utf-8', fm);
      Voice.playFx('complete');
      await jarvisReplyAndLog(`Exported Markdown note "${safeSlug}.md" ready for ${target === 'obsidian' ? 'Obsidian' : (target === 'onedrive' ? 'OneDrive' : 'Google Drive')}.`, target);
    }
  }

  async function openInGoogleDocs(title, markdown) {
    const packet = `${title || 'JARVIS Document'}\n${'='.repeat(Math.min(60, (title || 'JARVIS Document').length))}\n\n${markdown || ''}`;
    try {
      await navigator.clipboard.writeText(packet);
    } catch (e) {}
    const def = (connectorsData.connectors || []).find((x) => x.id === 'googledocs') || {};
    const url = def.portalUrl || 'https://docs.new';
    window.open(url, '_blank', 'noopener,noreferrer');
    Voice.playFx('complete');
    await jarvisReplyAndLog(`Copied "${title || 'your document'}" to your clipboard and opened a fresh Google Doc. Just press Control V or Paste inside Google Docs!`, 'googledocs');
  }

  async function pushTaskToAsana(name, notes) {
    try {
      const res = await apiPost('/api/connectors/asana-task', { name, notes });
      if (res && res.ok) {
        Voice.playFx('complete');
        await jarvisReplyAndLog(`Created task "${name}" in Asana.`, 'asana');
        if (res.url) window.open(res.url, '_blank', 'noopener,noreferrer');
        return;
      }
      alert(res.error || 'Add your Asana Personal Access Token in the Connectors Hub first.');
      switchView('connectors');
    } catch (err) {
      alert('Add your Asana Personal Access Token in the Connectors Hub first.');
      switchView('connectors');
    }
  }

  async function deployHtmlToVercel(name, htmlContent) {
    setWaveMode('thinking');
    if (el('voiceStatusText')) el('voiceStatusText').textContent = '▲ DEPLOYING LIVE CLOUD APP TO VERCEL...';
    try {
      const res = await apiPost('/api/connectors/vercel-deploy', { name, html: htmlContent });
      if (res && res.ok && res.url) {
        Voice.playFx('complete');
        try { await navigator.clipboard.writeText(res.url); } catch (e) {}
        window.open(res.url, '_blank', 'noopener,noreferrer');
        await jarvisReplyAndLog(`Live cloud deployment complete! "${name}" is now published on Vercel at ${res.url} (link copied to your clipboard).`, 'vercel');
        return;
      }
      alert(res.error || 'Save your Vercel Access Token (from vercel.com/account/tokens) in the Connectors Hub first.');
      switchView('connectors');
    } catch (err) {
      alert('Save your Vercel Access Token in the Connectors Hub first.');
      switchView('connectors');
    }
  }

  if (el('btnAppVercel')) el('btnAppVercel').onclick = () => {
    const html = el('appCodeEditor')?.value || '';
    if (!activeAppItem || !html) { alert('Select or forge an App first.'); return; }
    deployHtmlToVercel(activeAppItem.title, html);
  };
  if (el('btnAppAsana')) el('btnAppAsana').onclick = () => {
    if (!activeAppItem) return;
    pushTaskToAsana(`Ship & Review App: ${activeAppItem.title}`, `${activeAppItem.summary || ''}\nWorkspace: workspace/apps/${activeAppItem.slug}`);
  };
  if (el('btnBizVercel')) el('btnBizVercel').onclick = async () => {
    if (!activeBizItem) { alert('Generate or select a Business Funnel first.'); return; }
    const res = await fetch(activeBizItem.previewUrl + '?t=' + Date.now(), { credentials: 'same-origin' });
    const html = res.ok ? await res.text() : '';
    if (html) deployHtmlToVercel(activeBizItem.title, html);
  };
  if (el('btnBizAsana')) el('btnBizAsana').onclick = () => {
    if (!activeBizItem) return;
    pushTaskToAsana(`Launch Funnel: ${activeBizItem.title}`, el('bizPlaybookEditor')?.value || activeBizItem.summary || '');
  };
  if (el('btnLeadObsidian')) el('btnLeadObsidian').onclick = () => {
    if (!activeLeadItem) return;
    syncToLocalConnector('obsidian', activeLeadItem.title, el('leadMdEditor')?.value || activeLeadItem.summary || '', true);
  };
  if (el('btnLeadWord')) el('btnLeadWord').onclick = () => {
    if (!activeLeadItem) return;
    syncToLocalConnector('msword', activeLeadItem.title, el('leadMdEditor')?.value || activeLeadItem.summary || '', true);
  };
  if (el('btnLeadGoogleDocs')) el('btnLeadGoogleDocs').onclick = () => {
    if (!activeLeadItem) return;
    openInGoogleDocs(activeLeadItem.title, el('leadMdEditor')?.value || activeLeadItem.summary || '');
  };
  if (el('btnAppLovable')) el('btnAppLovable').onclick = () => launchPortalStudioWithPacket('lovable', buildAppSpecBrief());
  if (el('btnAppEmergent')) el('btnAppEmergent').onclick = () => launchPortalStudioWithPacket('emergent', buildAppSpecBrief());
  if (el('btnAppWorkshop')) el('btnAppWorkshop').onclick = () => launchPortalStudioWithPacket('workshop', buildAppSpecBrief());
  if (el('btnAppHercules')) el('btnAppHercules').onclick = () => launchPortalStudioWithPacket('hercules', buildAppSpecBrief());
  if (el('btnAppMuse')) el('btnAppMuse').onclick = () => launchPortalStudioWithPacket('muse', buildAppSpecBrief());
  if (el('btnBizLovable')) el('btnBizLovable').onclick = () => launchPortalStudioWithPacket('lovable', buildBizSpecBrief());
  if (el('btnLeadMindsmith')) el('btnLeadMindsmith').onclick = () => launchPortalStudioWithPacket('mindsmith');
  if (el('btnLeadAsana')) el('btnLeadAsana').onclick = () => {
    if (!activeLeadItem) return;
    pushTaskToAsana(`Complete ${activeLeadItem.category === 'books' ? 'Book Chapter' : 'Course Module'}: ${activeLeadItem.title}`, activeLeadItem.summary || '');
  };

  /* ================= DEDICATED PROJECTS STUDIO (CLAUDE / CHATGPT PROJECTS STYLE) ================= */
  let lastLoadedProjectIdInForm = '';

  function selectProjectForStudio(proj, forceLoadInputs) {
    if (!proj) return;
    const changed = selectedProjectViewId !== proj.id;
    selectedProjectViewId = proj.id;
    if (el('projActiveTitle')) {
      const isLiveActive = activeProjectId === proj.id;
      el('projActiveTitle').textContent = `PROJECT // ${proj.name.toUpperCase()}${isLiveActive ? ' (● ACTIVE IN VOICE/CHAT)' : ''}`;
    }
    if (changed || forceLoadInputs || lastLoadedProjectIdInForm !== proj.id) {
      lastLoadedProjectIdInForm = proj.id;
      if (el('projNameInput')) el('projNameInput').value = proj.name || '';
      if (el('projInstructionsInput')) el('projInstructionsInput').value = proj.customInstructions || '';
      if (el('projKnowledgeInput')) el('projKnowledgeInput').value = proj.knowledgeNotes || '';
      if (el('projDeliverablesEditor')) el('projDeliverablesEditor').value = proj.deliverables || '';
    }
  }

  function renderProjectsStudio(projects) {
    const list = projects || [];
    // Populate top-bar Active Project selector
    const topSel = el('activeProjectSelect');
    if (topSel) {
      if (activeProjectId && !list.some((p) => p.id === activeProjectId)) {
        activeProjectId = '';
        localStorage.setItem('jarvis_active_project_id', '');
      }
      topSel.innerHTML = `<option value="">📁 Project: Global Workspace</option>` +
        list.map((p) => `<option value="${escapeHtml(p.id)}">📁 Project: ${escapeHtml(p.name)}</option>`).join('');
      topSel.value = activeProjectId || '';
    }

    // Populate AI Agent Linked Project selector
    const agentProjSel = el('agentProjectInput');
    if (agentProjSel && document.activeElement !== agentProjSel) {
      const curVal = agentProjSel.value;
      agentProjSel.innerHTML = `<option value="">Global Workspace (No Specific Project)</option>` +
        list.map((p) => `<option value="${escapeHtml(p.id)}">📁 ${escapeHtml(p.name)}</option>`).join('');
      if (list.some((p) => p.id === curVal)) agentProjSel.value = curVal;
    }

    if (!selectedProjectViewId && list.length > 0) {
      selectProjectForStudio(list.find((p) => p.id === activeProjectId) || list[0], true);
    } else if (selectedProjectViewId) {
      const cur = list.find((p) => p.id === selectedProjectViewId);
      if (cur) {
        if (el('projActiveTitle')) {
          el('projActiveTitle').textContent = `PROJECT // ${cur.name.toUpperCase()}${activeProjectId === cur.id ? ' (● ACTIVE IN VOICE/CHAT)' : ''}`;
        }
        if (el('projDeliverablesEditor') && document.activeElement !== el('projDeliverablesEditor')) {
          el('projDeliverablesEditor').value = cur.deliverables || '';
        }
      } else if (list.length > 0) {
        selectProjectForStudio(list[0], true);
      }
    }

    const assetListEl = el('projectsAssetList');
    if (assetListEl) {
      assetListEl.innerHTML = list.map((p) => {
        const isLive = activeProjectId === p.id;
        return `
          <div class="asset-item ${selectedProjectViewId === p.id ? 'active' : ''}" data-proj-id="${escapeHtml(p.id)}">
            <div class="asset-title">📁 ${escapeHtml(p.name)} ${isLive ? '<span style="color:var(--emerald);font-size:11px;">● ACTIVE</span>' : ''}</div>
            <div class="asset-sub">${escapeHtml(String(p.customInstructions || 'Custom workspace instructions & knowledge').slice(0, 95))}</div>
          </div>
        `;
      }).join('');
      assetListEl.querySelectorAll('.asset-item').forEach((node) => {
        node.onclick = () => {
          const found = list.find((x) => x.id === node.dataset.projId);
          if (found) {
            selectProjectForStudio(found, true);
            renderProjectsStudio(list);
          }
        };
      });
    }
  }

  if (el('activeProjectSelect')) {
    el('activeProjectSelect').addEventListener('change', (e) => {
      activeProjectId = e.target.value || '';
      localStorage.setItem('jarvis_active_project_id', activeProjectId);
      const proj = getActiveProjectObj();
      if (proj) selectProjectForStudio(proj, true);
      Voice.playFx('complete');
      renderState();
    });
  }

  if (el('btnNewProject')) {
    el('btnNewProject').addEventListener('click', () => {
      selectedProjectViewId = '';
      lastLoadedProjectIdInForm = '__NEW__';
      if (el('projNameInput')) { el('projNameInput').value = ''; el('projNameInput').focus(); }
      if (el('projInstructionsInput')) el('projInstructionsInput').value = '';
      if (el('projKnowledgeInput')) el('projKnowledgeInput').value = '';
      if (el('projDeliverablesEditor')) el('projDeliverablesEditor').value = '# New Project Workspace\n';
      if (el('projActiveTitle')) el('projActiveTitle').textContent = 'NEW PROJECT // UNSAVED DRAFT';
    });
  }

  if (el('btnProjUploadFile') && el('projKnowledgeFileInput')) {
    el('btnProjUploadFile').addEventListener('click', () => el('projKnowledgeFileInput').click());
    el('projKnowledgeFileInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const existing = (el('projKnowledgeInput')?.value || '').trim();
        const header = `\n\n--- [UPLOADED FILE: ${f.name}] ---\n`;
        if (el('projKnowledgeInput')) {
          el('projKnowledgeInput').value = (existing ? existing + header : `[UPLOADED FILE: ${f.name}]\n`) + String(reader.result || '').slice(0, 25000);
        }
        Voice.playFx('complete');
      };
      reader.readAsText(f);
      e.target.value = '';
    });
  }

  if (el('btnSaveProject')) {
    el('btnSaveProject').addEventListener('click', async () => {
      const name = (el('projNameInput')?.value || '').trim();
      if (!name) { alert('Enter a Project Name first.'); return; }
      const payload = {
        id: selectedProjectViewId || '',
        name,
        customInstructions: (el('projInstructionsInput')?.value || '').trim(),
        knowledgeNotes: (el('projKnowledgeInput')?.value || '').trim(),
        deliverables: el('projDeliverablesEditor')?.value || ''
      };
      const res = await apiPost('/api/projects/save', payload);
      if (res && res.ok && res.item) {
        selectedProjectViewId = res.item.id;
        lastLoadedProjectIdInForm = res.item.id;
        activeProjectId = res.item.id;
        localStorage.setItem('jarvis_active_project_id', activeProjectId);
        Voice.playFx('complete');
        await refreshState();
        await jarvisReplyAndLog(`Saved Project "${name}" and activated its instructions and knowledge base for Voice and Chat.`, 'projects');
      }
    });
  }

  if (el('btnSaveProjDeliverables')) {
    el('btnSaveProjDeliverables').addEventListener('click', async () => {
      const cur = (serverData.state?.projects || []).find((p) => p.id === selectedProjectViewId);
      if (!cur) { alert('Save or select a Project on the left first.'); return; }
      await apiPost('/api/projects/save', {
        ...cur,
        deliverables: el('projDeliverablesEditor')?.value || ''
      });
      Voice.playFx('complete');
      await refreshState();
    });
  }

  if (el('btnActivateProjectInChat')) {
    el('btnActivateProjectInChat').addEventListener('click', async () => {
      const cur = (serverData.state?.projects || []).find((p) => p.id === selectedProjectViewId);
      if (!cur) return;
      activeProjectId = cur.id;
      localStorage.setItem('jarvis_active_project_id', activeProjectId);
      Voice.playFx('complete');
      renderState();
      await jarvisReplyAndLog(`Active Project switched to "${cur.name}". Every conversation now uses this project's custom instructions and knowledge base.`, 'projects');
    });
  }

  if (el('btnDeleteProject')) {
    el('btnDeleteProject').addEventListener('click', async () => {
      if (!selectedProjectViewId) return;
      await apiPost('/api/projects/delete', { id: selectedProjectViewId });
      if (activeProjectId === selectedProjectViewId) {
        activeProjectId = '';
        localStorage.setItem('jarvis_active_project_id', '');
      }
      selectedProjectViewId = '';
      lastLoadedProjectIdInForm = '';
      await refreshState();
    });
  }

  function getSelectedProjectFullMarkdown() {
    const cur = (serverData.state?.projects || []).find((p) => p.id === selectedProjectViewId);
    const title = cur?.name || el('projNameInput')?.value || 'JARVIS Project';
    const md = [
      `# ${title}`,
      '',
      `## Custom Instructions`,
      cur?.customInstructions || el('projInstructionsInput')?.value || '',
      '',
      `## Knowledge Base & Reference Notes`,
      cur?.knowledgeNotes || el('projKnowledgeInput')?.value || '',
      '',
      `## Workspace Notes & Agent Deliverables`,
      el('projDeliverablesEditor')?.value || cur?.deliverables || ''
    ].join('\n');
    return { title, md };
  }

  if (el('btnProjLovable')) el('btnProjLovable').onclick = () => { const d = getSelectedProjectFullMarkdown(); launchPortalStudioWithPacket('lovable', d.md.slice(0, 2200)); };
  if (el('btnProjMuse')) el('btnProjMuse').onclick = () => { const d = getSelectedProjectFullMarkdown(); launchPortalStudioWithPacket('muse', d.md.slice(0, 2500)); };
  if (el('btnProjObsidian')) el('btnProjObsidian').onclick = () => { const d = getSelectedProjectFullMarkdown(); syncToLocalConnector('obsidian', d.title, d.md, true); };
  if (el('btnProjWord')) el('btnProjWord').onclick = () => { const d = getSelectedProjectFullMarkdown(); syncToLocalConnector('msword', d.title, d.md, true); };
  if (el('btnProjGoogleDocs')) el('btnProjGoogleDocs').onclick = () => { const d = getSelectedProjectFullMarkdown(); openInGoogleDocs(d.title, d.md); };
  if (el('btnProjOneDrive')) el('btnProjOneDrive').onclick = () => { const d = getSelectedProjectFullMarkdown(); syncToLocalConnector('onedrive', d.title, d.md, false); };
  if (el('btnProjGoogleDrive')) el('btnProjGoogleDrive').onclick = () => { const d = getSelectedProjectFullMarkdown(); syncToLocalConnector('googledrive', d.title, d.md, false); };
  if (el('btnProjNotion')) el('btnProjNotion').onclick = () => { const d = getSelectedProjectFullMarkdown(); pushItemToNotion(d.title, d.md); };
  if (el('btnProjAsana')) el('btnProjAsana').onclick = () => { const d = getSelectedProjectFullMarkdown(); pushTaskToAsana(`Project Milestone: ${d.title}`, d.md.slice(0, 2500)); };

  /* ================= AUTONOMOUS MULTI-AGENT WORKFORCE ================= */
  function renderAgentsStudio(agents, projects) {
    const grid = el('agentsCardsGrid');
    if (!grid) return;
    const projMap = {};
    (projects || []).forEach((p) => { projMap[p.id] = p.name; });

    grid.innerHTML = (agents || []).map((a) => {
      const isWorking = runningAgentIds.has(a.id);
      const latestReport = (a.reports && a.reports[0]) ? a.reports[0] : null;
      const projLabel = a.projectId && projMap[a.projectId] ? `📁 ${projMap[a.projectId]}` : '🌐 Global Workspace';
      const schedLabel = Number(a.scheduleMins || 0) > 0 ? `⏱ Auto every ${a.scheduleMins}m` : '⚡ On-Demand';
      const brainLabel = (a.preferredBrain || 'auto').toUpperCase();

      return `
        <div class="agent-card ${isWorking ? 'working' : ''}">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
              <div>
                <div style="font-size:15.5px;font-weight:700;color:#fff;">${escapeHtml(a.emoji || '🤖')} ${escapeHtml(a.name)}</div>
                <div style="font-size:11.5px;color:var(--cyan);margin-top:2px;">${escapeHtml(a.role || 'Specialist AI Agent')}</div>
              </div>
              <span class="hud-badge" style="${isWorking ? 'border-color:var(--amber);color:#fde68a;' : 'border-color:var(--emerald);color:#6ee7b7;'}">
                ${isWorking ? '● WORKING...' : '● READY'}
              </span>
            </div>

            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
              <strong>Brain:</strong> ${escapeHtml(brainLabel)} • <strong>${escapeHtml(projLabel)}</strong> • ${escapeHtml(schedLabel)}
            </div>

            <div style="font-size:12px;color:var(--text-main);background:rgba(0,240,255,0.05);border-left:2px solid var(--cyan);padding:7px 9px;border-radius:6px;margin-bottom:10px;">
              <strong>Mission:</strong> ${escapeHtml(a.taskPrompt || '')}
            </div>

            ${latestReport ? `
              <div style="font-size:10.5px;color:var(--emerald);margin-bottom:4px;font-family:var(--font-mono);">
                ✓ Latest Deliverable (${escapeHtml(new Date(latestReport.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} • ${escapeHtml(latestReport.brainUsed || 'AI')}):
              </div>
              <div class="agent-report-box">${escapeHtml(latestReport.content)}</div>
            ` : `
              <div class="agent-report-box" style="color:var(--text-muted);font-style:italic;">
                No deliverable generated yet. Click "▶ Run Mission" (or "🚀 Run All Active Agents in Parallel" above) to dispatch ${escapeHtml(a.name)}!
              </div>
            `}
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
            <button class="btn btn-sm btn-primary" ${isWorking ? 'disabled' : ''} onclick="window.jarvisAgentAction('${escapeHtml(a.id)}', 'run')">
              ${isWorking ? '⏳ Working...' : '▶ Run Mission'}
            </button>
            ${latestReport ? `
              <button class="btn btn-sm btn-emerald" onclick="window.jarvisAgentAction('${escapeHtml(a.id)}', 'speak')" title="Read Report Aloud">🔊 Speak</button>
              <button class="btn btn-sm" onclick="window.jarvisAgentAction('${escapeHtml(a.id)}', 'obsidian')" title="Save Report to Obsidian">💎</button>
              <button class="btn btn-sm" onclick="window.jarvisAgentAction('${escapeHtml(a.id)}', 'word')" title="Export Report to Microsoft Word">📘</button>
              <button class="btn btn-sm" onclick="window.jarvisAgentAction('${escapeHtml(a.id)}', 'gdocs')" title="Open Report in Google Docs">📄</button>
              <button class="btn btn-sm" onclick="window.jarvisAgentAction('${escapeHtml(a.id)}', 'asana')" title="Send Action Item to Asana">🎯</button>
            ` : ''}
            <button class="btn btn-sm" style="margin-left:auto;" onclick="window.jarvisAgentAction('${escapeHtml(a.id)}', 'edit')" title="Edit Agent">✏️</button>
            <button class="btn btn-sm" style="color:#fca5a5;" onclick="window.jarvisAgentAction('${escapeHtml(a.id)}', 'delete')" title="Delete Agent">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function queryBrainForAgent(agent, linkedProj) {
    const settings = serverData.state?.settings || {};
    const konshusWhisper = getKonshusMemoryWhisper();
    const agentInstruction = [
      agent.systemPrompt || `You are ${agent.name}, ${agent.role}.`,
      linkedProj ? `[LINKED PROJECT: ${linkedProj.name}]\nProject Instructions: ${linkedProj.customInstructions || ''}\nProject Knowledge:\n${String(linkedProj.knowledgeNotes || '').slice(0, 2800)}` : '',
      konshusWhisper ? `[KONSHUS AI MEMORY VAULT]:\n${konshusWhisper.slice(0, 2000)}` : '',
      `IMPORTANT OUTPUT FORMAT: Put your complete, rich, multi-section Markdown deliverable inside "manuscriptBody" and put a crisp 2-sentence spoken executive summary inside "spokenReply" (with action="chat").`
    ].filter(Boolean).join('\n\n');

    const missionPrompt = `AUTONOMOUS AGENT MISSION FOR ${agent.name.toUpperCase()} (${agent.role}):\n${agent.taskPrompt}\n\nProduce a thorough, structured Markdown deliverable in "manuscriptBody" and a 2-sentence spoken summary in "spokenReply".`;

    const contextSummary = {
      currentLaptop: currentDeviceNode,
      assistantName: `${agent.name} (${agent.role})`,
      brandName: settings.brandName,
      authorName: settings.authorName || 'Founder',
      customPersona: agentInstruction
    };

    const pref = agent.preferredBrain || 'auto';
    const queue = [];
    if (pref.startsWith('gemini-')) {
      if (isBrainConfigured('gemini')) queue.push({ provider: 'gemini', geminiModel: pref, tag: pref.toUpperCase() });
    } else if (pref !== 'auto' && isBrainConfigured(pref)) {
      queue.push({ provider: pref, geminiModel: 'gemini-3.8-flash', tag: pref.toUpperCase() });
    }
    buildSmartModelCandidates(agent.taskPrompt, 'chat', settings).forEach((c) => {
      if (!queue.some((q) => q.provider === c.provider && q.geminiModel === c.geminiModel)) {
        queue.push(c);
      }
    });

    for (let i = 0; i < queue.length; i++) {
      const cand = queue[i];
      try {
        let plan = null;
        if (cand.provider === 'gemini') {
          plan = await Voice.askGemini(missionPrompt, contextSummary, sessionCsrfToken, cand.geminiModel || 'gemini-3.8-flash');
        } else {
          const aiRes = await apiPost('/api/connectors/ai-query', {
            provider: cand.provider,
            prompt: `${agentInstruction}\n\n${missionPrompt}`,
            context: contextSummary
          });
          if (aiRes && aiRes.ok && aiRes.plan) plan = aiRes.plan;
        }
        if (plan && (plan.manuscriptBody || plan.spokenReply)) {
          const fullMd = plan.manuscriptBody && String(plan.manuscriptBody).trim().length > 40
            ? String(plan.manuscriptBody).trim()
            : String(plan.spokenReply || '').trim();
          const spoken = String(plan.spokenReply || `${agent.name} completed its mission.`).trim();
          return { content: fullMd, spoken, brainUsed: cand.tag };
        }
      } catch (err) {
        console.warn(`[JARVIS Agent ${agent.name}] candidate ${cand.tag} fallback:`, err);
      }
    }

    // Instant structured offline fallback if no API key is set yet
    const fallbackMd = [
      `# ${agent.emoji || '🤖'} ${agent.name} — Deliverable Brief`,
      `**Role:** ${agent.role}`,
      `**Mission:** ${agent.taskPrompt}`,
      linkedProj ? `**Project:** ${linkedProj.name}` : '',
      ``,
      `## Executive Action Summary`,
      `1. **Strategic Alignment:** Aligned mission directly with ${linkedProj ? linkedProj.name : (settings.brandName || 'your workspace')}.`,
      `2. **Recommended Next Milestone:** Review and refine key deliverables, then push action items to Asana, ClickUp, Notion, or Obsidian.`,
      `3. **Tip:** Add or verify your Google Gemini, Claude, OpenAI, or Perplexity API key in Settings/Connectors for deep multi-page AI generation.`
    ].filter(Boolean).join('\n');
    return {
      content: fallbackMd,
      spoken: `${agent.name} prepared an initial structured brief. Connect or verify an AI brain key anytime for full autonomous generation.`,
      brainUsed: 'INSTANT ENGINE'
    };
  }

  async function runSingleAgent(agentId, opts) {
    const options = opts || { speakWhenDone: true };
    const st = serverData.state || {};
    const agent = (st.agents || []).find((a) => a.id === agentId);
    if (!agent || runningAgentIds.has(agentId)) return null;

    runningAgentIds.add(agentId);
    renderAgentsStudio(st.agents || [], st.projects || []);

    try {
      const linkedProj = agent.projectId ? (st.projects || []).find((p) => p.id === agent.projectId) : null;
      const result = await queryBrainForAgent(agent, linkedProj);
      const nowIso = new Date().toISOString();
      const reportEntry = {
        id: 'rep-' + Date.now(),
        timestamp: nowIso,
        brainUsed: result.brainUsed,
        summary: result.spoken,
        content: result.content
      };

      const updatedAgent = {
        ...agent,
        lastRunAt: nowIso,
        reports: [reportEntry, ...(agent.reports || [])].slice(0, 10)
      };
      await apiPost('/api/agents/save', updatedAgent);

      // Automatically append deliverable to Linked Project workspace!
      if (linkedProj) {
        const freshSt = await apiGet('/api/state');
        const latestProj = (freshSt?.state?.projects || st.projects || []).find((p) => p.id === linkedProj.id) || linkedProj;
        const stamp = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const block = `\n\n---\n## ${agent.emoji || '🤖'} Agent Deliverable: ${agent.name} (${agent.role}) — ${stamp}\n${result.content}\n`;
        await apiPost('/api/projects/save', {
          ...latestProj,
          deliverables: (latestProj.deliverables || '') + block
        });
      }

      await apiPost('/api/chat/log', {
        role: 'assistant',
        text: `[${agent.emoji || '🤖'} AGENT ${agent.name.toUpperCase()}] ${result.spoken}`,
        sourceNode: `AGENT-${agent.name.toUpperCase()}`,
        actionType: 'agent_report'
      });

      runningAgentIds.delete(agentId);
      Voice.playFx('complete');
      await refreshState();

      if (options.speakWhenDone) {
        const s = serverData.state?.settings || {};
        await Voice.speak(`${agent.name} finished its mission: ${result.spoken}`, {
          muted: voiceMuted || s.voiceReply === false,
          rate: s.voiceRate || 1.02,
          pitch: s.voicePitch || 0.94,
          useGeminiTts: !!serverData.hasVaultGeminiKey,
          csrfToken: sessionCsrfToken
        });
      }
      return result;
    } catch (err) {
      runningAgentIds.delete(agentId);
      await refreshState();
      return null;
    }
  }

  async function runAllAgentsInParallel() {
    const agents = (serverData.state?.agents || []).filter((a) => a.enabled !== false);
    if (agents.length === 0) {
      await jarvisReplyAndLog('Create at least one AI Agent first to run your autonomous squad.', 'agents');
      return;
    }
    setWaveMode('thinking');
    if (el('voiceStatusText')) {
      el('voiceStatusText').textContent = `🚀 RUNNING ${agents.length} AUTONOMOUS AGENTS IN PARALLEL...`;
    }
    await Promise.all(agents.map((a) => runSingleAgent(a.id, { speakWhenDone: false })));
    await jarvisReplyAndLog(
      `All ${agents.length} autonomous agents — ${agents.map((a) => a.name).join(', ')} — have completed their missions in parallel and saved their deliverables into your Projects workspace.`,
      'agents'
    );
  }

  window.jarvisAgentAction = async function (agentId, act) {
    if (!isAuthenticated) return;
    if (Voice.unlockAudioGesture) Voice.unlockAudioGesture();
    const agent = (serverData.state?.agents || []).find((a) => a.id === agentId);
    if (!agent) return;
    const latest = agent.reports && agent.reports[0] ? agent.reports[0] : null;

    if (act === 'run') {
      await runSingleAgent(agentId, { speakWhenDone: true });
    } else if (act === 'speak' && latest) {
      const s = serverData.state?.settings || {};
      await Voice.speak(latest.summary || latest.content.slice(0, 550), {
        muted: false,
        rate: s.voiceRate || 1.02,
        pitch: s.voicePitch || 0.94,
        useGeminiTts: !!serverData.hasVaultGeminiKey,
        csrfToken: sessionCsrfToken
      });
    } else if (act === 'obsidian' && latest) {
      await syncToLocalConnector('obsidian', `${agent.name} — ${agent.role}`, latest.content, true);
    } else if (act === 'word' && latest) {
      await syncToLocalConnector('msword', `${agent.name} — ${agent.role}`, latest.content, true);
    } else if (act === 'gdocs' && latest) {
      await openInGoogleDocs(`${agent.name} — ${agent.role}`, latest.content);
    } else if (act === 'asana' && latest) {
      await pushTaskToAsana(`[Agent ${agent.name}] Follow-Up Action`, latest.content.slice(0, 2500));
    } else if (act === 'edit') {
      if (el('agentEditId')) el('agentEditId').value = agent.id;
      if (el('agentEmojiInput')) el('agentEmojiInput').value = agent.emoji || '🤖';
      if (el('agentNameInput')) { el('agentNameInput').value = agent.name || ''; el('agentNameInput').focus(); }
      if (el('agentRoleInput')) el('agentRoleInput').value = agent.role || '';
      if (el('agentBrainInput')) el('agentBrainInput').value = agent.preferredBrain || 'auto';
      if (el('agentProjectInput')) el('agentProjectInput').value = agent.projectId || '';
      if (el('agentSchedInput')) el('agentSchedInput').value = String(agent.scheduleMins || 0);
      if (el('agentPromptInput')) el('agentPromptInput').value = agent.systemPrompt || '';
      if (el('agentTaskInput')) el('agentTaskInput').value = agent.taskPrompt || '';
      if (el('agentFormHeader')) el('agentFormHeader').textContent = `✏️ EDITING AGENT: ${agent.name.toUpperCase()}`;
    } else if (act === 'delete') {
      await apiPost('/api/agents/delete', { id: agentId });
      await refreshState();
    }
  };

  function resetAgentForm() {
    if (el('agentEditId')) el('agentEditId').value = '';
    if (el('agentEmojiInput')) el('agentEmojiInput').value = '🤖';
    if (el('agentNameInput')) el('agentNameInput').value = '';
    if (el('agentRoleInput')) el('agentRoleInput').value = '';
    if (el('agentBrainInput')) el('agentBrainInput').value = 'auto';
    if (el('agentProjectInput')) el('agentProjectInput').value = activeProjectId || '';
    if (el('agentSchedInput')) el('agentSchedInput').value = '0';
    if (el('agentPromptInput')) el('agentPromptInput').value = '';
    if (el('agentTaskInput')) el('agentTaskInput').value = '';
    if (el('agentFormHeader')) el('agentFormHeader').textContent = '➕ CREATE OR CUSTOMIZE AUTONOMOUS AI AGENT';
  }

  if (el('btnResetAgentForm')) el('btnResetAgentForm').addEventListener('click', resetAgentForm);
  if (el('btnRunAllAgents')) el('btnRunAllAgents').addEventListener('click', runAllAgentsInParallel);

  if (el('btnSaveAgent')) {
    el('btnSaveAgent').addEventListener('click', async () => {
      const name = (el('agentNameInput')?.value || '').trim();
      const taskPrompt = (el('agentTaskInput')?.value || '').trim();
      if (!name || !taskPrompt) {
        alert('Provide an Agent Name and an Autonomous Mission / Task Assignment.');
        return;
      }
      const editId = (el('agentEditId')?.value || '').trim();
      const existing = editId ? (serverData.state?.agents || []).find((a) => a.id === editId) : null;
      const payload = {
        id: editId || '',
        emoji: (el('agentEmojiInput')?.value || '🤖').trim() || '🤖',
        name,
        role: (el('agentRoleInput')?.value || '').trim() || 'Autonomous Specialist Agent',
        preferredBrain: el('agentBrainInput')?.value || 'auto',
        projectId: el('agentProjectInput')?.value || '',
        scheduleMins: Number(el('agentSchedInput')?.value || 0),
        enabled: true,
        systemPrompt: (el('agentPromptInput')?.value || '').trim(),
        taskPrompt,
        lastRunAt: existing?.lastRunAt || '',
        reports: existing?.reports || []
      };
      await apiPost('/api/agents/save', payload);
      resetAgentForm();
      Voice.playFx('complete');
      await refreshState();
      await jarvisReplyAndLog(`Autonomous Agent "${name}" is ready for deployment.`, 'agents');
    });
  }

  // Background Autonomous Agent Schedule Loop (executes any agent with scheduleMins > 0 when due!)
  setInterval(() => {
    if (!isAuthenticated) return;
    const agents = serverData.state?.agents || [];
    const now = Date.now();
    agents.forEach((a) => {
      const mins = Number(a.scheduleMins || 0);
      if (mins <= 0 || a.enabled === false || runningAgentIds.has(a.id)) return;
      const lastMs = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
      if (!lastMs || (now - lastMs) >= mins * 60000) {
        runSingleAgent(a.id, { speakWhenDone: false });
      }
    });
  }, 45000);

  // Security & Settings Modal + Personalization / Family Sharing
  let pendingAvatarDataUrl = null;

  function resizeAvatarPhotoToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read image file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Invalid image format.'));
        img.onload = () => {
          const size = 280;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const side = Math.min(img.width, img.height);
          const sx = Math.max(0, (img.width - side) / 2);
          // Frame slightly toward upper-center so a person's face & shoulders stay centered
          const sy = Math.max(0, (img.height - side) * 0.18);
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.86));
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

  async function openSettingsModal() {
    await loadSecurityInfo();
    const s = serverData.state?.settings || {};
    pendingAvatarDataUrl = null;
    el('cfgNetworkMode').value = securityInfo.networkMode || 'lan';
    el('vaultKeyStatus').textContent = securityInfo.hasGeminiKeyInVault
      ? `(Stored in DPAPI: ${securityInfo.geminiKeyMasked})`
      : '(Not set yet)';
    el('cfgGeminiKey').value = '';
    el('cfgNewPasscode').value = '';
    if (el('cfgAssistantName')) el('cfgAssistantName').value = s.assistantName || 'J.A.R.V.I.S.';
    el('cfgWakeWord').value = s.wakeWord || 'jarvis';
    if (el('cfgVoiceGender')) el('cfgVoiceGender').value = s.voiceGender || 'male';
    if (el('cfgAvatarMode')) el('cfgAvatarMode').value = s.avatarMode || 'orb';
    if (el('cfgHoloTint')) el('cfgHoloTint').checked = s.holoTint !== false;
    el('cfgGeminiModel').value = s.geminiModel || 'auto';
    el('cfgAuthorName').value = s.authorName || '';
    el('cfgBrandName').value = s.brandName || '';
    if (el('cfgIosGemUrl')) el('cfgIosGemUrl').value = s.iosGemUrl || '';
    if (el('cfgCustomPersona')) el('cfgCustomPersona').value = s.customPersona || '';

    const logs = securityInfo.auditLog || [];
    el('securityAuditBox').textContent = logs.length
      ? logs.map((ev) => `[${new Date(ev.timestamp).toLocaleTimeString()}] ${ev.event} (${ev.ip}) — ${ev.detail}`).join('\n')
      : 'No audit events yet.';

    el('settingsModal').classList.add('open');
  }

  if (el('btnUploadAvatarPhoto') && el('cfgAvatarFileInput')) {
    el('btnUploadAvatarPhoto').addEventListener('click', () => {
      el('cfgAvatarFileInput').click();
    });

    el('cfgAvatarFileInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizeAvatarPhotoToDataUrl(file);
        pendingAvatarDataUrl = dataUrl;
        if (el('cfgAvatarMode')) el('cfgAvatarMode').value = 'custom_photo';
        const tint = el('cfgHoloTint') ? el('cfgHoloTint').checked : true;
        await apiPost('/api/settings', {
          avatarMode: 'custom_photo',
          customAvatarDataUrl: dataUrl,
          holoTint: tint
        });
        Voice.playFx('complete');
        await refreshState();
        el('btnUploadAvatarPhoto').textContent = '✓ Photo Loaded!';
        setTimeout(() => { el('btnUploadAvatarPhoto').textContent = '📷 Upload Person Photo'; }, 2400);
      } catch (err) {
        alert(err.message || 'Could not process image.');
      }
      e.target.value = '';
    });
  }

  if (el('cfgAvatarMode')) {
    el('cfgAvatarMode').addEventListener('change', (e) => {
      const s = serverData.state?.settings || {};
      const hasCustom = !!(pendingAvatarDataUrl || (s.customAvatarDataUrl && String(s.customAvatarDataUrl).startsWith('data:image/')));
      if (e.target.value === 'custom_photo' && !hasCustom && el('cfgAvatarFileInput')) {
        el('cfgAvatarFileInput').click();
      }
      if (e.target.value === 'holo_female' && el('cfgVoiceGender')) {
        el('cfgVoiceGender').value = 'female';
      } else if (e.target.value === 'holo_male' && el('cfgVoiceGender')) {
        el('cfgVoiceGender').value = 'male';
      }
    });
  }

  if (el('btnShareFamilyKit')) {
    el('btnShareFamilyKit').addEventListener('click', async () => {
      const inviteText = [
        '🎁 Get Your Own Personal J.A.R.V.I.S. Holographic AI App (iPhone, iPad, Mac & Windows)!',
        '',
        'I created a customizable voice-activated Personal AI Command Center with 3D Holographic Person Avatars, Photo Holograms, App Builder, and Book/Course Studio — and you can install your own 100% private copy in seconds (zero coding needed):',
        '',
        '📱 OPTION A — iPhone or iPad Only (No Computer Needed! Takes 15 Seconds):',
        '1. Open this link in Safari on your iPhone/iPad:',
        '   https://drjusinophd-cloud.github.io/personal-jarvis/',
        '2. Tap Safari\'s Share (⬆) button -> tap "Add to Home Screen".',
        '3. Open the app from your Home Screen, set your private Passcode, and tap "🛡 Security & Settings"!',
        '',
        '💻 OPTION B — Windows PC or MacBook Desktop App:',
        '1. Download the clean Starter ZIP:',
        '   https://github.com/drjusinophd-cloud/personal-jarvis/archive/refs/heads/main.zip',
        '2. Unzip and double-click "Install-For-Family-Windows.bat" (Windows) or "Install-For-Family-Mac.command" (Mac).',
        '',
        '✨ Make It Yours:',
        'Inside "🛡 Security & Settings", rename your AI (e.g., FRIDAY, ATHENA, NOVA, JARVIS), choose a Male or Female 3D Hologram Person (or upload any person\'s photo!), and paste a free Google Gemini API key from https://aistudio.google.com/apikey to talk back and forth!'
      ].join('\n');

      try {
        await navigator.clipboard.writeText(inviteText);
        el('btnShareFamilyKit').textContent = '✓ Invite Kit Copied to Clipboard!';
        Voice.playFx('complete');
        setTimeout(() => { el('btnShareFamilyKit').textContent = '🎁 Copy Family & Friends Share Kit'; }, 3000);
      } catch (err) {
        prompt('Copy this Family & Friends Invite Kit:', inviteText);
      }
    });
  }

  el('btnOpenSettings').addEventListener('click', openSettingsModal);
  const navSettingsBtn = el('btnNavOpenSettings');
  if (navSettingsBtn) navSettingsBtn.addEventListener('click', openSettingsModal);
  el('btnCloseSettings').addEventListener('click', () => el('settingsModal').classList.remove('open'));
  if (el('btnPasteGeminiKey')) {
    el('btnPasteGeminiKey').onclick = async () => {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip) { el('cfgGeminiKey').value = clip.trim(); el('cfgGeminiKey').type = 'text'; }
      } catch (e) { el('cfgGeminiKey').focus(); }
    };
  }
  if (el('btnToggleGeminiVis')) {
    el('btnToggleGeminiVis').onclick = () => {
      const inp = el('cfgGeminiKey');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    };
  }

  el('btnRotateAgentToken').addEventListener('click', async () => {
    const res = await apiPost('/api/security/rotate-agent-token', {});
    if (res.ok) {
      securityInfo.agentToken = res.agentToken;
      alert('MacBook Agent Token rotated! Copy the updated 1-line command from the 4-Laptop Fleet tab onto your MacBooks.');
      renderState();
      await openSettingsModal();
    }
  });

  if (el('btnCopyIosBridgeUrl')) {
    el('btnCopyIosBridgeUrl').onclick = async () => {
      const ips = serverData.host?.ips || [];
      const port = serverData.host?.port || 7777;
      const preferredIp = ips.find((ip) => ip.startsWith('100.')) || ips[0] || window.location.hostname || 'localhost';
      const bridgeUrl = `http://${preferredIp}:${port}/api/mobile/bridge`;
      try {
        await navigator.clipboard.writeText(bridgeUrl);
        el('btnCopyIosBridgeUrl').textContent = '✓ URL Copied!';
        setTimeout(() => { el('btnCopyIosBridgeUrl').textContent = '📋 Copy Bridge URL'; }, 2500);
      } catch (e) {
        prompt('Copy this Bridge URL into Apple Shortcuts:', bridgeUrl);
      }
    };
  }

  if (el('btnCopyIosBridgeInfo')) {
    el('btnCopyIosBridgeInfo').onclick = async () => {
      await loadSecurityInfo();
      const tok = (securityInfo.agentToken || '').trim();
      try {
        await navigator.clipboard.writeText(tok);
        el('btnCopyIosBridgeInfo').textContent = '✓ Token Copied!';
        setTimeout(() => { el('btnCopyIosBridgeInfo').textContent = '🔑 Copy Shortcut Token'; }, 2500);
      } catch (e) {
        prompt('Copy this exact X-Jarvis-Agent-Token into Apple Shortcuts:', tok);
      }
    };
  }

  el('btnSaveSettings').addEventListener('click', async () => {
    const newKey = el('cfgGeminiKey').value.trim();
    if (newKey) {
      await apiPost('/api/vault/gemini-key', { apiKey: newKey });
    }
    const newPass = el('cfgNewPasscode').value;
    if (newPass) {
      const pRes = await apiPost('/api/auth/change-passcode', { passcode: newPass });
      if (!pRes.ok) { alert(pRes.error); return; }
    }
    await apiPost('/api/security/network-mode', { networkMode: el('cfgNetworkMode').value });
    const settingsPatch = {
      assistantName: (el('cfgAssistantName') ? el('cfgAssistantName').value.trim() : '') || 'J.A.R.V.I.S.',
      wakeWord: el('cfgWakeWord').value.trim().toLowerCase() || 'jarvis',
      voiceGender: el('cfgVoiceGender') ? el('cfgVoiceGender').value : 'male',
      avatarMode: el('cfgAvatarMode') ? el('cfgAvatarMode').value : 'orb',
      holoTint: el('cfgHoloTint') ? !!el('cfgHoloTint').checked : true,
      geminiModel: el('cfgGeminiModel').value,
      authorName: el('cfgAuthorName').value.trim() || 'Founder',
      brandName: el('cfgBrandName').value.trim() || 'Apex Leadership & Venture Lab',
      iosGemUrl: el('cfgIosGemUrl') ? el('cfgIosGemUrl').value.trim() : '',
      customPersona: el('cfgCustomPersona') ? el('cfgCustomPersona').value.trim() : ''
    };
    if (pendingAvatarDataUrl) {
      settingsPatch.customAvatarDataUrl = pendingAvatarDataUrl;
    }
    await apiPost('/api/settings', settingsPatch);
    el('settingsModal').classList.remove('open');
    await loadSecurityInfo();
    await refreshState();
  });

  // Boot Auth Check & Live Sync
  checkAuthStatus();
  setInterval(refreshState, 3500);
})();
