@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:5173/'"
call npm run dev

pause
