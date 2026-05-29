@echo off
setlocal

cd /d "%~dp0"

if not exist "data" mkdir "data"

echo Starting Pantheon DPS Dashboard...
echo.
echo Open http://localhost:3107 in your browser.
echo Note: StartPantheonParser.bat now starts both the parser and dashboard.
echo This launcher is only for dashboard-only troubleshooting.
echo.

for /f "usebackq tokens=*" %%A in (`powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3107 -State Listen -ErrorAction SilentlyContinue) { 'yes' }"`) do set DASHBOARD_RUNNING=%%A

if "%DASHBOARD_RUNNING%"=="yes" (
  echo Dashboard is already running.
  echo Opening http://localhost:3107 ...
  start "" "http://localhost:3107"
  echo.
  pause
  exit /b 0
)

start "" "http://localhost:3107"
npm run dashboard

echo.
echo Pantheon DPS Dashboard stopped.
pause
