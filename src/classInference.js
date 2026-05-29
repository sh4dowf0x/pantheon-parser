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
    className: 'Summoner Pet',
    abilities: [
      'Blast of Magic',
      'Mana Burst',
      'Mana Flame',
      'Mana Spike'
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

const NAMED_MOBS = [
  'Gruumsh the Elusive',
  'Crestlord Ruknar',
  'Krageeli the Ruinous',
  'Snik the Tidemancer',
  "Maraki'ki",
  'Krex',
  'sinister sproutbone',
  'Thixar the Bonehowl',
  'wildhive queen',
  'Vaelris the Deadheart',
  'Bogjaw',
  'Kaelthar teh Withering',
  'Kaelthar the Withering',
  'Thragos the Rootbound',
  'Karnak the Ironbranch',
  'highspire hivequeen',
  'Grimwatcher Xarok',
  'The Wycan',
  'Moon Witch Lysara',
  'Razorfang',
  'blackback widow',
  'Ragifus',
  'Abandoned Quarry Golem',
  'Trapmaker Krell',
  'masked bandit',
  'forgotten bowman',
  '"Hotshot" Sallisah',
  'Nightbane Toad',
  'Drog',
  'Pog the Elusive',
  'Windfeather',
  'Keragos the Watcher',
  'Rattlecage',
  'spider of ill omen',
  'Ulthiran Sacrificer',
  'Gadai Recruiter',
  'a jacked rabbit',
  'Zirus the Bonewalker',
  'Crav',
  "Xedras Mal'thir",
  'Heltic',
  'Jugo "Mountain" Pojacks',
  'grizzled greatpaw',
  'Larcs the Weaponsmith',
  'Elder Ironhide Boar',
  'Asabatu',
  'brooding skitterfang',
  'Bitter Bone',
  'cursed apparition',
  'War Scout Grak-Gor',
  'redjacket queen',
  'Rilo the Insomniac',
  'Gadai messenger',
  'Moonfang',
  'Wander Guardian',
  'Mountain Drake Matriarch'
];

function mobNameKey(value) {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/["]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const NAMED_MOB_KEYS = new Set(NAMED_MOBS.map(mobNameKey));

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

function isUnnamedMobName(value) {
  const name = String(value || '').trim();
  return /[a-z]/.test(name) && !/[A-Z0-9]/.test(name) && /^[a-z][a-z' -]*$/.test(name);
}

function isNamedMobName(value) {
  return NAMED_MOB_KEYS.has(mobNameKey(value));
}

function inferClassFromAbilities(abilities, options = {}) {
  if (isNamedMobName(options.sourceName)) {
    return {
      className: 'Mob',
      confidence: 1,
      matchedAbilities: ['named mob']
    };
  }

  if (isUnnamedMobName(options.sourceName)) {
    return {
      className: 'Mob',
      confidence: 1,
      matchedAbilities: ['lowercase name']
    };
  }

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
  isNamedMobName,
  isUnnamedMobName,
  inferClassFromAbilities
};
