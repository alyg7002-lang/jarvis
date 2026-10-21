// J.A.R.V.I.S. front end.
import * as J from '../shared/ops.js';
import * as api from './api.js';
import * as V from './voice.js';
import { createOrb } from './orb.js';

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LSP = 'jv.prefs';
const prefs = Object.assign({ voiceName: '', rate: 1.0, pitch: 0.92, muted: false, wake: false, autoListen: true }, safeParse(localStorage.getItem(LSP)));
function savePrefs() { try { localStorage.setItem(LSP, JSON.stringify(prefs)); } catch {} V.setPrefs(prefs); }
function safeParse(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
const pick = a => a[Math.floor(Math.random() * a.length)];
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = iso => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const money = x => (x < 0.01 && x > 0 ? '<$0.01' : `$${(+x || 0).toFixed(2)}`);
const hrs = m => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

// ---------- navigation ----------
const ICONS = {
  home: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  faith: '<path d="M12 3v18M7 8h10"/>',
  build: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  focus: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  trading: '<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/>',
  learn: '<rect x="3" y="5" width="13" height="10" rx="1"/><path d="M8 19h13V9"/>',
  review: '<path d="M4 4h16v16H4z"/><path d="M8 14l2.5 2.5L16 10"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
};
const NAV = [['home', 'Home'], ['faith', 'Faith'], ['build', 'Build'], ['focus', 'Focus'], ['trading', 'Trading'], ['learn', 'Learn'], ['review', 'Review'], ['settings', 'Settings']];
const TABS = [['home', 'Home'], ['faith', 'Faith'], ['build', 'Build'], ['focus', 'Focus'], ['more', 'More']];
const navLink = ([id, label]) => `<a href="#${id}" data-nav="${id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>${label}</a>`;
$('railLinks').innerHTML = NAV.map(navLink).join('');
$('tabs').innerHTML = TABS.map(navLink).join('');

let view = 'home';
function route() {
  const v = (location.hash.slice(1) || 'home').split('?')[0];
  view = NAV.some(n => n[0] === v) || v === 'more' ? v : 'home';
  document.querySelectorAll('.view').forEach(s => (s.hidden = s.id !== `view-${view}`));
  const moreSet = ['trading', 'learn', 'review', 'settings'];
  document.querySelectorAll('[data-nav]').forEach(a => {
    const on = a.dataset.nav === view || (a.closest('#tabs') && a.dataset.nav === 'more' && moreSet.includes(view));
    a.toggleAttribute('aria-current', false);
    if (on) a.setAttribute('aria-current', 'page');
  });
  if (view === 'home') $('caption').hidden = true;
  else if (flow && lastJarvis) { $('captionText').textContent = lastJarvis; $('caption').hidden = false; }
  document.title = view === 'home' ? 'J.A.R.V.I.S.' : `${$(`view-${view}`).dataset.title} · Jarvis`;
  render();
  if (view !== 'home') $('main').focus({ preventScroll: true });
  scrollTo({ top: 0 });
}
addEventListener('hashchange', route);
const go = v => { if (location.hash.slice(1) !== v) { window.history.pushState(null, '', `#${v}`); route(); } };

// ---------- app state ----------
let D = null;          // dashboard data from api.dashboard()
let S = J.emptyState();
let chatLog = safeParse(sessionStorage.getItem('jv.chatLog')).list || [];
let deepNext = false;
let lastInputVoice = false;

function setState(s) {
  S = J.normalize(s);
  if (D) {
    D.state = S;
    D.usage = J.usageTotals(S, D.today);
    D.review = J.weeklyReview(S, D.today);
    D.lastWeek = J.weeklyReview(S, D.today, { previous: true });
    D.trades = J.tradeStats(S);
  }
}
async function refresh() {
  try { D = await api.dashboard(); setState(D.state); }
  catch (e) { console.error(e); }
  render(); renderStatus();
}
async function doOp(name, args, { quiet = false } = {}) {
  try {
    const r = await api.op(name, args);
    setState(r.state); render();
    return r.result;
  } catch (e) {
    if (!quiet) toast(e.message, { hot: true });
    throw e;
  }
}

// ---------- status, clock, banner ----------
function renderStatus() {
  const c = api.conn;
  const online = c.mode === 'cloud' && c.brain;
  const dot = document.querySelector('#status .dot');
  dot.className = `dot ${online ? 'on' : c.mode === 'cloud' ? 'warn' : ''}`;
  $('railDot').className = dot.className;
  const cost = D?.usage?.today?.cost;
  $('statusText').textContent = online ? `Brain online${cost ? ` · ${money(cost)} today` : ''}` : c.mode === 'cloud' ? 'Connected, no brain' : 'Offline mode';
  $('status').title = c.reason || '';
}
function tick() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('dayline').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const b = bannerText();
  $('banner').hidden = !b; if (b) $('banner').textContent = b;
}
const mins = hhmm => { const [a, b] = hhmm.split(':').map(Number); return a * 60 + b; };
function nightPhase() {
  const now = mins(J.localTime()), st = S.settings;
  const wd = mins(st.windDown), bed = mins(st.bedtime), wake = mins(st.wake);
  const inRange = (x, a, b) => (a <= b ? x >= a && x < b : x >= a || x < b);
  if (inRange(now, bed, wake)) return 'late';
  if (inRange(now, wd, bed)) return 'winddown';
  return 'day';
}
function bannerText() {
  const p = nightPhase();
  if (p === 'late') return `It's past your ${J.spokenTime(S.settings.bedtime)} bedtime. Phone on the charger across the room, sir. Your alarm is set for ${J.spokenTime(S.settings.wake)}.`;
  if (p === 'winddown') return `Wind-down time. Do tonight's debrief, then put the phone on the charger across the room.`;
  return '';
}

