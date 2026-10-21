// Jarvis's brain: Claude + a set of tools that read and change Jarvis's memory.
//
// How a chat turn works (the "tool loop"):
//   1. Send Claude the conversation, the persona, a snapshot of today, and the tool list.
//   2. If Claude answers with tool calls, run them here, send back the results, repeat.
//   3. When Claude answers with plain text, that's what Jarvis says out loud.
import * as J from '../../shared/ops.js';

export const MODELS = {
  quick: 'claude-haiku-5-5',
  deep: 'claude-sonnet-5-5',
};
// USD per million tokens. Check https://docs.claude.com pricing if these change.
export const RATES = {
  'claude-haiku-5-5': { in: 0.10, out: 0.50 },
  'claude-sonnet-5-5': { in: 2.00, out: 10.00 },
};
export function costOf(model, u = {}) {
  const r = RATES[model] || RATES['claude-sonnet-5-5'];
  const inTok = (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0);
  return (inTok * r.in + (u.output_tokens || 0) * r.out) / 1e6;
}

export const PERSONA = `You are J.A.R.V.I.S., the personal assistant of Elijah Gonzalez. Think of the AI butler from Iron Man: composed, quick, quietly witty, unfailingly useful. You speak with a British register and call him "sir" now and then (not every sentence).

About Elijah: 19, second-year mechanical engineering student at Kennesaw State University, lives in the Atlanta area, no job right now. Mechanically minded and a natural troubleshooter: once he understands how a process works he improves it. Explain how things work, not only what to do. He's a non-denominational Christian who aligns with Stuart Knechtle (Give Me an Answer). He's building you as his first real AI project to show his uncle, a software engineer.

How you talk (your replies are read aloud by a speech engine):
- Lead with the answer. Default to 1-3 short sentences, under 60 words. Go longer only when he asks to go deeper.
- Plain spoken sentences: no markdown, no bullet points, no emoji, no URLs read aloud. Say times like "9:35" and "11:59 PM".
- Laid back and sharp, like a smart friend with a butler's manners. No hype, no "Great question!", no over-the-top motivation.
- Brutally honest about his ideas: name the flaw, the fix, and what's actually good about it.
- Push for specifics when his goals are vague.

Hard rules:
- Graded schoolwork (including Spanish and English): coach, explain, quiz, and check his work, but never write graded answers, essays or code for him. Ungraded writing (emails, messages, project write-ups) you may draft freely.
- Trading: he studies an opening range breakout retest strategy and runs a paper-trading bot. Never predict the market, call "the best trade", or promise wins; nobody can reliably do that. Push paper trading, a written log of 30-50 trades, and risk math before any real money. You can do risk math with the risk_calc tool.
- Bible study (about 15 minutes, NLT, great Bible stories, aimed at him becoming the best Christlike man he can be): short prayer, have him read the passage by reference (never paste long passages), then the discussion questions one at a time, then one concrete action for the day. When he finishes, call study_done and action_set. The next day, ask how yesterday's action went and record it with action_check.
- Screen time: he loses hours to Instagram and Snapchat, mostly early mornings and late nights. Hold him accountable without nagging, and steer him to a concrete build task instead of scrolling (start_build_session).
- Sleep: protect his wake time. After his wind-down time, keep answers short and point him toward bed.
- Career: he's weighing the hands-on technician path versus engineering at Delta TechOps. Help him explore both; don't push one.
- Use tools instead of guessing about his schedule, due dates, memory, or the bot. If he asks for something you can't do, say so plainly in one sentence and call log_miss so he can build it later.
- When he tells you a durable fact about himself, his people, or his plans, and it would help later, save it with memory_save. Never save passwords, keys, or account numbers.`;

const s = (props, req = []) => ({ type: 'object', properties: props, required: req });
const str = d => ({ type: 'string', description: d });
const numb = d => ({ type: 'number', description: d });
const bool = d => ({ type: 'boolean', description: d });

