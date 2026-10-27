@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%CD%"
set "PYTHON=%ROOT%\local-server\.venv\Scripts\python.exe"
if not exist "%PYTHON%" (echo [ERROR] Python venv missing & pause & exit /b 1)
where npm >nul 2>nul || (echo [ERROR] Node.js required & pause & exit /b 1)
rem KWT_STUDIO_BRIDGE_V1_3_1: verify extension API before launching UI; don't silently reuse old bridge.
"%PYTHON%" "%ROOT%\studio-bridge\bridge_launcher.py" ensure
if errorlevel 1 (
  echo [ERROR] Bridge startup/version check failed. No GUI was launched.
  pause
  exit /b 1
)
cd /d "%ROOT%\studio"
if not exist node_modules (
  call npm install || (echo [ERROR] npm install failed & pause & exit /b 1)
)
start "" "http://127.0.0.1:1420"
call npm run dev
endlocal
