@echo off
setlocal
cd /d "%~dp0"
py -3.11 "%~dp0setup_gemma.py" --check
if errorlevel 1 (echo [ERROR] Installation check failed. & pause & exit /b 1)
powershell -NoProfile -Command "try { (Invoke-RestMethod 'http://127.0.0.1:18080/v1/models' -TimeoutSec 5) | ConvertTo-Json -Depth 4 } catch { Write-Host '[INFO] Server not running; start RUN_GEMMA.bat' }"
pause
