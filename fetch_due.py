"""Pull upcoming due dates from your D2L calendar feed and save them to due.json.

How it fits together:
  - D2L publishes your course calendar as an .ics file (a standard calendar format).
  - A browser page can't download that file directly (the D2L server blocks
    cross-site requests, a rule called CORS), and the feed link is private, so it
    can't live in a public page either.
  - So a GitHub Action runs this script on GitHub's servers every few hours. It
    reads the secret feed link, downloads the .ics, keeps only the next 3 weeks
    of due dates, and commits a small due.json file the page can read.

Uses only Python's standard library, so there's nothing to install.
"""

import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HOME_TZ = ZoneInfo("America/New_York")
DAYS_AHEAD = 21
OUT_FILE = os.path.join(os.path.dirname(__file__), "..", "due.json")


def download(url: str) -> str:
    url = url.replace("webcal://", "https://", 1)
    req = urllib.request.Request(url, headers={"User-Agent": "jarvis-due-sync"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def unfold(text: str) -> list[str]:
    """ICS wraps long lines by starting the next line with a space. Undo that."""
    lines: list[str] = []
    for raw in text.splitlines():
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def unescape(value: str) -> str:
    return (value.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",")
                 .replace("\\;", ";").replace("\\\\", "\\").strip())


def parse_events(text: str) -> list[dict]:
    events, cur = [], None
    for line in unfold(text):
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            head, value = line.split(":", 1)
            name, *params = head.split(";")
            cur[name.upper()] = (value, dict(p.split("=", 1) for p in params if "=" in p))
    return events


def parse_start(value: str, params: dict):
    """Returns (datetime in Eastern time, all_day flag)."""
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
        d = datetime.strptime(value[:8], "%Y%m%d").date()
        return datetime(d.year, d.month, d.day, 23, 59, tzinfo=HOME_TZ), True
    dt = datetime.strptime(value.rstrip("Z")[:15], "%Y%m%dT%H%M%S")
    if value.endswith("Z"):
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        try:
            dt = dt.replace(tzinfo=ZoneInfo(params.get("TZID", "America/New_York")))
        except Exception:
            dt = dt.replace(tzinfo=HOME_TZ)
    return dt.astimezone(HOME_TZ), False


def main() -> int:
    url = os.environ.get("D2L_ICS_URL", "").strip()
    if not url:
        print("D2L_ICS_URL secret is not set. Add it under Settings > Secrets and variables > Actions.")
        return 1

    events = parse_events(download(url))
    now = datetime.now(HOME_TZ)
    horizon = now + timedelta(days=DAYS_AHEAD)
    items = []
    for ev in events:
        if "DTSTART" not in ev:
            continue
        summary = unescape(ev.get("SUMMARY", ("", {}))[0])
        status = ev.get("STATUS", ("", {}))[0].upper()
        if not summary or status == "CANCELLED" or summary.endswith(" - Available"):
            continue
        start, all_day = parse_start(*ev["DTSTART"])
        if not (now - timedelta(hours=1) <= start <= horizon):
            continue
        location = unescape(ev.get("LOCATION", ("", {}))[0])
        items.append({
            "id": ev.get("UID", (summary + start.isoformat(), {}))[0],
            "item": re.sub(r"\s*-\s*Due$", "", summary).strip(),
            "course": location.split(" Section")[0].strip(),
            "due": start.isoformat(),
            "allDay": all_day,
        })

    items.sort(key=lambda r: r["due"])
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "items": items}

    # Only rewrite the file when the list actually changed, so the repo history stays clean.
    try:
        with open(OUT_FILE, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("items") == items:
            print(f"No change ({len(items)} items).")
            return 0
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(f"Wrote {len(items)} due items.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
