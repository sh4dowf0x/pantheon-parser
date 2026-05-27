@echo off
setlocal

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo Git is required to update Pantheon Parser.
  echo Install Git for Windows, then run this again.
  pause
  exit /b 1
)

if not exist ".git" (
  echo This folder is not a git checkout.
  echo Clone https://github.com/sh4dowf0x/pantheon-parser.git or run this from the project folder.
  pause
  exit /b 1
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
