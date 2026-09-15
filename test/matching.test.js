// Unit tests for the pure matching logic. No dependencies, no framework:
//   node --test test/
const test = require('node:test');
const assert = require('node:assert');

const { normalize, levenshtein, stemOf, matchAnswer } = require('../js/matching.js');
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

test('cities without listed forms still accept their inflections', () => {
  // Was the most unfair failure in the game: 52 of 72 cities used to accept
  // the base form only, so a correct answer earned a yellow card. ROADMAP #3.
  assert.equal(match('porvoossa'), 'porvoo');
  assert.equal(match('kuusamossa'), 'kuusamo');
  assert.equal(match('haminassa'), 'hamina');
  assert.equal(match('mäntässä'), 'mänttä');
});

test('stemOf absorbs consonant gradation, i -> e stems and -nen words', () => {
  assert.equal(stemOf('helsinki'), 'helsin');   // k -> g
  assert.equal(stemOf('lahti'), 'lah');         // t -> d
  assert.equal(stemOf('riihimäki'), 'riihimä'); // ki -> e
  assert.equal(stemOf('parainen'), 'parais');   // nen -> s
  assert.equal(stemOf('kemi'), 'kem');          // floor of three characters
  assert.equal(stemOf('oma'), 'oma');           // never shorter than the word
});

// The load-bearing test. Every one of the 72 cities, in the form a Finnish
// speaker actually says for "in <city>" -- inessive -ssa/-ssä, or adessive
// -lla/-llä where that is the idiomatic one. Without this sweep the stem rule
// is a guess.
const INESSIVE = {
  helsinki:'helsingissä', espoo:'espoossa', tampere:'tampereella', vantaa:'vantaalla',
  oulu:'oulussa', turku:'turussa', jyväskylä:'jyväskylässä', lahti:'lahdessa',
  kuopio:'kuopiossa', kouvola:'kouvolassa', pori:'porissa', joensuu:'joensuussa',
  lappeenranta:'lappeenrannassa', hämeenlinna:'hämeenlinnassa', vaasa:'vaasassa',
  seinäjoki:'seinäjoella', rovaniemi:'rovaniemellä', mikkeli:'mikkelissä',
  kotka:'kotkassa', salo:'salossa', porvoo:'porvoossa', kokkola:'kokkolassa',
  hyvinkää:'hyvinkäällä', lohja:'lohjalla', järvenpää:'järvenpäässä', rauma:'raumalla',
  kajaani:'kajaanissa', imatra:'imatralla', riihimäki:'riihimäellä', nokia:'nokialla',
  kerava:'keravalla', savonlinna:'savonlinnassa', varkaus:'varkaudessa', raahe:'raahessa',
  kaskinen:'kaskisissa', kristiinankaupunki:'kristiinankaupungissa', ylivieska:'ylivieskassa',
  iisalmi:'iisalmessa', valkeakoski:'valkeakoskella', kauhava:'kauhavalla',
  kauhajoki:'kauhajoella', loviisa:'loviisassa', naantali:'naantalissa',
  uusikaupunki:'uudessakaupungissa', heinola:'heinolassa', pieksämäki:'pieksämäellä',
  forssa:'forssassa', äänekoski:'äänekoskella', kuusamo:'kuusamossa', tornio:'torniossa',
  kemi:'kemissä', kemijärvi:'kemijärvellä', loimaa:'loimaalla', somero:'somerolla',
  parainen:'paraisissa', hamina:'haminassa', orimattila:'orimattilassa',
  pietarsaari:'pietarsaaressa', uusikaarlepyy:'uudessakaarlepyyssä', ikaalinen:'ikaalisissa',
  virrat:'virroilla', parkano:'parkanossa', sastamala:'sastamalassa', akaa:'akaassa',
  kangasala:'kangasalla', raisio:'raisiossa', kaarina:'kaarinassa',
  kirkkonummi:'kirkkonummella', tuusula:'tuusulassa', nurmijärvi:'nurmijärvellä',
  vihti:'vihdissä', mänttä:'mäntässä'
};

test('the inessive corpus covers every city in the list', () => {
  const listed = CITIES.map(a => a.canonical).sort();
  assert.deepEqual(Object.keys(INESSIVE).sort(), listed,
    'a city was added or renamed without updating the corpus below');
});

test('every city accepts the form a Finnish speaker actually says', () => {
  const failures = [];
  for(const [canonical, inessive] of Object.entries(INESSIVE)){
    const got = match(inessive);
    if(got !== canonical) failures.push(`${inessive} -> ${got} (expected ${canonical})`);
  }
  assert.deepEqual(failures, [], `${failures.length} of 72 cities reject a correct answer`);
});

test('the longest matching stem wins, so the shorter city cannot steal it', () => {
  assert.equal(match('kemissä'), 'kemi');
  assert.equal(match('kemijärvellä'), 'kemijärvi'); // not kemi, via stem "kem"
  assert.equal(match('porissa'), 'pori');
  assert.equal(match('porvoossa'), 'porvoo');       // not pori, via stem "por"
  assert.equal(match('kauhavalla'), 'kauhava');
  assert.equal(match('kauhajoella'), 'kauhajoki');  // not kauhava, via stem "kauha"
});

test('a stem without a case ending after it is not a match', () => {
  // Three-character stems are the loosest, so these are the cases that would
  // hurt: "sal" prefixes salaatti, "vaa" prefixes vaahtera, "kot" kotletti.
  assert.equal(match('salaatti'), null);
  assert.equal(match('vaahtera'), null);
  assert.equal(match('kotletti'), null);
  assert.equal(match('porvoolainen'), null, 'ROADMAP #3 expected to have to accept this');
  assert.equal(match('helsin'), null, 'a bare stem is not an answer');
});

test('genitive and illative forms are accepted too', () => {
  assert.equal(match('helsingin'), 'helsinki');
  assert.equal(match('poriin'), 'pori');
  assert.equal(match('kuusamoon'), 'kuusamo');
  assert.equal(match('porvoosta'), 'porvoo');
  assert.equal(match('kuusamolle'), 'kuusamo');
});

test('BASELINE: the fuzzy fallback accepts near-miss nonsense', () => {
  // One edit is allowed even on four-letter canonicals. ROADMAP #4.
  assert.equal(match('poro'), 'pori');
  assert.equal(match('talo'), 'salo');
});
