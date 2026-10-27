@echo off
cd /d "%~dp0"
py -3.11 -m venv .venv
if errorlevel 1 (echo Python 3.11 is required. & pause & exit /b 1)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (echo Installation failed. & pause & exit /b 1)
rem KWT_BUBBLE_OPENCV_DEP_V1: test the target venv after package installation.
python -c "import cv2; from importlib.metadata import version; assert version('opencv-python-headless')=='4.11.0.86'; print('[OK] Bubble OpenCV:',cv2.__version__)"
if errorlevel 1 (echo OpenCV verification failed. & pause & exit /b 1)
echo Installation complete.
pause
