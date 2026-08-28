# Testing

There is no test framework here, and for now that's a deliberate choice rather than a gap —
the game is ~400 lines of DOM-driven code whose riskiest component (Finnish speech
recognition) can't be meaningfully automated anyway. What follows is the manual smoke test to
run before pushing, plus an honest account of what should be automated when this stops being
a prototype.

## Running it

Two ways, and **they are not equivalent** — test whichever one you actually tell people to use:

```sh
# 1. Straight from disk. This is the intended workflow.
open -a "Google Chrome" index.html

# 2. Over localhost. Needed if Chrome refuses mic permission on a file:// origin.
python3 -m http.server 8000
# then http://localhost:8000
```

The split into `css/` and `js/` keeps option 1 working: classic `<script src>` and `<link>`
tags have no CORS restriction on `file://`. Only ES modules and `fetch()` are blocked there,
which is exactly why the code avoids both. **If you ever change how the JS is loaded, re-test
from `file://` specifically** — this failure mode does not appear over localhost.

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
| `helsinki` | Accepted, turn passes to B | Message **stays visible** |
| `helsinki` again | Duplicate → yellow card | Message **stays visible** |
| `qwertyuiop` | Invalid → yellow card | Message **stays visible** |
| `helsingissä` | Accepted — inflected form | Only works for the 20 cities that have forms |
| `porvoo` | Accepted | Base form; `porvoossa` is **expected to fail** |

The "stays visible" column is the whole point. Feedback was previously set and wiped in the
same tick, so **every** message was invisible. If you see a message flash and vanish, that
regression is back.

### 3. Cards, elimination, winner

- Each yellow card fills one chip on that player's scoreboard row.
- The second card eliminates: row dims to muted text (not a washed-out low-contrast row) and
  is labelled *pois pelistä*.
- Turn order skips eliminated players.
- Last player standing triggers the winner screen; *Uusi peli* returns to setup with no stale
  feedback message left over.

### 4. Speech

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

### 5. Admin screen

- Opens pre-filled with the live categories as formatted JSON.
- Malformed JSON → parse error shown inline, changes not applied.
- Structurally wrong JSON (category with no `answers`, answer with no `canonical`) → the
  specific validation message, changes not applied.
- Valid edit → category appears in the dropdown and is playable.
- **Reload the page — the edit is gone.** That's current expected behaviour, not a bug. See
  [ROADMAP.md](ROADMAP.md), which puts fixing it first.

### 6. Input handling and injection

- Type an answer and press **Enter** — it submits without touching the OK button.
- Add players named `Ma"tti` and `<img src=x onerror=alert(1)>`. Both must render as literal
  text in the setup row and the scoreboard, with no alert and no broken input field.

## What deserves automation, and what doesn't

Worth automating, if this grows past prototype:

- **`normalize()`, `levenshtein()` and `matchAnswer()`.** Pure functions, no DOM, and they hold
  all the genuinely tricky logic — Finnish characters, case folding, inflected-form lookup,
  the fuzzy threshold. This is where a real bug will hide and where a unit test costs almost
  nothing. It's the one place automation clearly pays for itself today.
- **The category data.** A structural check is cheaper than a test: no duplicate `canonical`
  values, everything lowercase, every `forms` entry a string, no form colliding with a
  different answer's canonical. Data bugs here surface as baffling gameplay.
- **A fuzzy-matching regression corpus.** Pin the known false positives (`poro` → `pori`) so
  that tuning the threshold shows you exactly what you traded.

Deliberately **not** worth automating right now:

- Screen transitions and scoreboard rendering. A browser driver could assert on them, but
  screen state currently lives in DOM classes, so the tests would encode the markup and break
  on any restyle. Cheaper to look at it.
- Speech recognition. Non-deterministic, network-dependent, needs real audio. Exploratory
  testing with real voices in a real room is the only thing that tells you anything true —
  and it's how you'll find the actual problems, like which Finnish city names Google reliably
  mangles.

Note that unit-testing those pure functions needs a small code change first: `js/game.js` is a
classic script with no exports, so there's nothing to import. That's tracked in
[ROADMAP.md](ROADMAP.md) rather than done pre-emptively — it trades away the zero-tooling
property that makes this thing pleasant, so it should wait until there's a reason.

## Before you push

- Run the smoke test above from `file://`, in Chrome.
- Check the console is clean.
- Confirm `git status` is empty and the diff is what you meant to change.
