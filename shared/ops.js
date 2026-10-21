// Jarvis shared state logic.
//
// This one file runs in two places:
//   - the browser (when Jarvis runs without the backend, it saves to this device)
//   - the Cloudflare Worker (the backend saves to its KV database)
// Every change to Jarvis's memory goes through applyOp(), so both sides behave
// exactly the same. Pure functions only: no network, no storage, no clock
// except the `now` you pass in.

export const TZ = 'America/New_York';

// ---------- dates (always in Eastern time) ----------
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const wdFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });

export const localDate = (now = new Date()) => dateFmt.format(now);              // 2026-10-21
export const localTime = (now = new Date()) => timeFmt.format(now).replace(/^24/, '00'); // 13:07
export const weekday = (now = new Date()) => wdFmt.format(now);                  // Wed

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function dayDiff(a, b) { // b - a in days
  const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}
export function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun
  return addDays(iso, -((dow + 6) % 7));
}
export function isoWeek(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

// ---------- state ----------
export function emptyState() {
  return {
    v: 1,
    facts: [],        // things Jarvis remembers about you
    backlog: [],      // build-mode tasks
    devlog: [],       // dated build notes
    debriefs: [],     // nightly 2-minute debriefs
    actions: {},      // date -> today's Bible study action + follow-through
    study: {},        // date -> true when the study was done
    prayers: [],
    cards: [],        // flashcards (spaced repetition)
    phoneWeeks: [],   // weekly phone screen time you report
    laptop: {},       // date -> minutes per distracting app (from the laptop watcher)
    trades: [],       // your own demo-trade log
    misses: [],       // things you asked that Jarvis couldn't do
    verseChecks: {},  // week -> recall result
    usage: {},        // date -> API calls, tokens, cost
    settings: { ...DEFAULT_SETTINGS },
  };
}

export const DEFAULT_SETTINGS = {
  wake: '08:00',          // anchor wake-up time
  windDown: '23:30',      // phone on the charger across the room
  bedtime: '00:30',       // after this, distractions get called out fast
  dailyBudget: 0.5,       // USD per day the brain may spend
  monthlyBudget: 5,       // USD per month
  phoneGoalHours: 56,     // weekly phone screen-time goal (8 h/day)
  distractLimitMin: 30,   // laptop: continuous minutes before a nudge
  accountabilityName: '', // who gets the Sunday summary
};

export function normalize(s) {
  const base = emptyState();
  if (!s || typeof s !== 'object') return base;
  for (const k of Object.keys(base)) if (s[k] === undefined) s[k] = base[k];
  s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  return s;
}

const rid = () => Math.random().toString(36).slice(2, 8);
const clip = (s, n = 400) => String(s ?? '').trim().slice(0, n);
const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
const cap = (arr, n) => { if (arr.length > n) arr.splice(0, arr.length - n); };

// Flashcard intervals in days by Leitner box.
export const BOX_DAYS = [0, 1, 2, 4, 8, 16, 32];

// ---------- operations ----------
// Each op: (state, args, ctx) -> result (any JSON). ctx = { now, today }.
export const OPS = {
  memory_save(s, a, c) {
    const text = clip(a.fact || a.text, 300);
    if (!text) throw new Error('fact is empty');
    const dup = s.facts.find(f => f.text.toLowerCase() === text.toLowerCase());
    if (dup) return { saved: false, note: 'already remembered', id: dup.id };
    const f = { id: rid(), text, at: c.today };
    s.facts.push(f); cap(s.facts, 80);
    return { saved: true, id: f.id };
  },
  memory_forget(s, a) {
    const m = clip(a.match || a.id, 120).toLowerCase();
    if (!m) throw new Error('say what to forget');
    const before = s.facts.length;
    s.facts = s.facts.filter(f => f.id !== m && !f.text.toLowerCase().includes(m));
    return { removed: before - s.facts.length };
  },

  backlog_add(s, a, c) {
    const task = clip(a.task, 200);
    if (!task) throw new Error('task is empty');
    const t = { id: rid(), task, minutes: Math.min(120, Math.max(10, num(a.minutes, 25))), project: clip(a.project || 'Jarvis', 40), added: c.today, done: null };
    s.backlog.push(t); cap(s.backlog, 200);
    return t;
  },
  backlog_done(s, a, c) {
    const t = findTask(s, a);
    if (!t) throw new Error('no matching task');
    t.done = c.today;
    if (a.note) OPS.devlog_add(s, { text: `${t.task}: ${a.note}` }, c);
    return { done: t.task, next: nextTask(s)?.task || null };
  },
  backlog_remove(s, a) {
    const t = findTask(s, a);
    if (!t) throw new Error('no matching task');
    s.backlog = s.backlog.filter(x => x !== t);
    return { removed: t.task };
  },
  backlog_reorder(s, a) {
    const t = findTask(s, a);
    if (!t) throw new Error('no matching task');
    s.backlog = s.backlog.filter(x => x !== t);
    s.backlog.unshift(t);
    return { first: t.task };
  },

  devlog_add(s, a, c) {
    const text = clip(a.text, 600);
    if (!text) throw new Error('entry is empty');
    const e = { id: rid(), date: c.today, text };
    s.devlog.push(e); cap(s.devlog, 300);
    return e;
  },

  debrief(s, a, c) {
    const d = { date: a.date || c.today, done: clip(a.done, 400), missed: clip(a.missed, 400), tomorrow: clip(a.tomorrow, 200) };
    s.debriefs = s.debriefs.filter(x => x.date !== d.date);
    s.debriefs.push(d); cap(s.debriefs, 120);
    return d;
  },

  action_set(s, a, c) {
    const date = a.date || c.today;
    const text = clip(a.text, 200);
    if (!text) throw new Error('action is empty');
    s.actions[date] = { text, done: null, note: '' };
    pruneMap(s.actions, 90);
    return { date, text };
  },
  action_check(s, a, c) {
    const date = a.date || addDays(c.today, -1);
    const act = s.actions[date];
    if (!act) throw new Error(`no action was set for ${date}`);
    act.done = !!a.done; act.note = clip(a.note, 200);
    return { date, ...act };
  },
  study_done(s, a, c) {
    const date = a.date || c.today;
    s.study[date] = true; pruneMap(s.study, 400);
    return { date, streak: studyStreak(s, c.today) };
  },

  prayer_add(s, a, c) {
    const text = clip(a.text, 200);
    if (!text) throw new Error('prayer is empty');
    const p = { id: rid(), text, added: c.today, followUp: a.followUp || null, answer: null, answeredAt: null };
    s.prayers.push(p); cap(s.prayers, 100);
    return p;
  },
  prayer_answer(s, a, c) {
    const p = s.prayers.find(x => x.id === a.id) || s.prayers.find(x => a.match && x.text.toLowerCase().includes(String(a.match).toLowerCase()));
    if (!p) throw new Error('no matching prayer');
    p.answer = clip(a.note || 'answered', 300); p.answeredAt = c.today;
    return p;
  },
  prayer_remove(s, a) {
    const before = s.prayers.length;
    s.prayers = s.prayers.filter(x => x.id !== a.id);
    return { removed: before - s.prayers.length };
  },

  verse_check(s, a, c) {
    const wk = isoWeek(c.today);
    s.verseChecks[wk] = { ok: !!a.ok, at: c.today };
    return { week: wk, ok: !!a.ok };
  },

  flash_add(s, a, c) {
    const front = clip(a.front, 200), back = clip(a.back, 300);
    if (!front || !back) throw new Error('a card needs a front and a back');
    const card = { id: rid(), deck: clip(a.deck || 'General', 40), front, back, box: 0, due: c.today, seen: 0, missed: 0 };
    s.cards.push(card); cap(s.cards, 600);
    return card;
  },
  flash_grade(s, a, c) {
    const card = s.cards.find(x => x.id === a.id);
    if (!card) throw new Error('no such card');
    card.seen++;
    if (a.correct) card.box = Math.min(BOX_DAYS.length - 1, card.box + 1);
    else { card.box = 0; card.missed++; }
    card.due = addDays(c.today, Math.max(a.correct ? 1 : 0, BOX_DAYS[card.box]));
    return { id: card.id, box: card.box, due: card.due };
  },
  flash_remove(s, a) {
    const before = s.cards.length;
    s.cards = s.cards.filter(x => x.id !== a.id);
    return { removed: before - s.cards.length };
  },

  phone_week(s, a, c) {
    const week = mondayOf(a.week || c.today);
    const w = { week, total: num(a.total), instagram: num(a.instagram), snapchat: num(a.snapchat) };
    if (w.total <= 0) throw new Error('total hours must be above 0');
    s.phoneWeeks = s.phoneWeeks.filter(x => x.week !== week);
    s.phoneWeeks.push(w);
    s.phoneWeeks.sort((x, y) => x.week.localeCompare(y.week)); cap(s.phoneWeeks, 104);
    return w;
  },
  // Sent by the laptop watcher every few minutes: absolute totals for the day.
  laptop_report(s, a, c) {
    const date = a.date || c.today;
    const apps = {};
    for (const [k, v] of Object.entries(a.apps || {})) apps[clip(k, 30)] = Math.max(0, Math.round(num(v)));
    s.laptop[date] = { apps, late: Math.max(0, Math.round(num(a.late))), updated: c.now.toISOString() };
    pruneMap(s.laptop, 120);
    return { date, total: sum(Object.values(apps)) };
  },

  trade_add(s, a, c) {
    const t = {
      id: rid(), date: a.date || c.today, symbol: clip(a.symbol || 'MES', 12).toUpperCase(), side: /^s/i.test(a.side) ? 'short' : 'long',
      entry: num(a.entry), stop: num(a.stop), exit: num(a.exit), contracts: num(a.contracts, 1), setup: clip(a.setup || 'ORB retest', 60), notes: clip(a.notes, 300),
    };
    if (!t.entry || !t.stop) throw new Error('entry and stop are required');
    const risk = Math.abs(t.entry - t.stop);
    if (!risk) throw new Error('stop cannot equal entry');
    t.r = t.exit ? +(((t.side === 'long' ? t.exit - t.entry : t.entry - t.exit) / risk).toFixed(2)) : null;
    s.trades.push(t); cap(s.trades, 500);
    return t;
  },
  trade_remove(s, a) {
    const before = s.trades.length;
    s.trades = s.trades.filter(x => x.id !== a.id);
    return { removed: before - s.trades.length };
  },

  miss_log(s, a, c) {
    const text = clip(a.request || a.text, 200);
    if (!text) throw new Error('empty');
    const key = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 60);
    const m = s.misses.find(x => x.key === key);
    if (m) { m.count++; m.last = c.today; return m; }
    const n = { id: rid(), key, text, count: 1, first: c.today, last: c.today, built: false };
    s.misses.push(n); cap(s.misses, 100);
    return n;
  },
  miss_built(s, a) {
    const m = s.misses.find(x => x.id === a.id);
    if (!m) throw new Error('no such item');
    m.built = true;
    return m;
  },

  settings_update(s, a) {
    const out = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (a[k] === undefined) continue;
      const def = DEFAULT_SETTINGS[k];
      if (typeof def === 'number') { const v = num(a[k], def); if (v >= 0) out[k] = v; }
      else if (/^(wake|windDown|bedtime)$/.test(k)) { if (/^\d{2}:\d{2}$/.test(a[k])) out[k] = a[k]; }
      else out[k] = clip(a[k], 60);
    }
    Object.assign(s.settings, out);
    return s.settings;
  },

  // Recorded by the backend after each brain call.
  usage_add(s, a, c) {
    const d = s.usage[c.today] || (s.usage[c.today] = { calls: 0, inTok: 0, outTok: 0, cost: 0 });
    d.calls += 1; d.inTok += num(a.inTok); d.outTok += num(a.outTok); d.cost = +(d.cost + num(a.cost)).toFixed(6);
    pruneMap(s.usage, 120);
    return d;
  },
};

