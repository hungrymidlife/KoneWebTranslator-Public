@echo off
setlocal
set "ROOT=%~dp0"
set "PY=%ROOT%local-server\.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=py -3.11"
%PY% "%ROOT%local-trans\gui.py"
if errorlevel 1 pause
