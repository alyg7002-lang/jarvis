// Bot trade review: every paper trade the bots placed, each on its own candlestick chart.
// Data comes straight from the public orb-bot repo (no backend needed):
//   data/paper_trades.json            written by scripts/trade_review.py after every bot run
//   data/charts/<SYM>_<YYYY-MM-DD>.csv 1-min candles, 9:30-16:00 ET
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
const tone = v => (v > 0 ? 'good' : v < 0 ? 'bad' : '');
const EXIT = { target: 'Hit target', stop: 'Hit stop', time: 'Closed at 3:55', eod: 'Closed at 3:55', close: 'Closed at 3:55', stale_close: 'Closed late (held overnight)' };

let trades = null, err = null, sel = null, filter = 'all';
const bars = new Map();   // "SYM_DAY" -> Promise<bar[]>

async function getText(path) {
  const r = await fetch(RAW + path + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.text();
}
function dayBars(sym, d) {
  const k = sym + '_' + d;
  if (!bars.has(k)) bars.set(k, getText(`data/charts/${k}.csv`).then(txt => txt.trim().split(/\r?\n/).slice(1).map(l => {
    const [ts, o, hi, lo, c] = l.split(',');
    const clock = ts.slice(11, 16);   // ET wall time from the timestamp; regular hours only
    return clock >= '09:30' && clock < '16:00' ? { t: Date.parse(ts), o: +o, h: +hi, l: +lo, c: +c, day: d } : null;
  }).filter(b => b && b.t)).catch(e => { bars.delete(k); throw e; }));
  return bars.get(k);
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

export async function load(force) {
  if (trades && !force) return;
  try { trades = JSON.parse(await getText('data/paper_trades.json')).trades.slice().reverse(); err = null; }
  catch (e) { console.warn(e); err = e; }
}

export function html() {
  return `<div class="plate" style="grid-column:1/-1" id="reviewPlate">
    <div class="spread"><h2>Bot trade review</h2><span class="num small muted" id="reviewCount"></span></div>
    <p class="muted small" style="margin:0 0 12px">Every paper trade the bots placed. Tap one to see it on the chart: where it got in, where it got out, and what price did in between.</p>
    <div id="reviewChart"></div>
    <div class="row" id="reviewFilter" style="margin:0 0 8px"></div>
    <div id="reviewList"><p class="empty">Loading the bot's trades…</p></div>
  </div>`;
}

export async function mount() {
  await load();
  const list = document.getElementById('reviewList');
  if (!list) return;
  if (!trades) { list.innerHTML = `<p class="empty">Couldn't load the bot's trades from GitHub. Check your internet and tap Refresh.</p>`; return; }
  if (!trades.length) { list.innerHTML = '<p class="empty">No paper trades yet.</p>'; return; }
  const bots = [...new Set(trades.map(t => t.bot))];
  document.getElementById('reviewFilter').innerHTML = bots.length > 1
    ? ['all', ...bots].map(b => `<button class="btn small ${filter === b ? 'primary' : ''}" data-review-filter="${h(b)}">${b === 'all' ? 'All bots' : h(b)}</button>`).join('') : '';
  const shown = trades.filter(t => filter === 'all' || t.bot === filter);
  const closed = shown.filter(t => t.status === 'closed'), wins = closed.filter(t => t.pnl > 0).length;
  document.getElementById('reviewCount').textContent = `${shown.length} trades · ${wins} W / ${closed.length - wins} L`;
  if (!sel || !shown.some(t => t.id === sel)) sel = shown[0].id;
  list.innerHTML = `<div class="scroll-x"><table class="t review"><thead><tr><th>Date</th><th>Trade</th><th>Entry</th><th>Exit</th><th>Result</th><th>Why</th></tr></thead><tbody>${shown.map(t => `
    <tr data-review="${t.id}" tabindex="0" role="button" aria-pressed="${t.id === sel}" class="${t.id === sel ? 'on' : ''}">
      <td>${day(t.session_date)}</td><td><strong>${h(t.symbol)}</strong> ${h(t.direction)}<span class="muted small"> · ${h(t.bot)} #${t.n}</span></td>
      <td>${px(t.entry)} <span class="muted small">${tm(t.entry_time)}</span></td>
      <td>${t.status === 'open' ? '<span class="tag hot">open</span>' : `${px(t.exit)} <span class="muted small">${tm(t.exit_time)}</span>`}</td>
      <td class="${tone(t.pnl)}">${t.status === 'open' ? '—' : `${usd(t.pnl)} <span class="small">${rr(t.r_multiple)}</span>`}</td>
      <td class="muted small">${h(EXIT[t.exit_reason] || t.exit_reason || 'still open')}</td></tr>`).join('')}</tbody></table></div>`;
  show(sel);
}

export function onClick(e) {
  const f = e.target.closest('[data-review-filter]');
  if (f) { filter = f.dataset.reviewFilter; sel = null; mount(); return true; }
  const row = e.target.closest('[data-review]');
  if (!row) return false;
  sel = +row.dataset.review;
  document.querySelectorAll('tr[data-review]').forEach(r => { const on = +r.dataset.review === sel; r.classList.toggle('on', on); r.setAttribute('aria-pressed', on); });
  show(sel);
  document.getElementById('reviewPlate')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
export function onKey(e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr[data-review]')) { e.preventDefault(); return onClick(e); }
  return false;
}

async function show(id) {
  const box = document.getElementById('reviewChart'), t = trades.find(x => x.id === id);
  if (!box || !t) return;
  const head = `<div class="spread" style="margin-bottom:6px"><h3>${h(t.symbol)} ${h(t.direction)} · ${day(t.session_date)}</h3>
    <span class="${tone(t.pnl)} num">${t.status === 'open' ? 'still open' : `${usd(t.pnl)} · ${rr(t.r_multiple)}`}</span></div>`;
  const facts = [['Entry', `${px(t.entry)} at ${tm(t.entry_time)}`], ['Stop', px(t.stop)], ['Target', px(t.target) + (t.target_label ? ` (${h(t.target_label)})` : '')],
    ['Exit', t.status === 'open' ? 'open' : `${px(t.exit)} at ${tm(t.exit_time)}`], ['Shares', t.qty ?? '—'], ['Why it closed', h(EXIT[t.exit_reason] || t.exit_reason || 'still open')]];
  const factsHtml = `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  if (!t.charts?.length) {
    box.innerHTML = head + `<p class="empty" style="margin:8px 0">The candles for this day haven't been saved yet. The bot downloads them after its next run on GitHub.</p>` + factsHtml;
    return;
  }
  box.innerHTML = head + '<div class="tchart" aria-busy="true"><p class="empty">Loading candles…</p></div>' + factsHtml;
  let all;
  try { all = (await Promise.all(t.charts.map(d => dayBars(t.symbol, d)))).flat(); }
  catch (e) { box.querySelector('.tchart').innerHTML = `<p class="empty">Couldn't load the candles from GitHub.</p>`; return; }
  if (sel !== id) return;
  const host = box.querySelector('.tchart');
  host.removeAttribute('aria-busy');
  if (!all.length) { host.innerHTML = '<p class="empty">No candles for this day (market holiday?).</p>'; return; }
  const multi = t.charts.length > 1;
  const list = multi ? squeeze(all, 5) : all;
  draw(host, t, list, multi);
  const mfe = moveStats(t, all);
  if (mfe) box.querySelector('.facts').insertAdjacentHTML('beforeend',
    `<div><dt>Best it got</dt><dd class="good">${rr(mfe.best)}</dd></div><div><dt>Worst it got</dt><dd class="bad">${rr(mfe.worst)}</dd></div>`);
  host._redraw = () => draw(host, t, list, multi);
}

// How far the trade went in your favor (and against you) while it was open, in R.
function moveStats(t, list) {
  const risk = Math.abs(t.entry - t.stop);
  if (!risk || t.stop == null) return null;
  const a = Date.parse(t.entry_time), b = t.exit_time ? Date.parse(t.exit_time) : Infinity;
  const held = list.filter(x => x.t >= a && x.t <= b);
  if (!held.length) return null;
  const s = t.direction === 'long' ? 1 : -1;
  const best = Math.max(...held.map(x => (s > 0 ? x.h - t.entry : t.entry - x.l))) / risk;
  const worst = Math.min(...held.map(x => (s > 0 ? x.l - t.entry : t.entry - x.h))) / risk;
  return { best, worst };
}

function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.appendChild(e); return e; }
function idxAt(list, iso) {
  if (!iso) return list.length - 1;
  const t = Date.parse(iso);
  let i = 0; while (i < list.length - 1 && list[i + 1].t <= t) i++;
  return i;
}

function draw(host, t, list, multi) {
  host.innerHTML = '';
  const W = Math.max(host.clientWidth, 300), H = W < 560 ? 280 : 340, P = { l: 6, r: 62, t: 14, b: 26 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${t.symbol} candles with entry at ${px(t.entry)} and exit at ${px(t.exit)}` }, host);
  const levels = [t.entry, t.exit, t.stop, t.target].filter(v => v != null);
  let lo = Math.min(...list.map(b => b.l), ...levels), hi = Math.max(...list.map(b => b.h), ...levels);
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const n = list.length, slot = (W - P.l - P.r) / n;
  const x = i => P.l + slot * (i + 0.5), y = v => P.t + (hi - v) / (hi - lo) * (H - P.t - P.b);
  const ie = idxAt(list, t.entry_time), ix = idxAt(list, t.exit_time);
  // candles saved mid-day stop before the exit: don't pin the exit to the last candle
  const cut = t.exit_time && Date.parse(t.exit_time) > list[n - 1].t + 120000;

  // price grid on the right
  const step = niceStep((hi - lo) / 5);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'tc-grid' }, svg);
    el('text', { x: W - P.r + 6, y: y(v) + 4, class: 'tc-axis' }, svg).textContent = v.toFixed(step < 1 ? 2 : 0);
  }
  // time labels: every 30 min on one day, each day's open on several
  let lastDay = null;
  list.forEach((b, i) => {
    const d = new Date(b.t), mm = +hm.formatToParts(d).find(p => p.type === 'minute').value;
    if (multi ? b.day !== lastDay : mm === 0 || (mm === 30 && W >= 560)) {
      if (multi && lastDay) el('line', { x1: x(i) - slot / 2, x2: x(i) - slot / 2, y1: P.t, y2: H - P.b, class: 'tc-day' }, svg);
      el('text', { x: Math.max(x(i), P.l + 14), y: H - 8, class: 'tc-axis', 'text-anchor': 'middle' }, svg).textContent = multi ? day(b.day) : hm.format(d).replace(/ [AP]M/, '');
      lastDay = b.day;
    }
  });
  // opening range on the entry day
  if (t.or_high != null && t.or_low != null) {
    const days = list.map(b => b.day), first = days.indexOf(t.session_date), last = days.lastIndexOf(t.session_date);
    if (first >= 0) {
      el('rect', { x: x(first) - slot / 2, y: y(t.or_high), width: (last - first + 1) * slot, height: Math.max(y(t.or_low) - y(t.or_high), 1), class: 'tc-range' }, svg);
      el('text', { x: x(first) + 4, y: y(t.or_high) - 4, class: 'tc-label tc-range-l' }, svg).textContent = 'Opening range';
    }
  }
  // time in the trade
  el('rect', { x: x(ie) - slot / 2, y: P.t, width: (ix - ie + 1) * slot, height: H - P.t - P.b, class: 'tc-held' }, svg);
  // candles
  const wick = Math.max(1, Math.min(1.4, slot * 0.3)), body = Math.max(1, slot * 0.68);
  list.forEach((b, i) => {
    const cls = b.c >= b.o ? 'tc-up' : 'tc-dn';
    el('line', { x1: x(i), x2: x(i), y1: y(b.h), y2: y(b.l), class: cls, 'stroke-width': wick }, svg);
    el('rect', { x: x(i) - body / 2, y: y(Math.max(b.o, b.c)), width: body, height: Math.max(Math.abs(y(b.o) - y(b.c)), 1), class: cls + ' fill' }, svg);
  });
  // stop / target / entry lines across the time in the trade, labelled on the right
  const lines = [[t.target, 'tc-target', 'Target'], [t.stop, 'tc-stop', 'Stop'], [t.entry, 'tc-entry', 'Entry']].filter(l => l[0] != null);
  const tags = [];
  for (const [v, cls, name] of lines) {
    el('line', { x1: x(ie) - slot / 2, x2: W - P.r, y1: y(v), y2: y(v), class: cls }, svg);
    tags.push([y(v), cls, `${name} ${px(v)}`]);
  }
  tags.sort((a, b) => a[0] - b[0]).forEach((tg, i, a) => { if (i && tg[0] - a[i - 1][0] < 14) tg[0] = a[i - 1][0] + 14; });
  tags.forEach(([yy, cls, txt]) => el('text', { x: W - P.r - 4, y: yy - 4, class: `tc-label ${cls}`, 'text-anchor': 'end' }, svg).textContent = txt);
  // entry + exit markers
  const up = t.direction === 'long', ex = x(ie), ey = y(t.entry), s = 7;
  el('path', { d: up ? `M${ex},${ey + 3} l${-s},${s * 1.6} h${s * 2}z` : `M${ex},${ey - 3} l${-s},${-s * 1.6} h${s * 2}z`, class: 'tc-mark-in' }, svg);
  if (t.exit != null && !cut) {
    el('circle', { cx: x(ix), cy: y(t.exit), r: 5.5, class: t.pnl >= 0 ? 'tc-mark-win' : 'tc-mark-loss' }, svg);
    el('line', { x1: ex, y1: ey, x2: x(ix), y2: y(t.exit), class: 'tc-path' }, svg);
  }

  // hover / touch readout
  const cross = el('line', { y1: P.t, y2: H - P.b, class: 'tc-cross', opacity: 0 }, svg);
  const tip = document.createElement('div'); tip.className = 'tc-tip'; tip.hidden = true; host.appendChild(tip);
  const hit = el('rect', { x: P.l, y: 0, width: W - P.l - P.r, height: H, fill: 'transparent' }, svg);
  const move = e => {
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(n - 1, Math.floor((sx - P.l) / slot))), b = list[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
    tip.innerHTML = `<b>${multi ? day(b.day) + ' ' : ''}${hm.format(new Date(b.t))}</b> O ${px(b.o)} H ${px(b.h)} L ${px(b.l)} C ${px(b.c)}`
      + (i === ie ? `<br><span class="hot">Entry ${px(t.entry)}</span>` : '') + (i === ix && t.exit != null ? `<br>Exit ${px(t.exit)}` : '');
    tip.hidden = false;
    const left = x(i) * r.width / W;
    tip.style.left = Math.min(Math.max(left - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + 'px';
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.hidden = true; });

  const legend = document.createElement('div'); legend.className = 'tc-legend small muted';
  legend.innerHTML = (cut ? `<span class="hot" style="flex-basis:100%">These candles stop at ${hm.format(new Date(list[n - 1].t))}, before the exit at ${tm(t.exit_time)}. The rest downloads on the bot's next run.</span>` : '')
    + `<span><i class="k-in"></i>Entry</span><span><i class="k-out"></i>Exit</span><span><i class="k-stop"></i>Stop</span><span><i class="k-target"></i>Target</span><span><i class="k-range"></i>Opening range</span><span>${multi ? '5-min candles' : '1-min candles'} · ET</span>`;
  host.appendChild(legend);
}
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
}

let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => document.querySelector('.tchart')?._redraw?.(), 150); });
