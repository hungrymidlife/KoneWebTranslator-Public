@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "GIT_EDITOR=true"
set "VISUAL=true"
set "EDITOR=true"
set "GIT_SEQUENCE_EDITOR=true"

where git >nul 2>nul
if errorlevel 1 goto :GIT_NOT_FOUND

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :NOT_GIT_REPO

for /f "delims=" %%R in ('git rev-parse --show-toplevel') do set "REPO_ROOT=%%R"
cd /d "%REPO_ROOT%"

set "BRANCH="
for /f "delims=" %%B in ('git symbolic-ref --quiet --short HEAD 2^>nul') do set "BRANCH=%%B"
if not defined BRANCH goto :DETACHED_HEAD

set "REMOTE="
for /f "delims=" %%R in ('git config --get branch.%BRANCH%.remote 2^>nul') do set "REMOTE=%%R"
if not defined REMOTE set "REMOTE=origin"

git remote get-url "%REMOTE%" >nul 2>&1
if errorlevel 1 goto :REMOTE_NOT_FOUND

if exist "%REPO_ROOT%\.git\.COMMIT_EDITMSG.swp" del /f /q "%REPO_ROOT%\.git\.COMMIT_EDITMSG.swp" >nul 2>&1

for /f "delims=" %%M in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "COMMIT_TITLE=%%M"

echo.
echo [INFO] Repository: %REPO_ROOT%
echo [INFO] Branch    : %BRANCH%
echo [INFO] Remote    : %REMOTE%
echo.

git add -A
if errorlevel 1 goto :FAIL

git diff --cached --quiet
if not errorlevel 1 goto :PUSH_ONLY

echo [INPUT] Optional one-line commit body. Empty = timestamp title only.
set "COMMIT_BODY="
set /p "COMMIT_BODY=> "

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $title=$env:COMMIT_TITLE; $body=$env:COMMIT_BODY; if ([string]::IsNullOrWhiteSpace($body)) { & git -c core.editor=true commit -m $title } else { & git -c core.editor=true commit -m $title -m $body }; exit $LASTEXITCODE"
if errorlevel 1 goto :FAIL

:PUSH_ONLY
git push -u "%REMOTE%" "HEAD:%BRANCH%"
if errorlevel 1 goto :FAIL

echo.
echo [OK] Commit/push completed.
pause
exit /b 0

:GIT_NOT_FOUND
echo [ERROR] Git not found.
goto :ENDFAIL
:NOT_GIT_REPO
echo [ERROR] This folder is not a Git repository.
goto :ENDFAIL
:DETACHED_HEAD
echo [ERROR] Detached HEAD state.
goto :ENDFAIL
:REMOTE_NOT_FOUND
echo [ERROR] Remote "%REMOTE%" not found. Run GITHUB_CREATE_REPO.bat or add origin manually.
goto :ENDFAIL
:FAIL
echo [ERROR] Git operation failed.
:ENDFAIL
pause
exit /b 1