// Ops the browser and the laptop watcher are allowed to call directly.
// usage_add is backend-only so the cost meter can't be faked.
export const CLIENT_OPS = Object.keys(OPS).filter(k => k !== 'usage_add');

export function applyOp(state, name, args = {}, now = new Date()) {
  const fn = OPS[name];
  if (!fn) throw new Error(`unknown op ${name}`);
  const s = normalize(state);
  const result = fn(s, args || {}, { now, today: localDate(now) });
  return { state: s, result };
}

function findTask(s, a) {
  const open = s.backlog.filter(t => !t.done);
  if (a.id) return s.backlog.find(t => t.id === a.id);
  if (a.match) { const m = String(a.match).toLowerCase(); return open.find(t => t.task.toLowerCase().includes(m)); }
  return open[0];
}
function pruneMap(map, keep) {
  const keys = Object.keys(map).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) delete map[k];
}
const sum = a => a.reduce((x, y) => x + y, 0);

// ---------- selectors (read-only views of the state) ----------
export const nextTask = s => s.backlog.find(t => !t.done) || null;
export const openTasks = s => s.backlog.filter(t => !t.done);
export const dueCards = (s, today, deck) => s.cards.filter(c => c.due <= today && (!deck || c.deck.toLowerCase() === String(deck).toLowerCase()));

