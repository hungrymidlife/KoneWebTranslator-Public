@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python Launcher not found. Install Python 3.11.
  pause
  exit /b 1
)
py -3.11 "%~dp0download_detector.py"
if errorlevel 1 (
  echo [ERROR] Model download or verification failed.
  pause
  exit /b 1
)
call "%~dp0local-server\setup_detector.bat"
if errorlevel 1 (
  echo [ERROR] Detector initialization failed.
  pause
  exit /b 1
)
echo [OK] Detector ready.
pause
