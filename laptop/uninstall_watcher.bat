@echo off
schtasks /end /tn "Jarvis watcher" >nul 2>&1
schtasks /delete /tn "Jarvis watcher" /f
taskkill /fi "WINDOWTITLE eq Jarvis watcher" >nul 2>&1
echo Jarvis watcher removed. Restart the laptop to be sure it has stopped.
pause
