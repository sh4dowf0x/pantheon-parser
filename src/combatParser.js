function cleanLine(line) {
  return line
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^\[]*?\[?\d{1,2}:\d{2}:\d{2}\]?\s*/, '')
    .replace(/\.?\s*\((\d+)\s+[^)]{1,8}\s+mitigated\)/ig, '. ($1 mitigated)')
    .replace(/\.?\s*\((\d+)\s*[:;'`.,-]*\s*mitigated\)/ig, '. ($1 mitigated)')
    .replace(/\.?\s*\((\d+)\s*\)\s*[-–—]\s*Failed ability cast:.*$/i, '. ($1 mitigated)')
    .replace(/\.?\s*\((\d+)\s*\)\s*$/i, '. ($1 mitigated)')
    .replace(/\.\s+\.$/, '.')
    .replace(/(\(\d+ mitigated\)(?:\s+\(Critical\))?)(?:\s+[^()]{1,16})$/i, '$1')
    .replace(/(\.)(?:\s+[A-Za-z0-9;:'"`|\\/-]{1,16})$/i, '$1')
    .replace(/(\.)(?:\s+[!\[\]{}]+)$/i, '$1')
    .replace(/\.\s+[|il1]$/i, '.')
    .trim();
}

function normalizeName(value) {
  const cleaned = String(value || '')
    .replace(/^[^\[]*?\[?\d{1,2}:\d{2}:\d{2}\]?\s*/, '')
    .replace(/^[^A-Za-z]*(?:[A-Z0-9]{1,2}:[A-Z0-9/]{1,3}(?::\s*[A-Z0-9/]{1,3})?\]?)\s+/i, '')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned.match(/[A-Za-z]+/g) || [];
  if (!tokens.length) return '';
  if (tokens.length > 1 && tokens[0].length <= 2 && tokens[0] === tokens[0].toUpperCase()) {
    return tokens.slice(1).join(' ');
  }

  return tokens.join(' ');
}

function normalizeAbility(value) {
  const base = String(value || '');
  if (/Already Casting/i.test(base)) return 'Already Casting';
  if (/Global Cooldown/i.test(base)) return 'Global Cooldown';
  if (/Cooldown/i.test(base)) return 'Cooldown';
  if (/Invalid Target/i.test(base)) return 'Invalid Target';
  if (/Target Is Dead/i.test(base)) return 'Target Is Dead';
  if (/Out of Range/i.test(base)) return 'Out of Range';
  if (/Not Ready/i.test(base)) return 'Not Ready';

  const ability = base
    .replace(/^[-,.;:'"`|\\/\s]+/, '')
    .replace(/\.?\s*\(\d+ mitigated\).*$/i, '')
    .replace(/\s+[!\[\]{}]+$/g, '')
    .replace(/\.\s*$/i, '')
    .replace(/[;:|]+/g, ' ')
    .replace(/\bAuto\s+[^A-Za-z0-9\s]{1,3}\s+Attack\b/i, 'Auto Attack')
    .replace(/\bAuto\s+Aftack\b/i, 'Auto Attack')
    .replace(/\b(?:s|i|l)\s+Attack\b/i, 'Attack')
    .replace(/\bAuta\s+Attack\b/i, 'Auto Attack')
    .replace(/\bAuto\s+Attack\b/i, 'Auto Attack')
    .replace(/\bBane of\s+[il1]\s+Venom\b/i, 'Bane of Venom')
    .replace(/\bSerpentine\s+Strike\s+(?:11|Il|ll|1I|I1)\b/i, 'Serpentine Strike II')
    .replace(/\b(?:11|Il|ll|1I|I1)$/i, 'II')
    .replace(/\bTho(?:rn|m|mn|rmn|nm|nmn)coat\b/i, 'Thorncoat')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^Auto Attack$/i.test(ability)) return 'Auto Attack';
  if (/^Corrupt\s*[-.]?\s*Blood(?:\s*[Il1])?$/i.test(ability)) return 'Corrupt Blood I';
  return ability;
}

function parseCombatLine(input) {
  const line = cleanLine(input);
  if (!line) return null;

  let match = line.match(/^(.+?) dealt (\d+) ([A-Za-z]+) damage to (.+?) with (.+?)\.(?: \((\d+) mitigated\))?(?: \(Critical\))?$/i);
  if (match) {
    return {
      eventType: 'damage',
      source: normalizeName(match[1]),
      target: normalizeName(match[4]),
      ability: normalizeAbility(match[5]),
      amount: Number(match[2]),
      damageType: match[3],
      mitigated: match[6] ? Number(match[6]) : 0,
      isCritical: /\(Critical\)$/i.test(line),
      rawMessage: line
    };
  }

  match = line.match(/^(.+?)'s (.+?) healed (.+?) for (\d+)\.(?: \(Critical\))?$/i);
  if (match) {
    return {
      eventType: 'healing',
      source: normalizeName(match[1]),
      target: normalizeName(match[3]),
      ability: normalizeAbility(match[2]),
      amount: Number(match[4]),
      damageType: null,
      mitigated: 0,
      isCritical: /\(Critical\)$/i.test(line),
      rawMessage: line
    };
  }

  match = line.match(/^(.+?) healed (.+?) for (\d+)(?: with (.+?))?\.(?: \(Critical\))?$/i);
  if (match) {
    return {
      eventType: 'healing',
      source: normalizeName(match[1]),
      target: normalizeName(match[2]),
      ability: match[4] ? normalizeAbility(match[4]) : null,
      amount: Number(match[3]),
      damageType: null,
      mitigated: 0,
      isCritical: /\(Critical\)$/i.test(line),
      rawMessage: line
    };
  }

  match = line.match(/^(.+?) was healed for (\d+) by (.+?) with (.+?)\.(?: \(Critical\))?$/i);
  if (match) {
    return {
      eventType: 'healing',
      source: normalizeName(match[3]),
      target: normalizeName(match[1]),
      ability: normalizeAbility(match[4]),
      amount: Number(match[2]),
      damageType: null,
      mitigated: 0,
      isCritical: /\(Critical\)$/i.test(line),
      rawMessage: line
    };
  }

  match = line.match(/^(.+?) was healed for (\d+) by (.+?)\.(?: \(Critical\))?$/i);
  if (match) {
    const ability = normalizeAbility(match[3]);
    return {
      eventType: 'healing',
      source: null,
      target: normalizeName(match[1]),
      ability,
      amount: Number(match[2]),
      damageType: null,
      mitigated: 0,
      isCritical: /\(Critical\)$/i.test(line),
      rawMessage: line
    };
  }

  match = line.match(/^(.+?)'s (.+?) was fully resisted by (.+?)\.$/i);
  if (match) {
    return {
      eventType: 'resist',
      source: normalizeName(match[1]),
      target: normalizeName(match[3]),
      ability: normalizeAbility(match[2]),
      amount: 0,
      damageType: null,
      mitigated: 0,
      isCritical: false,
      rawMessage: line
    };
  }

  match = line.match(/^(.+?)'s (.+?) missed (.+?)\.$/i);
  if (match) {
    return {
      eventType: 'miss',
      source: normalizeName(match[1]),
      target: normalizeName(match[3]),
      ability: normalizeAbility(match[2]),
      amount: 0,
      damageType: null,
      mitigated: 0,
      isCritical: false,
      rawMessage: line
    };
  }

  match = line.match(/^(.+?) dodged (.+?)'s (.+?)\.$/i);
  if (match) {
    return {
      eventType: 'dodge',
      source: normalizeName(match[2]),
      target: normalizeName(match[1]),
      ability: normalizeAbility(match[3]),
      amount: 0,
      damageType: null,
      mitigated: 0,
      isCritical: false,
      rawMessage: line
    };
  }

  match = line.match(/^(?:Failed ability cast:|ailed ability cast:|iled ability cast:)\s*(.+?)(?:\.|$)/i);
  if (match) {
    return {
      eventType: 'failed_cast',
      source: null,
      target: null,
      ability: normalizeAbility(match[1]),
      amount: 0,
      damageType: null,
      mitigated: 0,
      isCritical: false,
      rawMessage: line
    };
  }

  return {
    eventType: 'unknown',
    source: null,
    target: null,
    ability: null,
    amount: 0,
    damageType: null,
    mitigated: 0,
    isCritical: false,
    rawMessage: line
  };
}

function looksLikeCombatLine(line) {
  const value = cleanLine(line);
  return / dealt \d+ [A-Za-z]+ damage to .+ with .+(?:\.|\)|$)| healed .+ for \d+| was healed for \d+ by .+(?:\.|\)|$)| was fully resisted by | missed | dodged |^(?:Failed ability cast:|ailed ability cast:|iled ability cast:)/i.test(value);
}

module.exports = {
  cleanLine,
  normalizeAbility,
  normalizeName,
  looksLikeCombatLine,
  parseCombatLine
};
