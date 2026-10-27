@echo off
setlocal
set "ROOT=%~dp0"
if not "%~1"=="" set "ROOT=%~1\"
set "PYTHON=%ROOT%local-server\.venv\Scripts\python.exe"
if not exist "%PYTHON%" (echo [ERROR] Missing %PYTHON% & pause & exit /b 1)
"%PYTHON%" "%ROOT%studio-bridge\bridge_launcher.py" check
pause
