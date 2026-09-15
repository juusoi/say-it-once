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

// returns canonical answer string if matched, else null
function matchAnswer(raw, answers){
  const norm = normalize(raw);
  if(!norm) return null;

  for(const a of answers){
    if(a.canonical === norm) return a.canonical;
    if(a.forms && a.forms.includes(norm)) return a.canonical;
  }

  let best = null, bestDist = Infinity;
  for(const a of answers){
    const dist = levenshtein(norm, a.canonical);
    const threshold = Math.max(1, Math.floor(a.canonical.length/6));
    if(dist <= threshold && dist < bestDist){
      best = a.canonical; bestDist = dist;
    }
  }
  return best;
}

// No-op in the browser; a real CommonJS module in Node.
if(typeof module !== 'undefined') module.exports = { normalize, levenshtein, matchAnswer };
