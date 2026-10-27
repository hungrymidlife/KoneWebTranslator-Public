@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%CD%"
if not exist "%ROOT%\studio\package.json" (
  echo [ERROR] Studio files not installed. Run APPLY.bat first.
  pause
  exit /b 1
)
set "PYTHON=%ROOT%\local-server\.venv\Scripts\python.exe"
if not exist "%PYTHON%" (
  echo [ERROR] Python venv not found: %PYTHON%
  echo Run local-server\install.bat first.
  pause
  exit /b 1
)
where npm >nul 2>nul || (echo [ERROR] Node.js and npm required. & pause & exit /b 1)
where cargo >nul 2>nul || (echo [ERROR] Rust cargo required for Tauri desktop build. Run RUN_STUDIO_WEB.bat to preview without Rust. & pause & exit /b 1)
rem KWT_STUDIO_BRIDGE_V1_3_1: verify extension API before launching UI; don't silently reuse old bridge.
"%PYTHON%" "%ROOT%\studio-bridge\bridge_launcher.py" ensure
if errorlevel 1 (
  echo [ERROR] Bridge startup/version check failed. No GUI was launched.
  pause
  exit /b 1
)
cd /d "%ROOT%\studio"
if not exist node_modules (
  echo [Studio] Installing npm packages...
  call npm install || (echo [ERROR] npm install failed & pause & exit /b 1)
)
call npm run tauri dev
rem KWT_STUDIO_EXIT_CLEANUP_V1_5 : stop recognized loopback Kone services on Studio exit
rem KWT_GUI_LIFECYCLE_V1_4_0: GUI lease expiry stops Studio-owned servers; do not kill external port listeners.
if errorlevel 1 (echo [ERROR] Studio failed; check Rust, MSVC Build Tools, WebView2. & pause)
endlocal
