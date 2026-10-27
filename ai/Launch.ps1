# KoneWebTranslator-Public / Studio Gemma launcher
# Adapted from the user-provided Launch.ps1: only model/server paths are relocated.
param(
    [switch]$MTP,
    [Parameter(Mandatory=$true)]
    [string]$InstallRoot
)
$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath($InstallRoot)
$server = Join-Path $root 'llama-bin\llama-server.exe'
$model = Join-Path $root 'models\Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf'
$draft = Join-Path $root 'models\mtp-gemma-4-12B-it.gguf'

if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw "Server executable missing: $server" }
if (-not (Test-Path -LiteralPath $model -PathType Leaf)) { throw "Model missing: $model" }

$argsList = @(
    '-m', $model,
    '-ngl', '99',
    '-fa', 'on',
    '-c', '8192',
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
    if (-not (Test-Path -LiteralPath $draft -PathType Leaf)) {
        throw "MTP draft model missing: $draft. Select Normal mode or install the MTP draft model."
    }
    $helpText = (& $server --help 2>&1 | Out-String)
    if ($helpText -notmatch 'draft-mtp') {
        throw 'This llama.cpp build does not advertise draft-mtp. Select Normal mode or use a compatible build.'
    }
    $argsList += @('-md', $draft, '--spec-type', 'draft-mtp')
    Write-Host 'MTP enabled (speculative decoding)' -ForegroundColor Green
} else {
    Write-Host 'Normal decoding (baseline)' -ForegroundColor Yellow
}
Write-Host "Install root: $root"
Write-Host 'API: http://127.0.0.1:18080/v1/chat/completions'
Write-Host 'Only local PC can connect.'
& $server @argsList
if ($LASTEXITCODE -ne 0) {
    Write-Host "Exit code: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
