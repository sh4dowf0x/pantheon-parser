@echo off
setlocal

cd /d "%~dp0"

echo Running one debug capture...
echo.
echo After this finishes, check:
echo   data\last-capture.png
echo   data\last-ocr.txt
echo.
echo After startup, this will give you 5 seconds to click/focus
echo the Pantheon game window you want to capture.
echo.

npm run debug:capture

echo.
pause