export const TOOLS = [
  { name: 'get_schedule', description: 'Class schedule for a weekday (Mon..Sun). Omit day for today.', input_schema: s({ day: str('Mon, Tue, Wed, Thu, Fri, Sat or Sun') }) },
  { name: 'get_due', description: 'Upcoming D2L due dates (assignments, quizzes).', input_schema: s({ days: numb('How many days ahead, default 14') }) },
  { name: 'get_weather', description: 'Current weather and today\'s high/low in Kennesaw, GA (Fahrenheit).', input_schema: s({}) },
  { name: 'get_bible_study', description: "Today's Bible story with prayer, reference, 3 questions and suggested action. offset=1 for tomorrow's.", input_schema: s({ offset: numb('Days from today') }) },
  { name: 'study_done', description: 'Mark today\'s Bible study as done. Returns the streak.', input_schema: s({}) },
  { name: 'action_set', description: 'Save the one concrete action he committed to for today.', input_schema: s({ text: str('The action') }, ['text']) },
  { name: 'action_check', description: 'Record whether he did a previous day\'s action. Defaults to yesterday.', input_schema: s({ done: bool('Did he do it'), note: str('Short note'), date: str('YYYY-MM-DD, default yesterday') }, ['done']) },
  { name: 'verse_of_week', description: "This week's memory verse reference.", input_schema: s({}) },
  { name: 'verse_check', description: 'Record whether he recited the memory verse correctly this week.', input_schema: s({ ok: bool('Recited correctly') }, ['ok']) },
  { name: 'prayer_add', description: 'Add a prayer request to follow up on later.', input_schema: s({ text: str('What to pray for'), followUp: str('YYYY-MM-DD to ask about it') }, ['text']) },
  { name: 'prayer_list', description: 'Open prayer requests.', input_schema: s({}) },
  { name: 'prayer_answer', description: 'Mark a prayer as answered with a note.', input_schema: s({ id: str('Prayer id'), match: str('Words from the prayer if no id'), note: str('What happened') }) },
  { name: 'memory_save', description: 'Remember a durable fact about Elijah.', input_schema: s({ fact: str('One short fact') }, ['fact']) },
  { name: 'memory_forget', description: 'Forget facts containing these words (or by id).', input_schema: s({ match: str('Words or id') }, ['match']) },
  { name: 'backlog_add', description: 'Add a 20-30 minute build task to the build-mode backlog.', input_schema: s({ task: str('Specific, finishable task'), minutes: numb('Estimated minutes'), project: str('Jarvis, ORB bot, School, Other') }, ['task']) },
  { name: 'backlog_list', description: 'Open build tasks in order.', input_schema: s({}) },
  { name: 'backlog_done', description: 'Mark a build task finished (first open one if no id/match). Optional note goes in the dev log.', input_schema: s({ id: str('Task id'), match: str('Words from the task'), note: str('What he built or learned') }) },
  { name: 'start_build_session', description: 'Start a focused build session on the next backlog task (or a given one) with a countdown timer on his screen. Use when he is bored, scrolling, or asks what to work on.', input_schema: s({ match: str('Words from a specific task'), minutes: numb('Session length, default 25') }) },
  { name: 'devlog_add', description: 'Add a dated dev-log entry: what he built, what broke, how he fixed it.', input_schema: s({ text: str('Entry') }, ['text']) },
  { name: 'devlog_recent', description: 'Recent dev-log entries (for showing his uncle or writing a summary).', input_schema: s({ limit: numb('How many, default 10') }) },
  { name: 'log_debrief', description: 'Save the nightly 2-minute debrief.', input_schema: s({ done: str('What got done'), missed: str("What didn't"), tomorrow: str("Tomorrow's one thing") }, ['done', 'tomorrow']) },
  { name: 'flashcard_add', description: 'Add a flashcard (Spanish vocab, MATLAB syntax, engineering concepts, or anything he missed in a quiz).', input_schema: s({ deck: str('Deck name'), front: str('Prompt'), back: str('Answer') }, ['front', 'back']) },
  { name: 'flashcard_due', description: 'Cards due for review today, optionally one deck.', input_schema: s({ deck: str('Deck name') }) },
  { name: 'flashcard_grade', description: 'Grade a reviewed card. Wrong answers come back sooner.', input_schema: s({ id: str('Card id'), correct: bool('Got it right') }, ['id', 'correct']) },
  { name: 'screen_time', description: "Today's laptop distraction minutes (from the watcher) and recent weekly phone totals vs goal.", input_schema: s({}) },
  { name: 'log_phone_week', description: 'Record a week of phone screen time he reports (hours).', input_schema: s({ total: numb('Total hours'), instagram: numb('Instagram hours'), snapchat: numb('Snapchat hours'), week: str('Any date in that week, default this week') }, ['total']) },
  { name: 'risk_calc', description: 'Position size and R targets. Symbols: MES, MNQ, M2K, MGC, MCL, ES, NQ, STOCK.', input_schema: s({ symbol: str('Symbol'), entry: numb('Entry price'), stop: numb('Stop price'), risk: numb('Dollars to risk, default 100') }, ['entry', 'stop']) },
  { name: 'trade_log_add', description: 'Log one of HIS demo trades (not the bot\'s).', input_schema: s({ symbol: str('e.g. MES'), side: str('long or short'), entry: numb('Entry'), stop: numb('Stop'), exit: numb('Exit'), contracts: numb('Contracts'), notes: str('What happened') }, ['entry', 'stop']) },
  { name: 'trade_log_summary', description: 'His demo trade log stats: count toward 30-50, win rate, average R.', input_schema: s({}) },
  { name: 'orb_bot_status', description: "Latest lines from the ORB paper-trading bot's live log on GitHub.", input_schema: s({}) },
  { name: 'weekly_review', description: 'Summary of this week (or last week): builds, study days, actions kept, screen time, trades, API cost.', input_schema: s({ previous: bool('Last full week instead of this one') }) },
  { name: 'usage_report', description: "What Jarvis's brain has cost today and this month vs the budget.", input_schema: s({}) },
  { name: 'settings_update', description: 'Change sleep anchors or limits: wake, windDown, bedtime (HH:MM 24h), dailyBudget, monthlyBudget (USD), phoneGoalHours (weekly), distractLimitMin.', input_schema: s({ wake: str('HH:MM'), windDown: str('HH:MM'), bedtime: str('HH:MM'), dailyBudget: numb('USD'), monthlyBudget: numb('USD'), phoneGoalHours: numb('Hours per week'), distractLimitMin: numb('Minutes') }) },
  { name: 'start_timer', description: 'Show and speak a countdown timer on his screen.', input_schema: s({ minutes: numb('Minutes'), label: str('What it is for') }, ['minutes']) },
  { name: 'log_miss', description: "Log a request you couldn't handle, so he can build it into you later.", input_schema: s({ request: str('What he asked for') }, ['request']) },
];

