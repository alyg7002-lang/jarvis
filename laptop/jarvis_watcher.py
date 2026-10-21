"""Jarvis laptop watcher (Windows).

What it does, every 15 seconds:
  1. Looks at the window you're using (its title, e.g. "Instagram - Microsoft Edge").
  2. If it's a time-sink site or app (Instagram, Snapchat, YouTube, TikTok, ...),
     adds 15 seconds to today's count for that app.
  3. After you've been on one continuously for your limit (30 min by default), or
     for 5 minutes after your bedtime, Jarvis says something out loud and hands
     you the next build task from your queue.
  4. Every 5 minutes it sends today's totals to the Jarvis backend, so the
     website and the brain can see them.

It only reads window titles. It never takes screenshots or reads what you type.
Uses only Python's standard library plus Windows' built-in speech, so there's
nothing to install. Runs quietly with pythonw.exe; logs to watcher.log.
"""

import ctypes
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "config.json")
STATE = os.path.join(HERE, "watcher_state.json")
LOG = os.path.join(HERE, "watcher.log")
TICK = 15  # seconds

# Window-title keywords -> the name shown on the Focus page.
SINKS = {
    "instagram": "Instagram",
    "snapchat": "Snapchat",
    "youtube": "YouTube",
    "tiktok": "TikTok",
    "twitch": "Twitch",
    "reddit": "Reddit",
    "facebook": "Facebook",
    " / x": "X",
    "twitter": "X",
}
# YouTube is fine when it's for class or building. Titles with these words don't count.
YOUTUBE_OK = ("matlab", "solidworks", "tutorial", "lecture", "calculus", "physics", "statics", "dynamics",
              "thermo", "python", "javascript", "how to", "explained", "course", "bible", "sermon", "knechtle")

DEFAULTS = {
    "api": "",
    "passcode": "",
    "limit_minutes": 30,
    "late_limit_minutes": 5,
    "bedtime": "00:30",
    "wake": "08:00",
    "speak": True,
}


def log(msg):
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        if os.path.getsize(LOG) > 512_000:  # keep the log small
            with open(LOG, encoding="utf-8") as f:
                tail = f.readlines()[-500:]
            with open(LOG, "w", encoding="utf-8") as f:
                f.writelines(tail)
    except OSError:
        pass
    if sys.stdout and sys.stdout.isatty():
        print(line)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


# ---------- Windows helpers ----------
user32 = ctypes.windll.user32 if os.name == "nt" else None


def active_title():
    if not user32:
        return ""
    hwnd = user32.GetForegroundWindow()
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]


def idle_seconds():
    """Seconds since the last keyboard/mouse input. A paused video you walked away from shouldn't count."""
    if not user32:
        return 0
    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    user32.GetLastInputInfo(ctypes.byref(info))
    return (ctypes.windll.kernel32.GetTickCount() - info.dwTime) / 1000.0


def speak(text):
    """Speak with Windows' built-in voices, preferring a British male one (George/Ryan)."""
    safe = text.replace("'", "''")
    ps = (
        "Add-Type -AssemblyName System.Speech;"
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        "$v=$s.GetInstalledVoices()|%{$_.VoiceInfo}|?{$_.Culture.Name -eq 'en-GB' -and $_.Gender -eq 'Male'}|select -First 1;"
        "if(-not $v){$v=$s.GetInstalledVoices()|%{$_.VoiceInfo}|?{$_.Gender -eq 'Male'}|select -First 1};"
        "if($v){$s.SelectVoice($v.Name)};$s.Rate=0;"
        f"$s.Speak('{safe}')"
    )
    try:
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except OSError as e:
        log(f"speak failed: {e}")


def popup(title, text):
    """A small always-on-top message box that doesn't block the watcher."""
    if not user32:
        return
    import threading
    MB_TOPMOST, MB_SETFOREGROUND, MB_ICONINFO = 0x40000, 0x10000, 0x40
    threading.Thread(target=lambda: user32.MessageBoxW(0, text, title, MB_TOPMOST | MB_SETFOREGROUND | MB_ICONINFO), daemon=True).start()


