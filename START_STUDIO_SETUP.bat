@echo off
setlocal EnableExtensions
rem KWT_STUDIO_INSTALLER_V2_0_0
chcp 65001 >nul
cd /d "%~dp0"
echo ====================================================
echo  KoneWebTranslator - Studio first-time setup
echo ====================================================
if not exist "%~dp0SETUP.bat" (
 echo [ERROR] Run this BAT from KoneWebTranslator root.
 pause
 exit /b 1
)
call "%~dp0SETUP.bat" <nul
if errorlevel 1 (
 echo [ERROR] Basic Studio setup failed. Read the output above.
 pause
 exit /b 1
)
where cargo >nul 2>nul
if not errorlevel 1 (
 echo [INFO] Rust detected. Launching desktop Studio...
 call "%~dp0RUN_STUDIO.bat"
) else (
 echo [INFO] Rust/Cargo is not installed. Launching Studio in web preview mode.
 echo [INFO] Install Rust and Windows C++ Build Tools for standalone desktop app.
 call "%~dp0RUN_STUDIO_WEB.bat"
)
if errorlevel 1 (
 echo [ERROR] Studio launch failed. See errors above.
 pause
 exit /b 1
)
endlocal
