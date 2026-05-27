const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { normalizeAbility, normalizeName } = require('./combatParser');
const { inferClassFromAbilities } = require('./classInference');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_DATABASE = path.join(ROOT, 'data', 'pantheon-events.sqlite');

function parseArgs(argv) {
  const args = {
    port: 3107,
    databasePath: DEFAULT_DATABASE
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '--db') args.databasePath = path.resolve(argv[++i]);
  }

  return args;
}

function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA busy_timeout = 3000');
  return db;
}

function getWindowStart(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function getDurationSeconds(bounds, requestedWindowSeconds) {
  if (!bounds || !bounds.first_seen || !bounds.last_seen) return 0;
  const active = Math.max(1, (Date.parse(bounds.last_seen) - Date.parse(bounds.first_seen)) / 1000);
  if (!requestedWindowSeconds) return active;
  return Math.max(1, Math.min(requestedWindowSeconds, active));
}

function getMetricConfig(metric) {
  if (metric === 'healing') {
    return {
      metric: 'healing',
      eventType: 'healing',
      amountName: 'healing',
      rateName: 'hps'
    };
  }

  return {
    metric: 'damage',
    eventType: 'damage',
    amountName: 'damage',
    rateName: 'dps'
  };
}

function normalizeSourceForMetric(source, metricConfig) {
  if (metricConfig.metric === 'healing') {
    return normalizeAbility(source || 'Unknown') || 'Unknown';
  }

  return normalizeName(source || 'Unknown') || 'Unknown';
}

function getDisplaySource(row, metricConfig) {
  if (metricConfig.metric !== 'healing') {
    return {
      source: normalizeName(row.source || 'Unknown') || 'Unknown',
      sourceKind: 'character'
    };
  }

  const source = normalizeName(row.source || '');
  const ability = normalizeAbility(row.ability || '');
  if (source && ability && normalizeAbility(source) !== ability) {
    return { source, sourceKind: 'character' };
  }

  return {
    source: ability || source || 'Unknown',
    sourceKind: 'ability'
  };
}

function getDashboardData(db, seconds, sourceMode, metric) {
  const metricConfig = getMetricConfig(metric);
  const since = getWindowStart(seconds);
  const where = since ? 'WHERE observed_at >= ?' : '';
  const playerOnly = sourceMode === 'players';
  const sourceFilter = playerOnly && metricConfig.metric === 'damage' ? "AND source GLOB '[A-Z]*'" : '';
  const metricWhere = since
    ? `WHERE observed_at >= ? AND event_type = '${metricConfig.eventType}' ${sourceFilter}`
    : `WHERE event_type = '${metricConfig.eventType}' ${sourceFilter}`;
  const params = since ? [since] : [];

  const bounds = db.prepare(`
    SELECT MIN(observed_at) AS first_seen, MAX(observed_at) AS last_seen
    FROM combat_events
    ${where}
  `).get(...params);

  const durationSeconds = getDurationSeconds(bounds, seconds);
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS events,
      SUM(CASE WHEN event_type = 'damage' ${playerOnly ? "AND source GLOB '[A-Z]*'" : ''} THEN amount ELSE 0 END) AS damage,
      SUM(CASE WHEN event_type = 'healing' THEN amount ELSE 0 END) AS healing,
      SUM(CASE WHEN event_type IN ('miss', 'dodge', 'resist') THEN 1 ELSE 0 END) AS avoids
    FROM combat_events
    ${where}
  `).get(...params);

  const combatantRows = db.prepare(`
    SELECT
      source,
      SUM(amount) AS total,
      COUNT(*) AS events,
      SUM(mitigated) AS mitigated,
      SUM(is_critical) AS crits,
      MIN(observed_at) AS first_seen,
      MAX(observed_at) AS last_seen,
      GROUP_CONCAT(DISTINCT ability) AS abilities
    FROM combat_events
    ${metricWhere}
    GROUP BY source, ability
    ORDER BY total DESC, events DESC
  `).all(...params);

  const combatantGroups = new Map();
  const ensureCombatant = (source, sourceKind = 'character') => {
    const current = combatantGroups.get(source) || {
      source,
      sourceKind,
      total: 0,
      damage: 0,
      healing: 0,
      damageTaken: 0,
      mitigatedTaken: 0,
      events: 0,
      hits: 0,
      incomingEvents: 0,
      mitigated: 0,
      crits: 0,
      firstSeen: null,
      lastSeen: null,
      abilities: new Set()
    };

    if (current.sourceKind !== 'character' && sourceKind === 'character') {
      current.sourceKind = 'character';
    }

    combatantGroups.set(source, current);
    return current;
  };

  for (const row of combatantRows) {
    const displaySource = getDisplaySource(row, metricConfig);
    const source = displaySource.source;
    if (playerOnly && metricConfig.metric === 'damage' && !/^[A-Z]/.test(source)) continue;

    const current = ensureCombatant(source, displaySource.sourceKind);

    const total = Number(row.total || 0);
    current.total += total;
    current.damage += metricConfig.metric === 'damage' ? total : 0;
    current.healing += metricConfig.metric === 'healing' ? total : 0;
    current.events += Number(row.events || 0);
    current.hits += Number(row.events || 0);
    current.mitigated += Number(row.mitigated || 0);
    current.crits += Number(row.crits || 0);
    for (const ability of String(row.abilities || '').split(',')) {
      if (ability.trim()) current.abilities.add(ability.trim());
    }
    if (!current.firstSeen || Date.parse(row.first_seen) < Date.parse(current.firstSeen)) current.firstSeen = row.first_seen;
    if (!current.lastSeen || Date.parse(row.last_seen) > Date.parse(current.lastSeen)) current.lastSeen = row.last_seen;
  }

  if (metricConfig.metric === 'damage') {
    const incomingWhere = since
      ? `WHERE observed_at >= ? AND event_type = 'damage' ${playerOnly ? "AND target GLOB '[A-Z]*'" : ''}`
      : `WHERE event_type = 'damage' ${playerOnly ? "AND target GLOB '[A-Z]*'" : ''}`;
    const incomingRows = db.prepare(`
      SELECT
        target,
        SUM(amount) AS total,
        COUNT(*) AS events,
        SUM(mitigated) AS mitigated,
        MIN(observed_at) AS first_seen,
        MAX(observed_at) AS last_seen
      FROM combat_events
      ${incomingWhere}
        AND target IS NOT NULL
      GROUP BY target
    `).all(...params);

    for (const row of incomingRows) {
      const target = normalizeName(row.target || 'Unknown') || 'Unknown';
      const current = ensureCombatant(target);
      current.damageTaken += Number(row.total || 0);
      current.mitigatedTaken += Number(row.mitigated || 0);
      current.incomingEvents += Number(row.events || 0);
      if (!current.firstSeen || Date.parse(row.first_seen) < Date.parse(current.firstSeen)) current.firstSeen = row.first_seen;
      if (!current.lastSeen || Date.parse(row.last_seen) > Date.parse(current.lastSeen)) current.lastSeen = row.last_seen;
    }
  }

  const combatants = [...combatantGroups.values()]
    .map((row) => {
      const abilities = [...row.abilities];
      const classGuess = inferClassFromAbilities(
        abilities.concat(metricConfig.metric === 'healing' ? [row.source] : []),
        { eventCount: row.events }
      );
      return {
        ...row,
        abilities,
        className: classGuess.className,
        classConfidence: classGuess.confidence,
        classMatchedAbilities: classGuess.matchedAbilities,
        sourceKind: row.sourceKind,
        damageTaken: row.damageTaken,
        mitigatedTaken: row.mitigatedTaken,
        incomingEvents: row.incomingEvents,
        rate: durationSeconds ? Number((row.total / durationSeconds).toFixed(2)) : 0,
        dps: metricConfig.metric === 'damage' && durationSeconds ? Number((row.total / durationSeconds).toFixed(2)) : 0,
        hps: metricConfig.metric === 'healing' && durationSeconds ? Number((row.total / durationSeconds).toFixed(2)) : 0
      };
    })
    .sort((a, b) => (b.total - a.total) || (b.events - a.events))
    .slice(0, 30);

  const recentEvents = db.prepare(`
    SELECT
      observed_at AS observedAt,
      event_type AS eventType,
      source,
      target,
      ability,
      amount,
      damage_type AS damageType,
      mitigated,
      is_critical AS isCritical,
      raw_message AS rawMessage
    FROM combat_events
    ${where}
    ORDER BY observed_at DESC, id DESC
    LIMIT 80
  `).all(...params);

  return {
    generatedAt: new Date().toISOString(),
    windowSeconds: seconds || null,
    sourceMode,
    metric: metricConfig.metric,
    durationSeconds,
    firstSeen: bounds ? bounds.first_seen : null,
    lastSeen: bounds ? bounds.last_seen : null,
    totals: {
      events: Number(totals.events || 0),
      damage: Number(totals.damage || 0),
      healing: Number(totals.healing || 0),
      avoids: Number(totals.avoids || 0),
      total: Number(totals[metricConfig.amountName] || 0),
      rate: durationSeconds ? Number((Number(totals[metricConfig.amountName] || 0) / durationSeconds).toFixed(2)) : 0,
      dps: durationSeconds ? Number((Number(totals.damage || 0) / durationSeconds).toFixed(2)) : 0,
      hps: durationSeconds ? Number((Number(totals.healing || 0) / durationSeconds).toFixed(2)) : 0
    },
    combatants,
    recentEvents
  };
}

function getBreakdownData(db, seconds, source, metric) {
  const metricConfig = getMetricConfig(metric);
  const since = getWindowStart(seconds);
  const params = since ? [since] : [];
  const where = since
    ? `WHERE observed_at >= ? AND event_type = '${metricConfig.eventType}'`
    : `WHERE event_type = '${metricConfig.eventType}'`;

  const rows = db.prepare(`
    SELECT
      source,
      ability,
      damage_type AS damageType,
      SUM(amount) AS total,
      COUNT(*) AS events,
      SUM(mitigated) AS mitigated,
      SUM(is_critical) AS crits
    FROM combat_events
    ${where}
    GROUP BY source, ability, damage_type
    ORDER BY total DESC, events DESC
  `).all(...params);

  const grouped = new Map();
  const normalizedRequestedSource = normalizeSourceForMetric(source, metricConfig);
  for (const row of rows) {
    const displaySource = getDisplaySource(row, metricConfig).source;
    if (normalizeSourceForMetric(displaySource, metricConfig) !== normalizedRequestedSource) continue;

    const ability = normalizeAbility(row.ability || 'Unknown') || 'Unknown';
    const damageType = row.damageType || '';
    const key = `${ability}\u0000${damageType}`;
    const current = grouped.get(key) || {
      ability,
      damageType,
      total: 0,
      damage: 0,
      healing: 0,
      events: 0,
      hits: 0,
      mitigated: 0,
      crits: 0
    };

    const total = Number(row.total || 0);
    current.total += total;
    current.damage += metricConfig.metric === 'damage' ? total : 0;
    current.healing += metricConfig.metric === 'healing' ? total : 0;
    current.events += Number(row.events || 0);
    current.hits += Number(row.events || 0);
    current.mitigated += Number(row.mitigated || 0);
    current.crits += Number(row.crits || 0);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .sort((a, b) => (b.total - a.total) || (b.events - a.events))
    .slice(0, 40);
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
  };

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function createServer(db) {
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/reset') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Use POST' });
          return;
        }

        const result = db.prepare('DELETE FROM combat_events').run();
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        sendJson(res, 200, {
          ok: true,
          deleted: Number(result.changes || 0),
          resetAt: new Date().toISOString()
        });
        return;
      }

      if (url.pathname === '/api/summary') {
        const seconds = Number(url.searchParams.get('window') || 300);
        const sourceMode = url.searchParams.get('sourceMode') === 'all' ? 'all' : 'players';
        const metric = url.searchParams.get('metric') === 'healing' ? 'healing' : 'damage';
        sendJson(res, 200, getDashboardData(db, seconds, sourceMode, metric));
        return;
      }

      if (url.pathname === '/api/breakdown') {
        const seconds = Number(url.searchParams.get('window') || 300);
        const source = url.searchParams.get('source') || '';
        const metric = url.searchParams.get('metric') === 'healing' ? 'healing' : 'damage';
        if (!source) {
          sendJson(res, 400, { error: 'Missing source' });
          return;
        }

        sendJson(res, 200, { source, metric, rows: getBreakdownData(db, seconds, source, metric) });
        return;
      }

      const relativePath = url.pathname === '/'
        ? 'index.html'
        : decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const filePath = path.resolve(PUBLIC_DIR, relativePath);
      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      sendFile(res, filePath);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });
}

const args = parseArgs(process.argv);
const db = openDatabase(args.databasePath);
const server = createServer(db);

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${args.port} is already in use. The dashboard may already be running at http://localhost:${args.port}`);
  } else {
    console.error(error);
  }
  db.close();
  process.exitCode = 1;
});

server.listen(args.port, () => {
  console.log(`Pantheon dashboard listening at http://localhost:${args.port}`);
  console.log(`Database: ${args.databasePath}`);
});

process.on('SIGINT', () => {
  console.log('\nStopping dashboard...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
