/**
 * J.A.R.V.I.S. Voice I/O, Relaxed Multi-Sentence Speech Capture, Gemini TTS & Gemini 3.8 Live
 */
window.JarvisVoiceAndBrain = (function () {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isAppleWebKitSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Brave/i.test(ua);
  const isMacOrIos = /Mac|iPhone|iPad|iPod/i.test(ua);
  const isBrowserSecureForMic = (typeof window !== 'undefined') && (
    window.isSecureContext === true ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );

  let audioCtx = null;
  let recognition = null;
  let isListening = false;
  let shouldKeepListening = false;
  let holdToTalkActive = false;
  let handsFreeWakeMode = false;
  let conversationActiveUntil = 0;
  let selectedVoice = null;
  let activeHtmlAudio = null;
  let liveSession = null;
  let lastInteractionId = null;

  // Multi-sentence buffer & generous silence timer
  let accumulatedText = '';
  let latestInterim = '';
  let silenceTimer = null;
  let autoSendPausedByTyping = false;
  const SILENCE_SUBMIT_MS = 4500; // 4.5 full seconds of quiet before auto-sending

  // MediaRecorder fallback (for browsers/webviews without Web Speech API)
  let mediaRecorder = null;
  let recordedChunks = [];
  let recorderStream = null;
  let currentCsrfGetter = function () { return ''; };
  let hasVaultKeyGetter = function () { return false; };

  let stateCallback = function () {};
  let transcriptCallback = function () {};
  let wakeEventCallback = function () {};
  let statusHintCallback = function () {};

  let isCurrentlySpeaking = false;
  let speakingCooldownUntil = 0;

  // Acoustic Double-Clap Wake Engine
  let clapWakeEnabled = false;
  let clapStream = null;
  let clapSourceNode = null;
  let clapAnalyser = null;
  let clapTimer = null;
  let firstClapMs = 0;
  let lastClapImpulseMs = 0;
  let ambientRms = 0.012;

  function configureVaultAccess(getCsrfFn, hasKeyFn) {
    currentCsrfGetter = getCsrfFn || currentCsrfGetter;
    hasVaultKeyGetter = hasKeyFn || hasVaultKeyGetter;
  }

  function ensureAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  function playFx(type) {
    try {
      const ctx = ensureAudioCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'wake') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.14);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.21);
      } else if (type === 'complete') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.setValueAtTime(990, now + 0.09);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.29);
      }
    } catch (e) {}
  }

  let preferredVoiceGender = 'male';

  function pickJarvisVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;

    if (preferredVoiceGender === 'auto') {
      return voices.find((v) => v.default && v.lang && v.lang.toLowerCase().startsWith('en')) ||
             voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('en')) ||
             voices[0];
    }

    const preferredNames = preferredVoiceGender === 'female'
      ? [
          'Google UK English Female',
          'Microsoft Sonia',
          'Microsoft Libby',
          'Samantha',
          'Karen',
          'Moira',
          'Microsoft Aria',
          'Microsoft Jenny',
          'Victoria',
          'Google US English',
          'Microsoft Zira'
        ]
      : [
          'Google UK English Male',
          'Daniel',
          'Arthur',
          'Oliver',
          'Microsoft Ryan',
          'Microsoft George',
          'Microsoft Guy',
          'English (United Kingdom)'
        ];

    for (let i = 0; i < preferredNames.length; i++) {
      const target = preferredNames[i].toLowerCase();
      const match = voices.find((v) => v.name.toLowerCase().includes(target));
      if (match) return match;
    }

    if (preferredVoiceGender === 'female') {
      const femMatch = voices.find((v) => /female|woman|zira|samantha|aria|sonia|jenny|victoria|karen/i.test(v.name));
      if (femMatch) return femMatch;
    }

    return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('en-gb')) ||
           voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('en')) ||
           voices[0];
  }

  function setVoicePreference(gender) {
    const next = (gender === 'female' || gender === 'auto') ? gender : 'male';
    if (preferredVoiceGender !== next || !selectedVoice) {
      preferredVoiceGender = next;
      if ('speechSynthesis' in window) {
        selectedVoice = pickJarvisVoice();
      }
    }
  }

  let activeBufferSource = null;
  let activeUtterance = null; // Prevent Chromium V8 GC from destroying active SpeechSynthesisUtterance!
  let lastVoiceEngine = 'Standby';
  let audioGestureUnlocked = false;
  let speechSynthPrimed = false;

  // Unlock WebAudio & SpeechSynthesis on first click, tap (macOS & iOS Safari!), or keypress
  function unlockAudioGesture() {
    try {
      const ctx = ensureAudioCtx();
      if (ctx && !audioGestureUnlocked) {
        const silentBuf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = silentBuf;
        src.connect(ctx.destination);
        src.start(0);
        audioGestureUnlocked = true;
      }
      if ('speechSynthesis' in window) {
        selectedVoice = selectedVoice || pickJarvisVoice();
        if (isMacOrIos && !speechSynthPrimed && !window.speechSynthesis.speaking) {
          speechSynthPrimed = true;
          try {
            window.speechSynthesis.resume();
            const warm = new SpeechSynthesisUtterance(' ');
            warm.volume = 0;
            warm.rate = 2;
            window.speechSynthesis.speak(warm);
          } catch (e2) {}
        }
      }
    } catch (e) {}
  }

  if (typeof window !== 'undefined') {
    ['click', 'touchend', 'pointerdown', 'keydown'].forEach(function (evName) {
      window.addEventListener(evName, unlockAudioGesture, { passive: true });
    });
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = function () {
      selectedVoice = pickJarvisVoice();
    };
  }

  function stopSpeaking() {
    if (activeBufferSource) {
      try { activeBufferSource.stop(0); activeBufferSource.disconnect(); } catch (e) {}
      activeBufferSource = null;
    }
    if (activeHtmlAudio) {
      try { activeHtmlAudio.pause(); activeHtmlAudio.currentTime = 0; } catch (e) {}
      activeHtmlAudio = null;
    }
    activeUtterance = null;
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    stateCallback(isListening ? 'listening' : 'idle');
  }

  function playBytesViaWebAudio(uint8Bytes, mimeType) {
    return new Promise(async function (resolve, reject) {
      try {
        const ctx = ensureAudioCtx();
        if (!ctx) return reject(new Error('No WebAudio context'));
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        // Check if container format (RIFF WAV, MP3, OGG) vs raw 16-bit signed PCM (Gemini audio/L16)
        const isRiffWav = uint8Bytes.length > 44 &&
          uint8Bytes[0] === 0x52 && uint8Bytes[1] === 0x49 && uint8Bytes[2] === 0x46 && uint8Bytes[3] === 0x46;
        const isMp3OrOgg = uint8Bytes.length > 4 && (
          (uint8Bytes[0] === 0x49 && uint8Bytes[1] === 0x44 && uint8Bytes[2] === 0x33) ||
          (uint8Bytes[0] === 0xFF && (uint8Bytes[1] & 0xE0) === 0xE0) ||
          (uint8Bytes[0] === 0x4F && uint8Bytes[1] === 0x67 && uint8Bytes[2] === 0x67)
        );

        let audioBuffer = null;
        if (isRiffWav || isMp3OrOgg) {
          const copyBuf = uint8Bytes.buffer.slice(uint8Bytes.byteOffset, uint8Bytes.byteOffset + uint8Bytes.byteLength);
          audioBuffer = await new Promise(function (resDec, rejDec) {
            ctx.decodeAudioData(copyBuf, resDec, rejDec);
          });
        } else {
          // Raw 16-bit signed little-endian PCM (e.g. Gemini TTS audio/L16;codec=pcm;rate=24000)
          let rate = 24000;
          const rateMatch = String(mimeType || '').match(/rate=(\d+)/i);
          if (rateMatch) rate = parseInt(rateMatch[1], 10) || 24000;
          const sampleCount = Math.floor(uint8Bytes.byteLength / 2);
          if (sampleCount < 10) return reject(new Error('Empty PCM audio'));
          audioBuffer = ctx.createBuffer(1, sampleCount, rate);
          const ch = audioBuffer.getChannelData(0);
          const dv = new DataView(uint8Bytes.buffer, uint8Bytes.byteOffset, uint8Bytes.byteLength);
          for (let i = 0; i < sampleCount; i++) {
            ch[i] = dv.getInt16(i * 2, true) / 32768.0;
          }
        }

        stopSpeaking();
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(ctx.destination);
        activeBufferSource = src;
        stateCallback('speaking');
        src.onended = function () {
          if (activeBufferSource === src) activeBufferSource = null;
          stateCallback(isListening ? 'listening' : 'idle');
          resolve();
        };
        src.start(0);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function speakViaGeminiTts(cleanText, csrfToken) {
    const res = await fetch('/api/ai/gemini', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Jarvis-CSRF': csrfToken
      },
      body: JSON.stringify({
        model: 'gemini-3.8-flash-lite-tts',
        input: [{
          type: 'user_input',
          content: [{
            type: 'text',
            text: cleanText,
            annotations: [{
              type: 'speech_metadata',
              style: preferredVoiceGender === 'female'
                ? 'warm, poised, articulate executive AI assistant'
                : 'composed, refined British executive AI assistant like JARVIS'
            }]
          }]
        }],
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [{ voice: preferredVoiceGender === 'female' ? 'Aoede' : 'Sadaltager' }]
        }
      })
    });
    if (!res.ok) throw new Error('Gemini TTS HTTP ' + res.status);
    const data = await res.json();
    let audioB64 = data?.output_audio?.data || '';
    let mime = data?.output_audio?.mime_type || 'audio/L16;rate=24000';
    if (!audioB64 && Array.isArray(data.steps)) {
      for (const st of data.steps) {
        if (st.type === 'model_output' && Array.isArray(st.content)) {
          for (const part of st.content) {
            if (part.type === 'audio' && part.data) {
              audioB64 = part.data;
              mime = part.mime_type || mime;
            }
          }
        }
      }
    }
    if (!audioB64) throw new Error('No Gemini audio bytes');

    const bin = atob(audioB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    lastVoiceEngine = 'Gemini Neural TTS';
    await playBytesViaWebAudio(bytes, mime);
  }

  async function speakViaServerWav(cleanText, csrfToken) {
    const res = await fetch('/api/voice/tts-wav', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Jarvis-CSRF': csrfToken || currentCsrfGetter() || ''
      },
      body: JSON.stringify({ text: cleanText })
    });
    if (!res.ok) throw new Error('Server WAV TTS HTTP ' + res.status);
    const arrBuf = await res.arrayBuffer();
    if (!arrBuf || arrBuf.byteLength < 100) throw new Error('Empty server WAV');
    lastVoiceEngine = 'Windows Hub SAPI Audio';
    try {
      await playBytesViaWebAudio(new Uint8Array(arrBuf), 'audio/wav');
    } catch (webAudioErr) {
      await new Promise(function (resolve, reject) {
        const wavBlob = new Blob([arrBuf], { type: 'audio/wav' });
        const url = URL.createObjectURL(wavBlob);
        stopSpeaking();
        const aud = new Audio(url);
        activeHtmlAudio = aud;
        stateCallback('speaking');
        aud.onended = function () {
          URL.revokeObjectURL(url);
          if (activeHtmlAudio === aud) activeHtmlAudio = null;
          stateCallback(isListening ? 'listening' : 'idle');
          resolve();
        };
        aud.onerror = function (err) {
          URL.revokeObjectURL(url);
          if (activeHtmlAudio === aud) activeHtmlAudio = null;
          stateCallback(isListening ? 'listening' : 'idle');
          reject(err || webAudioErr);
        };
        aud.play().catch(reject);
      });
    }
  }

  function speakViaBrowserSynthesis(cleanText, opts) {
    return new Promise(function (resolve, reject) {
      if (!('speechSynthesis' in window)) {
        return reject(new Error('speechSynthesis unsupported'));
      }
      const synth = window.speechSynthesis;

      function queueUtterance() {
        try { synth.resume(); } catch (e) {}
        const utter = new SpeechSynthesisUtterance(cleanText);
        activeUtterance = utter; // Hold strong reference so V8 GC never kills speech!
        selectedVoice = selectedVoice || pickJarvisVoice();
        if (selectedVoice) utter.voice = selectedVoice;
        utter.rate = Number(opts.rate || 1.02);
        utter.pitch = Number(opts.pitch || (preferredVoiceGender === 'female' ? 1.04 : 0.94));
        utter.volume = 1.0;

        let started = false;
        let finished = false;
        const maxDurationMs = Math.max(5000, cleanText.length * 110);

        const startCheckTimer = setTimeout(function () {
          if (!started && !finished) {
            finished = true;
            activeUtterance = null;
            try { synth.cancel(); } catch (e) {}
            reject(new Error('Browser speech did not start in time'));
          }
        }, isMacOrIos ? 4500 : 2500);

        const safetyEndTimer = setTimeout(function () {
          if (!finished) {
            finished = true;
            activeUtterance = null;
            stateCallback(isListening ? 'listening' : 'idle');
            resolve();
          }
        }, maxDurationMs);

        utter.onstart = function () {
          started = true;
          clearTimeout(startCheckTimer);
          lastVoiceEngine = selectedVoice ? ('Browser (' + selectedVoice.name + ')') : 'Browser Speech';
          stateCallback('speaking');
        };
        utter.onend = function () {
          if (finished) return;
          finished = true;
          clearTimeout(startCheckTimer);
          clearTimeout(safetyEndTimer);
          activeUtterance = null;
          stateCallback(isListening ? 'listening' : 'idle');
          resolve();
        };
        utter.onerror = function (ev) {
          if (finished) return;
          finished = true;
          clearTimeout(startCheckTimer);
          clearTimeout(safetyEndTimer);
          activeUtterance = null;
          stateCallback(isListening ? 'listening' : 'idle');
          if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) {
            resolve();
          } else {
            reject(new Error('SpeechSynthesis error'));
          }
        };

        synth.speak(utter);
      }

      // Avoid Chromium bug where cancel() on the exact same tick cancels the new utterance!
      if (synth.speaking || synth.pending) {
        try { synth.cancel(); } catch (e) {}
        setTimeout(queueUtterance, 75);
      } else {
        queueUtterance();
      }
    });
  }

  async function speak(text, opts) {
    opts = opts || {};
    if (opts.muted || !text) return;
    const clean = String(text).replace(/https?:\/\/\S+/g, '').replace(/[*#`_~]/g, '').trim();
    if (!clean) return;

    const csrf = opts.csrfToken || currentCsrfGetter() || '';
    isCurrentlySpeaking = true;

    // Pause speech recognition completely while JARVIS speaks so speaker audio is NEVER transcribed!
    clearSilenceTimer();
    accumulatedText = '';
    latestInterim = '';
    if (recognition) {
      try { recognition.abort(); } catch (e) {}
      isListening = false;
    }

    try {
      // Optional explicit Neural TTS override; otherwise default to instant 0ms Browser Executive Voice
      // so conversational replies start immediately and preserve 100% of Gemini API RPM quota for Q&A!
      if (opts.forceGeminiTts && csrf) {
        try {
          await speakViaGeminiTts(clean, csrf);
          return;
        } catch (e) {
          console.warn('[JARVIS Voice] Gemini TTS fallback:', e.message);
        }
      }

      // Tier 1: Instant Browser Native SpeechSynthesis (Google UK English Male / Microsoft Ryan / Daniel)
      try {
        await speakViaBrowserSynthesis(clean, opts);
        return;
      } catch (e) {
        console.warn('[JARVIS Voice] Browser Speech fallback to Hub WAV:', e.message);
      }

      // Tier 2: Windows Command Hub Server-Side SAPI WAV Stream (works in embedded webviews & iOS!)
      try {
        await speakViaServerWav(clean, csrf);
        return;
      } catch (e) {
        console.warn('[JARVIS Voice] Hub WAV fallback:', e.message);
      }

      // Tier 3: Gemini Neural TTS backup
      if (opts.useGeminiTts && csrf) {
        try {
          await speakViaGeminiTts(clean, csrf);
          return;
        } catch (e) {
          console.warn('[JARVIS Voice] All TTS tiers unavailable:', e.message);
        }
      }
      stateCallback('idle');
    } finally {
      isCurrentlySpeaking = false;
      speakingCooldownUntil = Date.now() + 550;
      accumulatedText = '';
      latestInterim = '';

      // Resume microphone cleanly after speaker echo settles for natural back-and-forth conversation!
      setTimeout(function () {
        if (isCurrentlySpeaking) return;
        accumulatedText = '';
        latestInterim = '';
        const shouldResumeMic = shouldKeepListening || handsFreeWakeMode || (Date.now() < conversationActiveUntil);
        if (shouldResumeMic) {
          if (!recognition) recognition = initRecognition();
          if (recognition) {
            try { recognition.start(); } catch (e) {}
          }
          stateCallback('listening');
        } else {
          stateCallback('idle');
        }
      }, 480);
    }
  }

  /* =========================================================================
     NATURAL CONVERSATIONAL VOICE & WAKE ENGINE (HENRY-AI STYLE BACK-AND-FORTH)
     ========================================================================= */
  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function cancelAutoSendBecauseUserIsTyping() {
    autoSendPausedByTyping = true;
    clearSilenceTimer();
  }

  function isSleepPhrase(norm) {
    return /^(go to sleep|standby|stand by|jarvis standby|jarvis go to sleep|stop listening|mute microphone|thats all|that's all|thats all for now|that's all for now|goodbye jarvis|bye jarvis)$/.test(norm);
  }

  function looksLikeDirectSpokenQuestionOrCommand(norm) {
    const words = norm.split(' ').filter(Boolean);
    if (words.length < 4) return false;
    return /^(what|how|why|when|where|who|which|can|could|would|will|should|do|does|did|is|are|with|tell|explain|show|help|give|summarize|build|create|write|make|open|launch|draft|design|plan)\b/.test(norm) ||
      /\b(api key|api keys|connector|connectors|direct link|jarvis|leadership|book|course|funnel|app|macbook|iphone)\b/.test(norm);
  }

  function matchWakePhrase(spoken) {
    const norm = String(spoken || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!norm) return null;
    const wakeWord = (window.JARVIS_WAKE_WORD || 'jarvis').toLowerCase().trim();

    if (isSleepPhrase(norm)) {
      return { kind: 'sleep' };
    }

    // 1. Contains custom wake word (e.g., "hi jarvis", "hello jarvis", "hey jarvis, how do I...")
    // Also handle common Web Speech near-homophones at start ("hey jarvis" misheard as "the jarvis" / "your jarvis")
    const wIdx = norm.indexOf(wakeWord);
    if (wIdx >= 0) {
      const beforeRaw = norm.slice(0, wIdx).trim();
      const afterRaw = norm.slice(wIdx + wakeWord.length).trim();

      // Only treat as a pure greeting if what precedes "jarvis" is empty or a short greeting/homophone AND nothing substantial follows!
      const shortPrefix = !beforeRaw || /^(hi|hello|hey|yo|okay|ok|good morning|good afternoon|good evening|wake up|the|your|there|dear)$/.test(beforeRaw);
      const fillerAfter = /^(|please|you there|are you there|are you awake|are you online|wake up|online|good morning|good afternoon|good evening|hi|hello|hey)$/.test(afterRaw);

      if (shortPrefix && fillerAfter) {
        return { kind: 'pure_greeting', phrase: spoken };
      }

      // If user spoke a question BEFORE "... jarvis" (e.g. "how do connectors work jarvis"), keep the whole question!
      const lowerOrig = spoken.toLowerCase();
      const origIdx = lowerOrig.indexOf(wakeWord);
      const afterClean = spoken.slice(origIdx + wakeWord.length).replace(/^[,\s.!?:;-]+/, '').trim();
      if (shortPrefix && afterClean) {
        return { kind: 'wake_with_command', command: afterClean };
      }
      return { kind: 'wake_with_command', command: spoken.trim() };
    }

    // 2. Standalone natural greetings ("good morning", "good afternoon", "good evening", "wake up")
    const greetMatch = norm.match(/^(good morning|good afternoon|good evening|wake up|hello there|im back|i'm back|i am back)(?:\s+(.*))?$/);
    if (greetMatch) {
      const remainder = (greetMatch[2] || '').trim();
      if (!remainder || /^(sir|friend|team|everyone|today|now|please)$/.test(remainder)) {
        return { kind: 'pure_greeting', phrase: spoken };
      }
      return { kind: 'wake_with_command', command: remainder };
    }

    // 3. Clear spoken question or request (4+ words) so user is NEVER ignored if they just ask JARVIS directly!
    if (looksLikeDirectSpokenQuestionOrCommand(norm)) {
      return { kind: 'wake_with_command', command: spoken.trim() };
    }

    return null;
  }

  function isInActiveConversation() {
    return shouldKeepListening || (Date.now() < conversationActiveUntil);
  }

  function scheduleRelaxedAutoSubmit() {
    clearSilenceTimer();
    if (holdToTalkActive || autoSendPausedByTyping || isCurrentlySpeaking) return;

    const previewFull = (accumulatedText + ' ' + latestInterim).trim();
    if (!previewFull) return;

    let waitMs = 2600; // Natural conversational pause (~2.6s) so you aren't cut off mid-sentence
    const m = matchWakePhrase(previewFull);

    if (isInActiveConversation()) {
      // In active conversation mode, submit ANY spoken response/question after a comfortable 2.5s pause
      waitMs = (m && m.kind === 'sleep') ? 1200 : 2500;
    } else if (handsFreeWakeMode) {
      if (m && m.kind === 'pure_greeting') {
        // Wait 2.3s even after "Hi Jarvis" so if user pauses 1.5s before asking their question, we capture the whole question!
        waitMs = 2300;
      } else if (m && m.kind === 'wake_with_command') {
        waitMs = 2600;
      } else {
        waitMs = 2400;
      }
    } else {
      waitMs = SILENCE_SUBMIT_MS;
    }

    silenceTimer = setTimeout(function () {
      if (isCurrentlySpeaking) return;
      const full = (accumulatedText + ' ' + latestInterim).trim();
      accumulatedText = '';
      latestInterim = '';
      if (!full) return;

      const normFull = full.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
      if (isSleepPhrase(normFull)) {
        conversationActiveUntil = 0;
        shouldKeepListening = false;
        statusHintCallback('🌙 STANDBY — CLAP 2X, CLICK ORB, OR SAY "HI JARVIS" ANYTIME');
        if (!handsFreeWakeMode) finalizeAndStopListening(false);
        return;
      }

      if (isInActiveConversation()) {
        // Direct back-and-forth conversation! Strip optional leading "hey jarvis" if they still said it, and answer!
        conversationActiveUntil = Date.now() + 180000;
        const wakeWord = (window.JARVIS_WAKE_WORD || 'jarvis').toLowerCase().trim();
        const wakeCheck = matchWakePhrase(full);
        if (wakeCheck && wakeCheck.kind === 'pure_greeting') {
          playFx('wake');
          wakeEventCallback({ source: 'voice', phrase: full });
          return;
        }
        const cleaned = full.replace(new RegExp('^(?:(?:hi|hello|hey|okay|ok)\\s+)?' + wakeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s,.:;!?-]*', 'i'), '').trim() || full;
        transcriptCallback({ draft: cleaned, interim: '', final: cleaned });
        return;
      }

      if (handsFreeWakeMode) {
        handleWakeWordUtterance(full);
      } else {
        transcriptCallback({ draft: full, interim: '', final: full });
      }
    }, waitMs);
  }

  function handleWakeWordUtterance(spoken) {
    if (isCurrentlySpeaking || Date.now() < speakingCooldownUntil) return;
    const matched = matchWakePhrase(spoken);
    if (!matched) return;

    if (matched.kind === 'sleep') {
      conversationActiveUntil = 0;
      shouldKeepListening = false;
      statusHintCallback('🌙 STANDBY — SAY "HI JARVIS" OR CLICK ORB TO RESUME');
      return;
    }

    if (matched.kind === 'pure_greeting') {
      playFx('wake');
      conversationActiveUntil = Date.now() + 180000; // 3 full minutes of continuous conversation!
      wakeEventCallback({ source: 'voice', phrase: spoken });
      return;
    }

    if (matched.kind === 'wake_with_command') {
      playFx('wake');
      conversationActiveUntil = Date.now() + 180000;
      transcriptCallback({ draft: matched.command, interim: '', final: matched.command });
    }
  }

  function focusDictationFallbackWithHint() {
    isListening = false;
    shouldKeepListening = false;
    handsFreeWakeMode = false;
    conversationActiveUntil = 0;
    stateCallback('idle');
    const inp = document.getElementById('commandInput');
    if (inp) inp.focus();
    if (!isBrowserSecureForMic) {
      statusHintCallback(isMacOrIos
        ? '🎙 PRESS FN TWICE (MAC) OR KEYBOARD MIC (IPHONE) TO SPEAK — OR OPEN JARVIS MAC APP (http://localhost:7777) FOR LIVE ORB MIC!'
        : '🎙 BROWSER BLOCKS LIVE MIC ON HTTP LAN IP — USE http://localhost:7777 OR HTTPS FOR HANDS-FREE ORB MIC!');
    } else {
      statusHintCallback('🎙 CLICK THE BROWSER ADDRESS BAR MIC/LOCK ICON & ALLOW MICROPHONE ACCESS!');
    }
  }

  async function startFallbackMediaRecorder() {
    if (!isBrowserSecureForMic || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      focusDictationFallbackWithHint();
      return;
    }
    try {
      recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4';
      mediaRecorder = new MediaRecorder(recorderStream, { mimeType });
      isListening = true;
      stateCallback('listening');
      transcriptCallback({
        draft: '',
        interim: 'Recording voice (take all the time you need — click Orb or release Space when done)...',
        final: ''
      });

      mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = async function () {
        isListening = false;
        if (recorderStream) {
          recorderStream.getTracks().forEach((t) => t.stop());
          recorderStream = null;
        }
        if (!recordedChunks.length) {
          stateCallback('idle');
          return;
        }
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        recordedChunks = [];

        if (!hasVaultKeyGetter()) {
          stateCallback('idle');
          alert('To use microphone speech inside this embedded preview tab, either save your Gemini API key in Security & Settings OR open http://localhost:7777 in Google Chrome or Microsoft Edge.');
          return;
        }

        stateCallback('thinking');
        try {
          const b64 = await blobToBase64(blob);
          const csrf = currentCsrfGetter();
          const res = await fetch('/api/ai/gemini', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Jarvis-CSRF': csrf },
            body: JSON.stringify({
              model: 'gemini-3.8-flash',
              input: [
                { type: 'text', text: 'Transcribe the user speech accurately. Output ONLY the exact spoken words without quotes or commentary.' },
                { type: 'audio', data: b64, mime_type: (blob.type || 'audio/webm').split(';')[0] }
              ]
            })
          });
          const data = await res.json();
          let text = data.output_text || '';
          if (!text && Array.isArray(data.steps)) {
            for (const st of data.steps) {
              if (st.type === 'model_output' && Array.isArray(st.content)) {
                for (const p of st.content) if (p.type === 'text' && p.text) text += p.text;
              }
            }
          }
          const cleaned = text.trim().replace(/^(hey\s+jarvis|jarvis)[,\s]*/i, '').trim();
          stateCallback('idle');
          if (cleaned) transcriptCallback({ draft: cleaned, interim: '', final: cleaned });
        } catch (err) {
          stateCallback('idle');
        }
      };

      mediaRecorder.start();
    } catch (err) {
      focusDictationFallbackWithHint();
    }
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onloadend = function () {
        const res = String(reader.result || '');
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function initRecognition() {
    if (!isBrowserSecureForMic) return null;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;

    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    // Chrome/Edge handle continuous=true cleanly; Apple Safari WebKit requires continuous=false + seamless onend restart!
    rec.continuous = !isAppleWebKitSafari;

    rec.onstart = function () {
      isListening = true;
      stateCallback('listening');
    };

    rec.onresult = function (event) {
      if (isCurrentlySpeaking || Date.now() < speakingCooldownUntil) {
        return;
      }
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          accumulatedText = (accumulatedText + ' ' + res[0].transcript).trim();
        } else {
          interim += res[0].transcript;
        }
      }
      latestInterim = interim.trim();
      const combined = (accumulatedText + ' ' + latestInterim).trim();

      if (combined) {
        transcriptCallback({
          draft: isInActiveConversation() || !handsFreeWakeMode ? combined : '',
          interim: combined,
          final: ''
        });
        scheduleRelaxedAutoSubmit();
      }
    };

    rec.onerror = function (ev) {
      if (ev.error === 'not-allowed' || ev.error === 'security') {
        try { rec.stop(); } catch (e) {}
        recognition = null;
        focusDictationFallbackWithHint();
        return;
      }
      // Embedded Electron/IDE webviews lack Chrome's internal speech service ('network' error).
      // Automatically switch to MediaRecorder + Gemini audio transcription if secure mic is available!
      if ((ev.error === 'network' || ev.error === 'service-not-allowed') && shouldKeepListening) {
        shouldKeepListening = false;
        try { rec.stop(); } catch (e) {}
        recognition = null;
        startFallbackMediaRecorder();
      }
    };

    rec.onend = function () {
      isListening = false;
      // Never restart mic while JARVIS is speaking out loud (speak()'s finally block restarts it cleanly after echo fades)
      if (isCurrentlySpeaking) return;

      if (shouldKeepListening || handsFreeWakeMode || (Date.now() < conversationActiveUntil)) {
        setTimeout(function () {
          if (!isCurrentlySpeaking && (shouldKeepListening || handsFreeWakeMode || (Date.now() < conversationActiveUntil))) {
            try { rec.start(); } catch (e) {}
          }
        }, 160);
      } else {
        stateCallback('idle');
      }
    };

    return rec;
  }

  function startListeningSession(isHoldMode) {
    stopSpeaking();
    clearSilenceTimer();
    accumulatedText = '';
    latestInterim = '';
    autoSendPausedByTyping = false;
    holdToTalkActive = !!isHoldMode;
    shouldKeepListening = true;
    conversationActiveUntil = Date.now() + 180000;
    playFx('wake');

    if (!recognition) recognition = initRecognition();
    if (!recognition) {
      startFallbackMediaRecorder();
      return;
    }
    if (!isListening) {
      try { recognition.start(); } catch (e) {}
    } else {
      stateCallback('listening');
    }
  }

  function finalizeAndStopListening(shouldSubmit) {
    clearSilenceTimer();
    holdToTalkActive = false;

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      shouldKeepListening = false;
      mediaRecorder.stop();
      return;
    }

    const wakeWord = (window.JARVIS_WAKE_WORD || 'jarvis').toLowerCase().trim();
    const wakeRx = new RegExp('^(?:(?:hi|hello|hey|okay|ok)\\s+)?' + wakeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s,.:;!?-]*', 'i');
    const fullSpoken = (accumulatedText + ' ' + latestInterim)
      .trim()
      .replace(wakeRx, '')
      .trim();
    accumulatedText = '';
    latestInterim = '';

    if (!handsFreeWakeMode && !shouldSubmit) {
      shouldKeepListening = false;
      conversationActiveUntil = 0;
      if (recognition) {
        try { recognition.stop(); } catch (e) {}
      }
      isListening = false;
      stateCallback('idle');
    }

    if (shouldSubmit && fullSpoken) {
      conversationActiveUntil = Date.now() + 180000;
      transcriptCallback({ draft: fullSpoken, interim: '', final: fullSpoken });
    }
  }

  // Click Orb / Mic Button: Starts continuous back-and-forth conversation, interrupts speech if speaking, or submits current buffer!
  function togglePushToTalk() {
    if (isCurrentlySpeaking) {
      stopSpeaking();
      startListeningSession(false);
      statusHintCallback('🟢 LISTENING — GO AHEAD, ASK ME ANYTHING...');
      return;
    }
    const pendingWords = (accumulatedText + ' ' + latestInterim).trim();
    if (isListening && pendingWords) {
      finalizeAndStopListening(true);
      return;
    }
    if (shouldKeepListening && (Date.now() < conversationActiveUntil)) {
      shouldKeepListening = false;
      conversationActiveUntil = 0;
      clearSilenceTimer();
      accumulatedText = '';
      latestInterim = '';
      if (!handsFreeWakeMode && recognition) {
        try { recognition.stop(); } catch (e) {}
        isListening = false;
        stateCallback('idle');
      }
      statusHintCallback('🌙 CONVERSATION PAUSED — CLICK ORB, CLAP 2X, OR SAY "HI JARVIS" ANYTIME');
      return;
    }
    startListeningSession(false);
    statusHintCallback('🟢 LIVE CONVERSATION ACTIVE — SPEAK ANY QUESTION OR REQUEST FREELY!');
  }

  // Hold Spacebar: Starts on first keydown, stays open the entire time Space is held, sends on keyup!
  function beginHoldToTalk() {
    if (holdToTalkActive) return;
    startListeningSession(true);
  }

  function endHoldToTalk() {
    if (!holdToTalkActive) return;
    holdToTalkActive = false;
    // Wait 550ms after key release so the final syllable finishes transcribing
    setTimeout(function () {
      finalizeAndStopListening(true);
    }, 550);
  }

  function setHandsFreeMode(enabled, silentBoot) {
    handsFreeWakeMode = !!enabled;
    clearSilenceTimer();
    accumulatedText = '';
    latestInterim = '';
    shouldKeepListening = false;

    if (recognition) {
      try { recognition.stop(); } catch (e) {}
      recognition = null;
    }
    if (handsFreeWakeMode) {
      if (!silentBoot) playFx('wake');
      recognition = initRecognition();
      if (recognition) {
        try { recognition.start(); } catch (e) {}
      }
    } else {
      stateCallback('idle');
    }
    return handsFreeWakeMode;
  }

  function openFollowUpListeningWindow() {
    conversationActiveUntil = Date.now() + 180000;
    if (!isCurrentlySpeaking) {
      if (!recognition) recognition = initRecognition();
      if (recognition && !isListening) {
        try { recognition.start(); } catch (e) {}
      }
      stateCallback('listening');
    }
  }

  /* =========================================================================
     ACOUSTIC DOUBLE-CLAP WAKE DETECTOR (WEB AUDIO ANALYSER TRANSIENT ENGINE)
     ========================================================================= */
  async function setClapWakeMode(enabled) {
    clapWakeEnabled = !!enabled;
    if (clapTimer) {
      clearInterval(clapTimer);
      clapTimer = null;
    }
    if (clapSourceNode) {
      try { clapSourceNode.disconnect(); } catch (e) {}
      clapSourceNode = null;
    }
    if (clapStream) {
      try { clapStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      clapStream = null;
    }
    clapAnalyser = null;
    firstClapMs = 0;

    if (!clapWakeEnabled) return false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      clapWakeEnabled = false;
      return false;
    }

    try {
      try {
        clapStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
      } catch (e1) {
        clapStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const ctx = ensureAudioCtx();
      if (!ctx) {
        clapWakeEnabled = false;
        return false;
      }

      clapSourceNode = ctx.createMediaStreamSource(clapStream);
      clapAnalyser = ctx.createAnalyser();
      clapAnalyser.fftSize = 1024;
      clapSourceNode.connect(clapAnalyser);

      const buf = new Float32Array(clapAnalyser.fftSize);
      ambientRms = 0.012;

      clapTimer = setInterval(function () {
        if (!clapWakeEnabled || !clapAnalyser) return;
        if (isCurrentlySpeaking || Date.now() < speakingCooldownUntil) return;

        clapAnalyser.getFloatTimeDomainData(buf);
        let sumSq = 0;
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]);
          if (v > peak) peak = v;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);

        // Update slow rolling ambient floor only during quiet frames
        if (peak < 0.14) {
          ambientRms = ambientRms * 0.95 + rms * 0.05;
        }

        const now = Date.now();
        if (firstClapMs > 0 && now - firstClapMs > 1300) {
          firstClapMs = 0;
        }

        const threshold = Math.max(0.18, ambientRms * 3.8);
        if (peak > threshold && (now - lastClapImpulseMs) > 170) {
          lastClapImpulseMs = now;
          const capturedPeak = peak;

          // Verify sharp acoustic decay 65ms later so normal sustained speech doesn't trigger clap
          setTimeout(function () {
            if (!clapAnalyser || isCurrentlySpeaking) return;
            const checkBuf = new Float32Array(clapAnalyser.fftSize);
            clapAnalyser.getFloatTimeDomainData(checkBuf);
            let s2 = 0;
            for (let j = 0; j < checkBuf.length; j++) s2 += checkBuf[j] * checkBuf[j];
            const rmsAfter = Math.sqrt(s2 / checkBuf.length);

            if (rmsAfter < capturedPeak * 0.65) {
              const tNow = Date.now();
              if (firstClapMs > 0 && (tNow - firstClapMs) >= 140 && (tNow - firstClapMs) <= 1300) {
                firstClapMs = 0;
                playFx('wake');
                conversationActiveUntil = tNow + 180000;
                wakeEventCallback({ source: 'clap', phrase: '👏 Double-Clap Wake' });
              } else {
                firstClapMs = tNow;
                statusHintCallback('👏 CLAP 1 DETECTED — CLAP ONCE MORE TO WAKE JARVIS!');
              }
            }
          }, 65);
        }
      }, 25);

      return true;
    } catch (err) {
      console.warn('[JARVIS Clap Wake] Mic permission required or unavailable:', err.message);
      clapWakeEnabled = false;
      return false;
    }
  }

  /* =========================================================================
     GOOGLE GEMINI INTERACTIONS API BRAIN
     ========================================================================= */
  const JARVIS_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['chat', 'build_app', 'build_business', 'build_book', 'build_course', 'dispatch_node']
      },
      spokenReply: { type: 'string' },
      title: { type: 'string' },
      subtitle: { type: 'string' },
      targetNode: { type: 'string' },
      commandType: { type: 'string' },
      commandPayload: { type: 'string' },
      customHtml: { type: 'string' },
      manuscriptBody: { type: 'string' },
      chapters: { type: 'array', items: { type: 'string' } },
      modules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            week: { type: 'string' },
            title: { type: 'string' },
            videoScript: { type: 'string' },
            exercise: { type: 'string' }
          },
          required: ['week', 'title', 'videoScript', 'exercise']
        }
      },
      heroPromise: { type: 'string' }
    },
    required: ['action', 'spokenReply']
  };

  async function askGemini(prompt, contextInfo, csrfToken, modelName) {
    let model = modelName || 'gemini-3.5-flash-lite';
    if (/^gemini-(1\.5|2\.0|2\.5)/.test(model)) model = 'gemini-3.8-flash';

    const aiName = (contextInfo && contextInfo.assistantName) || window.JARVIS_ASSISTANT_NAME || 'J.A.R.V.I.S.';
    const ownerName = (contextInfo && contextInfo.authorName) || 'Dr. Hector Jusino';
    const sysPrompt = [
      `You are ${aiName}, an intelligent, warm, articulate, loyal executive AI partner personalized for ${ownerName} (operating across desktop and mobile devices).`,
      'CONVERSATIONAL PRIORITY RULE (CRITICAL):',
      '- Whenever the user asks a question, seeks advice, brainstorms, chats, or asks how something works, you MUST set "action": "chat" and provide a clear, direct, helpful, natural conversational answer in "spokenReply" (2 to 5 crisp sentences that sound great spoken aloud—never recite canned workspace counts unless specifically asked!).',
      '- ONLY set "action" to "build_app", "build_business", "build_book", "build_course", or "dispatch_node" when the user explicitly instructs you to build, generate, create, write, or dispatch one right now.',
      'BUILT-IN PLATFORM, PROJECTS, AGENTS & CONNECTORS KNOWLEDGE:',
      '- Dedicated Projects Studio (📁 Projects tab + top-bar Project Selector): works like Claude Projects & ChatGPT Projects with custom instructions, uploaded .md/.txt knowledge files, and agent deliverables.',
      '- Autonomous Multi-Agent Workforce (🤖 AI Agents tab): supports multiple independent specialist agents (e.g., Atlas Research, Scribe Author, Vanguard Strategist, Chief of Staff) that can run solo, in parallel, or on an automatic timer.',
      '- Connectors Hub (🔌 tab) includes xAI Grok (grok-4.7 native AI Brain + 1-click grok.com Web Bridge), Muse AI (autonomous agent & interactive Spaces at muse.ai), Lovable (1-click #prompt= auto-prefill Build URL + lov_... API), Emergent Labs (agentic full-stack app blueprints), Mindsmith AI (interactive eLearning & course authoring), Workshop AI, Hercules AI, Konshus AI (long-term memory Whisper vault), Obsidian, Microsoft OneDrive, Google Drive, Google Docs, Microsoft Word (.doc export), Vercel (1-click live cloud app deploy), Asana, ClickUp, Notion, Cursor IDE, AIWriteBook, Genspark, Viktor AI, Slack, plus Gemini, Claude, OpenAI, Perplexity, DeepSeek, Kimi, and OpenRouter.',
      (contextInfo && contextInfo.customPersona) ? (`Shared Custom ${aiName} Persona & Instructions: ` + contextInfo.customPersona) : '',
      'Current Workspace & Recent Conversation Context: ' + JSON.stringify(contextInfo || {})
    ].filter(Boolean).join('\n');

    const reqBody = {
      model,
      system_instruction: sysPrompt,
      input: prompt,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: JARVIS_RESPONSE_SCHEMA
      }
    };
    if (lastInteractionId) reqBody.previous_interaction_id = lastInteractionId;

    const res = await fetch('/api/ai/gemini', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Jarvis-CSRF': csrfToken || ''
      },
      body: JSON.stringify(reqBody)
    });

    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error('Hub Gemini Vault Proxy HTTP ' + res.status + ': ' + errTxt.slice(0, 180));
    }

    const data = await res.json();
    if (data.id) lastInteractionId = data.id;

    let rawText = data.output_text || '';
    if (!rawText && Array.isArray(data.steps)) {
      const texts = [];
      for (const step of data.steps) {
        if (step.type === 'model_output' && Array.isArray(step.content)) {
          for (const part of step.content) {
            if (part.type === 'text' && part.text) texts.push(part.text);
          }
        }
      }
      rawText = texts.join('');
    }
    return JSON.parse(rawText || '{}');
  }

  /* =========================================================================
     GEMINI 3.8 LIVE WEBSOCKET (EPHEMERAL 1-USE TOKEN)
     ========================================================================= */
  async function toggleGeminiLiveStream(csrfToken, onStatus) {
    if (liveSession) {
      liveSession.close();
      liveSession = null;
      onStatus('Gemini 3.8 Live disconnected.');
      stateCallback('idle');
      return false;
    }

    onStatus('Minting 1-use ephemeral token from DPAPI Vault...');
    const tokRes = await fetch('/api/ai/live-token', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Jarvis-CSRF': csrfToken || ''
      },
      body: '{}'
    });
    const tokData = await tokRes.json();
    if (!tokRes.ok || !tokData.ephemeralToken) {
      throw new Error(tokData.error || 'Store your Gemini API Key in the Windows DPAPI Vault (Security & Settings) first.');
    }

    const wsUrl = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=' + encodeURIComponent(tokData.ephemeralToken);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    let nextPlayTime = 0;
    let activeSources = [];

    const ws = new WebSocket(wsUrl);
    ws.onopen = function () {
      onStatus('Gemini 3.8 Live Connected — Speak freely at your own pace');
      stateCallback('listening');
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-3.8-live',
          generationConfig: { responseModalities: ['AUDIO'] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: 'You are JARVIS, a refined British-cadence executive AI assistant helping the user build apps, grow their online leadership business, write leadership books, and design courses across their 4 laptops. Be patient, never rush the user, and keep answers crisp and helpful.' }]
          }
        }
      }));

      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = function (e) {
        if (ws.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
        ws.send(JSON.stringify({
          realtimeInput: { audio: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' } }
        }));
      };
      src.connect(proc);
      proc.connect(ctx.destination);
      ws._cleanupAudio = function () {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        } catch (e) {}
        proc.disconnect();
        src.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(function () {});
        playCtx.close().catch(function () {});
      };
    };

    ws.onmessage = async function (evt) {
      try {
        const text = typeof evt.data === 'string' ? evt.data : await evt.data.text();
        const msg = JSON.parse(text);
        const sc = msg?.serverContent;

        if (sc?.interrupted) {
          activeSources.forEach((n) => { try { n.stop(); } catch (e) {} });
          activeSources = [];
          nextPlayTime = playCtx.currentTime;
          stateCallback('listening');
        }
        if (sc?.inputTranscription?.text) onStatus('YOU: "' + sc.inputTranscription.text.trim() + '"');
        if (sc?.outputTranscription?.text) onStatus('JARVIS: "' + sc.outputTranscription.text.trim() + '"');

        const parts = sc?.modelTurn?.parts || [];
        for (const p of parts) {
          if (p.inlineData && p.inlineData.data) {
            stateCallback('speaking');
            const bin = atob(p.inlineData.data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const pcm16 = new Int16Array(bytes.buffer);
            const buf = playCtx.createBuffer(1, pcm16.length, 24000);
            const ch = buf.getChannelData(0);
            for (let i = 0; i < pcm16.length; i++) ch[i] = pcm16[i] / 32768;

            const node = playCtx.createBufferSource();
            node.buffer = buf;
            node.connect(playCtx.destination);
            const startAt = Math.max(playCtx.currentTime, nextPlayTime);
            node.start(startAt);
            activeSources.push(node);
            nextPlayTime = startAt + buf.duration;
            node.onended = function () {
              activeSources = activeSources.filter((x) => x !== node);
              if (playCtx.currentTime >= nextPlayTime - 0.05) stateCallback('listening');
            };
          }
        }
      } catch (err) {}
    };

    ws.onclose = function () {
      if (ws._cleanupAudio) ws._cleanupAudio();
      liveSession = null;
      stateCallback('idle');
      onStatus('Gemini 3.8 Live session ended.');
    };

    liveSession = {
      close: function () {
        if (ws._cleanupAudio) ws._cleanupAudio();
        ws.close();
      }
    };
    return true;
  }

  function startWaveVisualizer(canvas) {
    if (!canvas) return function () {};
    const ctx = canvas.getContext('2d');
    let currentMode = 'idle';
    let tick = 0;

    function loop() {
      tick += 0.08;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const bars = 36;
      const gap = w / bars;
      for (let i = 0; i < bars; i++) {
        let amp = 3;
        if (currentMode === 'listening') {
          amp = 6 + Math.abs(Math.sin(tick * 1.8 + i * 0.45)) * 16;
          ctx.fillStyle = '#10b981';
        } else if (currentMode === 'speaking') {
          amp = 8 + Math.abs(Math.sin(tick * 2.6 + i * 0.6)) * 22;
          ctx.fillStyle = '#00f0ff';
        } else if (currentMode === 'thinking') {
          amp = 5 + Math.abs(Math.cos(tick * 3.0 + i * 0.3)) * 12;
          ctx.fillStyle = '#f59e0b';
        } else {
          amp = 2 + Math.abs(Math.sin(tick * 0.7 + i * 0.3)) * 3;
          ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
        }
        const x = i * gap + 2;
        const y = (h - amp) / 2;
        ctx.fillRect(x, y, Math.max(2, gap - 4), amp);
      }
      requestAnimationFrame(loop);
    }
    loop();

    return function setMode(m) {
      currentMode = m || 'idle';
    };
  }

  return {
    configureVaultAccess,
    setVoicePreference,
    onStateChange: function (fn) { stateCallback = fn; },
    onTranscript: function (fn) { transcriptCallback = fn; },
    onWake: function (fn) { wakeEventCallback = fn; },
    onStatusHint: function (fn) { statusHintCallback = fn; },
    cancelAutoSendBecauseUserIsTyping,
    finalizeAndStopListening,
    playFx,
    speak,
    stopSpeaking,
    togglePushToTalk,
    beginHoldToTalk,
    endHoldToTalk,
    setHandsFreeMode,
    setClapWakeMode,
    openFollowUpListeningWindow,
    askGemini,
    toggleGeminiLiveStream,
    startWaveVisualizer,
    unlockAudioGesture,
    isConversing: isInActiveConversation,
    isSecureMicAvailable: function () { return isBrowserSecureForMic; },
    isAppleSafari: function () { return isAppleWebKitSafari; },
    getLastVoiceEngine: function () { return lastVoiceEngine; }
  };
})();
