// Read-only data Jarvis pulls from the outside world.
// The class schedule, Bible stories, verses and D2L due dates live in the jarvis
// GitHub repo (the due-date sync job keeps due.json fresh every 3 hours), so the
// Worker reads them straight from GitHub instead of keeping its own copy.
import { localDate, weekday, localTime } from '../../shared/ops.js';

const KENNESAW = { lat: 34.0234, lon: -84.6155 };

async function getJSON(url, ttl = 300) {
  const r = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true }, headers: { 'User-Agent': 'jarvis-worker' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function getText(url, ttl = 120) {
  const r = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true }, headers: { 'User-Agent': 'jarvis-worker' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

export function makeData(env) {
  const base = (env.DATA_BASE || 'https://raw.githubusercontent.com/alyg7002-lang/jarvis/main').replace(/\/$/, '');
  const memo = {};
  const once = (k, f) => (memo[k] ??= f().catch(e => { delete memo[k]; throw e; }));

  return {
    schedule: () => once('schedule', () => getJSON(`${base}/data/schedule.json`).then(d => d.classes || [])),
    stories: () => once('stories', () => getJSON(`${base}/data/study.json`).then(d => d.stories || [])),
    verses: () => once('verses', () => getJSON(`${base}/data/verses.json`).then(d => d.verses || [])),
    dueRaw: () => once('due', () => getJSON(`${base}/due.json`, 600)),

    async classesOn(dayAbbr) {
      const all = await this.schedule();
      return all.filter(c => c.weekday === dayAbbr).sort((a, b) => a.start.localeCompare(b.start));
    },

    async due({ days = 14, now = new Date() } = {}) {
      const d = await this.dueRaw();
      const end = now.getTime() + days * 86400000;
      const items = (d.items || []).filter(i => { const t = new Date(i.due).getTime(); return t > now.getTime() && t <= end; })
        .sort((a, b) => new Date(a.due) - new Date(b.due));
      return { updated: d.updated, items };
    },

    async weather() {
      return once('weather', async () => {
        const u = `https://api.open-meteo.com/v1/forecast?latitude=${KENNESAW.lat}&longitude=${KENNESAW.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=1`;
        const w = await getJSON(u, 900);
        return {
          temp: w.current.temperature_2m, desc: weatherWord(w.current.weather_code),
          high: w.daily.temperature_2m_max[0], low: w.daily.temperature_2m_min[0], rainChance: w.daily.precipitation_probability_max[0],
        };
      });
    },

    // The ORB paper bot commits its log to its own repo after each run.
    async botStatus(lines = 25) {
      const repo = env.BOT_REPO || 'alyg7002-lang/orb-bot';
      const txt = await getText(`https://raw.githubusercontent.com/${repo}/main/data/live_log.txt`);
      const all = txt.trim().split(/\r?\n/);
      return { repo, dashboard: `https://github.com/${repo}/blob/main/reports/dashboard.html`, lastLines: all.slice(-lines).join('\n') };
    },
  };
}

export function weatherWord(code) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code <= 48) return 'foggy';
  if (code <= 57) return 'drizzly';
  if (code <= 67) return 'rainy';
  if (code <= 77) return 'snowy';
  if (code <= 82) return 'showery';
  return 'stormy';
}

export { localDate, weekday, localTime };
