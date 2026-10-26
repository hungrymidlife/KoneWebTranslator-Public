@echo off
setlocal
cd /d "%~dp0"
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo ERROR: Existing Python venv not found. Run install.bat first.
  pause
  exit /b 1
)
"%PY%" "%~dp0setup_detector.py"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo.
  echo Detector setup failed. Read the error above.
  pause
  exit /b %RESULT%
)
echo.
echo Detector installation successful.
pause
exit /b 0
