@echo off
rem Lance Alkatrazz Tower puis ouvre la page.
cd /d "%~dp0"
start "" http://127.0.0.1:4777
node server\server.js
