// Unit tests for the pure matching logic. No dependencies, no framework:
//   node --test test/
const test = require('node:test');
const assert = require('node:assert');

const { normalize, levenshtein, matchAnswer } = require('../js/matching.js');
const { defaultCategories } = require('../js/categories.js');

const CITIES = defaultCategories()[0].answers;
const match = (raw) => matchAnswer(raw, CITIES);

test('normalize folds case, trims and strips punctuation', () => {
  assert.equal(normalize('Helsinki'), 'helsinki');
  assert.equal(normalize('  HELSINKI  '), 'helsinki');
  assert.equal(normalize('Helsinki!'), 'helsinki');
  assert.equal(normalize('Jyväskylä'), 'jyväskylä', 'ä/ö/å must survive');
  assert.equal(normalize('Ma"tti'), 'matti');
  assert.equal(normalize('123'), '');
  assert.equal(normalize('   '), '');
});

test('normalize keeps spaces and hyphens, which compound answers need', () => {
  assert.equal(normalize('Iso-Britannia'), 'iso-britannia');
  assert.equal(normalize('  Uusi  Seelanti '), 'uusi  seelanti');
});

test('levenshtein counts single edits of each kind', () => {
  assert.equal(levenshtein('pori', 'pori'), 0);
  assert.equal(levenshtein('poro', 'pori'), 1, 'substitution');
  assert.equal(levenshtein('por', 'pori'), 1, 'deletion');
  assert.equal(levenshtein('porii', 'pori'), 1, 'insertion');
  assert.equal(levenshtein('', 'pori'), 4);
  assert.equal(levenshtein('helsinki', 'turku'), 7);
});

test('an exact canonical matches', () => {
  assert.equal(match('helsinki'), 'helsinki');
  assert.equal(match('porvoo'), 'porvoo');
  assert.equal(match('Helsinki'), 'helsinki');
  assert.equal(match('  HELSINKI  '), 'helsinki');
});

test('a listed inflected form matches its canonical', () => {
  assert.equal(match('helsingissä'), 'helsinki');
  assert.equal(match('tampereella'), 'tampere');
  assert.equal(match('lahdessa'), 'lahti');
  assert.equal(match('turussa'), 'turku');
});

test('nonsense and empty input are rejected', () => {
  assert.equal(match('qwertyuiop'), null);
  assert.equal(match(''), null);
  assert.equal(match('   '), null);
  assert.equal(match('!!!'), null);
});

// ---------------------------------------------------------------------------
// Baseline: the two behaviours the next two commits deliberately change.
// These assertions are expected to flip, and the diff that flips them is the
// record of what was traded. See ROADMAP.md items 3 and 4.
// ---------------------------------------------------------------------------

test('BASELINE: cities without listed forms reject their inflections', () => {
  // The most unfair failure in the game: 52 of 72 cities only accept the base
  // form, so a correct answer earns a yellow card. ROADMAP #3.
  assert.equal(match('porvoossa'), null);
  assert.equal(match('kuusamossa'), null);
  assert.equal(match('haminassa'), null);
  assert.equal(match('mäntässä'), null);
});

test('BASELINE: the fuzzy fallback accepts near-miss nonsense', () => {
  // One edit is allowed even on four-letter canonicals. ROADMAP #4.
  assert.equal(match('poro'), 'pori');
  assert.equal(match('talo'), 'salo');
});
