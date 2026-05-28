const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');

let cachedWindow = null;
let cachedWindowAt = 0;

function resolveRegion(metadata, captureConfig, windowRect = null) {
  const mode = captureConfig.mode || 'fraction';
  if (mode === 'absolute') {
    return clampRegion(captureConfig.absolute, metadata);
  }

  if (mode === 'windowAbsolute') {
    const rect = windowRect || getWindowRect(captureConfig.window || {});
    const absolute = captureConfig.windowAbsolute || {};
    return clampRegion({
      x: rect.x + (Number(absolute.x) || 0),
      y: rect.y + (Number(absolute.y) || 0),
      width: Number(absolute.width) || rect.width,
      height: Number(absolute.height) || rect.height
    }, metadata);
  }

  if (mode === 'windowFraction') {
    const rect = windowRect || getWindowRect(captureConfig.window || {});
    const fraction = captureConfig.windowFraction || captureConfig.fraction || {};
    return clampRegion({
      x: rect.x + Math.round(rect.width * (fraction.x ?? 0.58)),
      y: rect.y + Math.round(rect.height * (fraction.y ?? 0.70)),
      width: Math.round(rect.width * (fraction.width ?? 0.40)),
      height: Math.round(rect.height * (fraction.height ?? 0.23))
    }, metadata);
  }

  if (mode === 'autoCombatLog') {
    const rect = windowRect || getWindowRect(captureConfig.window || {});
    const fallback = captureConfig.windowFraction || captureConfig.fraction || {};
    return clampRegion({
      x: rect.x + Math.round(rect.width * (fallback.x ?? 0.72)),
      y: rect.y + Math.round(rect.height * (fallback.y ?? 0.80)),
      width: Math.round(rect.width * (fallback.width ?? 0.27)),
      height: Math.round(rect.height * (fallback.height ?? 0.18))
    }, metadata);
  }

  const fraction = captureConfig.fraction || {};
  return clampRegion({
    x: Math.round(metadata.width * (fraction.x ?? 0.58)),
    y: Math.round(metadata.height * (fraction.y ?? 0.48)),
    width: Math.round(metadata.width * (fraction.width ?? 0.40)),
    height: Math.round(metadata.height * (fraction.height ?? 0.47))
  }, metadata);
}

function clampRegion(region, metadata) {
  const x = Math.max(0, Math.min(Number(region.x) || 0, metadata.width - 1));
  const y = Math.max(0, Math.min(Number(region.y) || 0, metadata.height - 1));
  const width = Math.max(1, Math.min(Number(region.width) || metadata.width, metadata.width - x));
  const height = Math.max(1, Math.min(Number(region.height) || metadata.height, metadata.height - y));
  return { x, y, width, height };
}

async function refineToDarkBounds(image, region, metadata, autoConfig = {}) {
  if (autoConfig.refineToDarkBounds === false) {
    return { region, refined: false, reason: 'disabled' };
  }

  const darkCutoff = Number(autoConfig.edgeDarkCutoff ?? autoConfig.darkCutoff ?? 55);
  const minDarkRatio = Number(autoConfig.edgeMinDarkRatio ?? 0.45);
  const minRowDarkRatio = Number(autoConfig.edgeMinRowDarkRatio ?? minDarkRatio);
  const minColDarkRatio = Number(autoConfig.edgeMinColDarkRatio ?? minDarkRatio);
  const edgePadding = Number(autoConfig.edgePadding ?? 0);
  const minWidth = Math.max(20, Math.floor(region.width * Number(autoConfig.edgeMinWidth ?? 0.65)));
  const minHeight = Math.max(20, Math.floor(region.height * Number(autoConfig.edgeMinHeight ?? 0.45)));
  const sample = await sharp(image)
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = sample.info.width;
  const height = sample.info.height;
  const channels = sample.info.channels;
  const rowDark = new Uint32Array(height);
  const colDark = new Uint32Array(width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const r = sample.data[offset];
      const g = sample.data[offset + 1];
      const b = sample.data[offset + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luma <= darkCutoff) {
        rowDark[y]++;
        colDark[x]++;
      }
    }
  }

  const left = findFirstIndex(colDark, height, minColDarkRatio);
  const right = findLastIndex(colDark, height, minColDarkRatio);
  const top = findFirstIndex(rowDark, width, minRowDarkRatio);
  const bottom = findLastIndex(rowDark, width, minRowDarkRatio);
  if (left === -1 || right === -1 || top === -1 || bottom === -1) {
    return { region, refined: false, reason: 'no dark bounds found' };
  }

  const refined = clampRegion({
    x: region.x + left - edgePadding,
    y: region.y + top - edgePadding,
    width: right - left + 1 + edgePadding * 2,
    height: bottom - top + 1 + edgePadding * 2
  }, metadata);

  if (refined.width < minWidth || refined.height < minHeight) {
    return {
      region,
      refined: false,
      reason: 'dark bounds were too small',
      bounds: { left, right, top, bottom },
      candidate: refined
    };
  }

  return {
    region: refined,
    refined: true,
    bounds: { left, right, top, bottom }
  };
}

