# Testing

The matching logic has unit tests; everything else is checked by hand. That split is
deliberate: the pure functions are where a real bug hides, and the riskiest component of the
game (Finnish speech recognition) can't be meaningfully automated at all.

## Automated

No framework, no dependencies, no `package.json`:

```sh
node --test test/*.test.js
```

Note the glob. `node --test test/` **fails** — Node resolves the directory as a module.

- `test/matching.test.js` — `normalize`, `levenshtein`, `stemOf` and `matchAnswer`. The
  load-bearing case is the sweep over all 72 cities in the form a Finnish speaker actually
  says, guarded by a second test that the corpus still matches the city list, so adding a city
  can't silently skip the sweep.
- `test/rules.test.js` — the warning-to-card decision and its Finnish wording: `cardForWarnings`
  (warning 2 is the red card), `warningCountLabel` (singular only at 1) and `warningMessage`.
- `test/categories.test.js` — structural validation of the shipped data: unique lowercase
  canonicals, string `forms`, no form colliding with another answer's canonical, no
  `CITY_ALIASES` key missing from `CITY_LIST`.

## Linting

Also no dependencies — Biome is a single pinned binary, so there is still no `package.json`,
no lockfile and no `node_modules`:

```sh
npx --yes @biomejs/biome@2.5.13 ci --error-on-warnings .
```

**Lint only, no formatter.** Enforcing Biome's formatter would rewrite about 1300 lines across
600 lines of source and expand `css/styles.css` to four times its length, for no defect
caught. `biome.jsonc` says why, and says why three rules are disabled — read it before turning
any of them back on, because two of the three protect behaviour the smoke test below checks.

One trap worth knowing: **never run `biome lint --write` on `js/game.js`.** Every button uses
an inline `onclick=`, which Biome does not parse, so it reports `startGame`, `resetGame`,
`openAdmin`, `saveAdmin` and `startListening` as unused — and marks them fixable. `--write`
would delete all five and break every button. The rule is disabled for that one file.

`actionlint` lints the workflow files and shellchecks their embedded `run:` scripts. It has
already earned its place here once, catching a `grep -q … && exit 1` that would have failed
CI on its own success path.

CI runs all of the above on every pull request, plus `node --check` on each script, an image
build (which runs `caddy validate`), and a check that the container serves all five files with
the expected headers.

## Running it

Three ways, and **they are not equivalent** — test whichever one you actually tell people to
use:

```sh
# 1. Straight from disk. This is the intended local workflow.
open -a "Google Chrome" index.html

# 2. Over localhost. Needed if Chrome refuses mic permission on a file:// origin.
python3 -m http.server 8000
# then http://localhost:8000

# 3. The actual published artefact, headers and all.
podman run --rm -p 8080:8080 ghcr.io/juusoi/say-it-once:latest
# then http://localhost:8080
```

Option 3 is the only one that exercises the CSP and the security headers. Do it before
shipping anything that touches `deploy/Caddyfile`: a header that silently disables the
microphone looks exactly like a broken microphone.

