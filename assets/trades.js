// Trades page: all four paper bots, how each is doing, whether its records can be trusted, and every
// trade on its own chart with what you need to judge it. Reads the public orb-bot repo directly:
//   data/paper_trades.json              written by scripts/trade_review.py after every bot run
//   data/health.json                    written by scripts/reconcile.py (journal vs Alpaca, days each bot ran)
//   data/charts/<SYM>_<YYYY-MM-DD>.csv  1-min candles
import { rollup, groupBy, moves, whatIf, holdText, pnlOf, rOf } from './tradecalc.js';

const RAW = 'https://raw.githubusercontent.com/alyg7002-lang/orb-bot/main/';
const TZ = 'America/New_York';
const NS = 'http://www.w3.org/2000/svg';
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const md = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
const tm = iso => (iso ? hm.format(new Date(iso)) : '—');
const day = d => md.format(new Date(d + 'T12:00:00-05:00'));
const px = v => (v == null ? '—' : (+v).toFixed(2));
const usd = v => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.abs(v).toFixed(2));
const rr = v => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + 'R');
const pf = v => (v === Infinity ? '∞' : v.toFixed(2));
const tone = v => (v > 0 ? 'good' : v < 0 ? 'bad' : '');
const EXIT = { target: 'Hit target', stop: 'Hit stop', time: 'Closed at 3:55', eod: 'Closed at the bell', sma5: 'Closed above 5-day avg', stale_close: 'Closed late' };
const exitWord = t => (t.status === 'open' ? 'Still open' : EXIT[t.exit_reason] || t.exit_reason);
const OUTCOME = { traded: 'Traded', no_retest: 'No retest', no_fvg: 'No FVG', fvg_failed: 'FVG failed', invalidated: 'Failed breakout', no_breakout: 'No breakout', vetoed: 'Vetoed', filtered: 'Filtered', low_volume: 'Low volume', news_day: 'News day', news: 'News day', daily_limit: 'Daily limit', one_at_a_time: 'Trade already open', missed: 'Missed (offline)', no_data: 'No data', no_setup: 'No setup', holding: 'Holding', exited: 'Exited', half_day: 'Short session', size_zero: 'Size 0' };
const STOPS = [[1, 'Current stop'], [0.75, '¾ stop'], [0.5, '½ stop']];
const TARGETS = [[1, '1R'], [1.5, '1.5R'], [2, '2R'], [3, '3R'], [null, 'None (3:55)']];

const state = { data: null, health: null, err: false, sel: null, bot: 'all', symbol: 'all', side: 'all', result: 'all', exit: 'all', useRules: false, lab: null };
const barCache = new Map();   // "SYM_DAY" -> Promise<bar[]>

async function getText(path) {
  const r = await fetch(RAW + path + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.text();
}
function dayBars(sym, d) {
  const k = sym + '_' + d;
  if (!barCache.has(k)) barCache.set(k, getText(`data/charts/${k}.csv`).then(txt => txt.trim().split(/\r?\n/).slice(1).map(l => {
    const [ts, o, hi, lo, c] = l.split(',');
    const clock = ts.slice(11, 16);   // ET wall time from the timestamp; regular hours only
    return clock >= '09:30' && clock < '16:00' ? { t: Date.parse(ts), clock, o: +o, h: +hi, l: +lo, c: +c, day: d } : null;
  }).filter(Boolean)).catch(e => { barCache.delete(k); throw e; }));
  return barCache.get(k);
}
// Long trades (several days) get 5-min candles so they stay readable.
function squeeze(list, mins) {
  const out = [];
  for (const b of list) {
    const slot = Math.floor(b.t / (mins * 60000)), last = out[out.length - 1];
    if (last && last.slot === slot) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; }
    else out.push({ ...b, slot });
  }
  return out;
}

async function load() {
  barCache.clear();
  try {
    state.data = JSON.parse(await getText('data/paper_trades.json'));
    state.data.trades.reverse();    // newest first
    state.err = false;
  } catch (e) { console.warn(e); state.err = true; }
  try { state.health = JSON.parse(await getText('data/health.json')); } catch { state.health = null; }
}

