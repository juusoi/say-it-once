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
  remove.setAttribute('aria-label', 'Poista pelaaja');
  remove.addEventListener('click', () => row.remove());

  row.append(input, remove);
  document.getElementById('player-inputs').appendChild(row);
}
addPlayerInput(); addPlayerInput();
renderCategorySelect();

document.getElementById('manual-input').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') submitManual();
});

// Run on load as well as at game start: the setup screen is the one place where
// "your browser has no speech recognition" is useful before anyone commits to a game.
checkSpeechSupport();

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

const SPEECH_ERRORS = {
  'not-allowed': "Mikrofoni on estetty — salli mikrofonin käyttö selaimen asetuksista.",
  'service-not-allowed': "Selain ei salli puheentunnistusta tällä sivulla.",
  'audio-capture': "Mikrofonia ei löytynyt.",
  'network': "Puheentunnistus vaatii verkkoyhteyden.",
  'no-speech': "En kuullut mitään — yritä uudelleen tai kirjoita."
};

function startListening(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return;
  // Already listening: constructing a second recognizer over the live one and
  // calling start() again throws InvalidStateError.
  if(recognizer) return;
  const btn = document.getElementById('mic-btn');
  const hint = document.getElementById('mic-hint');
  recognizer = new SR();
  recognizer.lang = 'fi-FI';
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 3;

  btn.classList.add('listening');
  hint.textContent = "Kuuntelen...";

  recognizer.onresult = (event) => {
    handleAnswer(pickBestAlternative(event.results[0]));
  };
  // onerror is always followed by onend, which would reset the hint and hide the
  // reason. Keep whatever the error handler wrote.
  let errored = false;
  recognizer.onerror = (event) => {
    errored = true;
    hint.textContent = SPEECH_ERRORS[event.error]
      || "En kuullut kunnolla — yritä uudelleen tai kirjoita.";
  };
  recognizer.onend = () => {
    recognizer = null;
    btn.classList.remove('listening');
    if(!errored) hint.textContent = "Paina ja sano vastaus";
  };

  try{
    recognizer.start();
  } catch(e){
    recognizer = null;
    btn.classList.remove('listening');
    hint.textContent = "Puheentunnistusta ei saatu käyntiin — kirjoita vastaus.";
  }
}

function submitManual(){
  const input = document.getElementById('manual-input');
  if(!input.value.trim()) return;
  handleAnswer(input.value.trim());
  input.value = "";
}

// ---------- MATCHING ----------
// normalize(), levenshtein() and matchAnswer() live in js/matching.js so that
// Node can import them for unit tests. matchAnswer() takes the answer list as
// an argument rather than reaching for these globals; this is the one place
// that knows which list is live.
function currentAnswers(){
  return CATEGORIES[selectedCategoryIndex].answers;
}

// The recognizer is asked for maxAlternatives guesses, ranked by its own
// confidence. Take the highest-ranked one that is actually a valid answer in this
// category, and otherwise fall back to its top guess so that a rejection quotes
// what the player was actually heard to say.
function pickBestAlternative(result){
  for(let i = 0; i < result.length; i++){
    if(matchAnswer(result[i].transcript, currentAnswers())) return result[i].transcript;
  }
  return result[0].transcript;
}

// ---------- GAME LOGIC ----------
function handleAnswer(raw){
  const answer = matchAnswer(raw, currentAnswers());
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
