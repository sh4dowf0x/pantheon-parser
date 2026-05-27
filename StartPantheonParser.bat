@echo off
setlocal

cd /d "%~dp0"

echo Starting Pantheon Parser...
echo.
echo Make sure the Pantheon combat log is visible in the lower-right
echo and not covered by another window.
echo.
echo If one Pantheon window is open, it will be selected automatically.
echo If multiple are open, you will be prompted to choose the PID.
echo.

npm start

echo.
echo Pantheon Parser stopped.
pause
