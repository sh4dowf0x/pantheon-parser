const { cleanLine, parseCombatLine } = require('./combatParser');

function overlapLength(previous, current) {
  const max = Math.min(previous.length, current.length);
  for (let length = max; length > 0; length--) {
    let matches = true;
    for (let i = 0; i < length; i++) {
      if (previous[previous.length - length + i] !== current[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return length;
  }
  return 0;
}

function findNewLines(previousVisibleLines, currentVisibleLines) {
  if (!previousVisibleLines.length) return currentVisibleLines;
  const overlap = overlapLength(previousVisibleLines, currentVisibleLines);
  if (overlap > 0) return currentVisibleLines.slice(overlap);

  const previousCounts = new Map();
  for (const line of previousVisibleLines) {
    previousCounts.set(line, (previousCounts.get(line) || 0) + 1);
  }

  const output = [];
  for (const line of currentVisibleLines) {
    const count = previousCounts.get(line) || 0;
    if (count > 0) {
      previousCounts.set(line, count - 1);
    } else {
      output.push(line);
    }
  }
  return output;
}

function extractLogTimestamp(line) {
  const match = String(line).match(/\[?(\d{1,2}:\d{2}:\d{2})\]?/);
  return match ? match[1] : null;
}

function fingerprintLine(line) {
  const timestamp = extractLogTimestamp(line);
  const event = parseCombatLine(line);
  if (event && event.eventType !== 'unknown') {
    return [
      timestamp || 'no-time',
      event.eventType,
      event.source || '',
      event.target || '',
      event.ability || '',
      event.amount || 0,
      event.damageType || '',
      event.mitigated || 0,
      event.isCritical ? 1 : 0
    ].join('|').toLowerCase();
  }

  return cleanLine(String(line)
    .replace(/[â€œâ€]/g, '"')
    .replace(/[â€˜â€™]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\.\s+[|il1]$/i, '.')
    .trim())
    .toLowerCase();
}

class RecentLineCache {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 120000;
    this.maxEntries = options.maxEntries ?? 500;
    this.seen = new Map();
  }

  filterNew(lines, now = Date.now()) {
    this.prune(now);
    const output = [];

    for (const line of lines) {
      const fingerprint = fingerprintLine(line);
      if (!fingerprint) continue;
      if (this.seen.has(fingerprint)) continue;
      this.seen.set(fingerprint, now);
      output.push(line);
    }

    this.prune(now);
    return output;
  }

  prune(now = Date.now()) {
    for (const [fingerprint, seenAt] of this.seen) {
      if (now - seenAt > this.ttlMs) this.seen.delete(fingerprint);
    }

    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      this.seen.delete(oldest);
    }
  }
}

module.exports = {
  extractLogTimestamp,
  findNewLines,
  fingerprintLine,
  RecentLineCache
};
