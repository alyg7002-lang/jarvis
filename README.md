# J.A.R.V.I.S.

A voice assistant web page: today's classes, live D2L due dates, a 15-minute morning Bible study, and a screen time tracker. You talk to it and it talks back. It runs free on GitHub Pages and works on a laptop or a phone.

## How it works

```
 D2L calendar feed (.ics, private link)
        │   every 3 hours
        ▼
 GitHub Action ── scripts/fetch_due.py ──► due.json  (committed to the repo)
                                              │
 data/schedule.json  data/study.json  data/screentime.json
                                              │
                                              ▼
                        index.html  (GitHub Pages)
          mic ► browser speech recognition ► keyword rules ► spoken reply
```

- **The page (`index.html`)** is plain HTML, CSS, and JavaScript, with no framework and no build step. It loads four JSON files and draws the dashboard.
- **Voice** uses the browser's built-in Web Speech API: `SpeechRecognition` for listening and `speechSynthesis` for talking. That's why it needs Edge or Chrome on a laptop. In the old version, Claude's page frame blocked the mic. On its own site, the mic works.
- **The brain** is a set of keyword rules (see `respond()` in `index.html`). It handles: brief me, what's due, today, what's on Thursday, Bible study (say "next" to step through), screen time, I'm bored, help. Anything else gives you a button that opens the question in Claude.
- **Due dates:** a browser can't download the D2L feed directly. D2L's server blocks cross-site requests (CORS), and the feed link is private. So a scheduled GitHub Action downloads it on GitHub's servers, using the link stored as a secret, and commits a small `due.json`. That gives you a server-side job with no server to run.

## Setup (about 15 minutes)

1. **Create the repo.** On github.com, click **New repository**. Name it `jarvis`, set it to **Public**, and click **Create repository**.
2. **Upload the files.** On the new repo page, click **uploading an existing file**. Open your `Documents\Jarvis` folder, select **everything inside it**, and drag it all into the browser. Click **Commit changes**.
   - **Add the sync job.** Click **Add file → Create new file**. For the name, type exactly `.github/workflows/update-due.yml` (the slashes create the folders). Open `setup\update-due.yml` in Notepad, copy everything, paste it into GitHub, and click **Commit changes**. Claude couldn't write `.github` folders onto your laptop, so this one gets added by hand.
3. **Turn on the website.** Go to **Settings → Pages**. Under "Branch", pick **main** and **/(root)**, then click **Save**. After a minute, the page shows your link: `https://YOUR-USERNAME.github.io/jarvis/`.
4. **Get your D2L feed link.** In D2L, open **Calendar**. Click **Subscribe** at the bottom of the calendar, choose **All Courses**, and copy the link.
5. **Add it as a secret.** In the repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Set Name to `D2L_ICS_URL` and Secret to the link. Click **Add secret**.
6. **Run the sync once.** Go to the **Actions** tab. If asked, click "I understand… enable them". Then open **Update due dates** and click **Run workflow**. When it turns green, `due.json` has your assignments. After that, it reruns every 3 hours on its own.
7. **Open Jarvis** at your link in Edge. Tap the orb, allow the microphone, and say "brief me".
   - **Phone:** open the link in Chrome (Android) or Safari (iPhone). Then choose **Add to Home Screen**, and it opens like an app.

## Editing it

- **Class times:** `data/schedule.json`. Add your online classes or study blocks the same way (`"mode": "Online"`). On GitHub, click the file, then the pencil icon to edit it.
- **Bible study stories:** `data/study.json`. Each one has a story, an NLT reference, a prayer, 3 questions, and an action. It rotates daily.
- **New voice commands:** add an `if (/your words/.test(t)) return say('...');` line in `respond()` inside `index.html`.

## Privacy

The repo is public, so anyone who finds the link can see your class schedule and assignment titles. **The D2L feed link itself stays secret.** To make the repo private, you need GitHub Pro, which is free through the **GitHub Student Developer Pack** with your KSU email (education.github.com).

## Limits / next steps

- The brain only knows its keyword rules. To answer anything, it needs an AI model behind it: a Claude API key (paid, pay-as-you-go) plus a tiny server (for example, Cloudflare Workers) to keep the key hidden.
- Pulse has no feed, so anything only in Pulse won't show up here.
- Screen time you log on the page is saved in that browser only. To make an entry permanent, add it to `data/screentime.json`.