export function studyStreak(s, today) {
  let d = s.study[today] ? today : addDays(today, -1), n = 0;
  while (s.study[d]) { n++; d = addDays(d, -1); }
  return n;
}

export function usageTotals(s, today) {
  const t = s.usage[today] || { calls: 0, cost: 0, inTok: 0, outTok: 0 };
  const month = today.slice(0, 7);
  const m = Object.entries(s.usage).filter(([k]) => k.startsWith(month)).reduce((a, [, v]) => ({ calls: a.calls + v.calls, cost: a.cost + v.cost }), { calls: 0, cost: 0 });
  return { today: { calls: t.calls, cost: +t.cost.toFixed(4) }, month: { calls: m.calls, cost: +m.cost.toFixed(4) }, dailyBudget: s.settings.dailyBudget, monthlyBudget: s.settings.monthlyBudget };
}

export function laptopToday(s, today) {
  const d = s.laptop[today];
  if (!d) return { total: 0, apps: {}, late: 0, updated: null };
  return { total: sum(Object.values(d.apps)), apps: d.apps, late: d.late, updated: d.updated };
}

// One week (Mon-Sun containing `today`, or the previous full week).
export function weeklyReview(s, today, { previous = false } = {}) {
  const start = previous ? addDays(mondayOf(today), -7) : mondayOf(today);
  const end = addDays(start, 6);
  const inWk = d => d >= start && d <= end;
  const actions = Object.entries(s.actions).filter(([d]) => inWk(d)).map(([, v]) => v);
  const laptopMin = Object.entries(s.laptop).filter(([d]) => inWk(d)).reduce((a, [, v]) => a + sum(Object.values(v.apps)), 0);
  const lateMin = Object.entries(s.laptop).filter(([d]) => inWk(d)).reduce((a, [, v]) => a + (v.late || 0), 0);
  const phone = s.phoneWeeks.find(w => w.week === start) || null;
  const cost = Object.entries(s.usage).filter(([d]) => inWk(d)).reduce((a, [, v]) => a + v.cost, 0);
  const tradesWk = s.trades.filter(t => inWk(t.date));
  return {
    start, end,
    buildsDone: s.backlog.filter(t => t.done && inWk(t.done)).length,
    devlog: s.devlog.filter(e => inWk(e.date)).length,
    studyDays: Object.keys(s.study).filter(inWk).length,
    actionsSet: actions.length,
    actionsKept: actions.filter(a => a.done === true).length,
    debriefs: s.debriefs.filter(d => inWk(d.date)).length,
    laptopDistractMin: laptopMin,
    lateNightMin: lateMin,
    phone,
    phoneGoal: s.settings.phoneGoalHours,
    trades: tradesWk.length,
    tradesTotal: s.trades.length,
    cardsReviewed: null,
    cost: +cost.toFixed(4),
  };
}

