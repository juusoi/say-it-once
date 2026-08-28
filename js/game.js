// ---------- STATE ----------
let CATEGORIES = defaultCategories();
let selectedCategoryIndex = 0;
let players = [];
let currentIndex = 0;
let usedAnswers = new Set();
let recognizer = null;

// ---------- SETUP SCREEN ----------
function renderCategorySelect(){
  const sel = document.getElementById('category-select');
  sel.innerHTML = '';
  CATEGORIES.forEach((cat, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `${cat.name} (${cat.answers.length} vastausta)`;
    sel.appendChild(opt);
  });
  sel.value = selectedCategoryIndex;
}

function addPlayerInput(name=""){
  const row = document.createElement('div');
  row.className = 'player-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Pelaajan nimi';
  input.value = name;

  const remove = document.createElement('button');
  remove.className = 'remove-btn';
  remove.textContent = '✕';
  remove.addEventListener('click', () => row.remove());

  row.append(input, remove);
  document.getElementById('player-inputs').appendChild(row);
}
addPlayerInput(); addPlayerInput();
renderCategorySelect();

function startGame(){
  selectedCategoryIndex = parseInt(document.getElementById('category-select').value, 10);
  const inputs = [...document.querySelectorAll('#player-inputs input')];
  players = inputs.map(i => i.value.trim()).filter(Boolean)
    .map(name => ({name, yellowCards: 0, eliminated:false}));
  if(players.length < 2){
    alert("Lisää vähintään kaksi pelaajaa.");
    return;
  }
  if(CATEGORIES[selectedCategoryIndex].answers.length === 0){
    alert("Valitussa kategoriassa ei ole vastauksia. Täytä se admin-paneelissa ensin.");
    return;
  }
  currentIndex = 0;
  usedAnswers = new Set();
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  document.getElementById('winner-screen').classList.add('hidden');
  document.getElementById('game-limitation-note').textContent =
    `Kategoria: ${CATEGORIES[selectedCategoryIndex].name}. Taivutusmuodot toimivat vain jos ne on lisätty admin-paneelissa — muuten sano perusmuoto.`;
  clearFeedback();
  renderScoreboard();
  renderCurrentPlayer();
  checkSpeechSupport();
}

function resetGame(){
  clearFeedback();
  document.getElementById('winner-screen').classList.add('hidden');
  document.getElementById('setup-screen').classList.remove('hidden');
  renderCategorySelect();
}

// ---------- ADMIN ----------
function openAdmin(){
  document.getElementById('admin-json').value = JSON.stringify(CATEGORIES, null, 2);
  document.getElementById('admin-error').textContent = '';
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.remove('hidden');
}
function closeAdmin(){
  document.getElementById('admin-screen').classList.add('hidden');
  document.getElementById('setup-screen').classList.remove('hidden');
}
function saveAdmin(){
  const errEl = document.getElementById('admin-error');
  let parsed;
  try{
    parsed = JSON.parse(document.getElementById('admin-json').value);
  } catch(e){
    errEl.textContent = 'JSON ei kelpaa: ' + e.message;
    return;
  }
  if(!Array.isArray(parsed) || parsed.length === 0){
    errEl.textContent = 'Odotettiin ei-tyhjää listaa kategorioita.';
    return;
  }
  for(const cat of parsed){
    if(typeof cat.name !== 'string' || !Array.isArray(cat.answers)){
      errEl.textContent = 'Jokaisella kategorialla pitää olla "name" (teksti) ja "answers" (lista).';
      return;
    }
    for(const a of cat.answers){
      if(typeof a.canonical !== 'string'){
        errEl.textContent = `Kategoriassa "${cat.name}" on vastaus ilman "canonical"-kenttää.`;
        return;
      }
      if(a.forms && !Array.isArray(a.forms)){
        errEl.textContent = `Kategoriassa "${cat.name}": "forms" pitää olla lista tai puuttua kokonaan.`;
        return;
      }
    }
  }
  CATEGORIES = parsed;
  selectedCategoryIndex = 0;
  errEl.textContent = '';
  closeAdmin();
  renderCategorySelect();
}

