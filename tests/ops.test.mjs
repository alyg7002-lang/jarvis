import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as J from '../shared/ops.js';

const at = iso => new Date(iso);
const run = (s, op, args, when = '2026-10-21T16:00:00Z') => J.applyOp(s, op, args, at(when));

test('dates are Eastern time', () => {
  assert.equal(J.localDate(at('2026-10-22T03:30:00Z')), '2026-10-21'); // 11:30 PM ET
  assert.equal(J.localTime(at('2026-10-21T17:07:00Z')), '13:07');
  assert.equal(J.mondayOf('2026-10-21'), '2026-10-19');
  assert.equal(J.mondayOf('2026-10-25'), '2026-10-19');
  assert.equal(J.dayDiff('2026-10-21', '2026-10-23'), 2);
  assert.equal(J.isoWeek('2026-10-21'), '2026-W43');
});

test('memory save dedupes and forget removes', () => {
  let { state } = run(null, 'memory_save', { fact: 'Uncle lives in Texas' });
  ({ state } = run(state, 'memory_save', { fact: 'uncle lives in texas' }));
  assert.equal(state.facts.length, 1);
  const r = run(state, 'memory_forget', { match: 'texas' });
  assert.equal(r.result.removed, 1);
});

test('backlog flow: add, next, done writes devlog', () => {
  let { state } = run(null, 'backlog_add', { task: 'Add weather tool', minutes: 25 });
  ({ state } = run(state, 'backlog_add', { task: 'Wake word' }));
  assert.equal(J.nextTask(state).task, 'Add weather tool');
  const r = run(state, 'backlog_done', { note: 'works' });
  assert.equal(r.result.next, 'Wake word');
  assert.equal(r.state.devlog.length, 1);
});

test('daily action set then checked next day; study streak', () => {
  let { state } = run(null, 'action_set', { text: 'Phone on charger by midnight' }, '2026-10-21T12:00:00Z');
  ({ state } = run(state, 'action_check', { done: true }, '2026-10-22T12:00:00Z'));
  assert.equal(state.actions['2026-10-21'].done, true);
  ({ state } = run(state, 'study_done', {}, '2026-10-20T12:00:00Z'));
  ({ state } = run(state, 'study_done', {}, '2026-10-21T12:00:00Z'));
  assert.equal(J.studyStreak(state, '2026-10-21'), 2);
  assert.equal(J.studyStreak(state, '2026-10-22'), 2); // not done yet today still counts yesterday
  assert.equal(J.studyStreak(state, '2026-10-24'), 0);
});

test('flashcards follow Leitner boxes', () => {
  let { state, result } = run(null, 'flash_add', { deck: 'Spanish', front: 'el martillo', back: 'the hammer' });
  assert.equal(J.dueCards(state, '2026-10-21').length, 1);
  ({ state } = run(state, 'flash_grade', { id: result.id, correct: true }));
  assert.equal(state.cards[0].due, '2026-10-22');
  ({ state } = run(state, 'flash_grade', { id: result.id, correct: false }));
  assert.equal(state.cards[0].box, 0);
  assert.equal(J.dueCards(state, '2026-10-21').length, 1);
});

test('risk math for MES and stock', () => {
  const r = J.riskCalc({ symbol: 'MES', entry: 5800, stop: 5794, risk: 100 });
  assert.equal(r.size, 3); // 6 pts * $5 = $30 per contract
  assert.equal(r.actualRisk, 90);
  assert.equal(r.target15R, 5809);
  const s = J.riskCalc({ symbol: 'STOCK', entry: 100, stop: 99.5, risk: 50 });
  assert.equal(s.size, 100);
  assert.equal(J.riskCalc({ symbol: 'MES', entry: 5800, stop: 5700, risk: 100 }).tooBig, true);
});

test('trade log computes R and stats', () => {
  let { state } = run(null, 'trade_add', { symbol: 'mes', side: 'long', entry: 5800, stop: 5794, exit: 5809 });
  ({ state } = run(state, 'trade_add', { side: 'short', entry: 5800, stop: 5806, exit: 5806 }));
  assert.equal(state.trades[0].r, 1.5);
  assert.equal(state.trades[1].r, -1);
  const st = J.tradeStats(state);
  assert.equal(st.winRate, 50);
  assert.equal(st.avgR, 0.25);
});

test('weekly review and share text', () => {
  let { state } = run(null, 'phone_week', { total: 40, instagram: 20, snapchat: 5 });
  ({ state } = run(state, 'laptop_report', { apps: { instagram: 45, youtube: 15 }, late: 10 }));
  ({ state } = run(state, 'usage_add', { inTok: 1000, outTok: 100, cost: 0.002 }));
  const r = J.weeklyReview(state, '2026-10-21');
  assert.equal(r.phone.total, 40);
  assert.equal(r.laptopDistractMin, 60);
  assert.match(J.shareText(r), /Phone: 40 h/);
  assert.equal(J.usageTotals(state, '2026-10-21').today.calls, 1);
});

test('misses count repeats', () => {
  let { state } = run(null, 'miss_log', { request: 'Play music on Spotify' });
  ({ state } = run(state, 'miss_log', { request: 'play music on spotify!' }));
  assert.equal(state.misses.length, 1);
  assert.equal(state.misses[0].count, 2);
});

test('settings validate', () => {
  const { state } = run(null, 'settings_update', { wake: '07:30', dailyBudget: '1', bedtime: 'late' });
  assert.equal(state.settings.wake, '07:30');
  assert.equal(state.settings.dailyBudget, 1);
  assert.equal(state.settings.bedtime, '00:30');
});

test('usage_add is not a client op', () => {
  assert.ok(!J.CLIENT_OPS.includes('usage_add'));
  assert.throws(() => run(null, 'nope', {}));
});

test('free brief reads naturally', () => {
  let { state } = run(null, 'action_set', { text: 'Text your dad' }, '2026-10-20T12:00:00Z');
  const t = J.briefText({
    now: at('2026-10-21T11:00:00Z'), state,
    classes: [{ course: 'MATLAB', start: '09:35' }],
    due: [{ item: 'Lab 4', due: '2026-10-23T23:59:59-04:00' }],
    weather: { temp: 61.4, high: 74, desc: 'clear' },
    study: { story: 'David and Goliath', reference: '1 Samuel 17' },
  });
  assert.match(t, /^Good morning, sir\./);
  assert.match(t, /MATLAB at 9:35 AM/);
  assert.match(t, /Lab 4, on Fri at 11:59 PM/);
  assert.match(t, /Text your dad/);
});
