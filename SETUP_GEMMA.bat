@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul || (echo [ERROR] Python launcher required. & pause & exit /b 1)
py -3.11 "%~dp0setup_gemma.py" %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (echo [ERROR] Gemma setup failed. & pause & exit /b %RESULT%)
echo [OK] Gemma setup finished.
pause
