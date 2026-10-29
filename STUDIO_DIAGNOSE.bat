@echo off
setlocal
set "PROJECT=C:\dev\KoneWebTranslator"
if not "%~1"=="" set "PROJECT=%~1"
if not exist "%PROJECT%\studio-bridge\studio_boot_diagnostic.py" (
  set /p "PROJECT=KoneWebTranslator project root: "
)
if not exist "%PROJECT%\studio-bridge\studio_boot_diagnostic.py" (
  echo [ERROR] Diagnostic module not found.
  pause
  exit /b 1
)
py -3 "%PROJECT%\studio-bridge\studio_boot_diagnostic.py"
set "CODE=%ERRORLEVEL%"
pause
endlocal & exit /b %CODE%