// Runs one tool. `ctx` holds the state (mutated in place), data sources and client actions.
export async function runTool(name, input, ctx) {
  const { data, now } = ctx;
  const today = J.localDate(now);
  const op = (opName, args) => { const r = J.applyOp(ctx.state, opName, args, now); ctx.state = r.state; ctx.changed = true; return r.result; };

  switch (name) {
    case 'get_schedule': return { day: input.day || J.weekday(now), classes: await data.classesOn(input.day || J.weekday(now)) };
    case 'get_due': return data.due({ days: input.days || 14, now });
    case 'get_weather': return data.weather();
    case 'get_bible_study': return J.studyFor(await data.stories(), today, input.offset || 0);
    case 'study_done': return op('study_done', {});
    case 'action_set': return op('action_set', input);
    case 'action_check': return op('action_check', input);
    case 'verse_of_week': return { ...J.verseFor(await data.verses(), today), checkedThisWeek: ctx.state.verseChecks[J.isoWeek(today)] || null };
    case 'verse_check': return op('verse_check', input);
    case 'prayer_add': return op('prayer_add', input);
    case 'prayer_list': return ctx.state.prayers.filter(p => !p.answer);
    case 'prayer_answer': return op('prayer_answer', input);
    case 'memory_save': return op('memory_save', input);
    case 'memory_forget': return op('memory_forget', input);
    case 'backlog_add': return op('backlog_add', input);
    case 'backlog_list': return J.openTasks(ctx.state).slice(0, 15);
    case 'backlog_done': return op('backlog_done', input);
    case 'start_build_session': {
      const m = input.match ? J.openTasks(ctx.state).find(t => t.task.toLowerCase().includes(String(input.match).toLowerCase())) : J.nextTask(ctx.state);
      if (!m) return { error: 'The backlog is empty. Ask what he wants to build and add a task first.' };
      const minutes = input.minutes || m.minutes || 25;
      ctx.actions.push({ type: 'build', taskId: m.id, task: m.task, minutes });
      return { started: m.task, minutes };
    }
    case 'devlog_add': return op('devlog_add', input);
    case 'devlog_recent': return ctx.state.devlog.slice(-(input.limit || 10));
    case 'log_debrief': return op('debrief', input);
    case 'flashcard_add': return op('flash_add', input);
    case 'flashcard_due': return J.dueCards(ctx.state, today, input.deck).slice(0, 10).map(c => ({ id: c.id, deck: c.deck, front: c.front, back: c.back }));
    case 'flashcard_grade': return op('flash_grade', input);
    case 'screen_time': return { laptopToday: J.laptopToday(ctx.state, today), phoneWeeks: ctx.state.phoneWeeks.slice(-4), weeklyGoalHours: ctx.state.settings.phoneGoalHours };
    case 'log_phone_week': return op('phone_week', input);
    case 'risk_calc': return J.riskCalc(input);
    case 'trade_log_add': return op('trade_add', input);
    case 'trade_log_summary': return { ...J.tradeStats(ctx.state), recent: ctx.state.trades.slice(-5) };
    case 'orb_bot_status': return data.botStatus();
    case 'weekly_review': return J.weeklyReview(ctx.state, today, { previous: !!input.previous });
    case 'usage_report': return J.usageTotals(ctx.state, today);
    case 'settings_update': return op('settings_update', input);
    case 'start_timer': {
      const minutes = Math.max(0.1, Math.min(240, +input.minutes || 5));
      ctx.actions.push({ type: 'timer', minutes, label: String(input.label || 'Timer').slice(0, 60) });
      return { started: true, minutes };
    }
    case 'log_miss': return op('miss_log', input);
    default: return { error: `unknown tool ${name}` };
  }
}

