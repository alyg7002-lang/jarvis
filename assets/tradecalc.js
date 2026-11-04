// Trade math for the Trades page. No browser code here, so tests/tradecalc.test.mjs can run it.

// A trade the bot failed to close on time keeps its real result, but `useRules` swaps in what the
// rule (flat at 15:55 that day) would have paid, so a lucky weekend hold can't flatter a bot.
export const pnlOf = (t, useRules) => (useRules && t.rules ? t.rules.pnl : t.pnl);
export const rOf = (t, useRules) => (useRules && t.rules ? t.rules.r : t.r_multiple);

export function rollup(trades, useRules = false) {
  const c = trades.filter(t => t.status === 'closed');
  const pnls = c.map(t => pnlOf(t, useRules) || 0);
  const wins = pnls.filter(p => p > 0), losses = pnls.filter(p => p < 0);
  const gw = wins.reduce((a, p) => a + p, 0), gl = -losses.reduce((a, p) => a + p, 0);
  let run = 0, peak = 0, maxDD = 0;
  for (const p of pnls) { run += p; peak = Math.max(peak, run); maxDD = Math.max(maxDD, peak - run); }
  return {
    n: c.length, open: trades.length - c.length, wins: wins.length, losses: losses.length,
    winRate: c.length ? wins.length / c.length : 0, pnl: run,
    avgR: c.length ? c.reduce((a, t) => a + (rOf(t, useRules) || 0), 0) / c.length : 0,
    pf: gl ? gw / gl : (gw ? Infinity : 0), maxDD,
  };
}

export function groupBy(trades, key, useRules = false) {
  const groups = new Map();
  for (const t of trades) { const k = key(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  return [...groups.entries()].map(([k, list]) => ({ key: k, ...rollup(list, useRules) })).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

const sideOf = t => (t.direction === 'long' ? 1 : -1);

// How far price went for and against the trade while it was open, and what it did after the exit that day.
export function moves(t, bars) {
  const risk = t.stop == null ? 0 : Math.abs(t.entry - t.stop);
  if (!risk || !bars.length) return null;
  const s = sideOf(t), a = Date.parse(t.entry_time), b = t.exit_time ? Date.parse(t.exit_time) : Infinity;
  const held = bars.filter(x => x.t >= a && x.t <= b);
  if (!held.length) return null;
  const up = x => (s > 0 ? x.h - t.entry : t.entry - x.l) / risk, down = x => (s > 0 ? x.l - t.entry : t.entry - x.h) / risk;
  const bestBar = held.reduce((m, x) => (up(x) > up(m) ? x : m)), worstBar = held.reduce((m, x) => (down(x) < down(m) ? x : m));
  const out = { best: up(bestBar), bestAt: bestBar.t, worst: down(worstBar), worstAt: worstBar.t };
  const exitDay = t.exit_time ? held[held.length - 1].day : null;
  const after = bars.filter(x => x.t > b && x.day === exitDay);
  if (after.length) { out.afterBest = Math.max(...after.map(up)); out.afterWorst = Math.min(...after.map(down)); }
  return out;
}

// Replays one trade's entry day with a different stop and target. Same conservative rules as the
// backtests: stop checked before target inside a candle, flat at 15:55. Returns R in the new risk.
export function whatIf(t, dayBars, stopMult = 1, targetR = null) {
  const base = t.stop == null ? 0 : Math.abs(t.entry - t.stop);
  if (!base) return null;
  const s = sideOf(t), risk = base * stopMult, a = Date.parse(t.entry_time);
  const bars = dayBars.filter(x => x.t > a);
  if (!bars.length) return null;
  const stop = t.entry - s * risk, target = targetR == null ? null : t.entry + s * risk * targetR;
  for (const b of bars) {
    if (b.clock >= '15:55') return s * (b.o - t.entry) / risk;
    if (s > 0 ? b.l <= stop : b.h >= stop) return s * ((s > 0 ? Math.min(b.o, stop) : Math.max(b.o, stop)) - t.entry) / risk;
    if (target != null && (s > 0 ? b.h >= target : b.l <= target)) return s * ((s > 0 ? Math.max(b.o, target) : Math.min(b.o, target)) - t.entry) / risk;
  }
  return s * (bars[bars.length - 1].c - t.entry) / risk;
}

export function holdText(fromIso, toIso) {
  if (!toIso) return 'still open';
  const mins = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000);
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}
