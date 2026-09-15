// Structural validation of the shipped category data. Data bugs here surface
// as baffling gameplay rather than as errors, so they are worth catching in
// CI: a duplicate canonical makes one answer unreachable, and a form that
// collides with a different answer's canonical silently resolves to the wrong
// city. See TESTING.md.
const test = require('node:test');
const assert = require('node:assert');

const { CITY_ALIASES, CITY_LIST, defaultCategories } = require('../js/categories.js');

const CATEGORIES = defaultCategories();

test('every category has a name and a non-empty answer list', () => {
  assert.ok(Array.isArray(CATEGORIES) && CATEGORIES.length > 0);
  for(const cat of CATEGORIES){
    assert.equal(typeof cat.name, 'string', 'name must be a string');
    assert.notEqual(cat.name.trim(), '', 'name must not be blank');
    assert.ok(Array.isArray(cat.answers), `${cat.name}: answers must be a list`);
    assert.ok(cat.answers.length > 0, `${cat.name}: has no answers, so it cannot be played`);
  }
});

test('canonicals are lowercase, trimmed and unique within a category', () => {
  for(const cat of CATEGORIES){
    const seen = new Set();
    for(const a of cat.answers){
      assert.equal(typeof a.canonical, 'string', `${cat.name}: answer without a canonical`);
      assert.equal(a.canonical, a.canonical.toLowerCase(), `${cat.name}: "${a.canonical}" is not lowercase`);
      assert.equal(a.canonical, a.canonical.trim(), `${cat.name}: "${a.canonical}" has surrounding whitespace`);
      assert.notEqual(a.canonical, '', `${cat.name}: empty canonical`);
      assert.ok(!seen.has(a.canonical), `${cat.name}: duplicate canonical "${a.canonical}"`);
      seen.add(a.canonical);
    }
  }
});

test('forms are lowercase strings and never collide with another answer', () => {
  for(const cat of CATEGORIES){
    const canonicals = new Set(cat.answers.map(a => a.canonical));
    const owner = new Map();
    for(const a of cat.answers){
      if(a.forms === undefined) continue;
      assert.ok(Array.isArray(a.forms), `${cat.name}: "${a.canonical}" has a non-list forms`);
      for(const f of a.forms){
        assert.equal(typeof f, 'string', `${cat.name}: "${a.canonical}" has a non-string form`);
        assert.equal(f, f.toLowerCase(), `${cat.name}: form "${f}" is not lowercase`);
        assert.notEqual(f.trim(), '', `${cat.name}: "${a.canonical}" has a blank form`);
        assert.ok(!canonicals.has(f) || f === a.canonical,
          `${cat.name}: form "${f}" of "${a.canonical}" is another answer's canonical`);
        assert.ok(!owner.has(f),
          `${cat.name}: form "${f}" is claimed by both "${owner.get(f)}" and "${a.canonical}"`);
        owner.set(f, a.canonical);
      }
    }
  }
});

test('the city list has no duplicates', () => {
  assert.equal(new Set(CITY_LIST).size, CITY_LIST.length);
});

test('every CITY_ALIASES key is a real city', () => {
  // A typo'd key here is silent: the aliases simply never get attached.
  const cities = new Set(CITY_LIST);
  for(const key of Object.keys(CITY_ALIASES)){
    assert.ok(cities.has(key), `CITY_ALIASES has "${key}", which is not in CITY_LIST`);
  }
});