// ---------- conversation ----------
const orb = createOrb($('orb'));
function setMode(m, label) {
  document.documentElement.dataset.mode = m;
  orb.setMode(m);
  $('orbState').textContent = label ?? (m === 'idle' && wantsMorningBrief() ? 'Tap for your morning brief' : null) ?? { idle: prefs.wake ? 'Say "Jarvis" or tap the reactor' : 'Tap the reactor to talk', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking. Tap to stop' }[m];
  $('micBtn').classList.toggle('live', m === 'listening');
}
V.on('boundary', () => orb.pulse(0.7));
V.on('start', () => { setMode('speaking'); wake?.pause(); });
V.on('end', () => { if (document.documentElement.dataset.mode === 'speaking') setMode('idle'); wake?.resume(); });

function addMsg(who, text, cls = '') {
  const el = document.createElement('div');
  el.className = `msg ${who} ${cls}`;
  el.textContent = text;
  $('convo').appendChild(el);
  while ($('convo').children.length > 40) $('convo').firstChild.remove();
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return el;
}
let typingEl = null;
function typing(on) {
  typingEl?.remove(); typingEl = null;
  if (on) { typingEl = document.createElement('div'); typingEl.className = 'typing'; typingEl.innerHTML = '<i></i><i></i><i></i>'; $('convo').appendChild(typingEl); typingEl.scrollIntoView({ block: 'nearest' }); }
}
function remember(role, content) {
  chatLog.push({ role, content }); chatLog = chatLog.slice(-16);
  try { sessionStorage.setItem('jv.chatLog', JSON.stringify({ list: chatLog })); } catch {}
}

// Jarvis speaks: show it, say it, and (in voice conversations) listen for the reply.
async function reply(text, { err = false, cost = null, keepListening = false } = {}) {
  typing(false);
  const el = addMsg('jv', text, err ? 'err' : '');
  if (cost != null && cost > 0) { const c = document.createElement('span'); c.className = 'cost'; c.textContent = `${money(cost)}`; el.appendChild(c); }
  if (!err) remember('assistant', text);
  lastJarvis = text;
  if (view !== 'home') { $('captionText').textContent = text; $('caption').hidden = false; clearTimeout(captionTimer); captionTimer = setTimeout(() => { if (!flow && document.activeElement !== $('captionIn')) $('caption').hidden = true; }, 12000); }
  setMode('speaking');
  const result = await V.say(text);
  if (result !== 'interrupted') setMode('idle');
  if ((keepListening || flow) && lastInputVoice && prefs.autoListen && result === 'done') startListening();
}

let lastJarvis = '', captionTimer = null;
let flow = null; // an active guided conversation (Bible study, debrief, quiz)
async function handle(raw, { voice = false } = {}) {
  const text = String(raw || '').trim();
  if (!text) return;
  lastInputVoice = voice;
  V.unlock();
  addMsg('me', text);
  if (/^(stop|cancel|never ?mind|quiet|shut up|that's all)\.?$/i.test(text)) {
    V.hush(); if (flow) { flow.cancel(); flow = null; } remember('user', text);
    return reply('Very good, sir.');
  }
  if (flow) return flow.answer(text);
  remember('user', text);
  const local = localIntent(text);
  if (local) return local();
  if (api.conn.mode === 'cloud' && api.conn.brain) return brain(text);
  return offlineBrain(text);
}

async function brain(text) {
  const deep = deepNext || /^deep:/i.test(text);
  deepNext = false; $('deepBtn').setAttribute('aria-pressed', 'false');
  setMode('thinking'); typing(true);
  try {
    const msgs = chatLog.map(m => ({ ...m, content: m.content.replace(/^deep:\s*/i, '') }));
    const r = await api.chat(msgs, deep);
    setState(r.state); render(); renderStatus();
    runActions(r.actions || []);
    await reply(r.reply, { cost: r.cost, keepListening: /\?\s*$/.test(r.reply) });
  } catch (e) {
    typing(false); setMode('idle');
    if (e.status === 0) return offlineBrain(text);
    chatLog.pop();
    await reply(e.message || 'Something went wrong reaching the brain.', { err: true });
    if (e.status === 401) { await api.connect(); renderStatus(); }
  }
}

function runActions(actions) {
  for (const a of actions) {
    if (a.type === 'timer') startTimer(a.minutes, a.label);
    if (a.type === 'build') startSession({ id: a.taskId, task: a.task, minutes: a.minutes });
  }
}

// Free commands handled on this device (no API cost, work offline).
function localIntent(t) {
  const s = t.toLowerCase().replace(/[^\w\s:'.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(brief me|morning brief|give me (my|the) brief|good morning( jarvis)?|what'?s my day( look like)?)\b/.test(s)) return briefMe;
  if (/\b(start|begin|lead|do|run)\b.*\b(bible|study|devotion|devotional)\b|^bible study$/.test(s)) return () => startFlow(studyFlow);
  if (/\b(debrief|end of (the )?day|wrap up (the|my) day|night check ?in)\b/.test(s)) return () => startFlow(debriefFlow);
  if (/^(quiz me|flashcards|review (my )?(flash)?cards)\b|\bquiz me\b/.test(s) && !/\badd\b/.test(s)) return () => startFlow(quizFlow);
  if (/\b(verse|memory verse)\b.*\b(check|recite|test|say)\b|\brecite\b.*\bverse\b/.test(s)) return () => startFlow(verseFlow);
  const tm = s.match(/(?:set (?:a )?)?timer (?:for )?(\d+(?:\.\d+)?) ?(min|minute|minutes|sec|second|seconds|hour|hours)?|(\d+(?:\.\d+)?) ?(min|minute|minutes|second|seconds|hour|hours) timer/);
  if (tm) return () => { const n = +(tm[1] || tm[3]), u = tm[2] || tm[4] || 'min'; const m = /^s/.test(u) ? n / 60 : /^h/.test(u) ? n * 60 : n; startTimer(m, 'Timer'); return reply(`Timer set for ${u.startsWith('s') ? `${n} seconds` : hrs(Math.round(m))}.`); };
  if (/^what( time is it|'?s the time)|^time$/.test(s)) return () => reply(`It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, sir.`);
  if (/\b(i'?m bored|nothing to do|what should i (build|work on)|start (a )?build( session)?|build mode)\b/.test(s)) return () => buildNow();
  return null;
}

async function briefMe() {
  try { localStorage.setItem('jv.briefed', J.localDate()); } catch {}
  setMode('thinking'); typing(true);
  let text;
  if (api.conn.mode === 'cloud') {
    try { const r = await fetch(`${api.conn.api}/api/brief`, { headers: { authorization: `Bearer ${api.passcode()}` } }); text = (await r.json()).text; } catch {}
  }
  if (!text) {
    if (!D) await refresh();
    text = J.briefText({ classes: D.classes, due: D.due.items, weather: D.weather, study: S.study[D.today] ? null : D.study, state: S });
  }
  return reply(text, { keepListening: /\?\s*$/.test(text) });
}

async function buildNow() {
  const t = J.nextTask(S);
  if (!t) return reply("The build list is empty, sir. Tell me one small thing you want working by tonight, or add starter tasks on the Build page.", { keepListening: true });
  startSession(t);
  return reply(`Right. Twenty-five minutes on: ${t.task}. Phone across the room. Go.`);
}

// Offline keyword brain (used until the backend is connected).
async function offlineBrain(text) {
  const s = text.toLowerCase();
  if (!D) await refresh();
  if (/\b(due|assignment|homework|deadline)s?\b/.test(s)) {
    const items = D.due.items.slice(0, 4);
    return reply(items.length ? `Coming up: ${items.map(d => `${d.item}, ${J.spokenDue(d.due)}`).join('; ')}.` : 'Nothing due in the next three weeks that I can see.');
  }
  if (/\b(class|classes|schedule|today)\b/.test(s)) {
    const c = D.classes;
    return reply(c.length ? `Today: ${c.map(x => `${x.course} at ${J.spokenTime(x.start)}`).join(', and ')}.` : 'No classes today. Good day to build something.');
  }
  if (/\b(weather|temperature|rain|outside)\b/.test(s)) {
    const w = D.weather;
    return reply(w ? `It's ${Math.round(w.temp)} degrees and ${w.desc}, high of ${Math.round(w.high)}, ${w.rainChance}% chance of rain.` : "I can't reach the weather service right now.");
  }
  const rem = text.match(/^remember (?:that )?(.+)/i);
  if (rem) { await doOp('memory_save', { fact: rem[1] }); return reply('Noted, sir.'); }
  if (/what do you (remember|know) about me/.test(s)) return reply(S.facts.length ? S.facts.slice(-6).map(f => f.text).join('. ') + '.' : "Nothing yet. Tell me to remember something.");
  if (/\bscreen ?time\b/.test(s)) { const l = J.laptopToday(S, D.today); return reply(`Laptop distraction today: ${hrs(l.total)}. Log your phone week on the Focus page.`); }
  if (/\b(bot|orb)\b/.test(s)) { go('trading'); return reply('The bot log is on the Trading page.'); }
  if (/\b(help|what can you do)\b/.test(s)) return reply('Offline, I can do your brief, due dates, classes, weather, Bible study, debrief, flashcards, timers and build sessions. Connect my brain in Settings for everything else.');
  doOp('miss_log', { request: text }, { quiet: true }).catch(() => {});
  return reply("My full brain isn't connected yet, so I can't answer that one. Once the backend is set up, I can. I've noted the request.", { err: false });
}

// ---------- guided flows ----------
// A flow is a script of questions. Each ask() speaks, then waits for the next thing you say or type.
function startFlow(fn) {
  if (flow) flow.cancel();
  let resolver = null, cancelled = false;
  const f = {
    answer(text) { remember('user', text); const r = resolver; resolver = null; r?.(text); },
    cancel() { cancelled = true; resolver?.(null); },
  };
  const ask = async prompt => {
    if (cancelled) return null;
    const p = new Promise(res => (resolver = res));
    await reply(prompt);
    const a = await p;
    if (cancelled || a == null) throw new Error('cancelled');
    return a;
  };
  const yesNo = async prompt => {
    for (let i = 0; i < 3; i++) {
      const a = (await ask(i ? 'Yes or no, sir?' : prompt)).toLowerCase();
      if (/\b(yes|yeah|yep|yup|did|i did|sure|correct|got it|right)\b/.test(a)) return true;
      if (/\b(no|nope|nah|didn'?t|did not|missed|wrong|not yet)\b/.test(a)) return false;
    }
    return false;
  };
  flow = f;
  fn({ ask, yesNo, say: t => reply(t) }).catch(e => { if (e.message !== 'cancelled') reply(`That flow hit a snag: ${e.message}`, { err: true }); })
    .finally(() => { if (flow === f) flow = null; });
}
const ack = () => pick(['Good.', 'Fair.', 'Noted.', 'Well put.', 'Good answer.', 'Hold onto that.']);

async function studyFlow({ ask, yesNo, say }) {
  if (!D) await refresh();
  const st = D.study;
  if (!st) return say("I couldn't load today's study.");
  const y = S.actions[J.addDays(D.today, -1)];
  if (y && y.done === null) {
    const did = await yesNo(`Before we start. Yesterday's action was: ${y.text}. Did you do it?`);
    const note = did ? '' : await ask('What got in the way?');
    await doOp('action_check', { done: did, note });
    await say(did ? 'Good man.' : 'Understood. Today is a fresh shot.');
  }
  highlight(0); go('faith');
  await ask(`Today's story is ${st.story}. Let's pray. ${st.prayer} Amen. Now read ${st.reference} in the New Living Translation. Tell me when you've finished.`);
  highlight(2); await ask(st.q1);
  highlight(3); await ask(`${ack()} ${st.q2}`);
  highlight(4); await ask(`${ack()} ${st.q3}`);
  highlight(5);
  const a = await ask(`${ack()} Today's suggested action: ${st.action} Say yes to take it, or tell me your own.`);
  const own = !/^(yes|yeah|yep|sure|ok|okay|that one|sounds good)\b/i.test(a.trim());
  await doOp('action_set', { text: own ? a : st.action });
  const r = await doOp('study_done', {});
  highlight(-1);
  await say(`Saved. That's ${r.streak} ${r.streak === 1 ? 'day' : 'days'} in a row. I'll ask you about it tomorrow morning.`);
}
function highlight(i) { document.querySelectorAll('#steps li').forEach((li, n) => li.classList.toggle('on', n === i)); }

async function debriefFlow({ ask, say }) {
  const done = await ask("Two-minute debrief. What got done today?");
  const missed = await ask(`${ack()} What didn't get done?`);
  const tomorrow = await ask("And tomorrow's one thing?");
  await doOp('debrief', { done, missed, tomorrow });
  const late = nightPhase() !== 'day';
  await say(`Saved. Tomorrow starts with: ${tomorrow}.${late ? ' Now the phone goes on the charger across the room, sir.' : ''}`);
}

async function quizFlow({ ask, yesNo, say }) {
  const cards = J.dueCards(S, D?.today || J.localDate()).slice(0, 10);
  if (!cards.length) return say('No cards are due. Add some on the Learn page, or ask me to make cards from what you missed.');
  let right = 0;
  for (const c of cards) {
    await ask(`${c.deck}: ${c.front}`);
    const ok = await yesNo(`The answer is: ${c.back}. Did you get it?`);
    if (ok) right++;
    await doOp('flash_grade', { id: c.id, correct: ok });
  }
  await say(`${right} out of ${cards.length}. The misses come back sooner.`);
}

async function verseFlow({ ask, yesNo, say }) {
  if (!D?.verse) return say("I couldn't load this week's verse.");
  await ask(`Go ahead and recite ${D.verse.ref} from memory.`);
  const ok = await yesNo('Did you get it word for word? Check it against the NLT link on the Faith page.');
  await doOp('verse_check', { ok });
  await say(ok ? 'Locked in.' : "Read it three times today and we'll try again tomorrow.");
}

// ---------- listening ----------
let listening = false, interimEl = null, wake = null;
async function startListening() {
  if (listening) return;
  V.hush(); V.unlock();
  if (!V.support.listen) { toast('This browser cannot listen. Use Edge or Chrome, or type instead.', { hot: true }); $('typed').focus(); return; }
  listening = true; wake?.pause(); V.chime.listen();
  setMode('listening');
  try {
    const text = await V.listenOnce({ onInterim: t => { if (!interimEl) interimEl = addMsg('me', '', 'interim'); interimEl.textContent = t; } });
    interimEl?.remove(); interimEl = null; listening = false;
    setMode('idle');
    if (text) handle(text, { voice: true }); else { V.chime.stop(); setMode('idle', "Didn't catch that. Tap to try again"); }
  } catch (e) {
    interimEl?.remove(); interimEl = null; listening = false;
    setMode('idle'); toast(e.message, { hot: true });
  } finally { wake?.resume(); }
}
function setupWake() {
  wake?.stop(); wake = null;
  if (!prefs.wake) { setMode('idle'); return; }
  wake = V.wakeWord({
    onWake: rest => { V.chime.listen(); if (rest) handle(rest, { voice: true }); else startListening(); },
    onState: (st, msg) => { if (st === 'blocked') { prefs.wake = false; savePrefs(); toast(msg, { hot: true }); render(); } },
  });
  setMode('idle');
}

const briefedToday = () => { try { return localStorage.getItem('jv.briefed') === J.localDate(); } catch { return true; } };
const wantsMorningBrief = () => !briefedToday() && nightPhase() === 'day' && +J.localTime().slice(0, 2) < 12;
$('orb').addEventListener('click', () => {
  const m = document.documentElement.dataset.mode;
  if (m === 'idle' && wantsMorningBrief()) { V.unlock(); return handle('brief me'); }
  if (m === 'speaking') { V.hush(); setMode('idle'); return; }
  if (m === 'listening') { V.stopListening(); return; }
  startListening();
});
$('orb').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('orb').click(); } });
$('micBtn').addEventListener('click', () => (listening ? V.stopListening() : startListening()));
$('deepBtn').addEventListener('click', () => { deepNext = !deepNext; $('deepBtn').setAttribute('aria-pressed', String(deepNext)); if (deepNext && !(api.conn.mode === 'cloud' && api.conn.brain)) toast('Deep mode needs the brain connected.'); });
$('captionForm').addEventListener('submit', e => { e.preventDefault(); const v = $('captionIn').value; $('captionIn').value = ''; handle(v); });
$('captionMic').addEventListener('click', () => (listening ? V.stopListening() : startListening()));
$('captionClose').addEventListener('click', () => { $('caption').hidden = true; });
$('composer').addEventListener('submit', e => { e.preventDefault(); const v = $('typed').value; $('typed').value = ''; handle(v); });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { V.hush(); if (listening) V.stopListening(); }
  if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); startListening(); }
});

// ---------- timers & build sessions ----------
const timers = [];
function startTimer(minutes, label = 'Timer') {
  const t = { id: Math.random().toString(36).slice(2), label, end: Date.now() + minutes * 60000 };
  timers.push(t); renderTimers();
}
function renderTimers() {
  const box = $('toasts');
  box.querySelectorAll('.toast.timer').forEach(el => { if (!timers.find(t => t.id === el.dataset.id)) el.remove(); });
  for (const t of timers) {
    let el = box.querySelector(`[data-id="${t.id}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'toast timer'; el.dataset.id = t.id; el.innerHTML = `<span class="num"></span><span>${h(t.label)}</span><button class="btn quiet small" data-act="timer-cancel" data-id="${t.id}">Cancel</button>`; box.appendChild(el); }
    const left = Math.max(0, Math.round((t.end - Date.now()) / 1000));
    el.querySelector('.num').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }
}
setInterval(() => {
  for (const t of [...timers]) if (Date.now() >= t.end) { timers.splice(timers.indexOf(t), 1); V.chime.alert(); reply(`${t.label === 'Timer' ? 'Your timer is done' : `${t.label}: time's up`}, sir.`); }
  renderTimers(); sessionTick(); tick();
}, 1000);

let session = safeParse(localStorage.getItem('jv.session')).id ? safeParse(localStorage.getItem('jv.session')) : null;
function saveSession() { try { session ? localStorage.setItem('jv.session', JSON.stringify(session)) : localStorage.removeItem('jv.session'); } catch {} }
function startSession(task) {
  const minutes = task.minutes || 25;
  session = { id: task.id, task: task.task, total: minutes * 60, end: Date.now() + minutes * 60000, pausedLeft: null };
  saveSession(); showSession();
}
function showSession() { $('session').hidden = !session; if (session) { $('sessionTask').textContent = session.task; sessionTick(); } }
function sessionLeft() { return session.pausedLeft ?? Math.max(0, Math.round((session.end - Date.now()) / 1000)); }
function sessionTick() {
  if (!session) return;
  const left = sessionLeft();
  $('sessionClock').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('sessionBar').style.width = `${100 - (100 * left) / session.total}%`;
  $('sessionPause').textContent = session.pausedLeft != null ? 'Resume' : 'Pause';
  if (left === 0 && !session.rang) { session.rang = true; saveSession(); V.chime.alert(); reply(`Time, sir. Did you finish ${session.task}? Tap "Finished it" if so.`); }
}
async function finishSession() {
  const s = session; session = null; saveSession(); showSession();
  if (s?.id) {
    const note = prompt('Nice. One line for the dev log: what did you build or fix? (optional)') || '';
    await doOp('backlog_done', { id: s.id, note }).catch(() => {});
    const n = J.nextTask(S);
    reply(`Logged. ${n ? `Next up when you're ready: ${n.task}.` : 'The build list is clear.'}`);
  }
}

// ---------- rendering ----------
function render() {
  if (view === 'home') renderHome();
  else if (view === 'more') renderMore();
  else ({ faith: renderFaith, build: renderBuild, focus: renderFocus, trading: renderTrading, learn: renderLearn, review: renderReview, settings: renderSettings })[view]?.();
}

function renderHome() {
  const sug = [];
  if (!D) { $('todayPanel').innerHTML = '<div class="plate"><p class="empty">Loading today…</p></div>'; return; }
  const today = D.today;
  sug.push(['Brief me', 'brief me']);
  if (!S.study[today]) sug.push(['Start Bible study', 'start Bible study']);
  sug.push(["What's due?", "what's due"]);
  if (nightPhase() !== 'day') sug.push(['Debrief', 'debrief']);
  else sug.push(["I'm bored", "I'm bored"]);
  if (J.dueCards(S, today).length) sug.push(['Quiz me', 'quiz me']);
  $('suggest').innerHTML = $('convo').children.length > 2 ? '' : sug.map(([l, q]) => `<button class="chip" data-say="${h(q)}">${h(l)}</button>`).join('');

  const nowMin = mins(J.localTime());
  const classes = D.classes.length
    ? D.classes.map(c => `<div class="class-row ${mins(c.end) < nowMin ? 'past' : ''}"><span class="num">${h(J.spokenTime(c.start))}</span><span>${h(c.course)} <span class="muted small">${h(c.mode)}${c.where ? `, ${h(c.where)}` : ''}</span></span></div>`).join('')
    : '<p class="empty">No classes today. Good day to build something.</p>';
  const due = D.due.items.slice(0, 6);
  const dueHtml = due.length ? `<ul class="list">${due.map(d => {
    const days = J.dayDiff(today, J.localDate(new Date(d.due)));
    return `<li class="due-row"><div class="grow"><div>${h(d.item)}</div><div class="meta">${h(d.course)}</div></div><span class="when ${days <= 1 ? 'hot' : ''}">${days === 0 ? `Today ${fmtTime(d.due)}` : days === 1 ? `Tomorrow ${fmtTime(d.due)}` : fmtDay(d.due)}</span></li>`;
  }).join('')}</ul>` : '<p class="empty">Nothing due in the next three weeks.</p>';
  const act = S.actions[today];
  const next = J.nextTask(S);
  const w = D.weather;
  $('todayPanel').innerHTML = `
    <div class="plate">
      <div class="spread"><h2>Today</h2>${w ? `<span class="wx"><span class="num">${Math.round(w.temp)}°</span><span class="muted small">${h(w.desc)}, high ${Math.round(w.high)}°</span></span>` : ''}</div>
      ${classes}
    </div>
    <div class="plate">
      <div class="spread"><h2>Coming due</h2><span class="muted small">${D.due.updated ? `synced ${h(ago(D.due.updated))}` : ''}</span></div>
      ${dueHtml}
    </div>
    <div class="plate">
      <h2>Today's action</h2>
      ${act ? `<p style="margin:0">${h(act.text)}</p>` : `<p class="empty" style="margin:0">Set during your morning Bible study.</p><div class="row"><button class="btn small" data-say="start Bible study">Start Bible study</button></div>`}
    </div>
    <div class="plate">
      <h2>Next build</h2>
      ${next ? `<p style="margin:0 0 10px">${h(next.task)} <span class="muted small">${next.minutes} min</span></p><button class="btn primary small" data-act="build-start" data-id="${next.id}">Start session</button>` : `<p class="empty" style="margin:0 0 10px">Nothing queued.</p><a class="btn small" href="#build">Add a task</a>`}
    </div>`;
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function viewHead(title, lede) { return `<h1>${h(title)}</h1><p class="lede">${lede}</p>`; }

function renderFaith() {
  const el = $('view-faith');
  if (!D) return (el.innerHTML = viewHead('Faith', 'Loading…'));
  const st = D.study, today = D.today;
  const done = !!S.study[today];
  const y = S.actions[J.addDays(today, -1)];
  const verse = D.verse, vc = S.verseChecks[J.isoWeek(today)];
  const prayers = S.prayers.filter(p => !p.answer);
  const answered = S.prayers.filter(p => p.answer).slice(-5).reverse();
  el.innerHTML = viewHead('Faith', 'Fifteen minutes each morning: pray, read, three questions, one action you can actually do today.') + `
  <div class="grid">
    <div class="plate">
      ${st ? `
      <div class="spread"><span class="muted small">Today's story</span>${done ? '<span class="tag">Done today</span>' : ''}</div>
      <h2 class="study-title">${h(st.story)}</h2>
      <a href="${h(J.nltLink(st.reference))}" target="_blank" rel="noopener">${h(st.reference)} in the NLT</a>
      <ol class="steps" id="steps">
        <li><div><span class="k">Pray</span>${h(st.prayer)}</div></li>
        <li><div><span class="k">Read</span>${h(st.reference)}</div></li>
        <li><div><span class="k">Question</span>${h(st.q1)}</div></li>
        <li><div><span class="k">Question</span>${h(st.q2)}</div></li>
        <li><div><span class="k">Question</span>${h(st.q3)}</div></li>
        <li><div><span class="k">Action</span>${h(S.actions[today]?.text || st.action)}</div></li>
      </ol>
      <div class="row" style="margin-top:14px"><button class="btn primary" data-say="start Bible study">${done ? 'Go through it again' : 'Lead me through it'}</button>${done ? '' : '<button class="btn quiet" data-act="study-done">I did it on my own</button>'}</div>` : '<p class="empty">Couldn\'t load today\'s study.</p>'}
    </div>
    <div class="stack">
      <div class="plate">
        <h2>Follow-through</h2>
        <div class="streak"><span class="big">${J.studyStreak(S, today)}</span><span class="muted">day study streak</span></div>
        ${y ? `<p style="margin:14px 0 6px">Yesterday's action: ${h(y.text)}</p>${y.done === null ? `<div class="row"><button class="btn small" data-act="action-check" data-done="1">I did it</button><button class="btn small quiet" data-act="action-check" data-done="0">I didn't</button></div>` : `<p class="small ${y.done ? 'good' : 'hot'}" style="margin:0">${y.done ? 'Done.' : 'Missed.'}${y.note ? ` ${h(y.note)}` : ''}</p>`}` : '<p class="muted small" style="margin:14px 0 0">Yesterday had no action set.</p>'}
        ${actionHistory()}
      </div>
      <div class="plate">
        <h2>Verse of the week</h2>
        ${verse ? `<p style="margin:0 0 8px"><a href="${h(verse.link)}" target="_blank" rel="noopener" class="num" style="font-size:20px">${h(verse.ref)}</a></p>
        <p class="muted small" style="margin:0 0 10px">Read it in the NLT, memorize it, and recite it to Jarvis before Sunday.</p>
        ${vc ? `<p class="small ${vc.ok ? 'good' : 'hot'}">${vc.ok ? 'Recited this week.' : 'Not yet this week.'}</p>` : ''}
        <div class="row"><button class="btn small" data-say="recite my verse">Recite it</button></div>` : '<p class="empty">No verse loaded.</p>'}
      </div>
    </div>
    <div class="plate">
      <h2>Prayer list</h2>
      <form data-form="prayer" class="row" style="margin:0 0 12px"><label class="sr" for="prayerIn">Prayer request</label><input id="prayerIn" name="text" placeholder="Who or what to pray for" required style="flex:1"><button class="btn">Add</button></form>
      ${prayers.length ? `<ul class="list">${prayers.map(p => `<li><div class="grow">${h(p.text)}<div class="meta">since ${h(fmtShort(p.added))}</div></div><button class="btn small" data-act="prayer-answer" data-id="${p.id}">Answered</button></li>`).join('')}</ul>` : '<p class="empty">Nothing on the list. Jarvis will follow up on anything you add.</p>'}
      ${answered.length ? `<h3 style="margin-top:16px">Answered</h3><ul class="list">${answered.map(p => `<li><div class="grow">${h(p.text)}<div class="meta">${h(p.answer)}</div></div></li>`).join('')}</ul>` : ''}
    </div>
  </div>`;
}
function fmtShort(iso) { return iso ? new Date(iso + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''; }
function actionHistory() {
  const rows = Object.entries(S.actions).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30);
  const kept = rows.filter(([, v]) => v.done === true).length, asked = rows.filter(([, v]) => v.done !== null).length;
  if (rows.length < 3) return '';
  return `<p class="small muted" style="margin:14px 0 0">Last ${rows.length} actions: kept <strong class="num">${kept}</strong> of ${asked} checked.</p>`;
}

const STARTER = [
  ['Test the wake word in Edge for one full morning', 25, 'Jarvis'],
  ['Add 10 Spanish flashcards on the Learn page', 20, 'School'],
  ['Log 3 Plus500 demo trades with entry, stop and exit', 30, 'Trading'],
  ['Write the dev log entry you would show your uncle', 20, 'Jarvis'],
  ['Read the ORB bot dashboard and write down one question', 20, 'ORB bot'],
];
function renderBuild() {
  const el = $('view-build');
  const open = J.openTasks(S), done = S.backlog.filter(t => t.done).slice(-8).reverse();
  el.innerHTML = viewHead('Build', 'When the urge to scroll hits, start a session instead: one specific task, 25 minutes, phone across the room.') + `
  <div class="grid">
    <div class="plate">
      <div class="spread"><h2>Queue</h2><span class="muted small">${open.length} open</span></div>
      <form data-form="task" style="margin-bottom:12px">
        <div class="fields"><label class="field" style="grid-column:span 2"><span>Task</span><input name="task" placeholder="Small and finishable" required></label><label class="field"><span>Minutes</span><input name="minutes" type="number" min="10" max="120" value="25"></label></div>
        <div class="row"><button class="btn">Add task</button></div>
      </form>
      ${open.length ? `<ul class="list">${open.map((t, i) => `<li><div class="grow">${h(t.task)}<div class="meta">${h(t.project)} · ${t.minutes} min</div></div>
        <div class="row" style="flex-wrap:nowrap"><button class="btn ${i === 0 ? 'primary' : ''} small" data-act="build-start" data-id="${t.id}">Start</button>${i ? `<button class="btn quiet small" data-act="task-top" data-id="${t.id}" title="Move to top">Top</button>` : ''}<button class="btn quiet small" data-act="task-remove" data-id="${t.id}" aria-label="Remove ${h(t.task)}">Remove</button></div></li>`).join('')}</ul>`
        : `<p class="empty">The queue is empty.</p><div class="row"><button class="btn" data-act="starter">Add starter tasks</button></div>`}
    </div>
    <div class="stack">
      <div class="plate">
        <h2>Dev log</h2>
        <p class="muted small" style="margin:0 0 10px">What you built, what broke, how you fixed it. This is your story for your uncle and your internship applications.</p>
        <form data-form="devlog"><label class="sr" for="devIn">Entry</label><textarea id="devIn" name="text" placeholder="Got the wake word working in Edge. Chrome kept stopping after a minute, so it restarts itself now." required></textarea><div class="row"><button class="btn">Add entry</button><button type="button" class="btn quiet" data-act="devlog-copy">Copy log for my uncle</button></div></form>
        ${S.devlog.length ? `<ul class="list" style="margin-top:12px">${S.devlog.slice(-8).reverse().map(e => `<li><div class="grow">${h(e.text)}<div class="meta">${h(fmtShort(e.date))}</div></div></li>`).join('')}</ul>` : ''}
      </div>
      ${done.length ? `<div class="plate"><h2>Recently finished</h2><ul class="list">${done.map(t => `<li><div class="grow">${h(t.task)}</div><span class="meta">${h(fmtShort(t.done))}</span></li>`).join('')}</ul></div>` : ''}
    </div>
  </div>`;
}

function renderFocus() {
  const el = $('view-focus');
  if (!D) return;
  const st = S.settings, today = D.today;
  const lap = J.laptopToday(S, today);
  const apps = Object.entries(lap.apps).sort((a, b) => b[1] - a[1]);
  const maxApp = Math.max(60, ...apps.map(a => a[1]));
  const weeks = S.phoneWeeks.slice(-6);
  const maxW = Math.max(st.phoneGoalHours, ...weeks.map(w => w.total), 1);
  const last = S.debriefs.find(d => d.date === today);
  const phase = nightPhase();
  el.innerHTML = viewHead('Focus', 'Protect the wake time, and the screen time takes care of itself.') + `
  <div class="grid">
    <div class="plate">
      <h2>Sleep anchors</h2>
      <div class="fields" style="margin-bottom:8px">
        <div><div class="muted small">Wind-down</div><div class="big" style="font-size:26px">${h(J.spokenTime(st.windDown))}</div></div>
        <div><div class="muted small">Bedtime</div><div class="big" style="font-size:26px">${h(J.spokenTime(st.bedtime))}</div></div>
        <div><div class="muted small">Wake</div><div class="big good" style="font-size:26px">${h(J.spokenTime(st.wake))}</div></div>
      </div>
      <p class="small ${phase === 'day' ? 'muted' : 'hot'}" style="margin:8px 0 0">${phase === 'late' ? 'You should be asleep right now.' : phase === 'winddown' ? 'Wind-down has started.' : `Wind-down starts in ${hrs(((mins(st.windDown) - mins(J.localTime())) + 1440) % 1440)}.`} Change these in Settings.</p>
    </div>
    <div class="plate">
      <div class="spread"><h2>Tonight's debrief</h2>${last ? '<span class="tag">Done</span>' : ''}</div>
      ${last ? `<p class="small" style="margin:0"><strong>Done:</strong> ${h(last.done)}</p><p class="small"><strong>Missed:</strong> ${h(last.missed || '—')}</p><p class="small" style="margin:0"><strong>Tomorrow's one thing:</strong> ${h(last.tomorrow)}</p>` : `
      <form data-form="debrief">
        <label class="field"><span>What got done</span><input name="done" required></label>
        <label class="field" style="margin-top:8px"><span>What didn't</span><input name="missed"></label>
        <label class="field" style="margin-top:8px"><span>Tomorrow's one thing</span><input name="tomorrow" required></label>
        <div class="row"><button class="btn primary">Save debrief</button><button type="button" class="btn quiet" data-say="debrief">Do it by voice</button></div>
      </form>`}
    </div>
    <div class="plate">
      <div class="spread"><h2>Laptop today</h2><span class="muted small">${lap.updated ? `watcher ${h(ago(lap.updated))}` : 'watcher not reporting'}</span></div>
      ${apps.length ? apps.map(([k, v]) => `<div style="margin:8px 0"><div class="spread small"><span>${h(k)}</span><span class="num">${hrs(v)}</span></div><div class="bar ${v >= st.distractLimitMin ? 'hot' : ''}"><i style="width:${Math.min(100, (100 * v) / maxApp)}%"></i></div></div>`).join('') + (lap.late ? `<p class="small hot">${lap.late} min after bedtime.</p>` : '')
        : `<p class="empty">${lap.updated ? 'No distracting sites today. Nice.' : 'The laptop watcher tracks Instagram, Snapchat, YouTube and TikTok time and nudges you after ' + st.distractLimitMin + ' minutes. See Settings to install it.'}</p>`}
    </div>
    <div class="plate">
      <h2>Phone, by week</h2>
      <p class="muted small" style="margin:0 0 10px">Your phone doesn't share screen time with websites, so log it each Sunday from Settings → Screen Time. Goal: ${st.phoneGoalHours} h a week.</p>
      ${weeks.length ? weeks.map(w => `<div style="margin:8px 0"><div class="spread small"><span>Week of ${h(fmtShort(w.week))}</span><span class="num">${w.total} h <span class="muted">· IG ${w.instagram} h</span></span></div><div class="bar ${w.total > st.phoneGoalHours ? 'hot' : ''}"><i style="width:${(100 * w.total) / maxW}%"></i></div></div>`).join('') : '<p class="empty">No weeks logged yet. Your baseline was 69 h with 41 on Instagram.</p>'}
      <form data-form="phone" style="margin-top:12px"><div class="fields"><label class="field"><span>Total h</span><input name="total" type="number" step="0.5" min="0" required></label><label class="field"><span>Instagram</span><input name="instagram" type="number" step="0.5" min="0"></label><label class="field"><span>Snapchat</span><input name="snapchat" type="number" step="0.5" min="0"></label></div><div class="row"><button class="btn">Log this week</button></div></form>
    </div>
  </div>`;
}

function renderTrading() {
  const el = $('view-trading');
  const t = D?.trades || J.tradeStats(S);
  const pct = Math.min(100, (100 * t.logged) / t.stretch);
  el.innerHTML = viewHead('Trading', 'Practice only. Log every demo trade, do the risk math first, and judge the strategy on 30 to 50 trades, not on one good day.') + `
  <div class="grid">
    <div class="plate">
      <h2>Risk calculator</h2>
      <form data-form="risk"><div class="fields">
        <label class="field"><span>Symbol</span><select name="symbol">${Object.keys(J.POINT_VALUE).map(s => `<option ${s === 'MES' ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="field"><span>Entry</span><input name="entry" type="number" step="any" required></label>
        <label class="field"><span>Stop</span><input name="stop" type="number" step="any" required></label>
        <label class="field"><span>Risk $</span><input name="risk" type="number" step="any" value="100"></label>
      </div><div class="row"><button class="btn primary">Calculate</button></div></form>
      <div id="riskOut" style="margin-top:12px"></div>
    </div>
    <div class="plate">
      <div class="spread"><h2>My demo trade log</h2><span class="num">${t.logged} / ${t.goal}–${t.stretch}</span></div>
      <div class="bar" style="margin:6px 0 12px"><i style="width:${pct}%"></i></div>
      <p class="small muted" style="margin:0 0 10px">${t.closed ? `Win rate ${t.winRate}% · average ${t.avgR}R over ${t.closed} closed trades.` : 'No closed trades yet.'} ${t.logged < t.goal ? `${t.goal - t.logged} more before the numbers start to mean anything.` : ''}</p>
      <form data-form="trade"><div class="fields">
        <label class="field"><span>Symbol</span><input name="symbol" value="MES"></label>
        <label class="field"><span>Side</span><select name="side"><option>long</option><option>short</option></select></label>
        <label class="field"><span>Entry</span><input name="entry" type="number" step="any" required></label>
        <label class="field"><span>Stop</span><input name="stop" type="number" step="any" required></label>
        <label class="field"><span>Exit</span><input name="exit" type="number" step="any"></label>
      </div><label class="field" style="margin-top:8px"><span>Notes</span><input name="notes" placeholder="Was it a real ORB retest? What did you see?"></label><div class="row"><button class="btn">Log trade</button></div></form>
      ${S.trades.length ? `<div class="scroll-x" style="margin-top:12px"><table class="t"><thead><tr><th>Date</th><th>Sym</th><th>Side</th><th>Entry</th><th>Stop</th><th>Exit</th><th>R</th><th></th></tr></thead><tbody>${S.trades.slice(-10).reverse().map(x => `<tr><td>${h(fmtShort(x.date))}</td><td>${h(x.symbol)}</td><td>${h(x.side)}</td><td>${x.entry}</td><td>${x.stop}</td><td>${x.exit || '—'}</td><td class="${x.r > 0 ? 'good' : x.r < 0 ? 'bad' : ''}">${x.r ?? '—'}</td><td><button class="btn quiet small" data-act="trade-remove" data-id="${x.id}" aria-label="Delete trade">×</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>
    <div class="plate" style="grid-column:1/-1">
      <div class="spread"><h2>ORB paper bot</h2><span class="row"><button class="btn small" data-act="bot-refresh">Refresh</button><a class="btn quiet small" href="https://github.com/alyg7002-lang/orb-bot" target="_blank" rel="noopener">Open on GitHub</a></span></div>
      <p class="muted small" style="margin:0 0 10px">Runs on GitHub every weekday at about 9:20 and 3:35. Its stats live in the bot, not here.</p>
      <pre class="log" id="botLog">Loading the latest log…</pre>
    </div>
  </div>`;
  loadBot();
}
async function loadBot() {
  try { const b = await api.bot(); if ($('botLog')) $('botLog').textContent = b.lastLines || 'The log is empty.'; }
  catch { if ($('botLog')) $('botLog').textContent = "Couldn't read the bot log from GitHub."; }
}

let reviewCard = null, showBack = false;
function renderLearn() {
  const el = $('view-learn');
  const today = D?.today || J.localDate();
  const due = J.dueCards(S, today);
  const decks = [...new Set(S.cards.map(c => c.deck))];
  if (!reviewCard || !due.find(c => c.id === reviewCard)) { reviewCard = due[0]?.id || null; showBack = false; }
  const c = S.cards.find(x => x.id === reviewCard);
  el.innerHTML = viewHead('Learn', "Spaced repetition: cards you miss come back tomorrow, cards you know drift out to a month. Jarvis can quiz you out loud while you walk to class.") + `
  <div class="grid">
    <div class="plate">
      <div class="spread"><h2>Review</h2><span class="num">${due.length} due</span></div>
      ${c ? `<div class="card-face"><div>${h(c.front)}${showBack ? `<span class="back">${h(c.back)}</span>` : ''}</div></div>
        <div class="row">${showBack ? `<button class="btn primary" data-act="grade" data-ok="1">Got it</button><button class="btn" data-act="grade" data-ok="0">Missed it</button>` : `<button class="btn primary" data-act="flip">Show answer</button>`}<button class="btn quiet" data-say="quiz me">Quiz me out loud</button></div>
        <p class="muted small">${h(c.deck)}</p>`
        : `<p class="empty">${S.cards.length ? "All caught up. Nothing's due today." : 'No cards yet. Add a few from Spanish, MATLAB, or anything you got wrong on a quiz.'}</p>`}
    </div>
    <div class="plate">
      <h2>Add a card</h2>
      <form data-form="card">
        <label class="field"><span>Deck</span><input name="deck" list="decks" value="${h(decks[0] || 'Spanish')}"><datalist id="decks">${['Spanish', 'MATLAB', 'Engineering', ...decks].filter((x, i, a) => a.indexOf(x) === i).map(d => `<option value="${h(d)}">`).join('')}</datalist></label>
        <label class="field" style="margin-top:8px"><span>Front</span><input name="front" placeholder="el engranaje" required></label>
        <label class="field" style="margin-top:8px"><span>Back</span><input name="back" placeholder="the gear" required></label>
        <div class="row"><button class="btn">Add card</button></div>
      </form>
      ${decks.length ? `<h3 style="margin-top:16px">Decks</h3><ul class="list">${decks.map(d => { const all = S.cards.filter(x => x.deck === d); return `<li><div class="grow">${h(d)}</div><span class="meta">${all.length} cards · ${all.filter(x => x.due <= today).length} due</span></li>`; }).join('')}</ul>` : ''}
    </div>
  </div>`;
}

function renderReview() {
  const el = $('view-review');
  if (!D) return;
  const r = D.review, lw = D.lastWeek, u = D.usage;
  const misses = S.misses.filter(m => !m.built).sort((a, b) => b.count - a.count).slice(0, 8);
  const who = S.settings.accountabilityName;
  const stat = (n, l, cls = '') => `<div><div class="big ${cls}">${n}</div><div class="muted small">${l}</div></div>`;
  el.innerHTML = viewHead('Review', 'Every Sunday: look at the week honestly, then send it to someone real.') + `
  <div class="grid">
    <div class="plate" style="grid-column:1/-1">
      <div class="spread"><h2>This week</h2><span class="muted small">${h(fmtShort(r.start))} to ${h(fmtShort(r.end))}</span></div>
      <div class="fields" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:18px">
        ${stat(r.buildsDone, 'build tasks finished')}
        ${stat(`${r.studyDays}/7`, 'Bible study days')}
        ${stat(`${r.actionsKept}/${r.actionsSet}`, 'daily actions kept')}
        ${stat(r.phone ? `${r.phone.total} h` : '—', `phone (goal ${r.phoneGoal} h)`, r.phone && r.phone.total > r.phoneGoal ? 'hot' : '')}
        ${stat(hrs(r.laptopDistractMin), 'laptop distraction', r.laptopDistractMin > 300 ? 'hot' : '')}
        ${stat(r.debriefs, 'debriefs')}
      </div>
      <div class="row" style="margin-top:18px"><button class="btn primary" data-act="share">${who ? `Send to ${h(who)}` : 'Share my week'}</button><button class="btn quiet" data-act="share-copy">Copy text</button></div>
      ${lw.studyDays + lw.buildsDone + lw.debriefs ? `<p class="small muted" style="margin:12px 0 0">Last week: ${lw.buildsDone} builds, ${lw.studyDays}/7 study days, ${lw.actionsKept}/${lw.actionsSet} actions kept.</p>` : ''}
    </div>
    <div class="plate">
      <h2>What Jarvis couldn't do</h2>
      <p class="muted small" style="margin:0 0 10px">Every request I fumbled, most asked first. Pick one and build it into me.</p>
      ${misses.length ? `<ul class="list">${misses.map(m => `<li><div class="grow">${h(m.text)}<div class="meta">asked ${m.count}×, last ${h(fmtShort(m.last))}</div></div><button class="btn small" data-act="miss-build" data-id="${m.id}">Add to build queue</button></li>`).join('')}</ul>` : '<p class="empty">Nothing yet.</p>'}
    </div>
    <div class="plate">
      <h2>Brain cost</h2>
      ${costBar('Today', u.today.cost, u.dailyBudget)}
      ${costBar('This month', u.month.cost, u.monthlyBudget)}
      <p class="muted small" style="margin:10px 0 0">${u.month.calls} brain calls this month. Brief, Bible study, debrief, quizzes and timers are free; they run on this device.</p>
    </div>
  </div>`;
}
const costBar = (label, v, max) => `<div style="margin:10px 0"><div class="spread small"><span>${label}</span><span class="num">${money(v)} of ${money(max)}</span></div><div class="bar ${v > max * 0.8 ? 'hot' : ''}"><i style="width:${Math.min(100, (100 * v) / (max || 1))}%"></i></div></div>`;

function renderMore() {
  $('view-more').innerHTML = viewHead('More', '') + `<div class="more-links">
    <a href="#trading"><strong>Trading</strong><span>Risk math, your demo log, the ORB bot</span></a>
    <a href="#learn"><strong>Learn</strong><span>Flashcards and voice quizzes</span></a>
    <a href="#review"><strong>Review</strong><span>Your week, misses, brain cost</span></a>
    <a href="#settings"><strong>Settings</strong><span>Voice, connection, sleep times</span></a></div>`;
}

function renderSettings() {
  const el = $('view-settings');
  const c = api.conn, st = S.settings;
  const voices = V.rankedVoices();
  const cur = V.currentVoice();
  const best = voices[0];
  el.innerHTML = viewHead('Settings', '') + `
  <div class="grid">
    <div class="plate">
      <h2>Voice</h2>
      <label class="field"><span>Jarvis's voice</span><select id="voiceSel">${voices.length ? voices.map(({ v, score }) => `<option value="${h(v.name)}" ${cur && v.name === cur.name ? 'selected' : ''}>${h(v.name.replace(/^Microsoft /, '').replace(/ - English/, ' -'))}${score >= 84 ? ' (best)' : ''}</option>`).join('') : '<option>No voices found</option>'}</select></label>
      ${best && best.score < 84 ? `<p class="small hot" style="margin:8px 0 0">For the real Jarvis sound, open this page in Microsoft Edge and pick "Ryan Online (Natural)". This browser doesn't have a British neural voice.</p>` : ''}
      <div class="fields" style="margin-top:10px">
        <label class="field"><span>Speed <span class="num">${prefs.rate.toFixed(2)}×</span></span><input type="range" id="rateIn" min="0.8" max="1.3" step="0.02" value="${prefs.rate}"></label>
        <label class="field"><span>Pitch <span class="num">${prefs.pitch.toFixed(2)}</span></span><input type="range" id="pitchIn" min="0.7" max="1.2" step="0.02" value="${prefs.pitch}"></label>
      </div>
      <div class="row"><button class="btn primary" data-act="voice-test">Test voice</button></div>
      <label class="check"><input type="checkbox" id="muteIn" ${prefs.muted ? 'checked' : ''}><span>Mute spoken replies</span></label>
      <h3 style="margin-top:18px">Listening</h3>
      <label class="check"><input type="checkbox" id="wakeIn" ${prefs.wake ? 'checked' : ''} ${V.support.listen ? '' : 'disabled'}><span>Wake word: say "Jarvis" to talk while this page is open</span></label>
      <label class="check"><input type="checkbox" id="autoIn" ${prefs.autoListen ? 'checked' : ''}><span>Keep listening when Jarvis asks you a question</span></label>
      <p class="muted small" style="margin:8px 0 0">Shortcut: Ctrl + Space to talk, Esc to stop. ${V.support.listen ? '' : 'This browser cannot listen; use Edge or Chrome.'}</p>
      <ul class="checks" id="checks"></ul>
      <div class="row"><button class="btn small" data-act="voice-check">Run voice check</button></div>
    </div>
    <div class="plate">
      <h2>Brain connection</h2>
      <p class="small" style="margin:0 0 10px"><span class="dot ${c.mode === 'cloud' && c.brain ? 'on' : c.mode === 'cloud' ? 'warn' : ''}"></span> ${h(c.reason)}</p>
      <form data-form="pass">
        <label class="field"><span>Passcode</span><input name="pass" type="password" autocomplete="current-password" value="${h(api.passcode())}" placeholder="The JARVIS_PASSCODE you set on GitHub"></label>
        <details style="margin-top:8px"><summary class="small muted">Backend address</summary><label class="field" style="margin-top:6px"><span>Leave blank to use the deployed one</span><input name="api" value="${h(localStorage.getItem('jv.api') || '')}" placeholder="${h(c.api || 'https://jarvis.your-name.workers.dev')}"></label></details>
        <div class="row"><button class="btn primary">Save and connect</button></div>
      </form>
    </div>
    <div class="plate">
      <h2>Daily rhythm</h2>
      <form data-form="settings">
        <div class="fields">
          <label class="field"><span>Wake</span><input name="wake" type="time" value="${h(st.wake)}"></label>
          <label class="field"><span>Wind-down</span><input name="windDown" type="time" value="${h(st.windDown)}"></label>
          <label class="field"><span>Bedtime</span><input name="bedtime" type="time" value="${h(st.bedtime)}"></label>
        </div>
        <div class="fields" style="margin-top:8px">
          <label class="field"><span>Phone goal (h/week)</span><input name="phoneGoalHours" type="number" min="0" value="${st.phoneGoalHours}"></label>
          <label class="field"><span>Laptop nudge after (min)</span><input name="distractLimitMin" type="number" min="5" value="${st.distractLimitMin}"></label>
        </div>
        <div class="fields" style="margin-top:8px">
          <label class="field"><span>Brain budget per day ($)</span><input name="dailyBudget" type="number" min="0" step="0.05" value="${st.dailyBudget}"></label>
          <label class="field"><span>Per month ($)</span><input name="monthlyBudget" type="number" min="0" step="0.5" value="${st.monthlyBudget}"></label>
        </div>
        <label class="field" style="margin-top:8px"><span>Weekly check-in goes to</span><input name="accountabilityName" value="${h(st.accountabilityName)}" placeholder="Dad, a friend…"></label>
        <div class="row"><button class="btn">Save</button></div>
      </form>
    </div>
    <div class="plate">
      <h2>Laptop watcher</h2>
      <p class="small" style="margin:0 0 8px">A small program on your laptop that tracks time on Instagram, Snapchat, YouTube and TikTok, speaks up after ${st.distractLimitMin} minutes or after bedtime, and offers your next build task. It runs on its own after you sign in to Windows.</p>
      <p class="small muted" style="margin:0">${J.laptopToday(S, D?.today || J.localDate()).updated ? 'Reporting normally.' : 'Not reporting yet. It installs in your Documents\\Jarvis\\laptop folder.'}</p>
    </div>
  </div>`;
  $('voiceSel').onchange = e => { prefs.voiceName = e.target.value; savePrefs(); V.say('Voice selected, sir.'); };
  $('rateIn').oninput = e => { prefs.rate = +e.target.value; savePrefs(); e.target.previousElementSibling.querySelector('.num').textContent = `${prefs.rate.toFixed(2)}×`; };
  $('pitchIn').oninput = e => { prefs.pitch = +e.target.value; savePrefs(); e.target.previousElementSibling.querySelector('.num').textContent = prefs.pitch.toFixed(2); };
  $('muteIn').onchange = e => { prefs.muted = e.target.checked; savePrefs(); };
  $('wakeIn').onchange = e => { prefs.wake = e.target.checked; savePrefs(); V.unlock(); setupWake(); toast(prefs.wake ? 'Wake word on. Say "Jarvis".' : 'Wake word off.'); };
  $('autoIn').onchange = e => { prefs.autoListen = e.target.checked; savePrefs(); };
}

async function voiceCheck() {
  const ul = $('checks'); if (!ul) return;
  const row = (ok, t) => { const li = document.createElement('li'); li.className = ok === null ? '' : ok ? 'ok' : 'no'; li.textContent = t; ul.appendChild(li); };
  ul.innerHTML = '';
  row(V.support.speak, V.support.speak ? 'Speech output available' : 'No speech output in this browser');
  const v = V.currentVoice();
  row(!!v && V.rankVoice(v) >= 84, v ? `Voice: ${v.name}` : 'No English voice installed');
  row(V.support.listen, V.support.listen ? 'Speech recognition available' : 'No speech recognition. Use Edge or Chrome');
  try { const p = await navigator.permissions.query({ name: 'microphone' }); row(p.state !== 'denied', `Microphone permission: ${p.state}`); } catch { row(null, 'Microphone permission: will ask when you talk'); }
  row(isSecureContext, isSecureContext ? 'Secure page (mic allowed)' : 'Page is not https, so the mic is blocked');
  V.say("Voice check complete. If you can hear me, the speaker side works.");
}

// ---------- events ----------
document.addEventListener('click', async e => {
  const say = e.target.closest('[data-say]');
  if (say) { e.preventDefault(); if (view !== 'home' && !/bible|verse|debrief|quiz/i.test(say.dataset.say)) go('home'); return handle(say.dataset.say); }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'goto': return go(b.dataset.view);
    case 'build-start': { const t = S.backlog.find(x => x.id === id); if (t) { V.unlock(); startSession(t); V.say(`Twenty-five minutes. ${t.task}. Go.`); } return; }
    case 'session-finish': return finishSession();
    case 'session-pause': if (session.pausedLeft != null) { session.end = Date.now() + session.pausedLeft * 1000; session.pausedLeft = null; } else session.pausedLeft = sessionLeft(); saveSession(); return sessionTick();
    case 'session-cancel': session = null; saveSession(); return showSession();
    case 'timer-cancel': timers.splice(timers.findIndex(t => t.id === id), 1); return renderTimers();
    case 'task-top': return doOp('backlog_reorder', { id });
    case 'task-remove': return doOp('backlog_remove', { id });
    case 'starter': for (const [task, minutes, project] of STARTER) await doOp('backlog_add', { task, minutes, project }); return;
    case 'devlog-copy': return copy(S.devlog.map(e => `${e.date}: ${e.text}`).join('\n') || 'No entries yet.', 'Dev log copied.');
    case 'study-done': await doOp('study_done', {}); return toast('Marked done. Set your action on the Home page or by voice.');
    case 'action-check': { const note = b.dataset.done === '1' ? '' : (prompt('What got in the way? (optional)') || ''); return doOp('action_check', { done: b.dataset.done === '1', note }); }
    case 'prayer-answer': { const note = prompt('What happened?'); if (note !== null) return doOp('prayer_answer', { id, note: note || 'answered' }); return; }
    case 'flip': showBack = true; return renderLearn();
    case 'grade': await doOp('flash_grade', { id: reviewCard, correct: b.dataset.ok === '1' }); reviewCard = null; return renderLearn();
    case 'trade-remove': if (confirm('Delete this trade from your log?')) return doOp('trade_remove', { id }); return;
    case 'bot-refresh': $('botLog').textContent = 'Loading…'; return loadBot();
    case 'miss-build': { const m = S.misses.find(x => x.id === id); await doOp('backlog_add', { task: `Teach Jarvis: ${m.text}`, minutes: 30, project: 'Jarvis' }); await doOp('miss_built', { id }); return toast('Added to the build queue.'); }
    case 'share': return share();
    case 'share-copy': return copy(J.shareText(D.review), 'Copied. Paste it in a text.');
    case 'voice-test': V.unlock(); return V.say(pick(["Good evening, sir. All systems are online, and your MATLAB lab is due Friday.", "At your service, sir. Shall I queue up a build session?", "I've taken the liberty of checking your schedule, sir. You're free after ten fifty-five."]));
    case 'voice-check': return voiceCheck();
  }
});

document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  try {
    switch (f.dataset.form) {
      case 'prayer': await doOp('prayer_add', v); break;
      case 'task': await doOp('backlog_add', { task: v.task, minutes: +v.minutes || 25, project: 'Jarvis' }); break;
      case 'devlog': await doOp('devlog_add', v); toast('Logged.'); break;
      case 'debrief': await doOp('debrief', v); toast('Debrief saved.'); break;
      case 'phone': await doOp('phone_week', v); toast('Week logged.'); break;
      case 'trade': await doOp('trade_add', v); toast('Trade logged.'); break;
      case 'card': await doOp('flash_add', v); f.front.value = ''; f.back.value = ''; f.front.focus(); toast('Card added.'); return;
      case 'settings': await doOp('settings_update', { ...v, phoneGoalHours: +v.phoneGoalHours, distractLimitMin: +v.distractLimitMin, dailyBudget: +v.dailyBudget, monthlyBudget: +v.monthlyBudget }); toast('Saved.'); break;
      case 'risk': {
        const r = J.riskCalc({ symbol: v.symbol, entry: +v.entry, stop: +v.stop, risk: +v.risk || 100 });
        $('riskOut').innerHTML = r.error ? `<p class="bad">${h(r.error)}</p>` : r.tooBig
          ? `<p class="hot" style="margin:0">That stop is too wide: one ${r.unit === 'shares' ? 'share' : 'contract'} risks $${r.riskPerUnit}, more than your $${r.dollarRisk}. Skip the trade or tighten the plan.</p>`
          : `<p style="margin:0"><span class="big">${r.size}</span> ${r.unit}, risking <strong>$${r.actualRisk}</strong> (${r.stopDistance} pts × $${r.pointValue}).</p><p class="small muted" style="margin:6px 0 0">Targets: 1R ${r.target1R} · 1.5R ${r.target15R} · 2R ${r.target2R}</p>`;
        return;
      }
      case 'pass': {
        api.setPasscode(v.pass.trim()); api.setApi((v.api || '').trim());
        await api.connect(); await refresh(); renderSettings();
        toast(api.conn.mode === 'cloud' ? 'Connected.' : api.conn.reason, { hot: api.conn.mode !== 'cloud' });
        return;
      }
    }
    f.reset?.();
  } catch {}
});

async function share() {
  const text = J.shareText(D.review);
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(text, 'Copied. Paste it in a text.');
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt('Copy this:', text); }
}
function toast(text, { hot = false, ms = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${hot ? 'hot' : ''}`; el.setAttribute('role', 'status'); el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- start ----------
(async function init() {
  V.setPrefs(prefs);
  tick(); setMode('idle'); route();
  V.loadVoices().then(() => { if (view === 'settings') renderSettings(); });
  showSession();
  for (const m of chatLog.slice(-6)) addMsg(m.role === 'user' ? 'me' : 'jv', m.content);
  await api.connect();
  await refresh();
  renderStatus();
  if (!chatLog.length) {
    const greet = api.conn.mode === 'cloud' && api.conn.brain ? 'Brain online. What do you need, sir?' : api.conn.code === 'needs-pass' ? 'Enter your passcode in Settings to connect my brain. Everything else works now.' : 'Running in offline mode. Your brief, Bible study, build sessions and flashcards all work. Say "brief me" to start.';
    addMsg('jv', greet);
  }
  if (prefs.wake) document.addEventListener('pointerdown', () => { V.unlock(); setupWake(); }, { once: true });
  setInterval(refresh, 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();

// Exposed for automated tests.
window.__jarvis = { handle, get S() { return S; }, get D() { return D; }, conn: api.conn, V };
