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

Answers are matched in four tiers: the base form, any hand-written inflected forms, the
base form's **stem** plus a Finnish case ending (so *Porvoossa* and *Helsingissä* work without
anyone writing them out), and finally a Levenshtein-distance fallback to absorb minor
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

Note that the two ways of running it are **not** equivalent for testing purposes — see
[TESTING.md](TESTING.md) before changing how the JS is loaded.

There is also a container image, which is what the public deploy serves:

```sh
podman run --rm -p 8080:8080 ghcr.io/juusoi/say-it-once:latest
# then open http://localhost:8080
```

See [deploy/README.md](deploy/README.md) for how that reaches the server.

## Project structure

```
index.html          markup for the four screens (setup, admin, game, winner)
css/styles.css      all styling
js/matching.js      normalize / stem / Levenshtein / matchAnswer — pure, no DOM
js/categories.js    the category data — city list, inflected forms, defaults
js/game.js          state, screen switching, speech, game logic
test/               node:test unit tests; `node --test test/*.test.js`
Containerfile       Caddy image for the public deploy
deploy/             in-image Caddyfile, Quadlet unit, server runbook
.github/workflows/  CI and the GHCR release
```

`js/matching.js` is separate from `js/game.js` for one reason: `game.js` runs top-level code
against the DOM and so can never be imported, while the matching logic is pure and is where a
real bug would hide. Both files end with a `typeof module` guard, which is a no-op in the
browser and a CommonJS export in Node.

**Deliberately plain: classic `<script>` tags, no modules, no bundler.** Three things depend
on this, so please don't "modernize" it without addressing them first:

1. Buttons use inline `onclick=` attributes, which resolve against the global scope. Moving
   the JS to `<script type="module">` silently breaks every button.
2. Category data is a `.js` file assigning a `const`, not a `.json` file loaded with `fetch()`,
   because `fetch()` is CORS-blocked on `file://`. Making it real JSON would mean always
   running a local server. The admin screen still shows and accepts real JSON at runtime.
3. `js/game.js` runs top-level code that needs `matching.js`, `categories.js` and a parsed
   DOM. Hence the load order, and hence the scripts staying at the end of `<body>` with no
   `defer`.

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
should also be accepted; it may be empty or omitted — and it usually should be, because stem
matching handles ordinary Finnish case endings on its own. `forms` is for words no prefix rule
reaches, such as compounds whose first half also inflects
(*Uusikaupunki* → *Uudessakaupungissa*).

The **admin screen** shows this JSON in an editable textarea and validates it before applying.
Edits take effect immediately for the current session. It is reachable only at
[`#admin`](#known-limitations) — a raw JSON editor that replaces every category and persists
nothing is a tool for drafting category data, not something to put in front of a player.

## Known limitations

- **Stem matching accepts some nonsense.** Answers are matched on the stem plus a case
  ending, so a short stem covers more than it should: *salo* stems to `sal`, and a made-up
  `sal` + case ending would be accepted. Deliberate — wrongly carding a correct answer is much
  worse than accepting a word nobody would say. It rejects the obvious cases (*salaatti*,
  *porvoolainen*) because the remainder has to be a real case ending.
- **Two cities still need hand-written forms.** *Uusikaupunki* and *Uusikaarlepyy* inflect both
  halves of the compound (*Uudessakaupungissa*), which no stem rule reaches.
- **No persistence.** Category edits made in the admin screen live in memory and are lost on
  reload. There is no backend and nothing is written to disk or `localStorage`.
- **The admin screen is only at `#admin`.** Add the fragment to the URL to reveal it. This is
  tidiness, not security — it is client-side and harmless either way.
- **Single device only.** One phone, passed around. No networked or multi-device play.
- **Speech needs Chrome or Edge**, needs a network connection — Chrome sends audio to Google
  for recognition — and needs a trusted origin. `file://`, `localhost` and the HTTPS deploy
  qualify; plain HTTP does not, and there the microphone is unavailable rather than degraded.
- **Short names have no typo tolerance.** The Levenshtein fallback now allows no edits below
  six characters, so *poro* is no longer accepted as *pori* — but neither is a genuine
  mis-hearing of *Kemi* or *Oulu*.
- **Fonts load from Google Fonts**, so every visitor's IP reaches Google. Offline, the page
  falls back to system sans-serif. Nothing else needs the network except speech recognition.
- **No favicon**, so every page load logs a 404 for `/favicon.ico` in the console.

Most of these are addressed, with trade-offs, in [ROADMAP.md](ROADMAP.md).

## Working on it

- [TESTING.md](TESTING.md) — the automated tests, the manual smoke test to run before pushing,
  and a note on what's worth automating versus what genuinely isn't.
- [ROADMAP.md](ROADMAP.md) — what to build next and why, plus what's deliberately out of scope.
- [deploy/README.md](deploy/README.md) — how a merge to `main` reaches the server, how to
  verify it landed, and how to roll back.

```sh
node --test test/*.test.js     # no dependencies, no package.json
```

Work on a branch and open a PR; `main` is the published version, and merging to it publishes a
new image that the server picks up within about five minutes.
