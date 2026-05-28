const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findNewLines, fingerprintLine, RecentLineCache } = require('../src/dedupe');
const { normalizeAbility, normalizeName, parseCombatLine } = require('../src/combatParser');
const { inferClassFromAbilities } = require('../src/classInference');
const { extractLogicalLines } = require('../src/ocr');
const { openStore } = require('../src/store');

const damage = parseCombatLine('Nexie dealt 7 Physical damage to vinecoil snake with Auto Attack. (1 mitigated) (Critical)');
assert.equal(damage.eventType, 'damage');
assert.equal(damage.source, 'Nexie');
assert.equal(damage.target, 'vinecoil snake');
assert.equal(damage.ability, 'Auto Attack');
assert.equal(damage.amount, 7);
assert.equal(damage.damageType, 'Physical');
assert.equal(damage.mitigated, 1);
assert.equal(damage.isCritical, true);

const timestampedDamage = parseCombatLine('[17:02:51] corrupted sproutbone dealt 8 Curse damage to Defender with Cursebolt.');
assert.equal(timestampedDamage.eventType, 'damage');
assert.equal(timestampedDamage.source, 'corrupted sproutbone');
assert.equal(timestampedDamage.target, 'Defender');
assert.equal(timestampedDamage.amount, 8);

assert.equal(normalizeName('U3:5U:16] Shadowfox'), 'Shadowfox');
assert.equal(normalizeName('U3:48:U2 Shadowfox'), 'Shadowfox');
assert.equal(normalizeName('Us:8Y9:Ub Shadowfox'), 'Shadowfox');
assert.equal(normalizeName('US:08:24] Shadowfox'), 'Shadowfox');
assert.equal(normalizeName('U4:UU: 16] Aeron'), 'Aeron');
assert.equal(normalizeName('Us:b6:5/] Stoat'), 'Stoat');
assert.equal(normalizeName('Us:5/:U4 nylem hatchling'), 'nylem hatchling');
assert.equal(normalizeName('EE Shadowfox'), 'Shadowfox');
assert.equal(normalizeName('wildleaf poppywig'), 'wildleaf poppywig');

