import test from 'node:test';
import assert from 'node:assert/strict';
import { rollup, moves, whatIf, holdText, groupBy } from '../assets/tradecalc.js';

const bar = (clock, o, h, l, c) => ({ t: Date.parse(`2026-11-03T${clock}:00-05:00`), clock, o, h, l, c, day: '2026-11-03' });
const long = { status: 'closed', direction: 'long', entry: 100, stop: 98, target: 103, entry_time: '2026-11-03T10:00:00-05:00', exit_time: '2026-11-03T10:03:00-05:00', exit: 103, pnl: 30, r_multiple: 1.5 };

test('rollup counts wins, losses, profit factor and drawdown', () => {
  const r = rollup([{ ...long, pnl: 100, r_multiple: 1 }, { ...long, pnl: -50, r_multiple: -1 }, { ...long, pnl: -25, r_multiple: -0.5 }, { ...long, status: 'open', pnl: null }]);
  assert.equal(r.n, 3); assert.equal(r.open, 1); assert.equal(r.wins, 1); assert.equal(r.losses, 2);
  assert.equal(r.pnl, 25); assert.equal(r.pf, 100 / 75); assert.equal(r.maxDD, 75);
  assert.ok(Math.abs(r.avgR - (-0.5 / 3)) < 1e-9);
});

test('useRules swaps in the by-the-rules result for late closes only', () => {
  const late = { ...long, pnl: 300, r_multiple: 2, rules: { pnl: -100, r: -0.5 } };
  assert.equal(rollup([late, long]).pnl, 330);
  assert.equal(rollup([late, long], true).pnl, -70);
  assert.equal(rollup([late, long], true).avgR, 0.5);
});

test('groupBy splits by key', () => {
  const g = groupBy([{ ...long, symbol: 'SPY' }, { ...long, symbol: 'QQQ' }, { ...long, symbol: 'SPY' }], t => t.symbol);
  assert.deepEqual(g.map(x => [x.key, x.n]), [['QQQ', 1], ['SPY', 2]]);
});

test('moves measures best and worst while held, and what happened after the exit', () => {
  const bars = [bar('09:59', 99, 110, 90, 100), bar('10:00', 100, 101, 99, 100), bar('10:01', 100, 104, 99.5, 103), bar('10:03', 103, 103.5, 102, 103), bar('10:10', 103, 108, 102, 107)];
  const m = moves(long, bars);
  assert.equal(m.best, 2); assert.equal(m.worst, -0.5); assert.equal(m.afterBest, 4);
});

test('whatIf: stop is checked before target in the same candle', () => {
  const bars = [bar('10:01', 100, 106, 97, 100)];
  assert.equal(whatIf(long, bars, 1, 1.5), -1);
});

test('whatIf: target hit, tighter stop, and the 15:55 flat', () => {
  const up = [bar('10:01', 100, 103.5, 99, 103)];
  assert.equal(whatIf(long, up, 1, 1.5), 1.5);
  assert.equal(whatIf(long, [bar('10:01', 100, 100.5, 98.9, 99)], 0.5, 2), -1);       // 1-point stop gets hit, full stop wouldn't
  assert.equal(whatIf(long, [bar('10:01', 100, 100.5, 98.9, 99), bar('15:55', 101, 101, 101, 101)], 1, null), 0.5);
});

test('whatIf: a gap through the stop fills at the open, worse than the stop', () => {
  assert.equal(whatIf(long, [bar('10:01', 96, 97, 95, 96)], 1, 2), -2);
});

test('whatIf skips trades without a stop', () => {
  assert.equal(whatIf({ ...long, stop: null }, [bar('10:01', 100, 101, 99, 100)]), null);
});

test('holdText', () => {
  assert.equal(holdText('2026-11-03T10:00:00-05:00', '2026-11-03T10:30:00-05:00'), '30m');
  assert.equal(holdText('2026-11-03T10:00:00-05:00', '2026-11-03T11:15:00-05:00'), '1h 15m');
  assert.equal(holdText('2026-11-03T10:00:00-05:00', null), 'still open');
});
