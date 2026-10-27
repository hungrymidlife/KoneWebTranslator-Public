param([switch]$MTP)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pathFile = Join-Path $root 'server-path.txt'
if (-not (Test-Path $pathFile)) { throw 'Run Install.bat first.' }
$server = (Get-Content $pathFile -Raw).Trim()
$model = Join-Path $root 'models\Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf'
$draft = Join-Path $root 'models\mtp-gemma-4-12B-it.gguf'
if (-not (Test-Path $server)) { throw "Server executable missing: $server" }
if (-not (Test-Path $model)) { throw "Model missing: $model" }
$argsList = @(
    '-m', $model,
    '-ngl', '99',
    '-fa', 'on',
    '-c', '4096',
    '-np', '1',
    '--host', '127.0.0.1',
    '--port', '18080',
    '--alias', 'gemma4-12b-local',
    '--top-k', '64',
    '--top-p', '0.9',
    '--min-p', '0.05',
    '--repeat-penalty', '1.1'
)
if ($MTP) {
  if (-not (Test-Path $draft)) { throw "MTP model missing: $draft" }
  $helpText = (& $server --help 2>&1 | Out-String)
  if ($helpText -notmatch 'draft-mtp') { throw 'This llama.cpp build does not advertise draft-mtp. Update build or run Start_Normal.bat.' }
  $argsList += @('-md',$draft,'--spec-type','draft-mtp')
  Write-Host 'MTP enabled (speculative decoding)' -ForegroundColor Green
} else { Write-Host 'Normal decoding (baseline)' -ForegroundColor Yellow }
Write-Host 'API: http://127.0.0.1:18080/v1/chat/completions'
Write-Host 'Press Ctrl+C to stop. Only local PC can connect.'
& $server @argsList
if ($LASTEXITCODE -ne 0) { Write-Host "Exit code: $LASTEXITCODE" -ForegroundColor Red; exit $LASTEXITCODE }
