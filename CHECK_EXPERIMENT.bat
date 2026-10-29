@echo off
setlocal
cd /d "%~dp0"
set "PY=local-server\.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo [ERROR] Python virtual environment missing. Prepare OCR environment first.
  pause
  exit /b 2
)
echo [CHECK] Python source syntax...
"%PY%" -m compileall -q local-server local-trans studio-bridge tests
if errorlevel 1 goto failure
echo [CHECK] Experiment unit tests...
"%PY%" -m unittest discover -s tests -p "test_*experiment*.py" -v
if errorlevel 1 goto failure
"%PY%" -m unittest discover -s tests -p "test_*manga*.py" -v
if errorlevel 1 goto failure
"%PY%" -m unittest discover -s tests -p "test_smart_linebreak.py" -v
if errorlevel 1 goto failure
pushd studio
call npm run build
set "CODE=%ERRORLEVEL%"
popd
if not "%CODE%"=="0" goto failure
echo [OK] Experiment offline checks passed. Full Windows ZIP run remains separate.
pause
exit /b 0
:failure
echo [ERROR] Experiment check failed; inspect the error lines above.
pause
exit /b 1
