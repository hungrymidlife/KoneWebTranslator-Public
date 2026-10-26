@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
echo [Hayai OCR v2.5 Nova] isolated environment setup
if not exist "server.py" (echo ERROR: Copy this BAT into KoneWebTranslator\local-server first.& pause & exit /b 1)
if not exist ".venv-hayai\Scripts\python.exe" (
  if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m venv ".venv-hayai"
  ) else (
    py -3.11 -m venv ".venv-hayai"
    if errorlevel 1 py -3.12 -m venv ".venv-hayai"
    if errorlevel 1 py -3 -m venv ".venv-hayai"
  )
)
if not exist ".venv-hayai\Scripts\python.exe" (echo ERROR: Python virtual environment creation failed.& pause & exit /b 1)
set "PY=.venv-hayai\Scripts\python.exe"
"%PY%" -m pip install -U pip
if errorlevel 1 goto failed
echo [1/3] Installing CUDA PyTorch, official cu128 wheels ...
"%PY%" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 goto failed
echo [2/3] Installing Hayai OCR and model dependencies ...
"%PY%" -m pip install "hayai-ocr==2.2.0" "transformers>=4.50,<5" accelerate safetensors sentencepiece
if errorlevel 1 goto failed
echo [3/3] Checking GPU and Python packages ...
"%PY%" -c "import torch,transformers,hayai_ocr; print('torch:',torch.__version__,'CUDA available:',torch.cuda.is_available()); print('transformers:',transformers.__version__)"
if errorlevel 1 goto failed
"%PY%" -m pip check
if errorlevel 1 goto failed
echo.
echo [OK] Hayai environment is ready. First OCR run downloads model weights from Hugging Face.
echo This is independent from the existing .venv used by MangaOCR.
pause
exit /b 0
:failed
echo [ERROR] Installation did not complete. Existing .venv is unchanged.
pause
exit /b 1
