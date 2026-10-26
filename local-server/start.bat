@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (echo Run install.bat first. & pause & exit /b 1)
set KWT_OCR_GPU=0
.venv\Scripts\python.exe server.py
pause
