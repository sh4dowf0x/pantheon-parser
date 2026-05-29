const path = require('node:path');
const { spawn } = require('node:child_process');
const { readConfig, runParser } = require('./index');
const { parseArgs: parseDashboardArgs, startDashboard } = require('./dashboard');

function parseAppArgs(argv = process.argv) {
  const args = {
    dashboardPort: 3107,
    databasePath: path.resolve(process.cwd(), 'data', 'pantheon-events.sqlite'),
    configPath: path.resolve(process.cwd(), 'config.json')
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') args.dashboardPort = Number(argv[++i]);
    else if (arg === '--db') args.databasePath = path.resolve(argv[++i]);
    else if (arg === '--config') args.configPath = path.resolve(argv[++i]);
  }

  return args;
}

function startOverlay(control, config) {
  if (control.overlayProcess) return;

  const overlayConfig = config.overlay || {};
  const regionPath = path.resolve(process.cwd(), overlayConfig.regionPath || 'data/capture-region.json');
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'capture-overlay.ps1');
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-RegionPath',
    regionPath
  ], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true
  });

  control.overlayProcess = child;
  control.overlayEnabled = true;
  control.overlayPid = child.pid;
  child.on('exit', () => {
    if (control.overlayProcess === child) {
      control.overlayProcess = null;
      control.overlayPid = null;
      control.overlayEnabled = false;
    }
  });
}

function stopOverlay(control) {
  if (!control.overlayProcess) {
    control.overlayEnabled = false;
    control.overlayPid = null;
    return;
  }

  control.overlayProcess.kill();
  control.overlayProcess = null;
  control.overlayEnabled = false;
  control.overlayPid = null;
}

async function runApp(argv = process.argv) {
  const appArgs = parseAppArgs(argv);
  const config = readConfig(appArgs.configPath);
  const control = {
    intervalMs: Number(config.intervalMs || 750),
    paused: false,
    overlayEnabled: false,
    overlayPid: null,
    overlayProcess: null,
    startedAt: new Date().toISOString()
  };
  control.setOverlayEnabled = async (enabled) => {
    if (enabled) startOverlay(control, config);
    else stopOverlay(control);
  };

  if ((config.overlay || {}).enabled !== false) {
    startOverlay(control, config);
  }

  const dashboard = startDashboard({
    args: parseDashboardArgs([
      argv[0],
      argv[1],
      '--port',
      String(appArgs.dashboardPort),
      '--db',
      appArgs.databasePath
    ]),
    exitOnError: false,
    control
  });

  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping Pantheon Parser...');
  });

  try {
    await runParser({
      argv: [
        argv[0],
        argv[1],
        ...argv.slice(2),
        '--db',
        appArgs.databasePath
      ],
      installSignalHandler: false,
      control,
      shouldStop: () => stopping
    });
  } finally {
    stopOverlay(control);
    await new Promise((resolve) => dashboard.close(resolve));
  }
}

if (require.main === module) {
  runApp().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseAppArgs,
  runApp
};
