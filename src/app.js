const path = require('node:path');
const { runParser } = require('./index');
const { parseArgs: parseDashboardArgs, startDashboard } = require('./dashboard');

function parseAppArgs(argv = process.argv) {
  const args = {
    dashboardPort: 3107,
    databasePath: path.resolve(process.cwd(), 'data', 'pantheon-events.sqlite')
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') args.dashboardPort = Number(argv[++i]);
    else if (arg === '--db') args.databasePath = path.resolve(argv[++i]);
  }

  return args;
}

async function runApp(argv = process.argv) {
  const appArgs = parseAppArgs(argv);
  const dashboard = startDashboard({
    args: parseDashboardArgs([
      argv[0],
      argv[1],
      '--port',
      String(appArgs.dashboardPort),
      '--db',
      appArgs.databasePath
    ]),
    exitOnError: false
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
      shouldStop: () => stopping
    });
  } finally {
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
