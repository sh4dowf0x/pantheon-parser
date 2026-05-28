@echo off
setlocal

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found. Using GitHub ZIP updater instead...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-from-github.ps1" -Destination "%~dp0"
  if errorlevel 1 (
    echo GitHub ZIP update failed.
    pause
    exit /b 1
  )
  goto refresh_dependencies
)

if not exist ".git" (
  echo This folder is not a git checkout. Using GitHub ZIP updater instead...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-from-github.ps1" -Destination "%~dp0"
  if errorlevel 1 (
    echo GitHub ZIP update failed.
    pause
    exit /b 1
  )
  goto refresh_dependencies
)

git diff --quiet
if errorlevel 1 (
  echo Local file changes detected.
  echo Commit, stash, or move your changes before updating.
  git status --short
  pause
  exit /b 1
)

git diff --cached --quiet
if errorlevel 1 (
  echo Staged local changes detected.
  echo Commit, stash, or unstage your changes before updating.
  git status --short
  pause
  exit /b 1
)

echo Fetching latest version...
git fetch origin
if errorlevel 1 (
  echo Fetch failed.
  pause
  exit /b 1
)

echo Updating from origin/main...
git pull --ff-only origin main
if errorlevel 1 (
  echo Update failed. You may need to resolve git conflicts manually.
  pause
  exit /b 1
)

:refresh_dependencies
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Skipping dependency refresh.
) else (
  echo Refreshing dependencies...
  npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Pantheon Parser is up to date.
pause
