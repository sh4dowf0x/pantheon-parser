@echo off
setlocal

cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-Process -Name Pantheon -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Id, MainWindowTitle, @{Name='Started';Expression={$_.StartTime}}, Path | Format-Table -AutoSize"

echo.
echo To pin the parser to one window, edit config.json:
echo.
echo   "processId": 12345,
echo.
pause
