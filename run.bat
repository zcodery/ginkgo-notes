@echo off
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies, please wait...
  call pnpm install
)

start "" cmd /c "timeout /t 3 >nul && start http://localhost:3100"
call pnpm dev
