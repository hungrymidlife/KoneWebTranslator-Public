@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (py -3 "%~dp0KoneGemmaManager.py") else (python "%~dp0KoneGemmaManager.py")
if errorlevel 1 pause