The split into `css/` and `js/` keeps option 1 working: classic `<script src>` and `<link>`
tags have no CORS restriction on `file://`. Only ES modules and `fetch()` are blocked there,
which is exactly why the code avoids both. **If you ever change how the JS is loaded, re-test
from `file://` specifically** — this failure mode does not appear over localhost. A quick
non-interactive check that all four scripts ran is that the category dropdown is populated:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --virtual-time-budget=3000 --dump-dom "file://$PWD/index.html" | grep '<option'
```

## Smoke test

Ten minutes, covers every path a party actually hits. Two players is enough; the second one
existing is what makes turn advance and elimination observable.

### 1. Setup screen

- Page loads with two empty player rows and the category dropdown populated
  (*Suomen kaupungit (72 vastausta)*).
- **Console is clean.** A 404 on `css/styles.css` or `js/*.js` means the split broke; the page
  will still render, just unstyled and inert.
- In a browser without speech support (Firefox), the warning banner appears **on this screen**,
  before starting a game — not only after.
- *"+ Lisää pelaaja"* adds a row; the `✕` removes the row it belongs to, not a different one.
- Starting with fewer than two named players is refused.

### 2. The three answer paths — the core of the game

Start a game with players **A** and **B**, then type answers rather than speaking them (the
text input isolates game logic from STT noise; speech gets tested separately in step 4).

| Input | Expected | Watch for |
|---|---|---|
| `helsinki` | Accepted, turn passes to B | Message **stays visible**, green light + chime |
| `helsinki` again | Duplicate → warning 1 🟨 | Message **stays visible**, yellow light + tone |
| `qwertyuiop` | Invalid → warning 1 🟨 | Message **stays visible** |
| `helsingissä` | Accepted — hand-written form | Consonant gradation, k → g |
| `porvoossa` | Accepted — stem match | No hand-written forms exist for Porvoo |
| `mäntässä` | Accepted — stem match | Gradation again, tt → t |
| `salaatti` | Invalid → warning 🟨 | Shares the stem `sal` with *salo*, but `aatti` is not a case ending |
| `poro` | Invalid → warning 🟨 | Was accepted as *pori* before the fuzzy threshold was tightened |

The "stays visible" column is the whole point. Feedback was previously set and wiped in the
same tick, so **every** message was invisible. If you see a message flash and vanish, that
regression is back.

### 3. Cards, escalation, elimination, winner

- Each warning fills one chip on that player's scoreboard row, and the row's text count goes
  from *0 varoitusta* to *1 varoitus* to *2 varoitusta*.
- The first warning is a yellow card 🟨; the second is a red card 🟥 and eliminates the player.
- The eliminated row dims to muted text (not a washed-out low-contrast row) and is labelled
  *🟥 Punainen — pois pelistä*.
- Turn order skips eliminated players.
- Last player standing triggers the winner screen **and stops the timer**; *Uusi peli* returns
  to setup with no stale feedback message left over.

### 4. Turn timer

- On starting a game the countdown shows *30 s* next to the current player and ticks down.
- Let it reach 0 without answering: feedback reads *Aika loppui! 🟨 Keltainen kortti.*, the
  yellow light and tone fire, and the turn advances with a fresh *30 s*.
- Time out the **same** player twice (or time out once and give them one bad answer): the second
  warning is a red card and eliminates them.
- Press the mic, then let the timer expire while *Kuuntelen…* is showing: the mic button stops
  pulsing and the mic is released, and a late recognition result does **not** score — the
  timeout is the only warning.
- The timer restarts after every accepted answer and after every warning, and no second timer
  stacks up (the countdown should decrement once per second, not faster).

### 5. Sound and light

Each of the three events shows a labelled light next to the mic and plays a distinct tone.
Audio only starts after the first mic press or submitted answer, because the browser requires a
user gesture.

- Correct answer → green dot, label *Oikein*, pleasant two-note chime.
- Yellow warning (invalid, duplicate **or** timeout) → yellow dot, label *Keltainen kortti*,
  short warning tone.
- Red card → red dot, label *Punainen kortti — pois pelistä*, distinct lower descending tone.
- With audio unavailable (e.g. block it via devtools), the light still shows and nothing throws.

### 6. Speech

Can't be automated — it needs a real microphone, a real voice, and Google's recognition
service. Test it by hand, in Chrome, with the actual Finnish words people will say:

- Press the mic, say a city, confirm it's accepted.
- **Press the mic twice quickly.** Nothing should throw; the button must not stick in its
  pulsing listening state. (Previously an uncaught `InvalidStateError`.)
- **Deny microphone permission** and press the mic. You should get *"Mikrofoni on estetty…"* —
  a specific reason that **persists**, not the generic "I didn't hear you" that used to be
  overwritten by the hint reset a moment later.
- Go offline and try: expect the network-specific message.
- Say something wrong on purpose and check the rejection quotes what was heard, so players can
  tell a genuine mistake from a mis-hearing.

### 7. Admin screen

- **The entry button is absent** on a plain load, and appears when you add `#admin` to the URL.
  Clearing the fragment hides it again without a reload.
- Opens pre-filled with the live categories as formatted JSON.
- Malformed JSON → parse error shown inline, changes not applied.
- Structurally wrong JSON (category with no `answers`, answer with no `canonical`) → the
  specific validation message, changes not applied.
- Valid edit → category appears in the dropdown and is playable.
- **Reload the page — the edit is gone.** That's current expected behaviour, not a bug. See
  [ROADMAP.md](ROADMAP.md), which puts fixing it first.

### 8. Input handling and injection

- Type an answer and press **Enter** — it submits without touching the OK button.
- Add players named `Ma"tti` and `<img src=x onerror=alert(1)>`. Both must render as literal
  text in the setup row and the scoreboard, with no alert and no broken input field.

## What deserves automation, and what doesn't

Done, and it paid for itself immediately: the stem rule would have been a guess without the
72-city sweep, and pinning `poro` → `pori` before tightening the threshold is what made the
trade visible in the diff rather than discovered later in a game.

Deliberately **not** worth automating right now:

- Screen transitions and scoreboard rendering. A browser driver could assert on them, but
  screen state currently lives in DOM classes, so the tests would encode the markup and break
  on any restyle. Cheaper to look at it.
- Speech recognition. Non-deterministic, network-dependent, needs real audio. Exploratory
  testing with real voices in a real room is the only thing that tells you anything true —
  and it's how you'll find the actual problems, like which Finnish city names Google reliably
  mangles.

The seam this needed turned out to be cheaper than expected. An earlier version of this file
assumed a `window.X` export and said to "pick ugly"; instead the pure functions moved to their
own file, `js/matching.js`, ending in a `typeof module` guard. That is a no-op in the browser,
a real CommonJS export in Node, one extra classic `<script>` tag, and no tooling — so the
zero-dependency, double-click-to-play property survived intact.

## Before you push

- `node --test test/*.test.js` passes.
- `npx --yes @biomejs/biome@2.5.13 ci --error-on-warnings .` is clean.
- Run the smoke test above from `file://`, in Chrome.
- Check the console is clean, apart from the known `/favicon.ico` 404.
- If you touched `deploy/Caddyfile`, `Containerfile` or anything under `.github/`, run the
  smoke test against the container too (option 3 above) and press the microphone — that is the
  only way a header regression shows up.
- Confirm `git status` is empty and the diff is what you meant to change.

Merging to `main` publishes a new image, and the server picks it up within about five minutes.
See [deploy/README.md](deploy/README.md).