function findFirstIndex(values, denominator, minRatio) {
  for (let i = 0; i < values.length; i++) {
    if (values[i] / denominator >= minRatio) return i;
  }
  return -1;
}

function findLastIndex(values, denominator, minRatio) {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] / denominator >= minRatio) return i;
  }
  return -1;
}

async function detectCombatLogRegion(image, metadata, captureConfig, windowRect) {
  const auto = captureConfig.autoCombatLog || {};
  if (auto.x !== undefined && auto.y !== undefined && auto.width !== undefined && auto.height !== undefined) {
    const padding = auto.padding ?? 4;
    const seedRegion = clampRegion({
      x: windowRect.x + Math.round(windowRect.width * auto.x) - padding,
      y: windowRect.y + Math.round(windowRect.height * auto.y) - padding,
      width: Math.round(windowRect.width * auto.width) + padding * 2,
      height: Math.round(windowRect.height * auto.height) + padding * 2
    }, metadata);
    const refined = await refineToDarkBounds(image, seedRegion, metadata, auto);

    return {
      region: refined.region,
      detection: {
        mode: 'autoCombatLog',
        matched: true,
        strategy: refined.refined ? 'fixedWindowRatioDarkBounds' : 'fixedWindowRatio',
        ratio: {
          x: auto.x,
          y: auto.y,
          width: auto.width,
          height: auto.height
        },
        seedRegion,
        refinement: refined
      }
    };
  }

  const client = await sharp(image)
    .extract({
      left: windowRect.x,
      top: windowRect.y,
      width: windowRect.width,
      height: windowRect.height
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = client.info.width;
  const height = client.info.height;
  const channels = client.info.channels;
  const darkCutoff = auto.darkCutoff ?? 55;
  const integralWidth = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const r = client.data[offset];
      const g = client.data[offset + 1];
      const b = client.data[offset + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      row += Math.max(0, darkCutoff - luma);
      const index = (y + 1) * integralWidth + (x + 1);
      integral[index] = integral[index - integralWidth] + row;
    }
  }

  function sumRect(x, y, w, h) {
    const x2 = x + w;
    const y2 = y + h;
    return (
      integral[y2 * integralWidth + x2] -
      integral[y * integralWidth + x2] -
      integral[y2 * integralWidth + x] +
      integral[y * integralWidth + x]
    );
  }

  const searchX = Math.floor(width * (auto.searchX ?? 0.55));
  const searchY = Math.floor(height * (auto.searchY ?? 0.55));
  const searchWidth = Math.floor(width * (auto.searchWidth ?? 0.45));
  const searchHeight = Math.floor(height * (auto.searchHeight ?? 0.45));
  const step = auto.step ?? 8;
  const minWidth = Math.floor(width * (auto.minWidth ?? 0.20));
  const maxWidth = Math.floor(width * (auto.maxWidth ?? 0.34));
  const minHeight = Math.floor(height * (auto.minHeight ?? 0.10));
  const maxHeight = Math.floor(height * (auto.maxHeight ?? 0.24));
  const rightBias = auto.rightBias ?? 8;
  const bottomBias = auto.bottomBias ?? 8;
  let best = null;

  for (let h = minHeight; h <= maxHeight; h += step) {
    for (let w = minWidth; w <= maxWidth; w += step) {
      const xMax = Math.min(searchX + searchWidth - w, width - w);
      const yMax = Math.min(searchY + searchHeight - h, height - h);
      for (let y = searchY; y <= yMax; y += step) {
        for (let x = searchX; x <= xMax; x += step) {
          const darkness = sumRect(x, y, w, h) / (w * h);
          const closenessRight = x / Math.max(1, width - w);
          const closenessBottom = y / Math.max(1, height - h);
          const score = darkness + closenessRight * rightBias + closenessBottom * bottomBias;
          if (!best || score > best.score) best = { x, y, width: w, height: h, darkness, score };
        }
      }
    }
  }

  if (!best || best.darkness < (auto.minDarkness ?? 4)) {
    return {
      region: resolveRegion(metadata, captureConfig, windowRect),
      detection: {
        mode: 'autoCombatLog',
        matched: false,
        reason: best ? 'best region was not dark enough' : 'no candidate regions scanned',
        best
      }
    };
  }

  const padding = auto.padding ?? 4;
  const seedRegion = clampRegion({
    x: windowRect.x + best.x - padding,
    y: windowRect.y + best.y - padding,
    width: best.width + padding * 2,
    height: best.height + padding * 2
  }, metadata);
  const refined = await refineToDarkBounds(image, seedRegion, metadata, auto);

  return {
    region: refined.region,
    detection: {
      mode: 'autoCombatLog',
      matched: true,
      clientRelative: best,
      paddedRegion: {
        x: best.x - padding,
        y: best.y - padding,
        width: best.width + padding * 2,
        height: best.height + padding * 2
      },
      seedRegion,
      search: { x: searchX, y: searchY, width: searchWidth, height: searchHeight },
      refinement: refined
    }
  };
}

function getWindowRect(windowConfig = {}) {
  const now = Date.now();
  if (cachedWindow && now - cachedWindowAt < 2000) return cachedWindow;

  const processName = windowConfig.processName || 'Pantheon';
  const titleContains = windowConfig.titleContains || 'Pantheon';
  const processId = windowConfig.processId || null;
  const useClientArea = windowConfig.useClientArea !== false;
  const useForeground = windowConfig.useForeground === true;
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32WindowRect {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }
  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
}
"@
[void][Win32WindowRect]::SetProcessDPIAware()
$processName = '${escapePowerShellSingleQuoted(processName)}'
$titleContains = '${escapePowerShellSingleQuoted(titleContains)}'
$processId = '${escapePowerShellSingleQuoted(processId || '')}'
$useClientArea = ${useClientArea ? '$true' : '$false'}
$useForeground = ${useForeground ? '$true' : '$false'}
if ($useForeground) {
  $handle = [Win32WindowRect]::GetForegroundWindow()
  $foregroundPid = 0
  [void][Win32WindowRect]::GetWindowThreadProcessId($handle, [ref]$foregroundPid)
  $proc = Get-Process -Id $foregroundPid -ErrorAction Stop
  if ($proc.ProcessName -ne $processName -or $proc.MainWindowTitle -notlike "*$titleContains*") {
    throw "Foreground window is '$($proc.ProcessName)' / '$($proc.MainWindowTitle)', not $processName."
  }
  $items = @([pscustomobject]@{ Id = $proc.Id; MainWindowTitle = $proc.MainWindowTitle; MainWindowHandle = $handle })
} else {
  $items = Get-Process -Name $processName -ErrorAction Stop |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and
    ($_.MainWindowTitle -like "*$titleContains*") -and
    (($processId -eq '') -or ($_.Id -eq [int]$processId))
  }
}
$windows = $items |
  ForEach-Object {
    $rect = New-Object Win32WindowRect+RECT
    $handle = $_.MainWindowHandle
    if ($useClientArea) {
      [void][Win32WindowRect]::GetClientRect($handle, [ref]$rect)
      $topLeft = New-Object Win32WindowRect+POINT
      $topLeft.X = $rect.Left
      $topLeft.Y = $rect.Top
      [void][Win32WindowRect]::ClientToScreen($handle, [ref]$topLeft)
      $bottomRight = New-Object Win32WindowRect+POINT
      $bottomRight.X = $rect.Right
      $bottomRight.Y = $rect.Bottom
      [void][Win32WindowRect]::ClientToScreen($handle, [ref]$bottomRight)
      $left = $topLeft.X
      $top = $topLeft.Y
      $right = $bottomRight.X
      $bottom = $bottomRight.Y
    } else {
      [void][Win32WindowRect]::GetWindowRect($handle, [ref]$rect)
      $left = $rect.Left
      $top = $rect.Top
      $right = $rect.Right
      $bottom = $rect.Bottom
    }
    [pscustomobject]@{
      id = $_.Id
      title = $_.MainWindowTitle
      x = $left
      y = $top
      width = $right - $left
      height = $bottom - $top
      area = ($right - $left) * ($bottom - $top)
    }
  } |
  Sort-Object area -Descending
