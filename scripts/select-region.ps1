param(
  [string]$ConfigPath = (Join-Path (Get-Location) "config.json")
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RegionSelectWin32 {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll")]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
}
"@

[void][RegionSelectWin32]::SetProcessDPIAware()

Write-Host "Click/focus the Pantheon window with the combat log visible."
Write-Host "Starting selector in 5 seconds..."
Start-Sleep -Seconds 5

$handle = [RegionSelectWin32]::GetForegroundWindow()
$pantheonPid = 0
[void][RegionSelectWin32]::GetWindowThreadProcessId($handle, [ref]$pantheonPid)
$proc = Get-Process -Id $pantheonPid -ErrorAction Stop
if ($proc.ProcessName -ne "Pantheon") {
  throw "Foreground window is '$($proc.ProcessName)', not Pantheon."
}

$clientRect = New-Object RegionSelectWin32+RECT
[void][RegionSelectWin32]::GetClientRect($handle, [ref]$clientRect)
$clientTopLeft = New-Object RegionSelectWin32+POINT
$clientTopLeft.X = 0
$clientTopLeft.Y = 0
[void][RegionSelectWin32]::ClientToScreen($handle, [ref]$clientTopLeft)

$virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Bounds = $virtual
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::Black
$form.Opacity = 0.25
$form.Cursor = [System.Windows.Forms.Cursors]::Cross
$form.KeyPreview = $true

$script:startPoint = $null
$script:currentPoint = $null
$script:selected = $null

$form.Add_KeyDown({
  if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $script:selected = $null
    $form.Close()
  }
})

$form.Add_MouseDown({
  $script:startPoint = $_.Location
  $script:currentPoint = $_.Location
  $form.Invalidate()
})

$form.Add_MouseMove({
  if ($script:startPoint -ne $null) {
    $script:currentPoint = $_.Location
    $form.Invalidate()
  }
})

$form.Add_MouseUp({
  if ($script:startPoint -ne $null) {
    $x1 = [Math]::Min($script:startPoint.X, $_.Location.X) + $virtual.X
    $y1 = [Math]::Min($script:startPoint.Y, $_.Location.Y) + $virtual.Y
    $x2 = [Math]::Max($script:startPoint.X, $_.Location.X) + $virtual.X
    $y2 = [Math]::Max($script:startPoint.Y, $_.Location.Y) + $virtual.Y
    $script:selected = [pscustomobject]@{
      x = $x1
      y = $y1
      width = $x2 - $x1
      height = $y2 - $y1
    }
    $form.Close()
  }
})

$form.Add_Paint({
  if ($script:startPoint -ne $null -and $script:currentPoint -ne $null) {
    $x = [Math]::Min($script:startPoint.X, $script:currentPoint.X)
    $y = [Math]::Min($script:startPoint.Y, $script:currentPoint.Y)
    $w = [Math]::Abs($script:startPoint.X - $script:currentPoint.X)
    $h = [Math]::Abs($script:startPoint.Y - $script:currentPoint.Y)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Lime, 3)
    $_.Graphics.DrawRectangle($pen, $x, $y, $w, $h)
    $pen.Dispose()
  }
})

[void]$form.ShowDialog()

if ($script:selected -eq $null) {
  throw "No region selected."
}

$relative = [pscustomobject]@{
  x = [Math]::Max(0, $script:selected.x - $clientTopLeft.X)
  y = [Math]::Max(0, $script:selected.y - $clientTopLeft.Y)
  width = $script:selected.width
  height = $script:selected.height
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$config.capture.mode = "windowAbsolute"
$config.capture.window.processId = $pantheonPid
$config.capture.window.useForeground = $false
$config.capture.windowAbsolute.x = [int]$relative.x
$config.capture.windowAbsolute.y = [int]$relative.y
$config.capture.windowAbsolute.width = [int]$relative.width
$config.capture.windowAbsolute.height = [int]$relative.height

$json = $config | ConvertTo-Json -Depth 20
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ConfigPath, $json, $utf8NoBom)

Write-Host "Selected desktop region: x=$($script:selected.x), y=$($script:selected.y), w=$($script:selected.width), h=$($script:selected.height)"
Write-Host "Saved window-relative region: x=$($relative.x), y=$($relative.y), w=$($relative.width), h=$($relative.height)"
Write-Host "Updated $ConfigPath"
