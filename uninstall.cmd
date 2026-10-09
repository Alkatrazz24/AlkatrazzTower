@echo off
rem Retire Alkatrazz Tower de ce PC (hooks, lancement au demarrage, skill des personnages).
cd /d "%~dp0"
node scripts\uninstall.js
pause
