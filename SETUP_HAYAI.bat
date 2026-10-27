@echo off
setlocal
cd /d "%~dp0"
if not exist "local-server\Install_Hayai_OCR.bat" (echo [ERROR] OCR installer missing. & pause & exit /b 1)
call "local-server\Install_Hayai_OCR.bat"
exit /b %ERRORLEVEL%