export function shareText(r) {
  const lines = [
    `Jarvis weekly check-in (${r.start} to ${r.end})`,
    `Build tasks finished: ${r.buildsDone}`,
    `Bible study days: ${r.studyDays}/7, daily actions kept: ${r.actionsKept}/${r.actionsSet}`,
    r.phone ? `Phone: ${r.phone.total} h (goal ${r.phoneGoal} h), Instagram ${r.phone.instagram} h` : 'Phone: not logged yet',
    `Laptop distraction: ${Math.round(r.laptopDistractMin / 6) / 10} h, late-night ${r.lateNightMin} min`,
    `Demo trades logged: ${r.tradesTotal} total`,
  ];
  return lines.join('\n');
}

// Trading risk math. Point values per 1.00 move, per contract.
export const POINT_VALUE = { MES: 5, ES: 50, MNQ: 2, NQ: 20, M2K: 5, MGC: 10, MCL: 100, STOCK: 1 };
export function riskCalc({ symbol = 'MES', entry, stop, risk = 100, accountSize = 0, riskPct = 0 }) {
  const sym = String(symbol).toUpperCase();
  const pv = POINT_VALUE[sym] ?? 1;
  const dist = Math.abs(num(entry) - num(stop));
  if (!dist) return { error: 'entry and stop must differ' };
  const dollarRisk = riskPct && accountSize ? accountSize * riskPct / 100 : num(risk, 100);
  const perUnit = dist * pv;
  const size = Math.floor(dollarRisk / perUnit);
  const long = num(entry) > num(stop);
  const target = r => +(num(entry) + (long ? 1 : -1) * dist * r).toFixed(2);
  return { symbol: sym, pointValue: pv, stopDistance: +dist.toFixed(4), riskPerUnit: +perUnit.toFixed(2), dollarRisk: +dollarRisk.toFixed(2), size, actualRisk: +(size * perUnit).toFixed(2), unit: sym === 'STOCK' ? 'shares' : 'contracts', target1R: target(1), target15R: target(1.5), target2R: target(2), tooBig: size === 0 };
}