// ---------- SPEECH ----------
function checkSpeechSupport(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const warn = document.getElementById('unsupported-warning');
  if(!SR){
    warn.classList.remove('hidden');
    document.getElementById('mic-btn').disabled = true;
    document.getElementById('mic-btn').style.opacity = 0.4;
  } else {
    warn.classList.add('hidden');
  }
}

function startListening(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return;
  const btn = document.getElementById('mic-btn');
  const hint = document.getElementById('mic-hint');
  recognizer = new SR();
  recognizer.lang = 'fi-FI';
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 3;

  btn.classList.add('listening');
  hint.textContent = "Kuuntelen...";

  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    handleAnswer(transcript);
  };
  recognizer.onerror = () => {
    hint.textContent = "En kuullut kunnolla — yritä uudelleen tai kirjoita.";
  };
  recognizer.onend = () => {
    btn.classList.remove('listening');
    hint.textContent = "Paina ja sano vastaus";
  };
  recognizer.start();
}

function submitManual(){
  const input = document.getElementById('manual-input');
  if(!input.value.trim()) return;
  handleAnswer(input.value.trim());
  input.value = "";
}

// ---------- MATCHING ----------
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
function matchAnswer(raw){
  const norm = normalize(raw);
  if(!norm) return null;
  const answers = CATEGORIES[selectedCategoryIndex].answers;

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

// ---------- GAME LOGIC ----------
function handleAnswer(raw){
  const answer = matchAnswer(raw);
  const feedback = document.getElementById('feedback');

  if(!answer){
    feedback.className = 'feedback invalid';
    feedback.textContent = `"${raw}" ei kelpaa tässä kategoriassa! 🟨 Keltainen kortti.`;
    giveYellowCard();
    renderScoreboard();
    return;
  }

  if(usedAnswers.has(answer)){
    feedback.className = 'feedback dup';
    feedback.textContent = `${capitalize(answer)} on jo sanottu! 🟨 Keltainen kortti.`;
    giveYellowCard();
  } else {
    usedAnswers.add(answer);
    feedback.className = 'feedback ok';
    feedback.textContent = `${capitalize(answer)} hyväksytty.`;
    nextTurn();
  }
  renderScoreboard();
}

function giveYellowCard(){
  const p = players[currentIndex];
  p.yellowCards += 1;
  if(p.yellowCards >= 2){
    p.eliminated = true;
  }
  checkGameOver();
  if(!document.getElementById('winner-screen').classList.contains('hidden')) return;
  nextTurn();
}

function nextTurn(){
  const active = players.filter(p=>!p.eliminated);
  if(active.length <= 1) { checkGameOver(); return; }
  do{
    currentIndex = (currentIndex + 1) % players.length;
  } while(players[currentIndex].eliminated);
  renderCurrentPlayer();
}

function checkGameOver(){
  const active = players.filter(p=>!p.eliminated);
  if(active.length <= 1){
    document.getElementById('game-screen').classList.add('hidden');
    const winnerScreen = document.getElementById('winner-screen');
    winnerScreen.classList.remove('hidden');
    document.getElementById('winner-text').textContent = active.length === 1
      ? `🏆 ${active[0].name} voitti!`
      : `Peli päättyi tasapeliin.`;
  }
}

function renderCurrentPlayer(){
  document.getElementById('current-player-name').textContent = players[currentIndex].name;
  renderScoreboard();
}

// Only ever cleared when a new game/turn cycle starts -- never on turn advance,
// or the feedback for the answer just given would be wiped before it is read.
function clearFeedback(){
  const el = document.getElementById('feedback');
  el.textContent = '';
  el.className = 'feedback';
}

function renderScoreboard(){
  const board = document.getElementById('scoreboard');
  board.innerHTML = '';
  players.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'player-card' + (idx===currentIndex && !p.eliminated ? ' active':'') + (p.eliminated ? ' eliminated':'');

    const nameEl = document.createElement('div');
    nameEl.className = 'p-name';
    nameEl.textContent = p.name + (p.eliminated ? ' — pois pelistä' : '');

    const cardsEl = document.createElement('div');
    cardsEl.className = 'p-cards';
    for(let i=0;i<2;i++){
      const chip = document.createElement('div');
      chip.className = i < p.yellowCards ? 'yellow-chip' : 'empty-chip';
      cardsEl.appendChild(chip);
    }

    row.append(nameEl, cardsEl);
    board.appendChild(row);
  });
}

function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
