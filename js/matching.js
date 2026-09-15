// Pure answer-matching logic: no DOM, no globals, no browser APIs.
//
// This file is deliberately separate from game.js so it can be imported by
// Node for unit tests (see test/matching.test.js). game.js runs top-level
// code against the DOM and can never be imported; these functions hold all
// the genuinely tricky logic and have no such dependency.
//
// Loaded as a plain classic script before categories.js and game.js, so the
// file:// workflow is unaffected. See README.md.

function normalize(w){
  return w.toLowerCase().trim().replace(/[^a-zäöå\s-]/g,'').trim();
}

function levenshtein(a,b){
  const m=a.length, n=b.length;
  const dp = Array.from({length:m+1}, (_,i)=>[i, ...Array(n).fill(0)]);
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      dp[i][j] = a[i-1]===b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Finnish case endings, enough to cover how a place name actually gets said:
// the local cases and their sources, the allative, and every illative or
// genitive form -- all of which end in -n, so one entry covers them all.
const CASE_ENDINGS = ['ssa','ssä','sta','stä','lla','llä','lta','ltä','lle','n'];

// Up to three characters of leftover stem, then a case ending. That bound is
// what stops a three-character stem from swallowing unrelated words: "sal"
// prefixes "salaatti", but "aatti" carries no case ending, so it is rejected.
const CASE_ENDING_RE = new RegExp('^.{0,3}(?:' + CASE_ENDINGS.join('|') + ')$');

// The leading characters an inflected form shares with its base form. Cutting
// two characters is what absorbs consonant gradation (helsinki -> helsin, so
// "helsingissä" matches; lahti -> lah, so "lahdessa" does) and the i -> e stem
// class (riihimäki -> riihimä, so "riihimäellä" does). Words in -nen take an
// -s stem instead: parainen -> parais, matching "paraisissa".
function stemOf(canonical){
  if(canonical.length > 3 && canonical.endsWith('nen')) return canonical.slice(0,-3) + 's';
  return canonical.slice(0, Math.max(3, canonical.length - 2));
}

// returns canonical answer string if matched, else null
function matchAnswer(raw, answers){
  const norm = normalize(raw);
  if(!norm) return null;

  // 1 & 2: the base form, or an inflection somebody wrote out by hand.
  for(const a of answers){
    if(a.canonical === norm) return a.canonical;
    if(a.forms && a.forms.includes(norm)) return a.canonical;
  }

  // 3: a case ending on a known answer's stem, so "porvoossa" reaches
  // "porvoo" without anyone hand-writing 208 strings.
  //
  // The longest matching stem wins, and that is correctness rather than
  // polish: "kemijärvellä" matches both "kem" (kemi) and "kemijär"
  // (kemijärvi), and "porvoossa" matches both "por" (pori) and "porv"
  // (porvoo). Take the shorter stem and the wrong city silently wins.
  let stemBest = null, stemLen = -1;
  for(const a of answers){
    const stem = stemOf(a.canonical);
    if(stem.length > stemLen
       && norm.startsWith(stem)
       && CASE_ENDING_RE.test(norm.slice(stem.length))){
      stemBest = a.canonical; stemLen = stem.length;
    }
  }
  if(stemBest) return stemBest;

  // 4: last resort, absorb speech-to-text noise on the base form.
  //
  // Two guards keep this from accepting near-miss nonsense. Speech-to-text
  // rarely mangles the initial sound, so require the first letter to match --
  // that is what rejects "talo" as salo. And no edits at all below six
  // characters, because one edit on a four-letter word is most of the word --
  // that is what rejects "poro" as pori, which the first-letter guard alone
  // does not, both starting with p.
  //
  // The short names (kemi, pori, salo, oulu, akaa) lose their noise tolerance
  // entirely. Affordable now and not before: tier 3 above covers their
  // inflections, which is most of what the tolerance was absorbing.
  let best = null, bestDist = Infinity;
  for(const a of answers){
    if(norm[0] !== a.canonical[0]) continue;
    const dist = levenshtein(norm, a.canonical);
    const threshold = Math.floor(a.canonical.length/6);
    if(dist <= threshold && dist < bestDist){
      best = a.canonical; bestDist = dist;
    }
  }
  return best;
}

// No-op in the browser; a real CommonJS module in Node.
if(typeof module !== 'undefined') module.exports = { normalize, levenshtein, stemOf, matchAnswer };
