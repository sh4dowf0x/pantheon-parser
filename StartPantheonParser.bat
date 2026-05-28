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

set OVERLAY_PID=
for /f "usebackq tokens=*" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0scripts\capture-overlay.ps1','-RegionPath','%~dp0data\capture-region.json','-ShowLabel') -WindowStyle Hidden -PassThru; $p.Id"`) do set OVERLAY_PID=%%A

if defined OVERLAY_PID (
  echo Capture overlay started. PID %OVERLAY_PID%
  echo.
) else (
  echo Capture overlay did not start. Continuing parser only.
  echo.
)

npm start

if defined OVERLAY_PID (
  powershell -NoProfile -Command "Stop-Process -Id %OVERLAY_PID% -Force -ErrorAction SilentlyContinue"
)

echo.
echo Pantheon Parser stopped.
pause