# ---------- backend ----------
def api_call(cfg, method, path, body=None):
    if not cfg.get("api") or not cfg.get("passcode"):
        return None
    req = urllib.request.Request(
        cfg["api"].rstrip("/") + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"authorization": f"Bearer {cfg['passcode']}", "content-type": "application/json", "user-agent": "jarvis-watcher"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def classify(title):
    t = f" {title.lower()} "
    for key, name in SINKS.items():
        if key in t:
            if name == "YouTube" and any(w in t for w in YOUTUBE_OK):
                return None
            return name
    return None


def hhmm_to_min(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def is_late(now, bedtime, wake):
    """True between bedtime and wake (handles bedtime after midnight)."""
    x = now.hour * 60 + now.minute
    b, w = hhmm_to_min(bedtime), hhmm_to_min(wake)
    return (b <= x < w) if b <= w else (x >= b or x < w)


def jarvis_day(now, wake):
    """Late-night minutes count toward the day you stayed up on, not the next one."""
    x = now.hour * 60 + now.minute
    d = now if x >= hhmm_to_min(wake) - 240 else now - timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def find_backend(cfg):
    """The deploy job publishes the backend address in the repo's config.json."""
    if cfg.get("api"):
        return
    try:
        with urllib.request.urlopen("https://raw.githubusercontent.com/alyg7002-lang/jarvis/main/config.json", timeout=15) as r:
            cfg["api"] = json.loads(r.read().decode()).get("api", "")
    except Exception:
        pass


def main():
    cfg = {**DEFAULTS, **load_json(CONFIG, {})}
    find_backend(cfg)
    st = load_json(STATE, {})
    log(f"watcher started (backend: {'on' if cfg.get('api') and cfg.get('passcode') else 'off'})")
    streak_app, streak_sec, warned_at = None, 0, 0
    next_task = None
    last_report = last_settings = 0

    while True:
        now = datetime.now()
        try:
            # Pull bedtime, limits and the next build task from Jarvis every 15 minutes.
            if time.time() - last_settings > 900:
                last_settings = time.time()
                find_backend(cfg)
                try:
                    d = api_call(cfg, "GET", "/api/state")
                    if d:
                        s = d["state"]["settings"]
                        cfg["bedtime"], cfg["wake"] = s.get("bedtime", cfg["bedtime"]), s.get("wake", cfg["wake"])
                        cfg["limit_minutes"] = s.get("distractLimitMin", cfg["limit_minutes"])
                        open_tasks = [t for t in d["state"]["backlog"] if not t.get("done")]
                        next_task = open_tasks[0]["task"] if open_tasks else None
                except Exception as e:  # offline is fine; keep counting locally
                    log(f"settings fetch failed: {e}")

            day = jarvis_day(now, cfg["wake"])
            if st.get("date") != day:
                st = {"date": day, "apps": {}, "late": 0}

            app = classify(active_title()) if idle_seconds() < 120 else None
            late = is_late(now, cfg["bedtime"], cfg["wake"])
            if app:
                st["apps"][app] = st["apps"].get(app, 0) + TICK
                if late:
                    st["late"] = st.get("late", 0) + TICK
                streak_sec = streak_sec + TICK if app == streak_app else TICK
                streak_app = app
            else:
                streak_sec = max(0, streak_sec - TICK * 2)  # a short break eases off, a real one resets
                if streak_sec == 0:
                    streak_app = None

            limit = (cfg["late_limit_minutes"] if late else cfg["limit_minutes"]) * 60
            if app and streak_sec >= limit and time.time() - warned_at > (300 if late else 600):
                warned_at = time.time()
                mins = streak_sec // 60
                task = f" Next on your build list: {next_task}." if next_task else ""
                if late:
                    msg = f"Sir, it's {now:%I:%M}, past your bedtime, and you've been on {app} for {mins} minutes. Close it and put the phone across the room."
                else:
                    msg = f"Sir, that's {mins} minutes on {app}.{task} Twenty-five minutes on that instead?"
                log(f"nudge: {msg}")
                if cfg.get("speak", True):
                    speak(msg)
                popup("Jarvis", msg)

            save_json(STATE, st)

            if time.time() - last_report > 300:
                last_report = time.time()
                minutes = {k: round(v / 60) for k, v in st["apps"].items() if v >= 60}
                try:
                    api_call(cfg, "POST", "/api/op", {"name": "laptop_report", "args": {"date": day, "apps": minutes, "late": round(st.get("late", 0) / 60)}})
                except Exception as e:
                    log(f"report failed: {e}")
        except Exception as e:  # never die; log and keep going
            log(f"error: {e!r}")
        time.sleep(TICK)


if __name__ == "__main__":
    if "--test" in sys.argv:
        speak("Jarvis watcher online, sir. I'll keep an eye on Instagram for you.")
        print("Spoke a test line. Active window right now:", active_title(), "->", classify(active_title()))
        time.sleep(6)
    else:
        main()