$windows | Select-Object -First 1 | ConvertTo-Json -Compress
`;

  const output = execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], { encoding: 'utf8', windowsHide: true }).trim();

  if (!output) {
    throw new Error(`Could not find a ${processName} window`);
  }

  const rect = JSON.parse(output);
  cachedWindow = {
    x: Number(rect.x),
    y: Number(rect.y),
    width: Number(rect.width),
    height: Number(rect.height),
    title: rect.title,
    id: rect.id
  };
  cachedWindowAt = now;
  return cachedWindow;
}

function clearCachedWindow() {
  cachedWindow = null;
  cachedWindowAt = 0;
}

function listWindows(windowConfig = {}) {
  const processName = windowConfig.processName || 'Pantheon';
  const titleContains = windowConfig.titleContains || 'Pantheon';
  const useClientArea = windowConfig.useClientArea !== false;
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32WindowRect {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }
  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
}
"@
[void][Win32WindowRect]::SetProcessDPIAware()
$processName = '${escapePowerShellSingleQuoted(processName)}'
$titleContains = '${escapePowerShellSingleQuoted(titleContains)}'
$useClientArea = ${useClientArea ? '$true' : '$false'}
$windows = Get-Process -Name $processName -ErrorAction Stop |
  Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -like "*$titleContains*") } |
  ForEach-Object {
    $rect = New-Object Win32WindowRect+RECT
    if ($useClientArea) {
      [void][Win32WindowRect]::GetClientRect($_.MainWindowHandle, [ref]$rect)
      $topLeft = New-Object Win32WindowRect+POINT
      $topLeft.X = $rect.Left
      $topLeft.Y = $rect.Top
      [void][Win32WindowRect]::ClientToScreen($_.MainWindowHandle, [ref]$topLeft)
      $bottomRight = New-Object Win32WindowRect+POINT
      $bottomRight.X = $rect.Right
      $bottomRight.Y = $rect.Bottom
      [void][Win32WindowRect]::ClientToScreen($_.MainWindowHandle, [ref]$bottomRight)
      $left = $topLeft.X
      $top = $topLeft.Y
      $right = $bottomRight.X
      $bottom = $bottomRight.Y
    } else {
      [void][Win32WindowRect]::GetWindowRect($_.MainWindowHandle, [ref]$rect)
      $left = $rect.Left
      $top = $rect.Top
      $right = $rect.Right
      $bottom = $rect.Bottom
    }
    [pscustomobject]@{
      id = $_.Id
      title = $_.MainWindowTitle
      started = $_.StartTime.ToString("yyyy-MM-dd HH:mm:ss")
      x = $left
      y = $top
      width = $right - $left
      height = $bottom - $top
      area = ($right - $left) * ($bottom - $top)
    }
  } |
  Sort-Object started
@($windows) | ConvertTo-Json -Compress
`;

  const output = execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], { encoding: 'utf8', windowsHide: true }).trim();

  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