// ---------- page ----------
export async function mount(root, force = false) {
  if (!force && root.querySelector('#tradesRoot')) return;     // keep the open trade through the 5-min refresh
  root.innerHTML = `<h1>Trades</h1>
    <p class="lede">All four paper bots. Is each one running, are its records right, and what exactly did it do? Tap any trade to see it on the chart. <button class="btn quiet small" data-tr="refresh">Refresh</button></p>
    <div id="tradesRoot"><p class="empty">Loading the bots' trades…</p></div>`;
  await load();
  const el = root.querySelector('#tradesRoot');
  if (!el) return;
  if (!state.data) { el.innerHTML = `<div class="plate"><p class="empty">Couldn't load the bots' trades from GitHub. Check your internet.</p><button class="btn small" data-tr="refresh">Try again</button></div>`; return; }
  el.innerHTML = `<div id="trBoard"></div><div id="trHealth"></div>
    <div class="plate" id="trDetail"></div>
    <div class="plate"><div class="spread"><h2>Trade log</h2><span class="num small muted" id="trCount"></span></div>
      <div class="trfilters" id="trFilters"></div><div id="trList"></div></div>
    <div class="plate" id="trLab"></div>`;
  paint();
}
function paint() { board(); health(); filters(); list(); lab(); if (state.sel != null || filtered().length) detail(); }

const allTrades = () => state.data.trades;
function filtered() {
  return allTrades().filter(t => (state.bot === 'all' || t.bot === state.bot) && (state.symbol === 'all' || t.symbol === state.symbol)
    && (state.side === 'all' || t.direction === state.side) && (state.exit === 'all' || t.exit_reason === state.exit)
    && (state.result === 'all' || (state.result === 'win' ? t.pnl > 0 : state.result === 'loss' ? t.pnl < 0 : t.status === 'open')));
}

function board() {
  const names = Object.keys(state.data.bots);
  const cov = name => Object.values(state.health?.coverage || {}).find(c => c.bot === name);
  $id('trBoard').innerHTML = `<div class="trboard">${names.map(name => {
    const list = allTrades().filter(t => t.bot === name), s = rollup(list, state.useRules), about = state.data.bots[name], c = cov(name);
    const off = c?.missing?.length;
    return `<button class="trbot ${state.bot === name ? 'on' : ''}" data-tr="bot" data-v="${h(name)}" aria-pressed="${state.bot === name}">
      <span class="spread"><strong>${h(name)}</strong><span class="tag ${off ? 'hot' : ''}">${off ? `missed ${off} day${off > 1 ? 's' : ''}` : c?.last_day ? `ran ${day(c.last_day)}` : 'no runs yet'}</span></span>
      <span class="big ${tone(s.pnl)}">${s.n ? usd(s.pnl) : '—'}</span>
      <span class="small muted">${s.n ? `${s.n} closed · ${s.wins}W ${s.losses}L · ${rr(s.avgR)} avg · PF ${pf(s.pf)}` : list.length ? `${list.length} open` : 'No trades yet'}</span>
      <span class="small muted">${h(about.where)}</span></button>`;
  }).join('')}</div>
  <label class="check trrules"><input type="checkbox" data-tr="rules" ${state.useRules ? 'checked' : ''}><span>Score late closes by the rule (flat at 3:55 on entry day), not by what the late hold happened to pay</span></label>`;
}

