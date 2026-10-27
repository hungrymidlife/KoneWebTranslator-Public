@echo off
setlocal
set "BASE=C:\AI\Gemma4MTP"
set "SERVER=%BASE%\llama-bin\llama-server.exe"
set "MODEL=%BASE%\models\Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf"
if not exist "%SERVER%" (echo [ERROR] llama-server missing. Run SETUP_GEMMA.bat. & pause & exit /b 1)
if not exist "%MODEL%" (echo [ERROR] Gemma model missing. Run SETUP_GEMMA.bat. & pause & exit /b 1)
"%SERVER%" -m "%MODEL%" --alias gemma4-12b-local --host 127.0.0.1 --port 18080 -ngl 99 -fa on -c 4096 -np 1
if errorlevel 1 (echo [ERROR] Gemma server exited with an error. & pause & exit /b 1)
