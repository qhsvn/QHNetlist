@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua co Node.js. Tai tai https://nodejs.org roi chay lai.
  pause
  exit /b 1
)
if not exist node_modules\avr8js (
  echo Dang cai thu vien lan dau...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
call npm run dev