function health() {
  const H = state.health, el = $id('trHealth');
  if (!H) { el.innerHTML = `<div class="trhealth warn"><strong>Record check hasn't run yet.</strong> It runs after each bot run on GitHub.</div>`; return; }
  const a = H.alpaca, issues = [...(a?.issues || []), ...(H.candles || [])];
  const missing = Object.values(H.coverage || {}).filter(c => c.missing?.length);
  const bad = issues.length || missing.length || !a;
  el.innerHTML = `<details class="trhealth ${bad ? 'warn' : 'ok'}" ${bad ? 'open' : ''}><summary><strong>Record check:</strong> ${
    a ? `${a.trades_checked} ORB trades against ${a.orders_checked} Alpaca orders, ${issues.length ? `${issues.length} problem${issues.length > 1 ? 's' : ''}` : 'all match'}` : "couldn't reach Alpaca"}${missing.length ? `, ${missing.length} bot${missing.length > 1 ? 's' : ''} missed days` : ''}
    <span class="muted small">· checked ${h(md.format(new Date(H.generated)))} ${h(tm(H.generated))}</span></summary>
    <ul class="trissues">${issues.map(i => `<li>${h(i.text)}</li>`).join('')}
      ${missing.map(c => `<li>${h(c.bot)} logged nothing on ${c.missing.map(day).join(', ')}, so the run didn't happen on those days.</li>`).join('')}
      ${bad ? '' : '<li>Every order has a journal row, every journal row has an order, and the fills match.</li>'}
      <li class="muted">RSI(2), NR7 and Vol Breakout send no orders by design, so they will never appear on Alpaca. Their record is the journal.</li></ul></details>`;
}

function filters() {
  const opts = (key, label, vals, words = {}) => `<label class="field"><span>${label}</span><select data-tr="filter" data-k="${key}"><option value="all">All</option>${vals.map(v => `<option value="${h(v)}" ${state[key] === v ? 'selected' : ''}>${h(words[v] || v)}</option>`).join('')}</select></label>`;
  const t = allTrades(), uniq = f => [...new Set(t.map(f).filter(Boolean))].sort();
  $id('trFilters').innerHTML = opts('bot', 'Bot', Object.keys(state.data.bots)) + opts('symbol', 'Ticker', uniq(x => x.symbol)) + opts('side', 'Side', ['long', 'short'])
    + opts('result', 'Result', ['win', 'loss', 'open'], { win: 'Winners', loss: 'Losers', open: 'Still open' }) + opts('exit', 'Exit', uniq(x => x.exit_reason), EXIT);
}

function list() {
  const shown = filtered(), s = rollup(shown, state.useRules), el = $id('trList');
  $id('trCount').textContent = `${shown.length} trades · ${s.wins}W ${s.losses}L · ${usd(s.pnl)}`;
  if (!shown.length) { el.innerHTML = '<p class="empty">No trades match these filters yet.</p>'; return; }
  if (!shown.some(t => t.id === state.sel)) state.sel = shown[0].id;
  el.innerHTML = `<div class="scroll-x"><table class="t review"><thead><tr><th>Date</th><th>Trade</th><th>Entry</th><th>Exit</th><th>Result</th><th>Why</th></tr></thead><tbody>${shown.map(t => {
    const p = pnlOf(t, state.useRules), r = rOf(t, state.useRules);
    return `<tr data-trade="${t.id}" tabindex="0" role="button" aria-pressed="${t.id === state.sel}" class="${t.id === state.sel ? 'on' : ''}">
      <td>${day(t.session_date)}</td><td><strong>${h(t.symbol)}</strong> ${h(t.direction)}<span class="muted small"> · ${h(t.bot)} #${t.n}</span></td>
      <td>${px(t.entry)} <span class="muted small">${tm(t.entry_time)}</span></td>
      <td>${t.status === 'open' ? '<span class="tag hot">open</span>' : `${px(t.exit)} <span class="muted small">${tm(t.exit_time)}</span>`}</td>
      <td class="${tone(p)}">${t.status === 'open' ? '—' : `${usd(p)} <span class="small">${rr(r)}</span>`}</td>
      <td class="muted small">${h(exitWord(t))}${t.rules ? ' <span class="tag hot">rule break</span>' : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function select(id) {
  state.sel = id;
  document.querySelectorAll('tr[data-trade]').forEach(r => { const on = +r.dataset.trade === id; r.classList.toggle('on', on); r.setAttribute('aria-pressed', on); });
  detail();
}

// ---------- one trade ----------
async function detail() {
  const box = $id('trDetail'), t = allTrades().find(x => x.id === state.sel);
  if (!box) return;
  if (!t) { box.innerHTML = '<p class="empty">Pick a trade from the log.</p>'; return; }
  const shown = filtered(), i = shown.findIndex(x => x.id === t.id), about = state.data.bots[t.bot] || {};
  const risk = t.stop == null ? null : Math.abs(t.entry - t.stop);
  const rsi = t.mode === 'paper_rsi2';
  const fill = state.health?.alpaca?.fills?.[t.id];
  const facts = [
    ['Entry', `${px(t.entry)} at ${tm(t.entry_time)}`], ['Exit', t.status === 'open' ? 'open' : `${px(t.exit)} at ${tm(t.exit_time)}${t.days.length > 1 ? ', ' + day(t.exit_time.slice(0, 10)) : ''}`],
    [rsi ? 'Risk unit (2×ATR)' : 'Stop', t.stop == null ? '—' : `${px(t.stop)} (${px(risk)} away)`], [rsi ? '5-day avg at entry' : 'Target', t.target == null ? 'None' : `${px(t.target)}${risk ? ` (${(Math.abs(t.target - t.entry) / risk).toFixed(1)}R)` : ''}`],
    ['Shares', t.qty], ['Position size', `$${Math.round(t.qty * t.entry).toLocaleString('en-US')}`], ['Dollars at risk', risk ? `$${(risk * t.qty).toFixed(2)}` : '—'],
    ['Held', holdText(t.entry_time, t.exit_time)], ['Why it closed', exitWord(t)],
  ];
  if (t.breakout_time && t.or_high != null) facts.push(['Breakout', tm(t.breakout_time)], ['Opening range', `${px(t.or_low)}–${px(t.or_high)} (${px(t.or_high - t.or_low)})`]);
  if (t.fvg) facts.push(['FVG', `${px(t.fvg[0])}–${px(t.fvg[1])}`]);
  if (t.mode === 'paper') facts.push(['Alpaca fills', !fill ? 'not checked' : `in ${px(fill.entry_fill)}${t.status === 'open' ? '' : `, out ${px(fill.exit_fill)}`}`]);
  box.innerHTML = `<div class="spread"><h2>${h(t.symbol)} ${h(t.direction)} · ${day(t.session_date)} <span class="muted small">${h(t.bot)} #${t.n}</span></h2>
      <span class="row"><button class="btn small" data-tr="step" data-v="-1" ${i <= 0 ? 'disabled' : ''} aria-label="Newer trade">← Newer</button><button class="btn small" data-tr="step" data-v="1" ${i < 0 || i >= shown.length - 1 ? 'disabled' : ''} aria-label="Older trade">Older →</button></span></div>
    <p class="trresult ${tone(t.pnl)}">${t.status === 'open' ? 'Still open' : `${usd(t.pnl)} · ${rr(t.r_multiple)}`}</p>
    ${t.rules ? `<p class="trnote"><strong>Rule break.</strong> This should have closed at 3:55 on ${day(t.session_date)}, but the close-out run failed, so it was held past the close with no stop or target working. By the rule it would have closed near ${px(t.rules.exit)} for ${usd(t.rules.pnl)} (${rr(t.rules.r)}).</p>` : ''}
    <div class="tchart" id="trChart"><p class="empty">Loading candles…</p></div>
    <dl class="facts" id="trFacts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${h(v)}</dd></div>`).join('')}</dl>
    <div id="trVotes"></div>
    ${t.log?.length ? `<details class="trlog"><summary>What the bot was thinking (${t.log.length} log lines)</summary><pre class="log">${h(t.log.join('\n'))}</pre></details>` : ''}
    <details class="trlog"><summary>This bot's rules</summary><p class="small muted">${h(about.rules)} <br>Records: ${h(about.where)}.</p></details>`;
  votes(t);
  const host = $id('trChart');
  if (!t.charts?.length) { host.innerHTML = `<p class="empty">The candles for this day haven't been saved yet. They download after the bot's next run on GitHub.</p>`; return; }
  let all;
  try { all = (await Promise.all(t.charts.map(d => dayBars(t.symbol, d)))).flat(); }
  catch { host.innerHTML = `<p class="empty">Couldn't load the candles from GitHub.</p>`; return; }
  if (state.sel !== t.id || !$id('trChart')) return;
  if (!all.length) { host.innerHTML = '<p class="empty">No candles for this day (market holiday?).</p>'; return; }
  const multi = t.charts.length > 1, bars = multi ? squeeze(all, 5) : all;
  const redraw = () => draw(host, t, bars, multi);
  redraw(); host._redraw = redraw;
  const m = moves(t, all);
  if (m) {
    const at = ms => `at ${multi ? md.format(ms) + ' ' : ''}${hm.format(ms)}`;
    const extra = [['Best it got', rr(m.best), at(m.bestAt), 'good'], ['Worst it got', rr(m.worst), at(m.worstAt), 'bad']];
    if (m.afterBest != null) extra.push(['After the exit that day', `${rr(m.afterBest)} / ${rr(m.afterWorst)}`, 'best / worst from entry', '']);
    $id('trFacts').insertAdjacentHTML('beforeend', extra.map(([k, v, sub, c]) => `<div><dt>${k}</dt><dd class="${c}">${h(v)} <span class="muted small">${h(sub)}</span></dd></div>`).join(''));
  }
}

function votes(t) {
  const el = $id('trVotes');
  if (!t.votes?.length) { el.innerHTML = ''; return; }
  const yes = t.votes.filter(v => v.vote > 0), no = t.votes.filter(v => v.vote < 0), abstain = t.votes.length - yes.length - no.length;
  const li = v => `<li><b>${h(v.voter)}</b> ${h(v.why)}</li>`;
  el.innerHTML = `<details class="trlog"><summary>Panel vote: ${yes.length} for, ${no.length} against${abstain ? `, ${abstain} no opinion` : ''}. The panel can't block a trade.</summary>
    <div class="trvotes"><div><h3 class="good">For</h3><ul>${yes.map(li).join('') || '<li class="muted">None</li>'}</ul></div><div><h3 class="bad">Against</h3><ul>${no.map(li).join('') || '<li class="muted">None</li>'}</ul></div></div></details>`;
}

// ---------- what-if ----------
function lab() {
  const el = $id('trLab'), n = labTrades().length;
  el.innerHTML = `<h2>Test a tweak</h2>
    <p class="muted small" style="margin:0 0 10px">Replays the ${n} intraday trade${n === 1 ? '' : 's'} matching your filters on their real candles with other stops and targets. Same rules as the backtests: stop checked first inside a candle, flat at 3:55. RSI(2) is left out because its exits aren't stops and targets.</p>
    <button class="btn small" data-tr="lab" ${n ? '' : 'disabled'}>Run it</button><div id="trLabOut"></div>`;
  state.lab = null;
}
const labTrades = () => filtered().filter(t => t.status === 'closed' && t.mode !== 'paper_rsi2' && t.stop != null && t.charts?.includes(t.session_date));

async function runLab() {
  const out = $id('trLabOut'), list = labTrades();
  out.innerHTML = '<p class="empty">Replaying…</p>';
  let rows;
  try { rows = await Promise.all(list.map(async t => ({ t, bars: await dayBars(t.symbol, t.session_date) }))); }
  catch { out.innerHTML = `<p class="empty">Couldn't load the candles from GitHub.</p>`; return; }
  const cell = (stop, target) => {
    const rs = rows.map(({ t, bars }) => whatIf(t, bars, stop, target)).filter(v => v != null);
    return { avg: rs.reduce((a, v) => a + v, 0) / (rs.length || 1), win: rs.filter(v => v > 0).length / (rs.length || 1), n: rs.length };
  };
  const hit = m => rows.filter(({ t, bars }) => { const x = moves(t, bars); return x && x.best >= m; }).length;
  const by = (label, key) => `<div><h3>${label}</h3><div class="scroll-x"><table class="t"><thead><tr><th></th><th>Trades</th><th>Win</th><th>Avg R</th></tr></thead><tbody>${groupBy(list, key, state.useRules).map(g => `<tr><td>${h(g.key)}</td><td>${g.n}</td><td>${Math.round(g.winRate * 100)}%</td><td class="${tone(g.avgR)}">${rr(g.avgR)}</td></tr>`).join('')}</tbody></table></div></div>`;
  const hour = t => t.entry_time.slice(11, 13) + ':00';     // ET wall time, 24-hour so it sorts
  out.innerHTML = `<div class="scroll-x" style="margin-top:12px"><table class="t"><thead><tr><th>Average R per trade</th>${TARGETS.map(([, l]) => `<th>Target ${l}</th>`).join('')}</tr></thead><tbody>
    ${STOPS.map(([s, l]) => `<tr><td>${l}</td>${TARGETS.map(([g]) => { const c = cell(s, g); return `<td class="${tone(c.avg)}">${rr(c.avg)} <span class="muted small">${Math.round(c.win * 100)}%</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="small muted">The % is the win rate. Reached +1R while open: ${hit(1)} of ${rows.length}. Reached +1.5R: ${hit(1.5)}. Reached +2R: ${hit(2)}.</p>
    ${rows.length < 30 ? `<p class="trnote"><strong>Only ${rows.length} trades.</strong> Under 30, the best cell is mostly luck. Don't change a setting from this table yet. Picking the best cell after the fact is curve-fitting. Use it to get ideas, then test them on separate data.</p>` : '<p class="trnote">The best cell here is picked after the fact, so it will look better than it really is. Test any change on separate data before you use it.</p>'}
    <div class="trby">${by('By ticker', t => t.symbol)}${by('By side', t => t.direction)}${by('By entry hour', hour)}</div>
    ${outcomesHtml()}`;
}
function outcomesHtml() {
  const names = state.bot === 'all' ? Object.keys(state.data.outcomes || {}) : [state.bot];
  const rows = names.filter(n => state.data.outcomes?.[n]);
  if (!rows.length) return '';
  return `<h3 style="margin-top:14px">How each ticker-day ended, trades or not</h3>${rows.map(n => `<p class="small muted" style="margin:4px 0"><b>${h(n)}:</b> ${Object.entries(state.data.outcomes[n]).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${h(OUTCOME[k] || k)} ${v}`).join(' · ')}</p>`).join('')}`;
}

// ---------- chart ----------
const $id = id => document.getElementById(id);
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.appendChild(e); return e; }
function idxAt(list, iso) {
  if (!iso) return list.length - 1;
  const t = Date.parse(iso);
  let i = 0; while (i < list.length - 1 && list[i + 1].t <= t) i++;
  return i;
}
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
}

function draw(host, t, list, multi) {
  host.innerHTML = '';
  const rsi = t.mode === 'paper_rsi2';
  const W = Math.max(host.clientWidth, 300), H = W < 560 ? 300 : 380, P = { l: 6, r: 62, t: 14, b: 26 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${t.symbol} candles with entry at ${px(t.entry)} and exit at ${px(t.exit)}` }, host);
  const levels = [t.entry, t.exit, t.stop, t.target, t.rules?.exit].filter(v => v != null);
  let lo = Math.min(...list.map(b => b.l), ...levels), hi = Math.max(...list.map(b => b.h), ...levels);
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const n = list.length, slot = (W - P.l - P.r) / n;
  const x = i => P.l + slot * (i + 0.5), y = v => P.t + (hi - v) / (hi - lo) * (H - P.t - P.b);
  const ie = idxAt(list, t.entry_time), ix = idxAt(list, t.exit_time);
  // candles saved mid-day stop before the exit or entry: don't pin those to the last candle
  const cut = t.exit_time && Date.parse(t.exit_time) > list[n - 1].t + 120000;
  const cutEntry = Date.parse(t.entry_time) > list[n - 1].t + 120000;

  const step = niceStep((hi - lo) / 5);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'tc-grid' }, svg);
    el('text', { x: W - P.r + 6, y: y(v) + 4, class: 'tc-axis' }, svg).textContent = v.toFixed(step < 1 ? 2 : 0);
  }
  let lastDay = null;
  list.forEach((b, i) => {
    const mm = b.clock.slice(3);
    if (multi ? b.day !== lastDay : mm === '00' || (mm === '30' && W >= 560)) {
      if (multi && lastDay) el('line', { x1: x(i) - slot / 2, x2: x(i) - slot / 2, y1: P.t, y2: H - P.b, class: 'tc-day' }, svg);
      el('text', { x: Math.max(x(i), P.l + 14), y: H - 8, class: 'tc-axis', 'text-anchor': 'middle' }, svg).textContent = multi ? day(b.day) : hm.format(new Date(b.t)).replace(/ [AP]M/, '');
      lastDay = b.day;
    }
  });
  const days = list.map(b => b.day), first = days.indexOf(t.session_date), last = days.lastIndexOf(t.session_date);
  if (t.or_high != null && t.or_low != null && first >= 0) {
    el('rect', { x: x(first) - slot / 2, y: y(t.or_high), width: (last - first + 1) * slot, height: Math.max(y(t.or_low) - y(t.or_high), 1), class: 'tc-range' }, svg);
    el('text', { x: x(first) + 4, y: y(t.or_high) - 4, class: 'tc-label tc-range-l' }, svg).textContent = 'Opening range';
  }
  if (t.fvg) el('rect', { x: x(Math.max(0, ie - 25)), y: y(t.fvg[1]), width: Math.max(x(ie) - x(Math.max(0, ie - 25)), 2), height: Math.max(y(t.fvg[0]) - y(t.fvg[1]), 2), class: 'tc-fvg' }, svg);
  if (!cutEntry) el('rect', { x: x(ie) - slot / 2, y: P.t, width: (ix - ie + 1) * slot, height: H - P.t - P.b, class: 'tc-held' }, svg);
  if (t.breakout_time && t.or_high != null && !multi) {
    const ib = idxAt(list, t.breakout_time);
    el('line', { x1: x(ib), x2: x(ib), y1: P.t, y2: H - P.b, class: 'tc-break' }, svg);
    el('text', { x: x(ib) + 3, y: H - P.b - 4, class: 'tc-label tc-range-l' }, svg).textContent = 'Breakout';
  }
  const wick = Math.max(1, Math.min(1.4, slot * 0.3)), body = Math.max(1, slot * 0.68);
  list.forEach((b, i) => {
    const cls = b.c >= b.o ? 'tc-up' : 'tc-dn';
    el('line', { x1: x(i), x2: x(i), y1: y(b.h), y2: y(b.l), class: cls, 'stroke-width': wick }, svg);
    el('rect', { x: x(i) - body / 2, y: y(Math.max(b.o, b.c)), width: body, height: Math.max(Math.abs(y(b.o) - y(b.c)), 1), class: cls + ' fill' }, svg);
  });
  const lines = [[t.target, 'tc-target', rsi ? '5-day avg' : 'Target'], [t.stop, 'tc-stop', rsi ? 'Risk unit' : 'Stop'], [t.entry, 'tc-entry', 'Entry']].filter(l => l[0] != null);
  const tags = [];
  for (const [v, cls, name] of lines) {
    el('line', { x1: cutEntry ? P.l : x(ie) - slot / 2, x2: W - P.r, y1: y(v), y2: y(v), class: cls }, svg);
    tags.push([y(v), cls, `${name} ${px(v)}`]);
  }
  tags.sort((a, b) => a[0] - b[0]).forEach((tg, i, a) => { if (i && tg[0] - a[i - 1][0] < 14) tg[0] = a[i - 1][0] + 14; });
  tags.forEach(([yy, cls, txt]) => { el('text', { x: W - P.r - 4, y: yy - 4, class: `tc-label ${cls}`, 'text-anchor': 'end' }, svg).textContent = txt; });
  const up = t.direction === 'long', ex = x(ie), ey = y(t.entry), s = 7;
  if (!cutEntry) el('path', { d: up ? `M${ex},${ey + 3} l${-s},${s * 1.6} h${s * 2}z` : `M${ex},${ey - 3} l${-s},${-s * 1.6} h${s * 2}z`, class: 'tc-mark-in' }, svg);
  if (t.exit != null && !cut) {
    el('line', { x1: ex, y1: ey, x2: x(ix), y2: y(t.exit), class: 'tc-path' }, svg);
    el('circle', { cx: x(ix), cy: y(t.exit), r: 5.5, class: t.pnl >= 0 ? 'tc-mark-win' : 'tc-mark-loss' }, svg);
  }
  if (t.rules && last >= 0) {
    const ir = list.findIndex(b => b.day === t.session_date && b.clock >= '15:55');
    if (ir >= 0) el('rect', { x: x(ir) - 5, y: y(t.rules.exit) - 5, width: 10, height: 10, class: 'tc-mark-rule', transform: `rotate(45 ${x(ir)} ${y(t.rules.exit)})` }, svg);
  }
  const cross = el('line', { y1: P.t, y2: H - P.b, class: 'tc-cross', opacity: 0 }, svg);
  const tip = document.createElement('div'); tip.className = 'tc-tip'; tip.hidden = true; host.appendChild(tip);
  const hit = el('rect', { x: P.l, y: 0, width: W - P.l - P.r, height: H, fill: 'transparent' }, svg);
  const move = e => {
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(n - 1, Math.floor((sx - P.l) / slot))), b = list[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
    const risk = t.stop == null ? 0 : Math.abs(t.entry - t.stop);
    const inTrade = risk && i >= ie && (!t.exit_time || i <= ix);
    tip.innerHTML = `<b>${multi ? day(b.day) + ' ' : ''}${hm.format(new Date(b.t))}</b> O ${px(b.o)} H ${px(b.h)} L ${px(b.l)} C ${px(b.c)}`
      + (inTrade ? ` <span class="${tone((up ? 1 : -1) * (b.c - t.entry))}">${rr((up ? 1 : -1) * (b.c - t.entry) / risk)}</span>` : '')
      + (i === ie ? `<br><span class="hot">Entry ${px(t.entry)}</span>` : '') + (i === ix && t.exit != null && !cut ? `<br>Exit ${px(t.exit)}` : '');
    tip.hidden = false;
    tip.style.left = Math.min(Math.max(x(i) * r.width / W - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + 'px';
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.hidden = true; });

  const key = (cls, label) => `<span><i class="${cls}"></i>${label}</span>`;
  const legend = document.createElement('div'); legend.className = 'tc-legend small muted';
  legend.innerHTML = (cut || cutEntry ? `<span class="hot" style="flex-basis:100%">These candles stop at ${hm.format(new Date(list[n - 1].t))}, before the ${cutEntry ? 'entry' : 'exit'} at ${tm(cutEntry ? t.entry_time : t.exit_time)}. The rest downloads on the bot's next run.</span>` : '')
    + key('k-in', 'Entry') + (t.exit != null ? key('k-out', 'Exit') : '') + (t.stop != null ? key('k-stop', rsi ? 'Risk unit' : 'Stop') : '') + (t.target != null ? key('k-target', rsi ? '5-day avg at entry' : 'Target') : '')
    + (t.or_high != null ? key('k-range', 'Opening range') : '') + (t.fvg ? key('k-fvg', 'FVG') : '') + (t.rules ? key('k-rule', 'Where the rule would have closed') : '')
    + `<span>${multi ? '5-min candles' : '1-min candles'} · ET</span>`;
  host.appendChild(legend);
}

// ---------- events (app.js forwards document clicks and keys here) ----------
export function onClick(e) {
  const row = e.target.closest('tr[data-trade]');
  if (row) { select(+row.dataset.trade); $id('trDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return true; }
  const b = e.target.closest('[data-tr]');
  if (!b) return false;
  switch (b.dataset.tr) {
    case 'bot': state.bot = state.bot === b.dataset.v ? 'all' : b.dataset.v; state.sel = null; paint(); return true;
    case 'step': { const shown = filtered(), i = shown.findIndex(t => t.id === state.sel), next = shown[i + +b.dataset.v]; if (next) select(next.id); return true; }
    case 'lab': runLab(); return true;
    case 'refresh': { const v = document.getElementById('view-trades'); if (v) mount(v, true); return true; }
  }
  return false;
}
export function onChange(e) {
  const f = e.target.closest?.('[data-tr]');
  if (!f) return false;
  if (f.dataset.tr === 'filter') { state[f.dataset.k] = f.value; state.sel = null; paint(); return true; }
  if (f.dataset.tr === 'rules') { state.useRules = f.checked; board(); list(); lab(); return true; }
  return false;
}
export function onKey(e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr[data-trade]')) { e.preventDefault(); return onClick(e); }
  return false;
}

let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => $id('trChart')?._redraw?.(), 150); });
