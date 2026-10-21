# J.A.R.V.I.S. 3.0

Elijah's personal assistant. You talk to it, it talks back in a British voice, and it actually does things: runs the morning brief and Bible study, tracks due dates, hands you a build task when you're about to scroll, quizzes you, does trading risk math, and remembers what you tell it.

## How it fits together

```
 phone / laptop browser                       Cloudflare Worker (free)                    Claude API
 ┌──────────────────────────┐   passcode   ┌───────────────────────────────┐   API key   ┌────────────┐
 │ index.html + assets/     │ ───────────► │ worker/src/index.js           │ ──────────► │ Haiku 5.5  │
 │  voice.js  speak + listen│   /api/*     │  brain.js  tool loop, persona │ ◄────────── │ Sonnet 5.5 │
 │  app.js    pages, flows  │ ◄─────────── │  KV        memory (one JSON)  │             └────────────┘
 └──────────────────────────┘              │  data.js   reads GitHub data  │
            ▲                              └───────────────────────────────┘
            │ laptop_report every 5 min                    ▲ reads schedule, study, due.json
 laptop/jarvis_watcher.py (Windows)                        │ and the ORB bot log from GitHub
```

- **The brain** (`worker/src/brain.js`) is a *tool loop*: Claude gets the persona, a snapshot of your day, and ~35 tools (calendar, due dates, memory, backlog, flashcards, risk math, bot status…). When it wants a tool, the Worker runs it and sends the result back, until Claude answers in plain words.
- **One brain for everything.** `shared/ops.js` holds every rule for changing your data. The website and the Worker both use it, so offline mode and cloud mode behave the same.
- **The API key never reaches the browser.** It lives as a Worker secret. The website only knows your passcode.
- **Cost control:** quick replies use Haiku 5.5 (about $0.10 / $0.50 per million tokens). Tap **Deep** (or start a message with `deep:`) for Sonnet 5.5. The Worker refuses brain calls once you pass the daily or monthly budget you set in Settings. The brief, Bible study, debrief, quizzes, timers and build sessions run on your device and cost nothing.

## What it does

| Page | What's there |
|---|---|
| Home | The reactor orb (tap or say "Jarvis"), conversation, today's classes, due dates, today's action, next build task |
| Faith | Today's story, guided 15-minute study, yesterday's action check-in, streak, verse of the week, prayer list with follow-up |
| Build | Build-mode queue, 25-minute session timer, dev log ("copy for my uncle") |
| Focus | Sleep anchors, nightly debrief, laptop distraction minutes, weekly phone log |
| Trading | Risk calculator (MES, MNQ, M2K, MGC, MCL, ES, NQ, stocks), demo trade log toward 30–50, live ORB bot log |
| Learn | Spaced-repetition flashcards, voice quizzes |
| Review | Weekly numbers, share to your accountability person, "what Jarvis couldn't do", brain cost |

Voice: say **"brief me"**, **"start Bible study"**, **"debrief"**, **"quiz me"**, **"recite my verse"**, **"I'm bored"**, **"set a timer for 10 minutes"**, or anything else for the brain. `Ctrl+Space` talks, `Esc` stops.

**Best voice:** Microsoft Edge on Windows → Settings → Voice → *Ryan Online (Natural) – English (United Kingdom)*. iPhone: download *Daniel* or *Arthur (Enhanced)* under Settings → Accessibility → Spoken Content → Voices → English (UK).

## Setup

One-time, about 15 minutes. Everything else deploys itself.

1. **Claude API key.** At console.anthropic.com: sign up, add $5 of credit (Billing), set a monthly spend limit, then create a key under API Keys.
2. **Cloudflare.** At dash.cloudflare.com: sign up (free). Copy your **Account ID** (right side of Workers & Pages). Create an API token (My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** → Continue → Create).
3. **GitHub secrets.** In this repo: Settings → Secrets and variables → Actions → New repository secret. Add these four: `ANTHROPIC_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `JARVIS_PASSCODE` (a passphrase you make up).
4. **Deploy.** Go to Actions → **Deploy Jarvis backend** → Run workflow. When it turns green, it has written `config.json` with the backend address, and the website finds it automatically.
5. **Connect.** Open the site, then go to Settings → Passcode → Save and connect.
6. **Laptop watcher.** Double-click `laptop\install_watcher.bat` and paste your passcode.

## Files

```
index.html, assets/         the website (no build step)
shared/ops.js               data rules shared by site + backend
worker/                     Cloudflare Worker (backend)
data/*.json                 schedule, 22 Bible stories, memory verses, D2L sync script
due.json                    D2L due dates (refreshed every 3 h by update-due.yml)
laptop/                     Windows screen-time watcher
tests/                      `npm test` (unit + backend with a fake Claude)
```

## Privacy

The repo is public, so your class schedule, the Bible study list and due-date titles are visible. Your memory, debriefs, prayers, trades and screen time live in Cloudflare KV behind your passcode, never in the repo. Ten wrong passcodes lock that device out for 15 minutes.
