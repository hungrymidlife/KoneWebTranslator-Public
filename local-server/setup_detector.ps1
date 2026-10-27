$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$default = 'C:\dev\KoneLocalTranslator'
Write-Host 'KoneLocalTranslator source folder (default: C:\dev\KoneLocalTranslator)'
$source = Read-Host 'Source folder'
if ([string]::IsNullOrWhiteSpace($source)) { $source = $default }
$source = $source.Trim('"')
$required = @('app\auto_detector.py', 'app\overlap_resolver.py')
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $source $rel))) {
    throw "Missing $rel in $source. Clone/download the original private repository first."
  }
}
$dest = Join-Path $root 'detector_vendor'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $source 'app\auto_detector.py') (Join-Path $dest 'auto_detector.py') -Force
Copy-Item (Join-Path $source 'app\overlap_resolver.py') (Join-Path $dest 'overlap_resolver.py') -Force
if (-not (Test-Path (Join-Path $dest '__init__.py'))) { New-Item -ItemType File (Join-Path $dest '__init__.py') | Out-Null }
$modelDir = Join-Path $root 'models'
New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
$modelTarget = Join-Path $modelDir 'comictextdetector.pt.onnx'
if (-not (Test-Path $modelTarget)) {
  $modelSource = Join-Path $source 'models\comictextdetector.pt.onnx'
  if (Test-Path $modelSource) {
    Copy-Item $modelSource $modelTarget
  } else {
    Write-Host 'ONNX weights not found in the original models folder.' -ForegroundColor Yellow
    $custom = Read-Host 'Full path to comictextdetector.pt.onnx (or press Enter to skip)'
    if (-not [string]::IsNullOrWhiteSpace($custom)) {
      Copy-Item $custom.Trim('"') $modelTarget -Force
    }
  }
}
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Existing .venv not found. Run the original install.bat first.' }
& $python -m pip install 'numpy>=1.26,<3' 'onnxruntime>=1.18,<2'
if ($LASTEXITCODE -ne 0) { throw 'Detector dependencies failed to install.' }
& $python -c 'from detector_vendor.auto_detector import ComicTextDetectorONNX; from detector_bridge import MODEL; d=ComicTextDetectorONNX(MODEL); print("DETECTOR READY")'
if ($LASTEXITCODE -ne 0) { throw 'Detector initialization failed. Check the model path and ONNX Runtime.' }
Write-Host 'Setup complete. Restart start.bat.' -ForegroundColor Green
