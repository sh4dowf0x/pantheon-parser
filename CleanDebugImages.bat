@echo off
setlocal

cd /d "%~dp0"

echo Deleting generated debug/calibration images...
echo.

if exist data\*.png del /q data\*.png
if exist data\*.txt del /q data\*.txt

echo Done.
pause
