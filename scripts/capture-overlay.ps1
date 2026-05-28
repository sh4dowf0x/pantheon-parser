param(
  [string]$RegionPath = "data\capture-region.json",
  [int]$PollMs = 250,
  [string]$BorderColor = "#00E5FF",
  [int]$BorderWidth = 3,
  [switch]$ShowLabel
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PantheonOverlayNative {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll", SetLastError = true)]
  public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
}
"@

[void][PantheonOverlayNative]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()

$resolvedRegionPath = if ([System.IO.Path]::IsPathRooted($RegionPath)) {
  $RegionPath
} else {
  Join-Path (Get-Location) $RegionPath
}

$transparentColor = [System.Drawing.Color]::FromArgb(255, 1, 0, 255)
$border = [System.Drawing.ColorTranslator]::FromHtml($BorderColor)
$state = [pscustomobject]@{
  RegionKey = ""
  Strategy = ""
  ObservedAt = ""
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Pantheon Parser Capture Overlay"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.BackColor = $transparentColor
$form.TransparencyKey = $transparentColor
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.Width = 1
$form.Height = 1

$form.Add_Shown({
  $GWL_EXSTYLE = -20
  $WS_EX_TRANSPARENT = 0x20
  $WS_EX_TOOLWINDOW = 0x80
  $WS_EX_NOACTIVATE = 0x08000000
  $current = [PantheonOverlayNative]::GetWindowLong($form.Handle, $GWL_EXSTYLE)
  [void][PantheonOverlayNative]::SetWindowLong($form.Handle, $GWL_EXSTYLE, $current -bor $WS_EX_TRANSPARENT -bor $WS_EX_TOOLWINDOW -bor $WS_EX_NOACTIVATE)
})

$form.Add_Paint({
  param($sender, $event)

  $graphics = $event.Graphics
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None

  $pen = New-Object System.Drawing.Pen($border, $BorderWidth)
  try {
    $offset = [Math]::Floor($BorderWidth / 2)
    $graphics.DrawRectangle($pen, $offset, $offset, [Math]::Max(1, $sender.ClientSize.Width - $BorderWidth), [Math]::Max(1, $sender.ClientSize.Height - $BorderWidth))
  } finally {
    $pen.Dispose()
  }

  if ($ShowLabel) {
    $label = "Pantheon Parser"
    if ($state.Strategy) { $label = "$label - $($state.Strategy)" }
    $font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $brush = New-Object System.Drawing.SolidBrush($border)
    $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
    try {
      $graphics.DrawString($label, $font, $shadow, 8, 7)
      $graphics.DrawString($label, $font, $brush, 7, 6)
    } finally {
      $font.Dispose()
      $brush.Dispose()
      $shadow.Dispose()
    }
  }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(100, $PollMs)
$timer.Add_Tick({
  if (-not (Test-Path -LiteralPath $resolvedRegionPath)) {
    $form.Hide()
    return
  }

  try {
    $data = Get-Content -LiteralPath $resolvedRegionPath -Raw | ConvertFrom-Json
    if (-not $data.region) {
      $form.Hide()
      return
    }

    $x = [int][Math]::Round([double]$data.region.x)
    $y = [int][Math]::Round([double]$data.region.y)
    $width = [int][Math]::Max(1, [Math]::Round([double]$data.region.width))
    $height = [int][Math]::Max(1, [Math]::Round([double]$data.region.height))
    $strategy = ""
    if ($data.detection -and $data.detection.strategy) {
      $strategy = [string]$data.detection.strategy
    }

    $regionKey = "$x,$y,$width,$height,$strategy"
    if ($regionKey -ne $state.RegionKey) {
      $state.RegionKey = $regionKey
      $state.Strategy = $strategy
      $state.ObservedAt = [string]$data.observedAt
      $form.Bounds = New-Object System.Drawing.Rectangle(
        ($x - $BorderWidth),
        ($y - $BorderWidth),
        ($width + $BorderWidth * 2),
        ($height + $BorderWidth * 2)
      )
      if (-not $form.Visible) { $form.Show() }
      $form.Invalidate()
    }
  } catch {
    $form.Hide()
  }
})

$form.Add_FormClosed({
  $timer.Stop()
  $timer.Dispose()
})

$timer.Start()
[System.Windows.Forms.Application]::Run($form)
