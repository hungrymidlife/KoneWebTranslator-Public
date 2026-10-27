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

# KWT_UNIFIED_RUNTIME_V1: validated JSON saved by Studio; fallback is the original launcher.
$gemmaOptions = @{
    context_size = 8192; gpu_layers = 99; flash_attention = 'on'; parallel_slots = 1
    top_k = 64; top_p = 0.9; min_p = 0.05; repeat_penalty = 1.1
}
$runtimeFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime_settings.json'
if (Test-Path -LiteralPath $runtimeFile -PathType Leaf) {
    $runtimeJson = Get-Content -LiteralPath $runtimeFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($runtimeJson.schema_version -ne 1 -or $null -eq $runtimeJson.gemma) {
        throw 'runtime_settings.json schema is invalid.'
    }
    foreach ($name in @('context_size','gpu_layers','flash_attention','parallel_slots','top_k','top_p','min_p','repeat_penalty')) {
        $item = $runtimeJson.gemma.PSObject.Properties[$name]
        if ($null -eq $item) { throw "runtime_settings.json missing Gemma option: $name" }
        $gemmaOptions[$name] = $item.Value
    }
    if ([int]$gemmaOptions['context_size'] -lt 2048 -or [int]$gemmaOptions['context_size'] -gt 131072 -or
        [int]$gemmaOptions['gpu_layers'] -lt 0 -or [int]$gemmaOptions['gpu_layers'] -gt 999 -or
        [int]$gemmaOptions['parallel_slots'] -lt 1 -or [int]$gemmaOptions['parallel_slots'] -gt 16 -or
        $gemmaOptions['flash_attention'] -notin @('on','off','auto')) {
        throw 'runtime_settings.json contains invalid Gemma launch options.'
    }
}

$argsList = @(
    '-m', $model,
    '-ngl', ([string]$gemmaOptions['gpu_layers']),
    '-fa', ([string]$gemmaOptions['flash_attention']),
    '-c', ([string]$gemmaOptions['context_size']),
    '-np', ([string]$gemmaOptions['parallel_slots']),
    '--host', '127.0.0.1',
    '--port', '18080',
    '--alias', 'gemma4-12b-local',
    '--top-k', ([string]$gemmaOptions['top_k']),
    '--top-p', ([System.Convert]::ToString([double]$gemmaOptions['top_p'],[System.Globalization.CultureInfo]::InvariantCulture)),
    '--min-p', ([System.Convert]::ToString([double]$gemmaOptions['min_p'],[System.Globalization.CultureInfo]::InvariantCulture)),
    '--repeat-penalty', ([System.Convert]::ToString([double]$gemmaOptions['repeat_penalty'],[System.Globalization.CultureInfo]::InvariantCulture))
)
# KWT_CHAT_ATTACH_V2_3: opt-in multimodal projector for image/video chat.
# Name a model-compatible projector exactly mmproj-gemma-4-12b-it.gguf.
$mmproj = Join-Path $root 'models\mmproj-gemma-4-12b-it.gguf'
if (Test-Path -LiteralPath $mmproj -PathType Leaf) {
    $mmHelp = (& $server --help 2>&1 | Out-String)
    if ($mmHelp -notmatch 'mmproj') {
        throw 'The installed llama-server does not support --mmproj. Update llama.cpp or remove the optional projector.'
    }
    $argsList += @('--mmproj', $mmproj)
    Write-Host 'Multimodal projector enabled for local chat (images/video frames).' -ForegroundColor Green
} else {
    Write-Host 'Multimodal projector absent: text-only chat. Image/video analysis will require a matching mmproj.' -ForegroundColor Yellow
}
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