assert.equal(normalizeAbility('. Auto Attack'), 'Auto Attack');
assert.equal(normalizeAbility('- Auto Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto ; Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto s Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto ! Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto . Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto Aftack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto'), 'Auto Attack');
assert.equal(normalizeAbility('Auto tack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto N Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto ERA Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto "Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto Ny Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto 3 Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto Aa a Attack'), 'Auto Attack');
assert.equal(normalizeAbility('Auto Attack. (10 mitigated) oe'), 'Auto Attack');
assert.equal(normalizeAbility('Bane of i Venom II'), 'Bane of Venom II');
assert.equal(normalizeAbility('Bane of Venom Il'), 'Bane of Venom II');
assert.equal(normalizeAbility('Serpentine Strike 11'), 'Serpentine Strike II');
assert.equal(normalizeAbility('Thomcoat'), 'Thorncoat');
assert.equal(normalizeAbility('Thormncoat'), 'Thorncoat');
assert.equal(normalizeAbility('Thomncoat'), 'Thorncoat');
assert.equal(normalizeAbility('Thorncoat'), 'Thorncoat');
assert.equal(normalizeAbility('Mantle of Mist Il. ['), 'Mantle of Mist II');
assert.equal(normalizeAbility('Mantle of Mist II. !'), 'Mantle of Mist II');
assert.equal(normalizeAbility('Corrupt Blood'), 'Corrupt Blood I');
assert.equal(normalizeAbility('Corrupt Blood I'), 'Corrupt Blood I');
assert.equal(normalizeAbility('Corrupt - Blood I'), 'Corrupt Blood I');
assert.equal(normalizeAbility('Corrupt Blood I. (2'), 'Corrupt Blood I');
assert.equal(normalizeAbility('Corrupt Blood (2'), 'Corrupt Blood I');
assert.equal(normalizeAbility('Corrupt Blood 4'), 'Corrupt Blood I');
assert.equal(normalizeAbility('Corrupt Blood A'), 'Corrupt Blood I');
assert.equal(normalizeAbility('Corrupt a Blood I'), 'Corrupt Blood I');
assert.equal(normalizeAbility(', Fleshcarver'), 'Fleshcarver');
assert.equal(normalizeAbility('Fleshcarver II'), 'Fleshcarver II');
assert.equal(normalizeAbility('N Fleshcarver II'), 'Fleshcarver II');
assert.equal(normalizeAbility('Ny Fleshcarver II'), 'Fleshcarver II');
assert.equal(normalizeAbility('a Fleshcarver II'), 'Fleshcarver II');
assert.equal(normalizeAbility('3 Fleshcarver II'), 'Fleshcarver II');
assert.equal(normalizeAbility('i Fleshcarver II'), 'Fleshcarver II');
assert.equal(normalizeAbility('p 7 Fleshcarver II'), 'Fleshcarver II');
assert.equal(normalizeAbility('Fleshcarver N II'), 'Fleshcarver II');
assert.equal(normalizeAbility('Bleeding'), 'Bleeding Essence');
assert.equal(normalizeAbility('Bleeding N Essence'), 'Bleeding Essence');
assert.equal(normalizeAbility('Bleeding f Essence'), 'Bleeding Essence');
assert.equal(normalizeAbility('Bleeding i Essence'), 'Bleeding Essence');
assert.equal(normalizeAbility('Bleeding 3 Essence'), 'Bleeding Essence');
assert.equal(normalizeAbility('Thresh'), 'Thresh I');
assert.equal(normalizeAbility('Thresh 7'), 'Thresh I');
assert.equal(normalizeAbility('Thresh Fl'), 'Thresh I');
assert.equal(normalizeAbility('Divine Sal ¥ » Shock'), 'Divine Shock');
assert.equal(normalizeAbility('Divine Sale NW, J » Shock'), 'Divine Shock');
assert.equal(normalizeAbility('Divine \\ Shock'), 'Divine Shock');
assert.equal(normalizeAbility('Zealous -. © e Strike'), 'Zealous Strike');
assert.equal(normalizeAbility('Zealous \\ Strike'), 'Zealous Strike');
assert.equal(normalizeAbility('Auto Attack. \\'), 'Auto Attack');
assert.equal(normalizeAbility('Already Casting. S bw - BE BR we. NEN Ee La THAT'), 'Already Casting');
assert.equal(normalizeAbility('Already Casting. i as T RL'), 'Already Casting');

assert.deepEqual(
  inferClassFromAbilities(['Mantle of Mist Il', 'Stinging Swarm I']).className,
  'Druid'
);
assert.deepEqual(
  inferClassFromAbilities(['Serpentine Strike II', 'Bane of Venom II']).className,
  'Shaman'
);
assert.deepEqual(
  inferClassFromAbilities(['Bane of Venom II']).className,
  'Shaman'
);
assert.deepEqual(
  inferClassFromAbilities(['Mantle of Mist II', 'Wind Striker', 'Grip of Shale']).className,
  'Shaman'
);
assert.deepEqual(
  inferClassFromAbilities(['Talisman of Regrowth II', 'Ignite II', 'Verdanfire Bolt']).className,
  'Druid'
);
assert.deepEqual(
  inferClassFromAbilities(['Corrupt Blood II', 'Fleshcarver', 'Life Tap']).className,
  'Dire Lord'
);
assert.deepEqual(
  inferClassFromAbilities(['Wind Blade II', 'Galestrike I']).className,
  'Pet'
);
assert.deepEqual(
  inferClassFromAbilities(['Celestial Light II']).className,
  'Cleric'
);
assert.deepEqual(
  inferClassFromAbilities(['Dawnfire II']).className,
  'Cleric'
);
assert.deepEqual(
  inferClassFromAbilities(['Evoke Embers II', 'Static Storm', 'Blaze', 'Sparking Bolt']).className,
  'Wizard'
);
assert.deepEqual(
  inferClassFromAbilities(['Blast of Cold II', 'Jolt']).className,
  'Wizard'
);
assert.deepEqual(
  inferClassFromAbilities(['Howling Arrow II', 'Swift Shot']).className,
  'Ranger'
);
assert.deepEqual(
  inferClassFromAbilities(['assault', 'Commanding Strike II', 'Strike of Breaking', 'Quell']).className,
  'Warrior'
);
assert.deepEqual(
  inferClassFromAbilities(['Divine Shock II', 'Zealous Strike', 'Faithful Strike']).className,
  'Paladin'
);
assert.deepEqual(
  inferClassFromAbilities(['Auto Attack']).className,
  'Unknown'
);
assert.deepEqual(
  inferClassFromAbilities(['Auto Attack'], { eventCount: 5 }).className,
  'Pet'
);