async function captureRegion(config, options = {}) {
  const image = await screenshot({ format: 'png' });
  const source = sharp(image);
  const metadata = await source.metadata();
  const captureConfig = config.capture || {};
  const windowRect = String(captureConfig.mode || '').startsWith('window') || captureConfig.mode === 'autoCombatLog'
    ? getWindowRect(captureConfig.window || {})
    : null;
  let detection = null;
  let region;
  if (captureConfig.mode === 'autoCombatLog') {
    const detected = await detectCombatLogRegion(image, metadata, captureConfig, windowRect);
    region = detected.region;
    detection = detected.detection;
  } else {
    region = resolveRegion(metadata, captureConfig, windowRect);
  }

  const ocrConfig = config.ocr || {};
  const threshold = Number(ocrConfig.threshold ?? 135);
  const processed = await sharp(image)
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height
    })
    .flatten({ background: '#000000' })
    .grayscale()
    .resize({ width: region.width * 2, withoutEnlargement: false })
    .threshold(threshold)
    .negate()
    .png()
    .toBuffer();
  const ocrImage = await trimOcrNoise(processed, ocrConfig);

  if (options.debugImagePath) {
    fs.mkdirSync(path.dirname(options.debugImagePath), { recursive: true });
    fs.writeFileSync(options.debugImagePath, ocrImage);
  }

  return { image: ocrImage, screen: metadata, region, window: windowRect, detection };
}

