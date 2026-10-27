param(
    [ValidateSet('test','install')][string]$Action = 'test',
    [string]$LogPath = ''
)
# KWT_WINOCR_LANG_ELEVATED_DIAGNOSTICS_PUBLIC_V207
# Save with UTF-8 BOM for Windows PowerShell 5.1 Korean strings.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Capability = 'Language.OCR~~~ja-JP~0.0.1.0'

function Emit([string]$Message) {
    [Console]::Out.WriteLine($Message)
    if ($LogPath) {
        [System.IO.File]::AppendAllText($LogPath, $Message + [Environment]::NewLine, $script:Utf8NoBom)
    }
}

function Is-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function WinRt-State {
    try {
        $langs = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]::AvailableRecognizerLanguages
        if ($null -eq $langs) { return 'unknown' }
        foreach ($lang in $langs) {
            if ($lang.LanguageTag -ieq 'ja-JP') { return 'available' }
        }
        return 'missing'
    } catch {
        return 'unknown'
    }
}

function Capability-State {
    $cap = Get-WindowsCapability -Online -Name $Capability -ErrorAction Stop
    if ($null -eq $cap) { throw ('Windows 기능을 찾을 수 없습니다: ' + $Capability) }
    return [string]$cap.State
}

function Elevated-Work {
    Emit ('[INFO] 관리자 권한: ' + (Is-Admin))
    $before = Capability-State
    Emit ('[STATE] ' + $Capability + ' : ' + $before)
    if ($Action -eq 'install' -and $before -ne 'Installed') {
        Emit ('[INFO] Add-WindowsCapability 실행 중: ' + $Capability)
        $result = Add-WindowsCapability -Online -Name $Capability -ErrorAction Stop
        if ($null -ne $result) {
            Emit ('[INFO] Add-WindowsCapability 결과: Online=' + $result.Online + ', RestartNeeded=' + $result.RestartNeeded)
        }
    }
    $after = Capability-State
    Emit ('[STATE] 설치 후 Windows 기능 상태: ' + $after)
    $winrt = WinRt-State
    Emit ('[STATE] WinRT 일본어 OCR: ' + $winrt)
    if ($after -ne 'Installed') {
        if ($after -eq 'InstallPending') {
            Emit '[WARN] Windows 기능 설치가 재시작 대기 중입니다. Windows를 재시작한 후 다시 검사하세요.'
            return 4
        }
        Emit ('[MISSING] Windows 일본어 OCR 기능이 Installed 상태가 아닙니다: ' + $after)
        return 3
    }
    if ($winrt -eq 'available') {
        Emit '[OK] Windows 일본어 OCR 기능 설치됨 · WinRT 인식 가능'
        return 0
    }
    if ($winrt -eq 'missing') {
        Emit '[WARN] Windows 기능은 Installed지만 WinRT 일본어 OCR 목록에는 없습니다. Windows 재시작 후 테스트하세요.'
        return 4
    }
    Emit '[WARN] Windows 기능은 Installed지만 WinRT 조회에 실패했습니다. 재시작 후 Studio 테스트를 다시 실행하세요.'
    return 4
}

try {
    $elevated = Is-Admin
    if (-not $elevated) {
        if ($Action -eq 'test') {
            $quick = WinRt-State
            Emit ('[STATE] 일반 권한 WinRT 일본어 OCR: ' + $quick)
            if ($quick -eq 'available') {
                Emit '[OK] Windows OCR WinRT 일본어(ja-JP) 인식 언어 사용 가능'
                exit 0
            }
            Emit '[INFO] WinRT 검사만으로는 설치 실패를 확정할 수 없어 관리자 권한으로 Windows 기능 상태를 조회합니다.'
        } else {
            Emit '[INFO] Windows 일본어 OCR 설치를 위해 관리자 권한을 요청합니다.'
        }
        $logDir = Join-Path $env:LOCALAPPDATA 'KoneWebTranslator\logs'
        New-Item -ItemType Directory -Path $logDir -Force -ErrorAction Stop | Out-Null
        $log = Join-Path $logDir ('winocr_' + $Action + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '_' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.log')
        [System.IO.File]::WriteAllText($log, '', $script:Utf8NoBom)
        $exe = Join-Path $PSHOME 'powershell.exe'
        $quotedScript = '"' + $PSCommandPath.Replace('"','""') + '"'
        $quotedLog = '"' + $log.Replace('"','""') + '"'
        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + $quotedScript + ' -Action ' + $Action + ' -LogPath ' + $quotedLog
        Emit ('[INFO] 관리자 프로세스 실행 · 로그: ' + $log)
        $child = Start-Process -FilePath $exe -ArgumentList $arguments -Verb RunAs -Wait -PassThru -ErrorAction Stop
        if ($null -eq $child) { throw '관리자 프로세스를 실행하지 못했습니다.' }
        $messages = [System.IO.File]::ReadAllLines($log, [System.Text.Encoding]::UTF8)
        foreach ($message in $messages) { [Console]::Out.WriteLine($message) }
        Emit ('[INFO] 관리자 프로세스 종료 코드: ' + $child.ExitCode)
        if ($messages.Count -eq 0) {
            Emit '[ERROR] 관리자 프로세스 실행 로그가 비어 있습니다. 설치 성공으로 처리하지 않습니다.'
            exit 1
        }
        if ($null -eq $child.ExitCode) { Emit '[ERROR] 관리자 프로세스 종료 코드를 확인하지 못했습니다.'; exit 1 }
        exit [int]$child.ExitCode
    }
    $resultCode = Elevated-Work
    exit [int]$resultCode
} catch {
    Emit ('[ERROR] Windows 일본어 OCR ' + $Action + ' 실패: ' + $_.Exception.Message)
    if ($_.Exception.HResult) { Emit ('[ERROR] HRESULT: 0x{0:X8}' -f ($_.Exception.HResult -band 0xFFFFFFFF)) }
    Emit '[INFO] Windows 기능 확인: 관리자 PowerShell에서 Get-WindowsCapability -Online -Name Language.OCR~~~ja-JP~0.0.1.0'
    exit 1
}
