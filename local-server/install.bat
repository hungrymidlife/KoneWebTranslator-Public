@echo off
cd /d "%~dp0"
py -3.11 -m venv .venv
if errorlevel 1 (echo Python 3.11 is required. & pause & exit /b 1)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (echo Installation failed. & pause & exit /b 1)
echo Installation complete.
pause
