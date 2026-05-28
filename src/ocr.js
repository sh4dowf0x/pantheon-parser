const { createWorker } = require('tesseract.js');
const { parseCombatLine } = require('./combatParser');

async function createOcr(config) {
  const worker = await createWorker(config.language || 'eng');
  await worker.setParameters({
    tessedit_pageseg_mode: config.psm || '6',
    preserve_interword_spaces: '1',
    debug_file: '/dev/null'
  });

  return {
    async recognize(imageBuffer) {
      const result = await worker.recognize(imageBuffer);
      return result.data.text || '';
    },

    async close() {
      await worker.terminate();
    }
  };
}

function extractLines(text) {
  return text
    .replace(/\s+[A-Za-z]{0,2}\s*(?=\[\d{1,2}:\d{2}:\d{2}\])/g, '\n')
    .split(/\r?\n/)
    .map((line) => line.replace(/[|_=~]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractLogicalLines(text) {
  const lines = extractLines(text);
  const output = [];

  for (const rawLine of lines) {
    for (const line of splitTimestampedFragments(rawLine)) {
      if (!startsWithFullTimestamp(line) && !output.length) continue;

      if (startsWithFullTimestamp(line)) {
        output.push(line);
        continue;
      }

      const previous = output[output.length - 1];
      const looksLikeContinuation = previous && shouldJoinWrappedLine(previous, line);

      if (looksLikeContinuation) {
        output[output.length - 1] = `${previous} ${line}`;
      }
    }
  }

  return output;
}

function shouldJoinWrappedLine(previous, line) {
  if (startsWithTimestamp(line) || startsNewStandaloneEvent(line)) return false;
  if (isCombatEvent(previous)) return isStrictSuffixContinuation(line);
  if (isCombatEvent(`${previous} ${line}`)) return true;
  if (isIncompleteCombatLine(previous) && !startsNewCombatFragment(line)) return true;
  return isSuffixContinuation(line) && looksLikeCombatFragment(previous);
}

function splitTimestampedFragments(line) {
  const timestampPattern = /\[\d{1,2}:\d{2}:\d{2}\]/g;
  const matches = [...line.matchAll(timestampPattern)];
  if (!matches.length) return [line];

  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : line.length;
    return line.slice(start, end).trim();
  }).filter(Boolean);
}

function isCombatEvent(line) {
  return parseCombatLine(line).eventType !== 'unknown';
}

function startsWithTimestamp(line) {
  return /^\W*\[?\d{1,2}:\d{2}:\d{2}\]?\s+/.test(line);
}

function startsWithFullTimestamp(line) {
  return /^\[\d{1,2}:\d{2}:\d{2}\]\s+/.test(line);
}

function startsNewStandaloneEvent(line) {
  return /^(?:Failed ability cast:|[A-Z][A-Za-z0-9' -]+ dealt \d+ [A-Za-z]+ damage to |[A-Z][A-Za-z0-9' -]+ healed |[A-Z][A-Za-z0-9' -]+ was healed for |[A-Z][A-Za-z0-9' -]+'s .+ (?:missed|was fully resisted by) |[A-Z][A-Za-z0-9' -]+ (?:dodged|parried) )/i.test(line) &&
    /[.)]$/.test(line);
}

function startsNewCombatFragment(line) {
  return /^(?:Failed ability cast:|[A-Z][A-Za-z0-9' -]+ dealt \d+ [A-Za-z]+ damage to |[A-Z][A-Za-z0-9' -]+ healed |[A-Z][A-Za-z0-9' -]+ was healed for |[A-Z][A-Za-z0-9' -]+'s .+ (?:missed|was fully resisted by) |[A-Z][A-Za-z0-9' -]+ (?:dodged|parried) )/i.test(line);
}

function looksLikeCombatFragment(line) {
  return / dealt \d+ [A-Za-z]+ damage to | healed .+ for \d+| was healed for \d+ by | was fully resisted by | missed | dodged | parried |Failed ability cast:/i.test(line);
}

function isIncompleteCombatLine(line) {
  if (!looksLikeCombatFragment(line)) return false;
  if (isCombatEvent(line)) return false;
  return (
    / dealt \d+ [A-Za-z]+ damage to .+$/i.test(line) ||
    / dealt \d+ [A-Za-z]+ damage to .+ with.*$/i.test(line) ||
    / healed .+ for \d+(?: with.*)?$/i.test(line) ||
    / was healed for \d+ by .*(?: with.*)?$/i.test(line) ||
    /'s .+ (?:missed|was fully resisted by) .+$/i.test(line) ||
    / (?:dodged|parried) .+'s .+$/i.test(line)
  );
}

function isSuffixContinuation(line) {
  return (
    isStrictSuffixContinuation(line) ||
    /^[A-Za-z][A-Za-z0-9' -]*(?:\.|\(|$)/.test(line)
  );
}

function isStrictSuffixContinuation(line) {
  return (
    /^\(?\d+ mitigated\)?\.?$/i.test(line) ||
    /^\(?Critical\)?\.?$/i.test(line)
  );
}

module.exports = {
  createOcr,
  extractLines,
  extractLogicalLines,
  shouldJoinWrappedLine
};