const noisyAutoAttack = parseCombatLine('Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto ; Attack. (10 mitigated) k -');
assert.equal(noisyAutoAttack.eventType, 'damage');
assert.equal(noisyAutoAttack.ability, 'Auto Attack');
assert.equal(noisyAutoAttack.mitigated, 10);

const prefixedTimestamp = parseCombatLine(". [20:22:26] Shadowfox dealt 41 Physical damage to vineweaver hatchling with Serpentine Strike Il. (10 mitigated)");
assert.equal(prefixedTimestamp.eventType, 'damage');
assert.equal(prefixedTimestamp.source, 'Shadowfox');
assert.equal(prefixedTimestamp.ability, 'Serpentine Strike II');

const noisyMitigated = parseCombatLine("Shadowfox dealt 40 Physical damage to gas bat nesting with Serpentine Strike II. (10 :' mitigated)");
assert.equal(noisyMitigated.eventType, 'damage');
assert.equal(noisyMitigated.ability, 'Serpentine Strike II');
assert.equal(noisyMitigated.mitigated, 10);

const noisyMitigatedTwo = parseCombatLine("Shadowfox dealt 40 Physical damage to gas bat nesting with Serpentine Strike II. (10 ) - Failed ability cast: Already Casting.");
assert.equal(noisyMitigatedTwo.eventType, 'damage');
assert.equal(noisyMitigatedTwo.ability, 'Serpentine Strike II');
assert.equal(noisyMitigatedTwo.mitigated, 10);

const noisyMitigatedThree = parseCombatLine("Bitik dealt 9 Physical damage to spine crawler with Auto Attack. (2 fe mitigated)");
assert.equal(noisyMitigatedThree.eventType, 'damage');
assert.equal(noisyMitigatedThree.source, 'Bitik');
assert.equal(noisyMitigatedThree.ability, 'Auto Attack');
assert.equal(noisyMitigatedThree.mitigated, 2);

const noisyMitigatedFour = parseCombatLine("Bitik dealt 9 Physical damage to spine crawler with Auto Attack. (2 i mitigated)");
assert.equal(noisyMitigatedFour.eventType, 'damage');
assert.equal(noisyMitigatedFour.mitigated, 2);

const noisyAutoAttackTwo = parseCombatLine("Shadowfox dealt 35 Physical damage to spine crawler with Auto ! Attack. (8 mitigated)");
assert.equal(noisyAutoAttackTwo.eventType, 'damage');
assert.equal(noisyAutoAttackTwo.ability, 'Auto Attack');

const noisyBane = parseCombatLine("Shadowfox dealt 14 Poison damage to spine crawler with Bane of i Venom II. (3 mitigated)");
assert.equal(noisyBane.eventType, 'damage');
assert.equal(noisyBane.ability, 'Bane of Venom II');

const leadingJunkName = parseCombatLine("1 Bitik dealt 10 Physical damage to gas bat nestling with Auto Attack. (2 mitigated)");
assert.equal(leadingJunkName.eventType, 'damage');
assert.equal(leadingJunkName.source, 'Bitik');

const leadingJunkResist = parseCombatLine("[ Shadowfox's Bane of Venom II was fully resisted by gas bat nestling.");
assert.equal(leadingJunkResist.eventType, 'resist');
assert.equal(leadingJunkResist.source, 'Shadowfox');

const noisyFailedCast = parseCombatLine('Failed ability cast: Already Casting. S bw - BE BR we. NEN Ee La THAT');
assert.equal(noisyFailedCast.eventType, 'failed_cast');
assert.equal(noisyFailedCast.ability, 'Already Casting');

const missingPeriodFailedCast = parseCombatLine('Failed ability cast: Already Casting');
assert.equal(missingPeriodFailedCast.eventType, 'failed_cast');
assert.equal(missingPeriodFailedCast.ability, 'Already Casting');

