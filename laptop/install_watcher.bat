@echo off
REM Starts the Jarvis watcher now and every time you sign in to Windows.
cd /d "%~dp0"
set PYW=
for /f "delims=" %%i in ('where pythonw 2^>nul') do if not defined PYW set "PYW=%%i"
if not defined PYW for /f "delims=" %%i in ('py -c "import sys,os;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))" 2^>nul') do set "PYW=%%i"
if not defined PYW (
  echo Python was not found. Install it from python.org, then run this again.
  pause
  exit /b 1
)
if not exist "%~dp0config.json" (
  echo.
  echo Paste your Jarvis passcode ^(the JARVIS_PASSCODE you added on GitHub^) and press Enter.
  echo Leave it blank to run without sending totals to the website.
  set /p "JPASS=Passcode: "
)
if not exist "%~dp0config.json" (
  >"%~dp0config.json" echo {"api": "", "passcode": "%JPASS%", "limit_minutes": 30, "late_limit_minutes": 5, "speak": true}
)
schtasks /create /tn "Jarvis watcher" /tr "\"%PYW%\" \"%~dp0jarvis_watcher.py\"" /sc onlogon /rl limited /f >nul
if errorlevel 1 (
  echo Could not create the startup task.
  pause
  exit /b 1
)
schtasks /run /tn "Jarvis watcher" >nul
echo Jarvis watcher installed and running. It starts by itself when you sign in.
"%PYW:pythonw=python%" "%~dp0jarvis_watcher.py" --test
timeout /t 5 >nul
