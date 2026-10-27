// Pure warning/card rules: no DOM, no globals, no browser APIs.
//
// Separate from game.js for the same reason as matching.js -- game.js runs
// top-level code against the DOM and can never be imported, while the
// warning-to-card decision and its Finnish wording are pure and are exactly
// where a bug would hide. Loaded as a classic script before game.js, so the
// file:// workflow is unaffected. See README.md.

// One warning is a yellow card, two are red and out. This is the single place
// that decides which card a warning count earns; game.js never compares the
// count itself.
function cardForWarnings(warnings){
  if(warnings >= 2) return 'red';
  if(warnings === 1) return 'yellow';
  return 'none';
}

// Finnish singular only at exactly one: "1 varoitus" but "0 varoitusta" and
// "2 varoitusta".
function warningCountLabel(warnings){
  return `${warnings} ${warnings === 1 ? 'varoitus' : 'varoitusta'}`;
}

// The feedback line for a warning. `prefix` is the reason-specific half
// (e.g. which answer was rejected); the card phrase is appended here so the
// yellow and red wording can never diverge between callers.
function warningMessage(prefix, warnings){
  const card = cardForWarnings(warnings);
  if(card === 'red') return `${prefix} 🟥 Punainen kortti — pois pelistä.`;
  if(card === 'yellow') return `${prefix} 🟨 Keltainen kortti.`;
  return prefix;
}

// No-op in the browser; a real CommonJS module in Node.
if(typeof module !== 'undefined') module.exports = { cardForWarnings, warningCountLabel, warningMessage };