// What Jarvis knows at the start of every turn, so most questions need no tool call.
export async function snapshot(ctx) {
  const { state, data, now } = ctx;
  const today = J.localDate(now);
  const yesterday = J.addDays(today, -1);
  const safe = async (f, d) => { try { return await f(); } catch { return d; } };
  const [classes, due] = await Promise.all([
    safe(() => data.classesOn(J.weekday(now)), []),
    safe(() => data.due({ days: 7, now }), { items: [] }),
  ]);
  const u = J.usageTotals(state, today);
  const lap = J.laptopToday(state, today);
  const lines = [
    `Now: ${J.weekday(now)} ${today}, ${J.localTime(now)} Eastern.`,
    `Today's classes: ${classes.length ? classes.map(c => `${c.course} ${c.start}-${c.end} (${c.mode})`).join('; ') : 'none'}.`,
    `Due in the next 7 days: ${due.items.length ? due.items.slice(0, 6).map(d => `${d.item} [${d.course}] ${J.spokenDue(d.due, now)}`).join('; ') : 'nothing'}.`,
    `Bible study done today: ${state.study[today] ? 'yes' : 'no'}; streak ${J.studyStreak(state, today)} days.`,
    `Today's action: ${state.actions[today]?.text || 'not set'}. Yesterday's action: ${state.actions[yesterday] ? `${state.actions[yesterday].text} (did it: ${state.actions[yesterday].done ?? 'not asked yet'})` : 'none'}.`,
    `Next build tasks: ${J.openTasks(state).slice(0, 3).map(t => t.task).join('; ') || 'backlog empty'}.`,
    `Flashcards due: ${J.dueCards(state, today).length}. Open prayers: ${state.prayers.filter(p => !p.answer).length}.`,
    `Laptop distraction today: ${lap.total} min. Sleep anchors: wake ${state.settings.wake}, wind-down ${state.settings.windDown}, bedtime ${state.settings.bedtime}.`,
    `Brain cost today $${u.today.cost.toFixed(3)} of $${u.dailyBudget} budget.`,
    state.facts.length ? `Things you remember about him:\n${state.facts.slice(-40).map(f => `- ${f.text}`).join('\n')}` : 'You have no saved memories yet.',
  ];
  return lines.join('\n');
}

export class BrainError extends Error { constructor(msg, status = 502) { super(msg); this.status = status; } }

async function callClaude(env, body) {
  const r = await fetch(`${env.ANTHROPIC_BASE || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return j;
  const msg = j?.error?.message || `HTTP ${r.status}`;
  if (r.status === 401) throw new BrainError('My API key was rejected. Check ANTHROPIC_API_KEY in GitHub secrets and redeploy.', 502);
  if (/credit balance/i.test(msg)) throw new BrainError('The API account is out of credits. Add credits in the Claude Console.', 402);
  if (r.status === 429 || r.status === 529) throw new BrainError('The brain is overloaded for a moment. Try again in a few seconds.', 503);
  throw new BrainError(`The brain returned an error: ${msg}`, 502);
}

// The tool loop. Returns { reply, actions, model, cost, rounds }.
export async function chat(env, ctx, { messages, deep = false }) {
  const model = deep ? MODELS.deep : MODELS.quick;
  const system = [
    { type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: await snapshot(ctx) },
  ];
  const tools = TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  const convo = messages.map(m => ({ role: m.role, content: m.content }));
  let cost = 0, inTok = 0, outTok = 0;

  for (let round = 1; round <= 6; round++) {
    const res = await callClaude(env, { model, max_tokens: deep ? 1500 : 600, system, tools, messages: convo });
    cost += costOf(model, res.usage);
    inTok += (res.usage?.input_tokens || 0) + (res.usage?.cache_read_input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0);
    outTok += res.usage?.output_tokens || 0;
    const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    const calls = (res.content || []).filter(b => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      return { reply: text || 'Done.', actions: ctx.actions, model, cost, inTok, outTok, rounds: round };
    }
    convo.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const c of calls) {
      let out, isError = false;
      try { out = await runTool(c.name, c.input || {}, ctx); }
      catch (e) { out = { error: e.message }; isError = true; }
      results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out ?? null).slice(0, 8000), is_error: isError || undefined });
    }
    convo.push({ role: 'user', content: results });
  }
  return { reply: "That took more steps than I'm allowed. Try asking in smaller pieces.", actions: ctx.actions, model, cost, inTok, outTok, rounds: 6 };
}
