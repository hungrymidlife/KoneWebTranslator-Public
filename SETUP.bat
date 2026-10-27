@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "studio\package.json" (echo [ERROR] Run this file from the repository root. & pause & exit /b 1)
where py >nul 2>nul || (echo [ERROR] Python launcher missing. Install Python 3.11. & pause & exit /b 1)
py -3.11 --version >nul 2>nul || (echo [ERROR] Python 3.11 required. & pause & exit /b 1)
where npm >nul 2>nul || (echo [ERROR] Node.js/npm required. & pause & exit /b 1)
echo [1/3] Setting up Python environment...
if not exist "local-server\.venv\Scripts\python.exe" (
  py -3.11 -m venv "local-server\.venv" || goto failed
)
"local-server\.venv\Scripts\python.exe" -m pip install --upgrade pip || goto failed
"local-server\.venv\Scripts\python.exe" -m pip install -r "local-server\requirements.txt" || goto failed
rem KWT_BUBBLE_OPENCV_DEP_V1: verify OpenCV loads in the exact Studio Bridge Python.
"local-server\.venv\Scripts\python.exe" -c "import cv2; from importlib.metadata import version; assert version('opencv-python-headless')=='4.11.0.86'; print('[OK] Bubble OpenCV:',cv2.__version__)" || goto failed
echo [2/3] Installing Studio dependencies...
pushd studio
if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
set "NPM_RESULT=%ERRORLEVEL%"
popd
if not "%NPM_RESULT%"=="0" goto failed
echo [3/3] Optional OCR setup instructions...
echo For Hayai OCR CUDA environment, run SETUP_HAYAI.bat separately.
echo Comic Text Detector ONNX model must be downloaded separately.
echo For desktop Studio install Rust and Microsoft C++ Build Tools; web preview uses RUN_STUDIO_WEB.bat.
echo [OK] Basic environment setup complete.
pause
exit /b 0
:failed
echo [ERROR] Setup failed. Check messages above.
pause
exit /b 1