const heal = parseCombatLine('Nexie was healed for 5 by Talisman of Regrowth I.');
assert.equal(heal.eventType, 'healing');
assert.equal(heal.source, null);
assert.equal(heal.target, 'Nexie');
assert.equal(heal.ability, 'Talisman of Regrowth I');
assert.equal(heal.amount, 5);

const noisyMantleHeal = parseCombatLine('Shadowfox was healed for 4 by Mantle of Mist Il. [');
assert.equal(noisyMantleHeal.eventType, 'healing');
assert.equal(noisyMantleHeal.source, null);
assert.equal(noisyMantleHeal.ability, 'Mantle of Mist II');
assert.equal(noisyMantleHeal.amount, 4);

const noisyMantleHealTwo = parseCombatLine('Shadowfox was healed for 4 by Mantle of Mist II. !');
assert.equal(noisyMantleHealTwo.eventType, 'healing');
assert.equal(noisyMantleHealTwo.source, null);
assert.equal(noisyMantleHealTwo.ability, 'Mantle of Mist II');

const sourcedHeal = parseCombatLine('Cleric healed Shadowfox for 42 with Flash Heal.');
assert.equal(sourcedHeal.eventType, 'healing');
assert.equal(sourcedHeal.source, 'Cleric');
assert.equal(sourcedHeal.target, 'Shadowfox');
assert.equal(sourcedHeal.ability, 'Flash Heal');
assert.equal(sourcedHeal.amount, 42);

const possessiveHeal = parseCombatLine("Cleric's Regrowth healed Shadowfox for 18.");
assert.equal(possessiveHeal.eventType, 'healing');
assert.equal(possessiveHeal.source, 'Cleric');
assert.equal(possessiveHeal.target, 'Shadowfox');
assert.equal(possessiveHeal.ability, 'Regrowth');

const resist = parseCombatLine("Nexie's Ignite I was fully resisted by vinecoil snake.");
assert.equal(resist.eventType, 'resist');
assert.equal(resist.source, 'Nexie');
assert.equal(resist.ability, 'Ignite I');
assert.equal(resist.target, 'vinecoil snake');

const miss = parseCombatLine("vinecoil snake's Auto Attack missed Nexie.");
assert.equal(miss.eventType, 'miss');
assert.equal(miss.source, 'vinecoil snake');
assert.equal(miss.target, 'Nexie');

const dodge = parseCombatLine("Nexie dodged ashveil wasp's Auto Attack.");
assert.equal(dodge.eventType, 'dodge');
assert.equal(dodge.source, 'ashveil wasp');
assert.equal(dodge.target, 'Nexie');

const parry = parseCombatLine("Defender parried ashveil wasp's Auto Attack.");
assert.equal(parry.eventType, 'parry');
assert.equal(parry.source, 'ashveil wasp');
assert.equal(parry.target, 'Defender');

assert.deepEqual(
  findNewLines(['a', 'b', 'c'], ['b', 'c', 'd', 'd']),
  ['d', 'd']
);

assert.deepEqual(
  findNewLines(['x', 'repeat'], ['repeat', 'repeat']),
  ['repeat']
);

assert.equal(
  fingerprintLine('. [17:02:52] corrupted sproutbone dealt 1 Disease damage to Defender with Diseased. i'),
  '17:02:52|damage|corrupted sproutbone|defender|diseased|1|disease|0|0'
);

assert.equal(
  fingerprintLine('[20:32:47] Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto ; Attack. (10 mitigated)'),
  '20:32:47|damage|shadowfox|vineweaver hatchling|auto attack|41|physical|10|0'
);

assert.equal(
  fingerprintLine('Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto Attack. (10 mitigated)'),
  'no-time|damage|shadowfox|vineweaver hatchling|auto attack|41|physical|10|0'
);