async function trimOcrNoise(imageBuffer, ocrConfig = {}) {
  if (
    ocrConfig.trimBottomNoise === false &&
    ocrConfig.trimLeftNoise === false &&
    ocrConfig.trimRightNoise === false
  ) return imageBuffer;

  const sample = await sharp(imageBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = sample.info.width;
  const height = sample.info.height;
  const channels = sample.info.channels;
  const minRowBlack = Math.max(4, Math.floor(width * Number(ocrConfig.textRowMinBlackRatio ?? 0.012)));
  const bucketCount = Number(ocrConfig.textRowBuckets ?? 32);
  const minBuckets = Number(ocrConfig.textRowMinBuckets ?? 6);
  const minRunHeight = Number(ocrConfig.textMinRunHeight ?? 8);
  const bottomPadding = Number(ocrConfig.textBottomPadding ?? 12);
  const leftPadding = Number(ocrConfig.textLeftPadding ?? 2);
  const rightPadding = Number(ocrConfig.textRightPadding ?? 80);
  const minColTextRatio = Number(ocrConfig.textColMinBlackRatio ?? 0.18);
  const rowHasText = new Array(height).fill(false);
  const rowIsInTextRun = new Array(height).fill(false);

  for (let y = 0; y < height; y++) {
    let black = 0;
    const buckets = new Uint8Array(bucketCount);
    for (let x = 0; x < width; x++) {
      const value = sample.data[(y * width + x) * channels];
      if (value < 128) {
        black++;
        buckets[Math.min(bucketCount - 1, Math.floor((x / width) * bucketCount))] = 1;
      }
    }
    let occupiedBuckets = 0;
    for (const bucket of buckets) occupiedBuckets += bucket;
    rowHasText[y] = black >= minRowBlack && occupiedBuckets >= minBuckets;
  }

  let lastTextRow = -1;
  let runStart = -1;
  for (let y = 0; y <= height; y++) {
    if (y < height && rowHasText[y]) {
      if (runStart === -1) runStart = y;
      continue;
    }

    if (runStart !== -1) {
      const runEnd = y - 1;
      markTextRun(runStart, runEnd);
      runStart = -1;
    }
  }

  if (lastTextRow === -1) return imageBuffer;
  const croppedHeight = ocrConfig.trimBottomNoise === false
    ? height
    : Math.min(height, lastTextRow + 1 + bottomPadding);
  const shouldTrimBottom = height - croppedHeight >= Number(ocrConfig.textTrimMinPixels ?? 16);
  const left = ocrConfig.trimLeftNoise === false
    ? 0
    : findTextLeftEdge(sample.data, width, height, channels, rowIsInTextRun, minColTextRatio, leftPadding);
  const right = ocrConfig.trimRightNoise === false
    ? width - 1
    : findTextRightEdge(sample.data, width, height, channels, rowIsInTextRun, minColTextRatio, rightPadding);
  const shouldTrimLeft = left >= Number(ocrConfig.textTrimMinPixels ?? 16);
  const shouldTrimRight = width - right - 1 >= Number(ocrConfig.textTrimMinPixels ?? 16);

  if (!shouldTrimBottom && !shouldTrimLeft && !shouldTrimRight) return imageBuffer;

  const cropLeft = shouldTrimLeft ? left : 0;
  const cropRight = shouldTrimRight ? right : width - 1;

  return sharp(imageBuffer)
    .extract({
      left: cropLeft,
      top: 0,
      width: cropRight - cropLeft + 1,
      height: shouldTrimBottom ? croppedHeight : height
    })
    .png()
    .toBuffer();

  function markTextRun(start, end) {
    if (end - start + 1 < minRunHeight) return;
    for (let y = start; y <= end; y++) rowIsInTextRun[y] = true;
    lastTextRow = end;
  }
}

function findTextLeftEdge(data, width, height, channels, rowIsInTextRun, minColTextRatio, leftPadding) {
  const textRows = rowIsInTextRun.reduce((total, value) => total + (value ? 1 : 0), 0);
  if (!textRows) return 0;

  const minColumnBlack = Math.max(2, Math.floor(textRows * minColTextRatio));
  for (let x = 0; x < width; x++) {
    let black = 0;
    for (let y = 0; y < height; y++) {
      if (!rowIsInTextRun[y]) continue;
      const value = data[(y * width + x) * channels];
      if (value < 128) black++;
    }
    if (black >= minColumnBlack) return Math.max(0, x - leftPadding);
  }

  return 0;
}

function findTextRightEdge(data, width, height, channels, rowIsInTextRun, minColTextRatio, rightPadding) {
  const textRows = rowIsInTextRun.reduce((total, value) => total + (value ? 1 : 0), 0);
  if (!textRows) return width - 1;

  const minColumnBlack = Math.max(2, Math.floor(textRows * minColTextRatio));
  for (let x = width - 1; x >= 0; x--) {
    let black = 0;
    for (let y = 0; y < height; y++) {
      if (!rowIsInTextRun[y]) continue;
      const value = data[(y * width + x) * channels];
      if (value < 128) black++;
    }
    if (black >= minColumnBlack) return Math.min(width - 1, x + rightPadding);
  }

  return width - 1;
}

module.exports = {
  captureRegion,
  resolveRegion,
  getWindowRect,
  clearCachedWindow,
  listWindows
};
