// Unit tests for the pure warning/card rules. No dependencies, no framework:
//   node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert');

const { cardForWarnings, warningCountLabel, warningMessage } = require('../js/rules.js');

test('cardForWarnings maps a warning count to a card', () => {
  assert.equal(cardForWarnings(0), 'none');
  assert.equal(cardForWarnings(1), 'yellow');
  assert.equal(cardForWarnings(2), 'red');
  assert.equal(cardForWarnings(3), 'red', 'red stays red past two');
});

test('the second warning is where a player is out', () => {
  // The gameplay rule in one place: warning 2 is the red card / elimination.
  assert.equal(cardForWarnings(1), 'yellow');
  assert.equal(cardForWarnings(2), 'red');
});

test('warningCountLabel uses the Finnish singular only at exactly one', () => {
  assert.equal(warningCountLabel(0), '0 varoitusta');
  assert.equal(warningCountLabel(1), '1 varoitus');
  assert.equal(warningCountLabel(2), '2 varoitusta');
  assert.equal(warningCountLabel(3), '3 varoitusta');
});

test('warningMessage appends the yellow card phrase at one warning', () => {
  assert.equal(warningMessage('Väärä vastaus!', 1), 'Väärä vastaus! 🟨 Keltainen kortti.');
});

test('warningMessage appends the red card phrase, and elimination, at two', () => {
  assert.equal(warningMessage('Väärä vastaus!', 2), 'Väärä vastaus! 🟥 Punainen kortti — pois pelistä.');
});

test('warningMessage keeps the caller-supplied reason prefix intact', () => {
  assert.equal(warningMessage('Aika loppui!', 1), 'Aika loppui! 🟨 Keltainen kortti.');
  assert.equal(warningMessage('Helsinki on jo sanottu!', 2), 'Helsinki on jo sanottu! 🟥 Punainen kortti — pois pelistä.');
});
