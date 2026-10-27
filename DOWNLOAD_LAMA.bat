@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
 echo [ERROR] Python Launcher missing. Install Python 3.11.
 pause
 exit /b 1
)
py -3.11 "%~dp0download_lama.py"
if errorlevel 1 (
 echo [ERROR] LaMa download or checksum verification failed.
 pause
 exit /b 1
)
echo [OK] LaMa model download completed.
pause
