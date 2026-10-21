// Jarvis backend: a Cloudflare Worker.
//
//   /api/health        public: is the backend up, is the brain configured
//   /api/state   GET   Jarvis's memory + today's data for the dashboard
//   /api/op      POST  change memory (add a task, log screen time, ...)
//   /api/chat    POST  talk to the brain (Claude + tools)
//   /api/brief   GET   the free spoken morning brief (no API cost)
//   everything else    the website itself (static files)
//
// Every /api route except health needs the passcode (JARVIS_PASSCODE secret),
// so nobody else can spend your API credits or read your data.
import * as J from '../../shared/ops.js';
import { makeData } from './data.js';
import { chat, BrainError, MODELS } from './brain.js';

const KEY = 'state:v1';
const VERSION = '3.0.0';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    }
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env, url, cors);
      return res;
    } catch (e) {
      const status = e.status || 500;
      return json({ error: e.message || 'Something broke on the backend.' }, status, cors);
    }
  },
};

async function route(req, env, url, cors) {
  const now = new Date();
  if (url.pathname === '/api/health') {
    return json({ ok: true, version: VERSION, brain: !!env.ANTHROPIC_API_KEY, passcodeSet: !!env.JARVIS_PASSCODE, storage: !!env.KV, models: MODELS }, 200, cors);
  }
  await authorize(req, env);
  const data = makeData(env);

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const state = await load(env);
    return json(await dashboard(state, data, now), 200, cors);
  }

  if (url.pathname === '/api/op' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (!J.CLIENT_OPS.includes(body.name)) throw httpError(400, `Unknown action "${body.name}".`);
    const state = await load(env);
    let out;
    try { out = J.applyOp(state, body.name, body.args || {}, now); }
    catch (e) { throw httpError(400, e.message); }
    await save(env, out.state);
    return json({ result: out.result, state: out.state }, 200, cors);
  }

  if (url.pathname === '/api/bot' && req.method === 'GET') {
    try { return json(await data.botStatus(40), 200, cors); }
    catch (e) { throw httpError(502, "Couldn't read the ORB bot log from GitHub."); }
  }

  if (url.pathname === '/api/brief' && req.method === 'GET') {
    const state = await load(env);
    return json({ text: await freeBrief(state, data, now) }, 200, cors);
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    if (!env.ANTHROPIC_API_KEY) throw httpError(503, 'The brain has no API key yet. Add ANTHROPIC_API_KEY to the GitHub secrets and redeploy.');
    const body = await req.json().catch(() => ({}));
    const messages = cleanMessages(body.messages);
    if (!messages.length) throw httpError(400, 'Say something first.');
    let state = await load(env);
    const today = J.localDate(now);
    const u = J.usageTotals(state, today);
    if (u.today.cost >= state.settings.dailyBudget) throw httpError(429, `Today's brain budget of $${state.settings.dailyBudget.toFixed(2)} is used up. Raise it in Settings or wait until tomorrow.`);
    if (u.month.cost >= state.settings.monthlyBudget) throw httpError(429, `This month's brain budget of $${state.settings.monthlyBudget.toFixed(2)} is used up. Raise it in Settings if you want to keep going.`);

    const ctx = { state, data, now, actions: [], changed: false };
    let out;
    try { out = await chat(env, ctx, { messages, deep: !!body.deep }); }
    catch (e) {
      if (ctx.changed) await save(env, ctx.state);
      if (e instanceof BrainError) throw httpError(e.status, e.message);
      throw e;
    }
    state = J.applyOp(ctx.state, 'usage_add', { inTok: out.inTok, outTok: out.outTok, cost: out.cost }, now).state;
    await save(env, state);
    return json({ reply: out.reply, actions: out.actions, model: out.model, cost: +out.cost.toFixed(5), usage: J.usageTotals(state, today), state }, 200, cors);
  }

  throw httpError(404, 'No such endpoint.');
}

// ---------- helpers ----------
async function dashboard(state, data, now) {
  const today = J.localDate(now);
  const safe = async (f, d = null) => { try { return await f(); } catch { return d; } };
  const [classes, due, stories, verses, weather] = await Promise.all([
    safe(() => data.classesOn(J.weekday(now)), []),
    safe(() => data.due({ days: 21, now }), { items: [] }),
    safe(() => data.stories(), []),
    safe(() => data.verses(), []),
    safe(() => data.weather()),
  ]);
  return {
    state, today, now: now.toISOString(),
    classes, due, weather,
    schedule: await safe(() => data.schedule(), []),
    study: J.studyFor(stories, today), verse: J.verseFor(verses, today),
    usage: J.usageTotals(state, today),
    review: J.weeklyReview(state, today),
    lastWeek: J.weeklyReview(state, today, { previous: true }),
    trades: J.tradeStats(state),
  };
}

async function freeBrief(state, data, now) {
  const safe = async (f, d = null) => { try { return await f(); } catch { return d; } };
  const today = J.localDate(now);
  const [classes, due, weather, stories] = await Promise.all([
    safe(() => data.classesOn(J.weekday(now)), []),
    safe(() => data.due({ days: 7, now }), { items: [] }),
    safe(() => data.weather()),
    safe(() => data.stories(), []),
  ]);
  return J.briefText({ now, classes, due: due.items, weather, study: state.study[today] ? null : J.studyFor(stories, today), state });
}

function cleanMessages(list) {
  if (!Array.isArray(list)) return [];
  const out = list.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-16).map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (out.length && out[0].role !== 'user') out.shift();
  // Claude needs alternating turns; merge repeats.
  const merged = [];
  for (const m of out) {
    if (merged.length && merged.at(-1).role === m.role) merged.at(-1).content += '\n' + m.content;
    else merged.push({ ...m });
  }
  if (merged.length && merged.at(-1).role !== 'user') merged.pop();
  return merged;
}

async function load(env) {
  if (!env.KV) throw httpError(503, 'Storage is not set up. Redeploy the Worker.');
  const raw = await env.KV.get(KEY, 'json');
  return J.normalize(raw);
}
async function save(env, state) {
  await env.KV.put(KEY, JSON.stringify(state));
}

async function authorize(req, env) {
  if (!env.JARVIS_PASSCODE) throw httpError(503, 'No passcode is set on the backend. Add JARVIS_PASSCODE to the GitHub secrets and redeploy.');
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const lockKey = `lock:${ip}`;
  const fails = env.KV ? +(await env.KV.get(lockKey)) || 0 : 0;
  if (fails >= 10) throw httpError(429, 'Too many wrong passcodes. Try again in 15 minutes.');
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(got, env.JARVIS_PASSCODE)) {
    if (env.KV) await env.KV.put(lockKey, String(fails + 1), { expirationTtl: 900 });
    throw httpError(401, 'Wrong passcode.');
  }
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function corsHeaders(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || 'https://alyg7002-lang.github.io').split(',').map(s => s.trim());
  const h = { 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
