param(
    [ValidateSet('test','install')][string]$Action='test'
)
# KWT_INSTALL_AUDIT_V2_0_1 - Windows Japanese OCR optional capability.
# Only this fixed Windows capability can be installed. No user-supplied commands.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$Capability = 'Language.OCR~~~ja-JP~0.0.1.0'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($Action -eq 'install' -and -not $elevated) {
        Write-Output '[INFO] Windows 일본어 OCR 언어팩은 관리자 승인이 필요합니다. UAC 창에서 승인해 주세요.'
        $quotedFile = '"' + $PSCommandPath.Replace('"','""') + '"'
        $args = '-NoProfile -ExecutionPolicy Bypass -File ' + $quotedFile + ' -Action install'
        $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $args -Verb RunAs -Wait -PassThru
        if ($null -eq $child) { throw '관리자 설치 프로세스를 시작하지 못했습니다.' }
        if ($child.ExitCode -ne 0) { Write-Output ('[ERROR] 관리자 설치 실패: exit '+$child.ExitCode); exit $child.ExitCode }
        Write-Output '[OK] Windows OCR 관리자 설치가 완료됐습니다. 테스트 버튼으로 다시 확인하세요.'
        exit 0
    }
    $state = (Get-WindowsCapability -Online -Name $Capability -ErrorAction Stop).State
    if ($state -eq 'Installed') {
        Write-Output ('[OK] '+$Capability+' : Installed')
        exit 0
    }
    if ($Action -eq 'test') {
        Write-Output ('[MISSING] '+$Capability+' : '+$state+' / 설치 버튼을 눌러 주세요.')
        exit 3
    }
    Write-Output ('[INFO] '+$Capability+' 설치 중 · 현재 '+$state)
    Add-WindowsCapability -Online -Name $Capability -ErrorAction Stop | Out-Null
    $after = (Get-WindowsCapability -Online -Name $Capability -ErrorAction Stop).State
    if ($after -ne 'Installed') { throw ('설치 후 상태가 Installed가 아닙니다: '+$after) }
    Write-Output ('[OK] '+$Capability+' : Installed')
    exit 0
} catch {
    Write-Output ('[ERROR] Windows OCR 점검/설치 실패: '+$_.Exception.Message)
    Write-Output '[INFO] 테스트에서 권한 오류가 난다면 관리자 PowerShell로 설치 상태를 확인하세요.'
    exit 1
}
