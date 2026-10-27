// ---------- STATE ----------
const TURN_SECONDS = 30;
let CATEGORIES = defaultCategories();
let selectedCategoryIndex = 0;
let players = [];
let currentIndex = 0;
let usedAnswers = new Set();
let recognizer = null;
let gameOver = false;
let turnTimer = null;
// Bumped every time a turn begins. A speech result captured for an older turn
// carries that turn's id and is ignored, so a late result cannot be counted
// twice -- once by the timeout and once by the answer it eventually returns.
let turnId = 0;
let audioCtx = null;

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

// The version is a single constant in js/version.js, shown in the footer so it
// is visible on every screen. Kept out of game logic entirely.
document.getElementById('version-line').textContent = `Versio ${APP_VERSION}`;

// Run on load as well as at game start: the setup screen is the one place where
// "your browser has no speech recognition" is useful before anyone commits to a game.
checkSpeechSupport();

// The admin editor is reachable only at #admin. Nothing is hidden for security
// -- it is client-side and persists nothing -- but a raw JSON textarea is not
// something to hand a player who came to play a party game.
function syncAdminVisibility(){
  const entry = document.getElementById('admin-entry');
  entry.classList.toggle('hidden', location.hash !== '#admin');
}
syncAdminVisibility();
window.addEventListener('hashchange', syncAdminVisibility);

function startGame(){
  selectedCategoryIndex = parseInt(document.getElementById('category-select').value, 10);
  const inputs = [...document.querySelectorAll('#player-inputs input')];
  players = inputs.map(i => i.value.trim()).filter(Boolean)
    .map(name => ({name, warnings: 0, eliminated:false}));
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
  gameOver = false;
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  document.getElementById('winner-screen').classList.add('hidden');
  document.getElementById('game-limitation-note').textContent =
    `Kategoria: ${CATEGORIES[selectedCategoryIndex].name}. Taivutusmuodot tunnistetaan yleensä automaattisesti — sano vastaus siinä muodossa kuin se luontevasti tulee.`;
  clearFeedback();
  startTurn();
  checkSpeechSupport();
}

function resetGame(){
  clearTimer();
  gameOver = false;
  clearFeedback();
  showSignal('idle');
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
  // The mic press is a user gesture, so it is where the AudioContext is
  // allowed to be created or resumed. Browsers block autoplay otherwise.
  ensureAudio();
  // Already listening: constructing a second recognizer over the live one and
  // calling start() again throws InvalidStateError.
  if(recognizer) return;
  const btn = document.getElementById('mic-btn');
  const hint = document.getElementById('mic-hint');
  const startedTurn = turnId;
  recognizer = new SR();
  recognizer.lang = 'fi-FI';
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 3;

  btn.classList.add('listening');
  hint.textContent = "Kuuntelen...";

  recognizer.onresult = (event) => {
    // A result that arrives after the turn has moved on (timeout, another
    // answer) belongs to a finished turn and must not be scored.
    if(startedTurn !== turnId) return;
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

// Stop an in-flight recognizer without scoring its result. The turn-id guard
// in onresult already rejects late results; this also releases the mic and
// resets the button so it does not stay stuck pulsing.
function stopListening(){
  if(!recognizer) return;
  const r = recognizer;
  recognizer = null;
  r.onresult = null;
  r.onend = null;
  r.onerror = null;
  try{ r.abort(); } catch(e){ /* already stopped */ }
  document.getElementById('mic-btn').classList.remove('listening');
  document.getElementById('mic-hint').textContent = "Paina ja sano vastaus";
}

function submitManual(){
  const input = document.getElementById('manual-input');
  if(!input.value.trim()) return;
  // A typed answer is submitted by the same click/keypress gesture the mic
  // uses, so unlock audio here too.
  ensureAudio();
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
  if(gameOver) return;
  const answer = matchAnswer(raw, currentAnswers());

  if(!answer){
    issueWarning(`"${raw}" ei kelpaa tässä kategoriassa!`);
    return;
  }

  if(usedAnswers.has(answer)){
    issueWarning(`${capitalize(answer)} on jo sanottu!`);
    return;
  }

  usedAnswers.add(answer);
  document.getElementById('feedback').className = 'feedback ok';
  document.getElementById('feedback').textContent = `${capitalize(answer)} hyväksytty.`;
  signal('ok');
  nextTurn();
}

// The single path every warning takes, whatever caused it: invalid answer,
// repeat, or timeout. Bumping the count, deciding the card, eliminating on red
// and starting the next turn all happen here so the three sources cannot drift.
function issueWarning(prefix){
  if(gameOver) return;
  const p = players[currentIndex];
  p.warnings += 1;
  const card = cardForWarnings(p.warnings);
  if(card === 'red') p.eliminated = true;

  const feedback = document.getElementById('feedback');
  feedback.className = 'feedback ' + (card === 'red' ? 'red' : 'warn');
  feedback.textContent = warningMessage(prefix, p.warnings);
  signal(card === 'red' ? 'red' : 'warn');
  renderScoreboard();
  checkGameOver();
  if(gameOver) return;
  nextTurn();
}

function nextTurn(){
  const active = players.filter(p=>!p.eliminated);
  if(active.length <= 1) { checkGameOver(); return; }
  do{
    currentIndex = (currentIndex + 1) % players.length;
  } while(players[currentIndex].eliminated);
  startTurn();
}

function checkGameOver(){
  const active = players.filter(p=>!p.eliminated);
  if(active.length <= 1){
    gameOver = true;
    clearTimer();
    stopListening();
    document.getElementById('game-screen').classList.add('hidden');
    const winnerScreen = document.getElementById('winner-screen');
    winnerScreen.classList.remove('hidden');
    document.getElementById('winner-text').textContent = active.length === 1
      ? `🏆 ${active[0].name} voitti!`
      : `Peli päättyi tasapeliin.`;
  }
}

// ---------- TURN TIMER ----------
// Every turn begins here, and only here: at game start, after an accepted
// answer, and after a warning that advances the turn. That single entry point
// is what keeps the countdown in step with whose turn it is.
function startTurn(){
  renderCurrentPlayer();
  startTimer();
}

function startTimer(){
  clearTimer();
  turnId += 1;
  if(gameOver) return;
  const deadline = Date.now() + TURN_SECONDS * 1000;
  renderTimer(TURN_SECONDS);
  turnTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    renderTimer(remaining);
    if(remaining <= 0) handleTimeout();
  }, 250);
}

