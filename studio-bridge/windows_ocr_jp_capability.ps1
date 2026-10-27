param(
    [ValidateSet('test','install')][string]$Action='test'
)
# KWT_WINOCR_LANG_TEST_ELEVATION_UTF8_PUBLIC_V206
# Windows PowerShell 5.1 requires a UTF-8 BOM to read Korean source correctly.
# The patch packager writes this script with a UTF-8 BOM.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$Capability = 'Language.OCR~~~ja-JP~0.0.1.0'

function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-WinRtJapaneseOcr {
    # $null means the WinRT API could not be queried; use elevated DISM as fallback.
    try {
        $languages = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]::AvailableRecognizerLanguages
        if ($null -eq $languages) { return $null }
        foreach ($language in $languages) {
            if ($language.LanguageTag -ieq 'ja-JP') { return $true }
        }
        return $false
    } catch {
        Write-Host ('[INFO] WinRT 언어 조회 불가, Windows 기능 검사로 전환: ' + $_.Exception.Message)
        return $null
    }
}

try {
    $elevated = Test-IsElevated

    # A normal Studio test should not require UAC when the WinRT OCR API is available.
    if ($Action -eq 'test' -and -not $elevated) {
        $winrtState = Test-WinRtJapaneseOcr
        if ($null -ne $winrtState) {
            if ($winrtState) {
                Write-Output '[OK] Windows OCR WinRT 일본어(ja-JP) 인식 언어 사용 가능'
                exit 0
            }
            Write-Output '[MISSING] Windows OCR WinRT 일본어(ja-JP) 인식 언어 없음 · 설치 또는 Windows 재시작 후 다시 검사하세요.'
            exit 3
        }
        Write-Output '[INFO] WinRT 조회가 불가능하여 관리자 권한으로 Windows 기능 설치 상태를 확인합니다.'
    }

    if (-not $elevated) {
        if ($Action -eq 'install') {
            Write-Output '[INFO] Windows 일본어 OCR 언어팩 설치를 위해 UAC 관리자 승인이 필요합니다.'
        } else {
            Write-Output '[INFO] Windows OCR 설치 상태 확인을 위해 UAC 관리자 승인이 필요합니다.'
        }
        $quotedFile = '"' + $PSCommandPath.Replace('"','""') + '"'
        $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + $quotedFile + ' -Action ' + $Action
        $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $args -Verb RunAs -Wait -PassThru -ErrorAction Stop
        if ($null -eq $child) { throw '관리자 권한 프로세스를 시작하지 못했습니다.' }
        if ($child.ExitCode -ne 0) {
            Write-Output ('[ERROR] Windows OCR 관리자 ' + $Action + ' 실패: 종료 코드 ' + $child.ExitCode)
            exit $child.ExitCode
        }
        Write-Output ('[OK] Windows OCR 관리자 ' + $Action + ' 완료 · 종료 코드 0')
        exit 0
    }

    $state = (Get-WindowsCapability -Online -Name $Capability -ErrorAction Stop).State
    if ($state -eq 'Installed') {
        Write-Output ('[OK] ' + $Capability + ' : Installed')
        exit 0
    }
    if ($Action -eq 'test') {
        Write-Output ('[MISSING] ' + $Capability + ' : ' + $state + ' · 설치 버튼을 눌러 주세요.')
        exit 3
    }

    Write-Output ('[INFO] ' + $Capability + ' 설치 중 · 현재 상태: ' + $state)
    Add-WindowsCapability -Online -Name $Capability -ErrorAction Stop | Out-Null
    $after = (Get-WindowsCapability -Online -Name $Capability -ErrorAction Stop).State
    if ($after -ne 'Installed') { throw ('설치 후 상태가 Installed가 아닙니다: ' + $after) }
    Write-Output ('[OK] ' + $Capability + ' : Installed')
    exit 0
} catch {
    Write-Output ('[ERROR] Windows OCR 점검/설치 실패: ' + $_.Exception.Message)
    if ($Action -eq 'test') {
        Write-Output '[INFO] 관리자 PowerShell에서 Get-WindowsCapability -Online -Name Language.OCR~~~ja-JP~0.0.1.0 명령으로 확인할 수 있습니다.'
    }
    exit 1
}
