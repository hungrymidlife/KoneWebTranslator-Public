@echo off
setlocal
cd /d "%~dp0"
set "PYTHON=%~dp0local-server\.venv\Scripts\python.exe"
if not exist "%PYTHON%" (echo [ERROR] Missing virtual environment: %PYTHON% & pause & exit /b 1)
if "%~1"=="" (
 echo [ERROR] Drag and drop an ORIGINAL Japanese ZIP onto this BAT.
 echo Optional second argument: baseline translated ZIP from main.
 pause
 exit /b 2
)
if "%~2"=="" (
 "%PYTHON%" "%~dp0local-trans\experiment_zip_runner.py" "%~1"
) else (
 "%PYTHON%" "%~dp0local-trans\experiment_zip_runner.py" "%~1" --baseline "%~2"
)
set "CODE=%ERRORLEVEL%"
if "%CODE%"=="0" (echo [OK] Test results created under kwt_experiment_results.) else (echo [ERROR] ZIP test failed. Check console and diagnostic report.)
pause
exit /b %CODE%
