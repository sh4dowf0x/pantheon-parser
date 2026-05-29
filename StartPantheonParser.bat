@echo off
setlocal

cd /d "%~dp0"

if not exist "data" mkdir "data"

echo Starting Pantheon Parser...
echo.
echo Dashboard will open at http://localhost:3107
echo.
echo Make sure the Pantheon combat log is visible in the lower-right
echo and not covered by another window.
echo.
echo If one Pantheon window is open, it will be selected automatically.
echo If multiple are open, you will be prompted to choose the PID.
echo.

echo Stopping any existing parser, dashboard, or capture overlay processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$self = $PID; Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\" | Where-Object { $_.CommandLine -match 'src[\\/](index|app|dashboard)\.js' -or $_.CommandLine -match 'npm-cli\.js.*(start|dashboard)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process -Filter \"name = 'powershell.exe'\" | Where-Object { $_.ProcessId -ne $self -and $_.CommandLine -match 'capture-overlay\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo.

start "" "http://localhost:3107"
npm start

echo.
echo Pantheon Parser stopped.
pause