const recent = new RecentLineCache({ ttlMs: 1000, maxEntries: 10 });
assert.deepEqual(
  recent.filterNew([
    '[20:32:47] Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto Attack. (10 mitigated)',
    '[20:32:47] Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto ; Attack. (10 mitigated)'
  ], 1000),
  ['[20:32:47] Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto Attack. (10 mitigated)']
);
assert.deepEqual(
  recent.filterNew(['[20:32:48] Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto Attack. (10 mitigated)'], 1200),
  ['[20:32:48] Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto Attack. (10 mitigated)']
);
assert.deepEqual(
  recent.filterNew(['[20:32:48] Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto Attack. (10 mitigated)'], 1300),
  []
);

assert.deepEqual(
  extractLogicalLines('[17:16:18] Shadowfox dealt 25 Physical damage to jungle goblin thrasher with\nAuto Attack. (8 mitigated)'),
  ['[17:16:18] Shadowfox dealt 25 Physical damage to jungle goblin thrasher with Auto Attack. (8 mitigated)']
);

assert.deepEqual(
  extractLogicalLines('[17:16:19] Vijeken dealt 11 Physical damage to wildleaf poppywig with Auto\nAttack. (2 mitigated)\n\n[17:16:20] Failed ability cast: Cooldown.'),
  [
    '[17:16:19] Vijeken dealt 11 Physical damage to wildleaf poppywig with Auto Attack. (2 mitigated)',
    '[17:16:20] Failed ability cast: Cooldown.'
  ]
);

assert.deepEqual(
  extractLogicalLines('[17:16:23] Shadowfox dealt 32 Physical damage to unusually long wildleaf\npoppywig name with Serpentine Strike II. (7 mitigated)'),
  ['[17:16:23] Shadowfox dealt 32 Physical damage to unusually long wildleaf poppywig name with Serpentine Strike II. (7 mitigated)']
);

assert.deepEqual(
  extractLogicalLines('[21:21:48] Shadowfox dealt 38 Physical damage to spine crawler with Serpentine Strike II. (9 mitigated)\nEE. UTTER "RAs. a nh'),
  [
    '[21:21:48] Shadowfox dealt 38 Physical damage to spine crawler with Serpentine Strike II. (9 mitigated)'
  ]
);

assert.deepEqual(
  extractLogicalLines('Essence. (2 mitigated)\n[14:22:50] Buster dealt 8 Physical damage to jungle goblin thrasher with Bleeding\nEssence. (2 mitigated)'),
  ['[14:22:50] Buster dealt 8 Physical damage to jungle goblin thrasher with Bleeding Essence. (2 mitigated)']
);

assert.deepEqual(
  extractLogicalLines('#; [14:13:01] Buster dealt 3 Nature damage to jungle goblin scout with Thorncoat.'),
  ['[14:13:01] Buster dealt 3 Nature damage to jungle goblin scout with Thorncoat.']
);

assert.deepEqual(
  extractLogicalLines("[17:16:24] Cleric's Talisman of Regrowth healed unusually long\nShadowfox name for 18."),
  ["[17:16:24] Cleric's Talisman of Regrowth healed unusually long Shadowfox name for 18."]
);

assert.deepEqual(
  extractLogicalLines("[12:35:05] Defender parried ashveil wasp's Auto Attack. v [12:35:08] Defender dodged ashveil wasp's Auto Attack."),
  [
    "[12:35:05] Defender parried ashveil wasp's Auto Attack.",
    "[12:35:08] Defender dodged ashveil wasp's Auto Attack."
  ]
);

const tempDb = path.join(os.tmpdir(), `pantheon-parser-test-${process.pid}.sqlite`);
try {
  fs.rmSync(tempDb, { force: true });
  const store = openStore(tempDb);
  const event = {
    observedAt: new Date().toISOString(),
    eventType: 'damage',
    source: 'Shadowfox',
    target: 'vineweaver hatchling',
    ability: 'Auto Attack',
    amount: 41,
    damageType: 'Physical',
    mitigated: 10,
    isCritical: false,
    eventKey: '20:32:47|damage|shadowfox|vineweaver hatchling|auto attack|41|physical|10|0',
    rawMessage: 'Shadowfox dealt 41 Physical damage to vineweaver hatchling with Auto Attack. (10 mitigated)'
  };
  assert.equal(store.insertEvent(event), true);
  assert.equal(store.insertEvent(event), false);
  store.close();
} finally {
  fs.rmSync(tempDb, { force: true });
}

console.log('parser tests passed');
