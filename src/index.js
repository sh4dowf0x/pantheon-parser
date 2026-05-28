const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { captureRegion, clearCachedWindow, getWindowRect, listWindows } = require('./capture');
const { findNewLines, fingerprintLine, RecentLineCache } = require('./dedupe');
const { createOcr, extractLines, extractLogicalLines } = require('./ocr');
const { looksLikeCombatLine, parseCombatLine } = require('./combatParser');
const { openStore } = require('./store');

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'config.json');

function readConfig(configPath) {
  const fallbackPath = path.resolve(process.cwd(), 'config.example.json');
  const target = fs.existsSync(configPath) ? configPath : fallbackPath;
  return JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function writeCaptureRegion(config, capture, observedAt) {
  const overlayConfig = config.overlay || {};
  if (overlayConfig.enabled === false || overlayConfig.writeRegion === false) return;

  const regionPath = path.resolve(process.cwd(), overlayConfig.regionPath || 'data/capture-region.json');
  writeJsonAtomic(regionPath, {
    observedAt,
    screen: capture.screen ? {
      width: capture.screen.width,
      height: capture.screen.height
    } : null,
    window: capture.window,
    region: capture.region,
    detection: capture.detection ? {
      mode: capture.detection.mode,
      strategy: capture.detection.refinement?.strategy || capture.detection.strategy || null,
      refinement: capture.detection.refinement || null
    } : null
  });
}

function parseArgs(argv) {
  const args = {
    once: false,
    debug: false,
    configPath: DEFAULT_CONFIG_PATH
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--once') args.once = true;
    else if (arg === '--debug') args.debug = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--config') args.configPath = path.resolve(argv[++i]);
    else if (arg === '--interval') args.intervalMs = Number(argv[++i]);
    else if (arg === '--pid') args.processId = Number(argv[++i]);
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function selectPantheonWindow(config, args) {
  const captureConfig = config.capture || {};
  const captureMode = String(captureConfig.mode || '');
  const usesPantheonWindow = captureMode.startsWith('window') || captureMode === 'autoCombatLog';
  if (!usesPantheonWindow) return;

  captureConfig.window = captureConfig.window || {};
  if (captureConfig.window.useForeground) {
    console.log('Foreground selection enabled.');
    console.log('Click/focus the Pantheon window you want to capture within 5 seconds...');
    clearCachedWindow();
    await sleep(5000);
    const selected = getWindowRect(captureConfig.window);
    captureConfig.window.processId = selected.id;
    captureConfig.window.useForeground = false;
    clearCachedWindow();
    console.log(`Using Pantheon PID ${selected.id} for this session.`);
    return;
  }

  if (args.processId) {
    captureConfig.window.processId = args.processId;
    clearCachedWindow();
    console.log(`Using Pantheon PID ${args.processId} from --pid.`);
    return;
  }

  if (captureConfig.window.processId) {
    console.log(`Using Pantheon PID ${captureConfig.window.processId} from config.json.`);
    return;
  }

  const windows = listWindows(captureConfig.window);
  if (windows.length === 1) {
    captureConfig.window.processId = windows[0].id;
    clearCachedWindow();
    console.log(`Using only Pantheon window found: PID ${windows[0].id}.`);
    return;
  }

  if (windows.length === 0) {
    console.log('No Pantheon windows found yet; will keep trying during capture.');
    return;
  }

  console.log('\nMultiple Pantheon windows found:');
  windows.forEach((window, index) => {
    console.log(`${index + 1}. PID ${window.id} - ${window.width}x${window.height} at ${window.x},${window.y} - started ${window.started}`);
  });

  const rl = readline.createInterface({ input, output });
  let selected = null;
  while (!selected) {
    const answer = await rl.question(`Choose Pantheon window [1-${windows.length}]: `);
    const choice = Number(answer.trim());
    if (Number.isInteger(choice) && choice >= 1 && choice <= windows.length) {
      selected = windows[choice - 1];
    } else {
      console.log('Please enter one of the listed numbers.');
    }
  }
  rl.close();

  captureConfig.window.processId = selected.id;
  clearCachedWindow();
  console.log(`Using Pantheon PID ${selected.id} for this session.\n`);
}

async function run() {
  const args = parseArgs(process.argv);
  const config = readConfig(args.configPath);
  if (args.intervalMs) config.intervalMs = args.intervalMs;
  await selectPantheonWindow(config, args);

  const databasePath = path.resolve(process.cwd(), config.databasePath || 'data/pantheon-events.sqlite');
  const store = args.dryRun ? null : openStore(databasePath);
  const ocr = await createOcr(config.ocr || {});
  let previousVisibleLines = [];
  const recentLines = new RecentLineCache(config.dedupe || {});
  let lastStatusAt = 0;
  let totalInserted = 0;
  let isFirstCapture = true;

  console.log('Pantheon OCR parser started.');
  console.log(`Config: ${fs.existsSync(args.configPath) ? args.configPath : 'config.example.json'}`);
  console.log(`Database: ${args.dryRun ? 'dry run - not writing' : databasePath}`);
  console.log('Press Ctrl+C to stop.');

  let stopping = false;
  process.on('SIGINT', async () => {
    stopping = true;
    console.log('\nStopping...');
  });

  while (!stopping) {
    const observedAt = new Date().toISOString();
    try {
      const capture = await captureRegion(config, {
        debugImagePath: args.debug ? path.resolve(process.cwd(), config.debugImagePath || 'data/last-capture.png') : null
      });
      writeCaptureRegion(config, capture, observedAt);

      const text = await ocr.recognize(capture.image);
      const debugConfig = config.debug || {};
      if (args.debug && config.debugTextPath) {
        const debugTextPath = path.resolve(process.cwd(), config.debugTextPath);
        fs.mkdirSync(path.dirname(debugTextPath), { recursive: true });
        fs.writeFileSync(debugTextPath, text);
      }
      if (args.debug && capture.detection) {
        const debugMetaPath = path.resolve(process.cwd(), 'data/last-capture-meta.json');
        writeJsonAtomic(debugMetaPath, {
          observedAt,
          screen: {
            width: capture.screen.width,
            height: capture.screen.height
          },
          window: capture.window,
          region: capture.region,
          detection: capture.detection
        });
      }
      if (args.debug && debugConfig.keepTimestampedCaptures === true) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const debugDir = path.resolve(process.cwd(), 'data');
        const currentCapture = path.join(debugDir, 'last-capture.png');
        const stampedCapture = path.join(debugDir, `last-capture-${stamp}.png`);
        if (fs.existsSync(currentCapture)) fs.copyFileSync(currentCapture, stampedCapture);
      }
      if (args.debug && debugConfig.keepCaptureImage === false && config.debugImagePath) {
        const debugImagePath = path.resolve(process.cwd(), config.debugImagePath);
        if (fs.existsSync(debugImagePath)) fs.unlinkSync(debugImagePath);
      }

      const logicalLines = extractLogicalLines(text);
      const visibleLines = logicalLines.filter(looksLikeCombatLine);
      let newLines = [];
      if (isFirstCapture && !args.once && (config.dedupe || {}).ignoreInitialVisibleLines !== false) {
        recentLines.filterNew(visibleLines);
      } else {
        const candidateLines = findNewLines(previousVisibleLines, visibleLines);
        newLines = recentLines.filterNew(candidateLines);
      }
      previousVisibleLines = visibleLines;
      isFirstCapture = false;

      for (const line of newLines) {
        const event = parseCombatLine(line);
        event.observedAt = observedAt;
        event.eventKey = fingerprintLine(line);
        if (!args.dryRun) {
          if (store.insertEvent(event)) totalInserted++;
        }
        console.log(`[${new Date(observedAt).toLocaleTimeString()}] ${event.rawMessage}`);
      }

      const now = Date.now();
      if (!args.once && config.statusEveryMs !== 0 && now - lastStatusAt >= (config.statusEveryMs || 10000)) {
        const windowText = capture.window
          ? `PID ${capture.window.id}, window ${capture.window.width}x${capture.window.height} at ${capture.window.x},${capture.window.y}`
          : 'screen capture';
        console.log(`[status ${new Date().toLocaleTimeString()}] ${windowText}; crop ${capture.region.width}x${capture.region.height} at ${capture.region.x},${capture.region.y}; OCR lines=${logicalLines.length}; combat candidates=${visibleLines.length}; total inserted=${totalInserted}`);
        lastStatusAt = now;
      }

      if (args.debug) {
        const windowText = capture.window
          ? `; window=${capture.window.width}x${capture.window.height} at ${capture.window.x},${capture.window.y}`
          : '';
        console.log(`Captured ${capture.region.width}x${capture.region.height} at ${capture.region.x},${capture.region.y}${windowText}; visible=${visibleLines.length}; new=${newLines.length}`);
        if (args.once) {
          const allLines = logicalLines;
          console.log('OCR lines:');
          for (const line of allLines) console.log(`  ${line}`);
        }
      }

      if (args.once) break;
    } catch (error) {
      console.error(`Capture/OCR failed: ${error.message}`);
      if (args.once) break;
    }

    await sleep(config.intervalMs || 750);
  }

  const summary = args.dryRun ? [] : store.recentSummary(300);
  if (summary.length) {
    console.log('\nRecent damage summary:');
    for (const row of summary) {
      console.log(`${row.source || 'Unknown'}: ${row.total_damage} damage across ${row.events} events`);
    }
  }

  await ocr.close();
  if (store) store.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
