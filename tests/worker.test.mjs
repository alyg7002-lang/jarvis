// Backend tests with a fake Claude API, fake GitHub data and in-memory storage.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { TOOLS, costOf } from '../worker/src/brain.js';

const PASS = 'test-passcode-123';
let kv, claudeQueue, claudeCalls;

function makeKV() {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, _m: m };
}
const env = () => ({ KV: kv, ANTHROPIC_API_KEY: 'sk-test', JARVIS_PASSCODE: PASS, DATA_BASE: 'https://data.test' });

const FILES = {
  'https://data.test/data/schedule.json': { classes: [{ weekday: 'Wed', start: '13:00', end: '14:00', course: 'Test Class', mode: 'Online' }] },
  'https://data.test/data/study.json': { stories: [{ story: 'David and Goliath', reference: '1 Samuel 17', prayer: 'p', q1: 'a', q2: 'b', q3: 'c', action: 'x' }] },
  'https://data.test/data/verses.json': { verses: ['Joshua 1:9'] },
  'https://data.test/due.json': { updated: 'x', items: [{ item: 'Lab 4', course: 'MATLAB', due: new Date(Date.now() + 2 * 86400000).toISOString() }] },
};

beforeEach(() => {
  kv = makeKV(); claudeQueue = []; claudeCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(init.body);
      claudeCalls.push(body);
      const next = claudeQueue.shift();
      if (!next) throw new Error('unexpected Claude call');
      return new Response(JSON.stringify(next.body ?? next), { status: next.status || 200 });
    }
    if (url.startsWith('https://api.open-meteo.com/')) {
      return new Response(JSON.stringify({ current: { temperature_2m: 64, weather_code: 1 }, daily: { temperature_2m_max: [75], temperature_2m_min: [55], precipitation_probability_max: [10] } }));
    }
    if (url.includes('orb-bot/main/data/live_log.txt')) return new Response('line1\nline2\nTook 1 trade');
    if (FILES[url]) return new Response(JSON.stringify(FILES[url]));
    return new Response('nope', { status: 404 });
  };
});

const call = (path, { method = 'GET', body, auth = PASS, headers = {} } = {}) =>
  worker.fetch(new Request(`https://jarvis.test${path}`, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env(), {});

test('health is public and reports config', async () => {
  const r = await call('/api/health', { auth: null });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.brain, true);
});

test('wrong passcode is rejected and locks out after 10 tries', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await call('/api/state', { auth: 'bad' })).status, 401);
  assert.equal((await call('/api/state', { auth: PASS })).status, 429);
});

test('state returns dashboard data', async () => {
  const j = await (await call('/api/state')).json();
  assert.equal(j.due.items[0].item, 'Lab 4');
  assert.equal(j.study.story, 'David and Goliath');
  assert.equal(j.verse.ref, 'Joshua 1:9');
  assert.equal(j.weather.desc, 'partly cloudy');
});

test('ops change memory; usage_add is blocked from clients', async () => {
  const r = await call('/api/op', { method: 'POST', body: { name: 'backlog_add', args: { task: 'Wake word', minutes: 25 } } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.state.backlog[0].task, 'Wake word');
  assert.equal((await call('/api/op', { method: 'POST', body: { name: 'usage_add', args: { cost: -5 } } })).status, 400);
  assert.equal((await call('/api/op', { method: 'POST', body: { name: 'backlog_add', args: {} } })).status, 400);
});

test('chat runs the tool loop, saves memory, returns actions, tracks cost', async () => {
  await call('/api/op', { method: 'POST', body: { name: 'backlog_add', args: { task: 'Add weather tool' } } });
  claudeQueue.push({
    stop_reason: 'tool_use', usage: { input_tokens: 3000, output_tokens: 80 },
    content: [
      { type: 'text', text: 'One moment.' },
      { type: 'tool_use', id: 't1', name: 'memory_save', input: { fact: 'Visiting uncle in Texas in December' } },
      { type: 'tool_use', id: 't2', name: 'start_build_session', input: {} },
    ],
  });
  claudeQueue.push({ stop_reason: 'end_turn', usage: { input_tokens: 3200, output_tokens: 40 }, content: [{ type: 'text', text: 'Noted, sir. Twenty-five minutes on the weather tool, starting now.' }] });
  const r = await call('/api/chat', { method: 'POST', body: { messages: [{ role: 'user', content: "I'm bored. Also I'm visiting my uncle in Texas in December." }] } });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.match(j.reply, /weather tool/);
  assert.equal(j.actions[0].type, 'build');
  assert.equal(j.state.facts[0].text, 'Visiting uncle in Texas in December');
  assert.ok(j.usage.today.calls === 1 && j.usage.today.cost > 0);
  // Second Claude call carried the tool results back.
  const second = claudeCalls[1].messages.at(-1);
  assert.equal(second.content[0].type, 'tool_result');
  // Snapshot gives Claude today's context.
  assert.match(claudeCalls[0].system[1].text, /Lab 4/);
  assert.equal(claudeCalls[0].model, 'claude-haiku-5-5');
});

test('deep mode uses the bigger model', async () => {
  claudeQueue.push({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'Deep answer.' }] });
  await call('/api/chat', { method: 'POST', body: { deep: true, messages: [{ role: 'user', content: 'Explain bearings' }] } });
  assert.equal(claudeCalls[0].model, 'claude-sonnet-5-5');
});

