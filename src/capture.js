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
  const minComponentArea = Number(autoConfig.edgeMinComponentArea ?? 5000);
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
  const component = findLargestDarkComponent(sample.data, width, height, channels, darkCutoff, minComponentArea);
  if (component) {
    const verticalBounds = shrinkDarkRows(
      sample.data,
      width,
      channels,
      darkCutoff,
      component,
      minRowDarkRatio
    );
    const bounds = verticalBounds ? {
      ...component,
      top: verticalBounds.top,
      bottom: verticalBounds.bottom
    } : component;
    const refined = clampRegion({
      x: region.x + bounds.left - edgePadding,
      y: region.y + bounds.top - edgePadding,
      width: bounds.right - bounds.left + 1 + edgePadding * 2,
      height: bounds.bottom - bounds.top + 1 + edgePadding * 2
    }, metadata);

    if (refined.width >= minWidth && refined.height >= minHeight) {
      return {
        region: refined,
        refined: true,
        strategy: 'largestDarkComponent',
        bounds,
        component
      };
    }
  }

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
    strategy: 'rowColumnDarkBounds',
    bounds: { left, right, top, bottom }
  };
}

function findLargestDarkComponent(data, width, height, channels, darkCutoff, minArea) {
  const size = width * height;
  const visited = new Uint8Array(size);
  const queue = new Int32Array(size);
  let best = null;

  for (let start = 0; start < size; start++) {
    if (visited[start] || !isDarkPixel(data, start, channels, darkCutoff)) continue;

    let head = 0;
    let tail = 0;
    let area = 0;
    let left = width;
    let right = 0;
    let top = height;
    let bottom = 0;
    visited[start] = 1;
    queue[tail++] = start;

    function addNeighbor(index) {
      if (visited[index] || !isDarkPixel(data, index, channels, darkCutoff)) return;
      visited[index] = 1;
      queue[tail++] = index;
    }

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      area++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;

      if (x > 0) addNeighbor(index - 1);
      if (x < width - 1) addNeighbor(index + 1);
      if (y > 0) addNeighbor(index - width);
      if (y < height - 1) addNeighbor(index + width);
    }

    if (area >= minArea && (!best || area > best.area)) {
      best = { left, right, top, bottom, area };
    }
  }

  return best;
}

function shrinkDarkRows(data, width, channels, darkCutoff, bounds, minRowRatio) {
  const left = Math.max(0, bounds.left);
  const right = Math.min(width - 1, bounds.right);
  const top = Math.max(0, bounds.top);
  const bottom = Math.max(top, bounds.bottom);
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const rowDark = new Uint32Array(boxHeight);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * width + x;
      if (!isDarkPixel(data, index, channels, darkCutoff)) continue;
      rowDark[y - top]++;
    }
  }

  const localTop = findFirstIndex(rowDark, boxWidth, minRowRatio);
  const localBottom = findLastIndex(rowDark, boxWidth, minRowRatio);
  if (localTop === -1 || localBottom === -1) return null;

  return {
    top: top + localTop,
    bottom: top + localBottom,
    area: bounds.area
  };
}

function isDarkPixel(data, index, channels, darkCutoff) {
  const offset = index * channels;
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma <= darkCutoff;
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
  const processed = await preprocessForOcr(image, region, ocrConfig);
  const ocrImage = await trimBottomNoise(processed, ocrConfig);

  if (options.debugImagePath) {
    fs.mkdirSync(path.dirname(options.debugImagePath), { recursive: true });
    fs.writeFileSync(options.debugImagePath, ocrImage);
  }

  return { image: ocrImage, screen: metadata, region, window: windowRect, detection };
}

async function preprocessForOcr(image, region, ocrConfig = {}) {
  const threshold = Number(ocrConfig.threshold ?? 135);
  const scale = Number(ocrConfig.scale ?? 2);
  const invert = ocrConfig.invert !== false;
  const input = await sharp(image)
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height
    })
    .flatten({ background: '#000000' })
    .resize({ width: Math.round(region.width * scale), withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = input.info.width;
  const height = input.info.height;
  const channels = input.info.channels;
  const output = Buffer.alloc(width * height);

  for (let i = 0; i < width * height; i++) {
    const offset = i * channels;
    const r = input.data[offset];
    const g = input.data[offset + 1];
    const b = input.data[offset + 2];
    const value = Math.max(r, g, b) >= threshold ? 255 : 0;
    output[i] = invert ? 255 - value : value;
  }

  return sharp(output, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

async function trimBottomNoise(imageBuffer, ocrConfig = {}) {
  if (ocrConfig.trimBottomNoise === false) return imageBuffer;

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
  const rowHasText = new Array(height).fill(false);

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
      if (runEnd - runStart + 1 >= minRunHeight) {
        lastTextRow = runEnd;
      }
      runStart = -1;
    }
  }

  if (lastTextRow === -1) return imageBuffer;
  const croppedHeight = Math.min(height, lastTextRow + 1 + bottomPadding);
  const shouldTrimBottom = height - croppedHeight >= Number(ocrConfig.textTrimMinPixels ?? 16);
  if (!shouldTrimBottom) return imageBuffer;

  return sharp(imageBuffer)
    .extract({
      left: 0,
      top: 0,
      width,
      height: croppedHeight
    })
    .png()
    .toBuffer();
}

module.exports = {
  captureRegion,
  resolveRegion,
  getWindowRect,
  clearCachedWindow,
  listWindows
};