function clearTimer(){
  if(turnTimer !== null){
    clearInterval(turnTimer);
    turnTimer = null;
  }
}

function handleTimeout(){
  if(gameOver) return;
  clearTimer();
  // Cut the mic and move to a fresh turn before warning, so a recognition
  // result still in flight is rejected by the turn-id guard.
  stopListening();
  turnId += 1;
  issueWarning("Aika loppui!");
}

function renderTimer(seconds){
  document.getElementById('timer').textContent = `${seconds} s`;
}

// ---------- SIGNAL (SOUND + LIGHT) ----------
// The light is updated before the sound and independently of it, so it shows
// even when audio is unavailable.
function signal(kind){
  showSignal(kind);
  playTone(kind);
}

function showSignal(kind){
  const el = document.getElementById('signal');
  el.className = 'signal ' + kind;
  const labels = {
    idle: 'Valmiina',
    ok: 'Oikein',
    warn: 'Keltainen kortti',
    red: 'Punainen kortti — pois pelistä'
  };
  document.getElementById('signal-label').textContent = labels[kind];
}

// Create or resume the AudioContext. Must be reached from a user gesture
// (mic button or submit), or browsers will refuse to start playback.
function ensureAudio(){
  try{
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return;
    if(!audioCtx) audioCtx = new Ctx();
    if(audioCtx.state === 'suspended') audioCtx.resume();
  } catch(e){
    audioCtx = null;
  }
}

// Tones are synthesised with oscillators -- no audio files, no libraries.
// Everything is wrapped so a missing or blocked AudioContext fails silently,
// leaving the light as the signal.
function playTone(kind){
  try{
    if(!audioCtx) return;
    const now = audioCtx.currentTime;
    if(kind === 'ok'){
      // A short two-note rising chime.
      tone(now, 660, 0.12, 0.18);
      tone(now + 0.1, 880, 0.14, 0.18);
    } else if(kind === 'warn'){
      // A single flat warning blip.
      tone(now, 330, 0.28, 0.22, 'square');
    } else if(kind === 'red'){
      // A distinct two-note descent, lower and longer.
      tone(now, 300, 0.2, 0.24, 'sawtooth');
      tone(now + 0.18, 160, 0.36, 0.24, 'sawtooth');
    }
  } catch(e){
    /* audio is best-effort */
  }
}

function tone(startAt, freq, duration, gain, type){
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, startAt);
  amp.gain.setValueAtTime(0, startAt);
  amp.gain.linearRampToValueAtTime(gain, startAt + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(amp).connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
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
    nameEl.textContent = p.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'p-meta';

    const countEl = document.createElement('span');
    countEl.className = 'p-warnings';
    countEl.textContent = warningCountLabel(p.warnings);

    // Two chips, one per warning: the first fills yellow, the second red. The
    // text label above is what makes the colour readable without relying on it.
    const cardsEl = document.createElement('div');
    cardsEl.className = 'p-cards';
    const card = cardForWarnings(p.warnings);
    for(let i=0;i<2;i++){
      const chip = document.createElement('div');
      const filled = i < p.warnings;
      chip.className = 'card-chip ' + (!filled ? 'empty' : (i === 0 ? 'yellow' : 'red'));
      cardsEl.appendChild(chip);
    }

    const statusEl = document.createElement('span');
    statusEl.className = 'p-status ' + card;
    statusEl.textContent = card === 'red' ? '🟥 Punainen — pois pelistä'
      : card === 'yellow' ? '🟨 Keltainen'
      : 'Ei kortteja';

    metaEl.append(countEl, cardsEl, statusEl);
    row.append(nameEl, metaEl);
    board.appendChild(row);
  });
}

function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
