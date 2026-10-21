// Where Jarvis's data comes from.
//
// Cloud mode: the backend (Cloudflare Worker) holds memory and the Claude brain.
// Local mode: no backend yet (or it's unreachable). Everything except the Claude
// brain still works, saved in this browser. Same logic either way: shared/ops.js.
import * as J from '../shared/ops.js';

const LS = { api: 'jv.api', pass: 'jv.pass', local: 'jv.localState' };
const RAW = 'https://raw.githubusercontent.com/alyg7002-lang/jarvis/main';
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

export const conn = { mode: 'local', api: '', reason: 'Not connected yet', brain: false };

export async function connect() {
  let api = store.get(LS.api) || '';
  if (!api) {
    if (/\.workers\.dev$/.test(location.hostname)) api = location.origin;
    else {
      try { const c = await (await fetch('./config.json', { cache: 'no-store' })).json(); api = c.api || ''; } catch {}
    }
  }
  conn.api = api.replace(/\/$/, '');
  if (!conn.api) return setLocal('The backend is not deployed yet.');
  let health;
  try { health = await (await fetch(`${conn.api}/api/health`, { cache: 'no-store' })).json(); }
  catch { return setLocal("Can't reach the backend right now."); }
  conn.brain = !!health.brain;
  if (!passcode()) return setLocal('Enter your passcode in Settings to connect.', 'needs-pass');
  try { await req('GET', '/api/state'); }
  catch (e) { return setLocal(e.message, e.status === 401 ? 'needs-pass' : undefined); }
  conn.mode = 'cloud'; conn.reason = health.brain ? 'Brain online' : 'Connected, but the brain has no API key';
  return conn;
}
function setLocal(reason, code) { conn.mode = 'local'; conn.reason = reason; conn.code = code; return conn; }

export const passcode = () => store.get(LS.pass) || '';
export function setPasscode(p) { store.set(LS.pass, p || null); }
export function setApi(u) { store.set(LS.api, u || null); }

async function req(method, path, body) {
  const r = await fetch(conn.api + path, {
    method, cache: 'no-store',
    headers: { authorization: `Bearer ${passcode()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `Backend error ${r.status}`); e.status = r.status; throw e; }
  return j;
}

// ---------- local fallback ----------
function localState() { try { return J.normalize(JSON.parse(store.get(LS.local) || 'null')); } catch { return J.emptyState(); } }
function saveLocal(s) { store.set(LS.local, JSON.stringify(s)); }
const cache = {};
async function staticJSON(path) {
  if (cache[path]) return cache[path];
  for (const url of [`${RAW}/${path}`, `./${path}`]) {
    try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) return (cache[path] = await r.json()); } catch {}
  }
  return null;
}
async function localWeather() {
  try {
    const w = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=34.0234&longitude=-84.6155&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=1')).json();
    const code = w.current.weather_code;
    const desc = code === 0 ? 'clear' : code <= 2 ? 'partly cloudy' : code === 3 ? 'overcast' : code <= 48 ? 'foggy' : code <= 67 ? 'rainy' : code <= 77 ? 'snowy' : code <= 82 ? 'showery' : 'stormy';
    return { temp: w.current.temperature_2m, desc, high: w.daily.temperature_2m_max[0], low: w.daily.temperature_2m_min[0], rainChance: w.daily.precipitation_probability_max[0] };
  } catch { return null; }
}

// ---------- public API used by the app ----------
export async function dashboard() {
  if (conn.mode === 'cloud') {
    try { return await req('GET', '/api/state'); }
    catch (e) { if (e.status === 401) setLocal(e.message, 'needs-pass'); else setLocal("Lost the backend. Working offline."); }
  }
  const now = new Date(), today = J.localDate(now), state = localState();
  const [sched, dueRaw, study, verses, weather] = await Promise.all([staticJSON('data/schedule.json'), staticJSON('due.json'), staticJSON('data/study.json'), staticJSON('data/verses.json'), localWeather()]);
  const schedule = sched?.classes || [];
  const items = (dueRaw?.items || []).filter(i => new Date(i.due) > now).sort((a, b) => new Date(a.due) - new Date(b.due));
  return {
    state, today, now: now.toISOString(), weather, schedule,
    classes: schedule.filter(c => c.weekday === J.weekday(now)).sort((a, b) => a.start.localeCompare(b.start)),
    due: { updated: dueRaw?.updated, items },
    study: J.studyFor(study?.stories, today), verse: J.verseFor(verses?.verses, today),
    usage: J.usageTotals(state, today), review: J.weeklyReview(state, today), lastWeek: J.weeklyReview(state, today, { previous: true }), trades: J.tradeStats(state),
    stories: study?.stories || [],
  };
}

export async function op(name, args = {}) {
  if (conn.mode === 'cloud') return req('POST', '/api/op', { name, args });
  const out = J.applyOp(localState(), name, args, new Date());
  saveLocal(out.state);
  return out;
}

export async function chat(messages, deep) {
  if (conn.mode !== 'cloud') { const e = new Error('offline'); e.status = 0; throw e; }
  return req('POST', '/api/chat', { messages, deep });
}

export async function bot() {
  if (conn.mode === 'cloud') { try { return await req('GET', '/api/bot'); } catch {} }
  const repo = 'alyg7002-lang/orb-bot';
  const txt = await (await fetch(`https://raw.githubusercontent.com/${repo}/main/data/live_log.txt`, { cache: 'no-store' })).text();
  return { repo, dashboard: `https://github.com/${repo}/blob/main/reports/dashboard.html`, lastLines: txt.trim().split(/\r?\n/).slice(-40).join('\n') };
}

export function exportLocal() { return localState(); }
export function clearLocal() { store.set(LS.local, null); }
