# say-it-once

A single-device party game in Finnish. The phone goes around the group; on your turn you
press the mic and say a word belonging to the active category — *Suomen kaupungit*, say.
Don't repeat what's already been said.

The UI is entirely in Finnish. This README is in English.

## Rules

- Each player, in turn, gives one answer belonging to the active category.
- An answer that has **already been said**, or that **isn't valid for the category**, earns
  a yellow card. 🟨
- **Two yellow cards and you're out.**
- Last player standing wins.

Answers are matched against a category's canonical answer list plus a list of known inflected
forms (Finnish case endings), with a Levenshtein-distance fallback to absorb minor
speech-to-text noise.

## Running it

There is no build step and there are no dependencies.

**Open `index.html` in Chrome or Edge.**

Speech recognition uses the Web Speech API, which Firefox does not implement and Safari
supports only partially. In those browsers the game still works — the manual text input next
to the mic accepts typed answers, and the app shows a warning banner — you just don't get
speech.

If Chrome refuses microphone permission when the page is opened as a `file://` URL, serve the
folder over localhost instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Speech-to-text is unreliable enough that the typed fallback is a first-class input, not an
afterthought. Expect to use it.

## Project structure

```
index.html          markup for the four screens (setup, admin, game, winner)
css/styles.css      all styling
js/categories.js    the category data — city list, inflected forms, defaults
js/game.js          state, screen switching, speech, answer matching, game logic
```

**Deliberately plain: classic `<script>` tags, no modules, no bundler.** Three things depend
on this, so please don't "modernize" it without addressing them first:

1. Buttons use inline `onclick=` attributes, which resolve against the global scope. Moving
   the JS to `<script type="module">` silently breaks every button.
2. Category data is a `.js` file assigning a `const`, not a `.json` file loaded with `fetch()`,
   because `fetch()` is CORS-blocked on `file://`. Making it real JSON would mean always
   running a local server. The admin screen still shows and accepts real JSON at runtime.
3. `js/game.js` runs top-level code that needs both `categories.js` and a parsed DOM. Hence
   the load order, and hence the scripts staying at the end of `<body>` with no `defer`.

The point of all three is that you can double-click the file and play. That's worth more than
tidier module syntax on a prototype like this one.

## Categories

Categories are data, not code. The shape:

```json
[
  {
    "name": "Suomen kaupungit",
    "answers": [
      { "canonical": "helsinki", "forms": ["helsingissä", "helsinkiin", "helsingin", "helsingistä"] },
      { "canonical": "porvoo",   "forms": [] }
    ]
  }
]
```

`canonical` is the base form and should be lowercase. `forms` lists inflected variants that
should also be accepted; it may be empty or omitted.

The **admin screen** (*Muokkaa kategorioita* on the setup screen) shows this JSON in an editable
textarea and validates it before applying. Edits take effect immediately for the current
session.

## Known limitations

- **Inflected forms exist for only 20 of the 72 cities.** The other 52 are recognised in base
  form only — say *"Porvoo"*, not *"Porvoossa"*. Forms for the remaining cities have to be
  written by hand in `js/categories.js` or the admin screen.
- **No persistence.** Category edits made in the admin screen live in memory and are lost on
  reload. There is no backend and nothing is written to disk or `localStorage`.
- **Single device only.** One phone, passed around. No networked or multi-device play.
- **Speech needs Chrome or Edge**, and needs a network connection — Chrome sends audio to
  Google for recognition.
- **Fuzzy matching can accept near-misses.** The Levenshtein fallback allows one edit for
  answers up to 11 characters, so a wrong word one letter away from a real one gets through
  (*poro* is accepted as *pori*). It's a deliberate trade against STT noise.
- **Fonts load from Google Fonts.** Offline, the page falls back to system sans-serif. Nothing
  else needs the network except speech recognition.
