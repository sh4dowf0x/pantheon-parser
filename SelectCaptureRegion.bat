@echo off
setlocal

cd /d "%~dp0"

echo Select the combat log capture region.
echo.
echo 1. Make the Pantheon combat log visible and opaque.
echo 2. Focus/click the Pantheon window when prompted.
echo 3. Drag a rectangle around only the combat log text area.
echo 4. Press Escape to cancel.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\select-region.ps1" -ConfigPath "%~dp0config.json"
if errorlevel 1 (
  echo.
  echo Region selection failed. Config was not updated.
  pause
  exit /b 1
)

echo.
echo Run DebugCapture.bat next to verify data\last-capture.png.
pause
