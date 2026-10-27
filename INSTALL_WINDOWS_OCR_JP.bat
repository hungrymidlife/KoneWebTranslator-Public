@echo off
setlocal
cd /d "%~dp0"
echo === KoneWebTranslator Japanese Windows OCR pack ===
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$n='Language.OCR~~~ja-JP~0.0.1.0'; try { $x=Get-WindowsCapability -Online -Name $n -ErrorAction Stop; if($x.State -eq 'Installed'){Write-Host '[OK] Japanese Windows OCR already installed.'; exit 0}; Write-Host ('[INFO] Current state: '+$x.State); $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); if(-not $admin){Write-Host '[ERROR] Please right-click this BAT and Run as administrator.'; exit 2}; Add-WindowsCapability -Online -Name $n -ErrorAction Stop | Out-Host; $y=Get-WindowsCapability -Online -Name $n -ErrorAction Stop; if($y.State -ne 'Installed'){Write-Host ('[ERROR] State after install: '+$y.State); exit 3}; Write-Host '[OK] Japanese Windows OCR installed. Restart the OCR server.'; exit 0 } catch {Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo [ERROR] Windows Japanese OCR check/install failed: %RC%
  pause
  exit /b %RC%
)
echo [OK] Done.
pause
exit /b 0