test('daily budget blocks the brain', async () => {
  await call('/api/op', { method: 'POST', body: { name: 'settings_update', args: { dailyBudget: 0 } } });
  const r = await call('/api/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(r.status, 429);
  assert.equal(claudeCalls.length, 0);
});

test('API errors become plain messages', async () => {
  claudeQueue.push({ status: 400, body: { error: { message: 'Your credit balance is too low to access the Anthropic API.' } } });
  const r = await call('/api/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(r.status, 402);
  assert.match((await r.json()).error, /out of credits/);
});

test('messages are cleaned to alternating turns ending with the user', async () => {
  claudeQueue.push({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'ok' }] });
  await call('/api/chat', { method: 'POST', body: { messages: [{ role: 'assistant', content: 'hello' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'system', content: 'evil' }] } });
  assert.deepEqual(claudeCalls[0].messages, [{ role: 'user', content: 'a\nb' }]);
});

test('free brief needs no API call', async () => {
  const j = await (await call('/api/brief')).json();
  assert.match(j.text, /sir/);
  assert.equal(claudeCalls.length, 0);
});

test('every tool has a runner and valid schema', async () => {
  const names = new Set(TOOLS.map(t => t.name));
  assert.equal(names.size, TOOLS.length);
  for (const t of TOOLS) assert.equal(t.input_schema.type, 'object');
  assert.ok(costOf('claude-haiku-5-5', { input_tokens: 1e6, output_tokens: 1e6 }) === 0.6);
});

test('CORS allows the GitHub Pages site only', async () => {
  const ok = await call('/api/health', { auth: null, headers: { origin: 'https://alyg7002-lang.github.io' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://alyg7002-lang.github.io');
  const bad = await call('/api/health', { auth: null, headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('every tool runs with sample input', async () => {
  const { runTool } = await import('../worker/src/brain.js');
  const { makeData } = await import('../worker/src/data.js');
  const J = await import('../shared/ops.js');
  const ctx = { state: J.emptyState(), data: makeData({ DATA_BASE: 'https://data.test' }), now: new Date('2026-10-21T16:00:00Z'), actions: [] };
  const samples = {
    action_set: { text: 'x' }, action_check: { done: true, date: '2026-10-21' }, verse_check: { ok: true }, prayer_add: { text: 'Dad' },
    prayer_answer: { match: 'dad', note: 'good' }, memory_save: { fact: 'f' }, memory_forget: { match: 'f' }, backlog_add: { task: 't' },
    backlog_done: {}, devlog_add: { text: 'd' }, log_debrief: { done: 'a', tomorrow: 'b' }, flashcard_add: { front: 'a', back: 'b' },
    log_phone_week: { total: 40 }, risk_calc: { entry: 10, stop: 9 }, trade_log_add: { entry: 10, stop: 9, exit: 11 },
    settings_update: { wake: '07:45' }, start_timer: { minutes: 5 }, log_miss: { request: 'r' },
  };
  const order = ['backlog_add', 'action_set', 'prayer_add', 'flashcard_add', ...TOOLS.map(t => t.name)];
  for (const name of order) {
    const input = name === 'flashcard_grade' ? { id: ctx.state.cards[0].id, correct: true } : samples[name] || {};
    const out = await runTool(name, input, ctx);
    assert.ok(out !== undefined, name);
    if (name === 'start_build_session' && out.error) assert.fail('build session should find a task');
  }
  assert.ok(ctx.actions.some(a => a.type === 'timer'));
});