export function tradeStats(s) {
  const closed = s.trades.filter(t => t.r !== null);
  const wins = closed.filter(t => t.r > 0).length;
  const avgR = closed.length ? closed.reduce((a, t) => a + t.r, 0) / closed.length : 0;
  return { logged: s.trades.length, closed: closed.length, wins, losses: closed.length - wins, winRate: closed.length ? Math.round(100 * wins / closed.length) : null, avgR: +avgR.toFixed(2), goal: 30, stretch: 50 };
}

// ---------- the free morning brief (no API call) ----------
export function briefText({ now = new Date(), classes = [], due = [], weather = null, study = null, state }) {
  const s = normalize(state);
  const today = localDate(now);
  const hour = +localTime(now).slice(0, 2);
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const parts = [`${greet}, sir.`];
  if (weather) parts.push(`It's ${Math.round(weather.temp)} degrees${weather.desc ? ' and ' + weather.desc : ''}, high of ${Math.round(weather.high)}.`);
  parts.push(classes.length ? `Today you have ${classes.map(c => `${c.course} at ${spokenTime(c.start)}`).join(', and ')}.` : 'No classes today, which makes it a build day.');
  const soon = due.slice(0, 3);
  if (soon.length) parts.push(`Coming due: ${soon.map(d => `${d.item}, ${spokenDue(d.due, now)}`).join('; ')}.`);
  else parts.push('Nothing due in the next few days.');
  const y = s.actions[addDays(today, -1)];
  if (y && y.done === null) parts.push(`Yesterday's action was: ${y.text}. Did you do it?`);
  if (study) parts.push(`Today's study is ${study.story}, ${study.reference}. Say "start Bible study" when you're ready.`);
  const t = nextTask(s);
  if (t) parts.push(`First build task on the list: ${t.task}.`);
  const cards = dueCards(s, today).length;
  if (cards) parts.push(`${cards} flashcards are due for review.`);
  return parts.join(' ');
}

export function spokenTime(hhmm) {
  let [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
}
export function spokenDue(iso, now = new Date()) {
  const d = new Date(iso);
  const days = dayDiff(localDate(now), localDate(d));
  const t = spokenTime(localTime(d));
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? `on ${weekday(d)}` : `in ${days} days`;
  return `${when} at ${t}`;
}

// Today's Bible story (rotates daily) and this week's memory verse (rotates weekly).
export function studyFor(stories, today, offset = 0) {
  if (!stories?.length) return null;
  const n = dayDiff('2026-01-01', today) + offset;
  return stories[((n % stories.length) + stories.length) % stories.length];
}
export function verseFor(verses, today) {
  if (!verses?.length) return null;
  const n = Math.floor(dayDiff('2026-01-05', mondayOf(today)) / 7); // 2026-01-05 is a Monday
  const ref = verses[((n % verses.length) + verses.length) % verses.length];
  return { ref, link: nltLink(ref) };
}
export const nltLink = ref => `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=NLT`;
