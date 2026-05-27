@echo off
setlocal

cd /d "%~dp0"

echo Capturing the full Pantheon window for calibration...
echo.
echo This will give you 5 seconds to click/focus the Pantheon
echo game window you want to calibrate.
echo.

npm run calibrate

echo.
echo Open:
echo   data\calibration-full.png
echo   data\calibration-grid.png
echo.
pause
