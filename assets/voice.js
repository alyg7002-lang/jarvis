// Jarvis voice: speaking (text-to-speech) and listening (speech-to-text), both
// built into the browser, so they're free.
//
// Speaking: the browser's speechSynthesis. The best "Jarvis" sound comes from a
// British male neural voice. Microsoft Edge ships natural ones (Ryan, Thomas);
// Chrome has "Google UK English Male"; iPhone/Mac have "Daniel" and "Arthur".
// We rank every installed voice and pick the best one automatically.
//
// Listening: webkitSpeechRecognition (Edge, Chrome, Safari). Push-to-talk by
// default; "wake word" mode keeps listening for the word "Jarvis".

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const Rec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export const support = { speak: !!synth, listen: !!Rec };

// ---------- voice ranking ----------
const RANKS = [
  [/Ryan Online \(Natural\).*United Kingdom/i, 100],
  [/Thomas Online \(Natural\).*United Kingdom/i, 96],
  [/(Oliver|Alfie|Elliot|Ethan|Noah) Online \(Natural\).*United Kingdom/i, 92],
  [/Google UK English Male/i, 88],
  [/^Daniel\b/i, 86],
  [/^Arthur\b/i, 85],
  [/(Ryan|Thomas).*(Natural|Neural)/i, 84],
  [/Microsoft George/i, 72],
  [/en-GB.*male/i, 66],
  [/(Guy|Andrew|Christopher|Brian|Davis|Eric|Roger|Steffan) Online \(Natural\)/i, 55], // US natural male fallback
  [/Microsoft (David|Mark)/i, 30],
];
export function rankVoice(v) {
  const label = `${v.name} ${v.lang}`;
  for (const [re, score] of RANKS) if (re.test(label)) return score;
  if (/^en-GB/i.test(v.lang)) return /female|libby|sonia|maisie|hazel|susan|kate|serena|martha/i.test(v.name) ? 40 : 60;
  if (/^en/i.test(v.lang)) return 10;
  return 0;
}

let voicesCache = [];
export function loadVoices() {
  return new Promise(resolve => {
    if (!synth) return resolve([]);
    const done = () => { voicesCache = synth.getVoices(); resolve(voicesCache); };
    const now = synth.getVoices();
    if (now.length) { voicesCache = now; return resolve(now); }
    let settled = false;
    synth.addEventListener('voiceschanged', () => { if (!settled) { settled = true; done(); } }, { once: true });
    setTimeout(() => { if (!settled) { settled = true; done(); } }, 1500);
  });
}
export function rankedVoices() {
  return voicesCache.filter(v => /^en/i.test(v.lang)).map(v => ({ v, score: rankVoice(v) })).sort((a, b) => b.score - a.score);
}

// ---------- speaking ----------
const prefs = { voiceName: '', rate: 1.0, pitch: 0.92, muted: false };
export function setPrefs(p) { Object.assign(prefs, p); }
export function getPrefs() { return { ...prefs }; }

function chosenVoice() {
  const list = rankedVoices();
  return (prefs.voiceName && list.find(x => x.v.name === prefs.voiceName)?.v) || list[0]?.v || null;
}
export const currentVoice = () => chosenVoice();

