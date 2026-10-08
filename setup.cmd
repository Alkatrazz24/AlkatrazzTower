@echo off
rem Installe Alkatrazz Tower sur ce PC.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js 20 ou plus est necessaire : https://nodejs.org
  start "" https://nodejs.org
  pause
  exit /b 1
)
node scripts\setup.js %*
pause
