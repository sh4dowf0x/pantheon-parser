const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function ensureCombatEventsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS combat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observed_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source TEXT,
      target TEXT,
      ability TEXT,
      amount INTEGER NOT NULL DEFAULT 0,
      damage_type TEXT,
      mitigated INTEGER NOT NULL DEFAULT 0,
      is_critical INTEGER NOT NULL DEFAULT 0,
      event_key TEXT,
      raw_message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_combat_events_observed_at
      ON combat_events(observed_at);

    CREATE INDEX IF NOT EXISTS idx_combat_events_event_type
      ON combat_events(event_type);

  `);

  const columns = db.prepare('PRAGMA table_info(combat_events)').all();
  const columnNames = new Set(columns.map((column) => column.name));
  const migrations = [
    ['observed_at', "ALTER TABLE combat_events ADD COLUMN observed_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'"],
    ['event_type', "ALTER TABLE combat_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'unknown'"],
    ['source', 'ALTER TABLE combat_events ADD COLUMN source TEXT'],
    ['target', 'ALTER TABLE combat_events ADD COLUMN target TEXT'],
    ['ability', 'ALTER TABLE combat_events ADD COLUMN ability TEXT'],
    ['amount', 'ALTER TABLE combat_events ADD COLUMN amount INTEGER NOT NULL DEFAULT 0'],
    ['damage_type', 'ALTER TABLE combat_events ADD COLUMN damage_type TEXT'],
    ['mitigated', 'ALTER TABLE combat_events ADD COLUMN mitigated INTEGER NOT NULL DEFAULT 0'],
    ['is_critical', 'ALTER TABLE combat_events ADD COLUMN is_critical INTEGER NOT NULL DEFAULT 0'],
    ['event_key', 'ALTER TABLE combat_events ADD COLUMN event_key TEXT'],
    ['raw_message', "ALTER TABLE combat_events ADD COLUMN raw_message TEXT NOT NULL DEFAULT ''"]
  ];

  for (const [name, sql] of migrations) {
    if (!columnNames.has(name)) {
      db.exec(sql);
    }
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_combat_events_event_key
      ON combat_events(event_key)
      WHERE event_key IS NOT NULL;
  `);
}

function openStore(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA busy_timeout = 3000');
  ensureCombatEventsSchema(db);

  const insert = db.prepare(`
    INSERT INTO combat_events (
      observed_at,
      event_type,
      source,
      target,
      ability,
      amount,
      damage_type,
      mitigated,
      is_critical,
      event_key,
      raw_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING
  `);

  return {
    insertEvent(event) {
      const result = insert.run(
        event.observedAt,
        event.eventType,
        event.source,
        event.target,
        event.ability,
        event.amount || 0,
        event.damageType,
        event.mitigated || 0,
        event.isCritical ? 1 : 0,
        event.eventKey || null,
        event.rawMessage
      );
      return Number(result.changes || 0) > 0;
    },

    recentSummary(seconds = 60) {
      const since = new Date(Date.now() - seconds * 1000).toISOString();
      return db.prepare(`
        SELECT
          source,
          SUM(amount) AS total_damage,
          COUNT(*) AS events
        FROM combat_events
        WHERE observed_at >= ?
          AND event_type = 'damage'
        GROUP BY source
        ORDER BY total_damage DESC
        LIMIT 12
      `).all(since);
    },

    close() {
      db.close();
    }
  };
}

module.exports = {
  ensureCombatEventsSchema,
  openStore
};
