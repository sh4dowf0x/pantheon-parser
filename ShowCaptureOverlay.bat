@echo off
setlocal

cd /d "%~dp0"

echo Starting Pantheon capture overlay...
echo.
echo The overlay follows data\capture-region.json.
echo Start the parser if no border appears yet.
echo Press Ctrl+C in this window to stop the overlay.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\capture-overlay.ps1" -RegionPath "%~dp0data\capture-region.json" -ShowLabel

echo.
echo Capture overlay stopped.
pause