// Turn text written for the screen into text that sounds right out loud.
export function forSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' (code on screen) ')
    .replace(/https?:\/\/\S+/g, ' the link on screen ')
    .replace(/[*_#>`~|]/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\bJ\.A\.R\.V\.I\.S\.?/g, 'Jarvis')
    .replace(/\s+-\s+/g, ', ')
    .replace(/(\d+)\s?°\s?F?/g, '$1 degrees')
    .replace(/\$0?\.(\d\d)\d*/g, (_, c) => `${+c} cents`)
    .replace(/\$(\d+(?:\.\d+)?)/g, '$1 dollars')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
// Chrome's online voices cut off long utterances, so speak sentence by sentence.
export function chunk(text, max = 180) {
  const sentences = text.split(/(?<=[.!?;]["')\]]?)\s+/);
  const out = [];
  for (let s of sentences) {
    s = s.trim();
    while (s.length > max) {
      const cut = s.lastIndexOf(',', max) > 40 ? s.lastIndexOf(',', max) + 1 : s.lastIndexOf(' ', max);
      out.push(s.slice(0, cut).trim()); s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

let token = 0, keepAlive = null;
const listeners = { start: [], end: [], boundary: [] };
export function on(evt, fn) { listeners[evt]?.push(fn); }
const emit = (evt, x) => listeners[evt]?.forEach(f => { try { f(x); } catch {} });

export function speaking() { return !!synth && (synth.speaking || synth.pending); }

export function say(text) {
  return new Promise(resolve => {
    const clean = forSpeech(text);
    if (!synth || prefs.muted || !clean) return resolve('skipped');
    const my = ++token;
    synth.cancel();
    clearInterval(keepAlive);
    const voice = chosenVoice();
    const parts = chunk(clean);
    emit('start');
    // Google voices stall after ~15 s unless nudged.
    if (voice && /Google/i.test(voice.name)) keepAlive = setInterval(() => { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } }, 10000);
    let i = 0;
    const next = () => {
      if (my !== token) return resolve('interrupted');
      if (i >= parts.length) { clearInterval(keepAlive); emit('end'); return resolve('done'); }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
      u.rate = prefs.rate;
      u.pitch = prefs.pitch;
      u.onboundary = e => emit('boundary', e);
      u.onend = () => setTimeout(next, 60);
      u.onerror = e => { if (e.error === 'interrupted' || e.error === 'canceled') return resolve('interrupted'); setTimeout(next, 0); };
      synth.speak(u);
    };
    next();
  });
}
export function hush() {
  token++; clearInterval(keepAlive);
  if (synth) synth.cancel();
  emit('end');
}
// Mobile Safari only lets pages talk after a tap. Call this from the first tap.
let unlocked = false;
export function unlock() {
  if (unlocked || !synth) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  synth.speak(u);
  chime.ctx();
}

// ---------- sounds ----------
export const chime = (() => {
  let ac = null;
  const ctx = () => { try { ac ??= new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch {} return ac; };
  const tone = (f1, f2, dur = 0.14, vol = 0.05, delay = 0) => {
    const a = ctx(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  };
  return {
    ctx,
    listen: () => { tone(660, 990, 0.12); tone(990, 1320, 0.1, 0.035, 0.09); },
    stop: () => tone(880, 520, 0.12, 0.04),
    alert: () => { tone(740, 740, 0.16, 0.06); tone(988, 988, 0.22, 0.06, 0.2); },
  };
})();

// ---------- listening ----------
const ERR = {
  'not-allowed': 'The microphone is blocked. Click the lock icon in the address bar, allow the microphone, and reload.',
  'service-not-allowed': 'Speech recognition is turned off in this browser. Use Edge or Chrome, or type instead.',
  'audio-capture': "I can't find a microphone. Check that one is plugged in and not used by another app.",
  network: "The speech service can't be reached. Check your connection, or type instead.",
  'no-speech': "I didn't catch anything.",
  'language-not-supported': 'This browser does not support English speech recognition.',
};
export const listenError = code => ERR[code] || `Listening stopped (${code}).`;

// One phrase, push-to-talk.
export function listenOnce({ onInterim } = {}) {
  return new Promise((resolve, reject) => {
    if (!Rec) return reject(new Error('This browser has no speech recognition. Use Edge or Chrome, or type instead.'));
    const r = new Rec();
    r.lang = 'en-US'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let final = '', interim = '';
    r.onresult = e => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      onInterim?.((final + ' ' + interim).trim());
    };
    r.onerror = e => { if (e.error === 'no-speech' || e.error === 'aborted') return; reject(new Error(listenError(e.error))); };
    r.onend = () => resolve((final || interim).trim());
    active = r;
    try { r.start(); } catch (e) { reject(e); }
  });
}
let active = null;
export function stopListening() { try { active?.stop(); } catch {} }

// Wake word: keeps a recognizer running and fires when it hears "Jarvis".
export function wakeWord({ onWake, onState }) {
  if (!Rec) return { stop() {}, pause() {}, resume() {}, supported: false };
  let r = null, running = true, paused = false, restartTimer = null;
  const WAKE = /\b(?:hey |ok |okay )?(jarvis|jervis|travis|service)\b[,.!?]?\s*(.*)$/i;
  const start = () => {
    if (!running || paused || document.hidden) return;
    r = new Rec();
    r.lang = 'en-US'; r.continuous = true; r.interimResults = true;
    let fired = false;
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], text = res[0].transcript;
        const m = text.match(WAKE);
        if (!m || fired) continue;
        // "Travis"/"service" are common mishears; only accept them at the start of a phrase.
        if (!/jarvis|jervis/i.test(m[1]) && text.trim().toLowerCase().indexOf(m[1].toLowerCase()) > 2) continue;
        if (res.isFinal || m[2].split(' ').length >= 2) {
          fired = true;
          const rest = res.isFinal ? m[2].trim() : '';
          try { r.abort(); } catch {}
          onWake(rest);
          return;
        }
      }
    };
    r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { running = false; onState?.('blocked', listenError(e.error)); } };
    r.onend = () => { r = null; clearTimeout(restartTimer); restartTimer = setTimeout(start, 300); };
    try { r.start(); onState?.('on'); } catch { restartTimer = setTimeout(start, 1000); }
  };
  const onVis = () => { if (!document.hidden) start(); };
  document.addEventListener('visibilitychange', onVis);
  start();
  return {
    supported: true,
    pause() { paused = true; clearTimeout(restartTimer); try { r?.abort(); } catch {} },
    resume() { if (!paused) return; paused = false; clearTimeout(restartTimer); restartTimer = setTimeout(start, 250); },
    stop() { running = false; clearTimeout(restartTimer); document.removeEventListener('visibilitychange', onVis); try { r?.abort(); } catch {} onState?.('off'); },
  };
}
