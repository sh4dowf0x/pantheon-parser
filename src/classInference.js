const { normalizeAbility } = require('./combatParser');

const CLASS_RULES = [
  {
    className: 'Shaman',
    abilities: [
      'Mantle of Mist',
      'Replenish',
      'Serpentine Strike',
      'Bane of Venom',
      'Wind Striker',
      'Mark of the Fireclaw',
      'Fang of Salgi',
      'Grip of Shale'
    ]
  },
  {
    className: 'Druid',
    abilities: [
      'Ignite',
      "Hirode's Flame",
      'Stinging Swarm',
      'Talisman of Regrowth',
      'Verdanfire Bolt'
    ]
  },
  {
    className: 'Paladin',
    abilities: [
      'Divine Shock',
      'Faithful Strike',
      'Zealous Strike'
    ]
  },
  {
    className: 'Dire Lord',
    abilities: [
      'Bleeding Essence',
      'Corrupt Blood',
      'Fleshcarver',
      'Life Tap'
    ]
  },
  {
    className: 'Ranger',
    abilities: [
      'Howling Arrow',
      'Swift Shot'
    ]
  },
  {
    className: 'Summoner',
    abilities: [
      'Aether Shards',
      'Blast Creation',
      'Aether Darts',
      'Frail Mana Bomb'
    ]
  },
  {
    className: 'Warrior',
    abilities: [
      'Assault',
      'Bash',
      'Clash Charge',
      'Commanding Strike',
      'Quell',
      'Rupture',
      'Strike of Breaking',
      'Tidal Shout'
    ]
  },
  {
    className: 'Wizard',
    abilities: [
      'Blast of Cold',
      'Blaze',
      'Evoke Embers',
      'Jolt',
      'Sparking Bolt',
      'Static Storm'
    ]
  },
  {
    className: 'Cleric',
    abilities: [
      'Celestial Light',
      'Rebuke',
      'Sturdy Strike',
      'Dawnfire'
    ]
  },
  {
    className: 'Pet',
    abilities: [
      'Claw',
      'Gale Strike',
      'Galestrike',
      'Thresh',
      'Thrash',
      'Wind Blade'
    ]
  }
];

function baseAbilityName(value) {
  return normalizeAbility(value)
    .replace(/\s+(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/i, '')
    .trim();
}

function scoreClass(abilities, rule) {
  const matches = [];
  for (const ability of abilities) {
    const base = baseAbilityName(ability);
    if (rule.abilities.some((known) => base.toLowerCase() === known.toLowerCase())) {
      matches.push(base);
    }
  }

  return {
    className: rule.className,
    score: matches.length,
    matches: [...new Set(matches)].sort()
  };
}

function inferClassFromAbilities(abilities, options = {}) {
  const allAbilities = (abilities || [])
    .map((ability) => normalizeAbility(ability))
    .filter(Boolean);
  const normalizedAbilities = [...new Set(allAbilities
    .filter((ability) => ability !== 'Auto Attack'))];

  if (!normalizedAbilities.length) {
    const autoAttackEvents = Number(options.eventCount || 0);
    if (allAbilities.includes('Auto Attack') && autoAttackEvents >= 5) {
      return {
        className: 'Pet',
        confidence: 0.25,
        matchedAbilities: ['Auto Attack']
      };
    }

    return { className: 'Unknown', confidence: 0, matchedAbilities: [] };
  }

  const best = CLASS_RULES
    .map((rule) => scoreClass(normalizedAbilities, rule))
    .sort((a, b) => b.score - a.score || a.className.localeCompare(b.className))[0];

  if (!best || best.score === 0) {
    return { className: 'Unknown', confidence: 0, matchedAbilities: [] };
  }

  return {
    className: best.className,
    confidence: Number(Math.min(1, best.score / 3).toFixed(2)),
    matchedAbilities: best.matches
  };
}

module.exports = {
  baseAbilityName,
  inferClassFromAbilities
};
