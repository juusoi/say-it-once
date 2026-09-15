# Roadmap

Where the prototype stands and what's worth doing next, roughly in the order I'd do it.
Nothing here is committed to — it's a menu with the trade-offs written down.

## Where it stands

The game is playable end to end: setup, turns, yellow cards, elimination, winner. It is
deployed publicly — a container image built by GitHub Actions, served by Caddy, pulled by the
server via `podman auto-update`. See [deploy/README.md](deploy/README.md).

The first public release also closed items 3, 4 and 5 below. Every city now accepts the form a
Finnish speaker actually says, the fuzzy fallback no longer accepts near-miss nonsense, and
the matching logic has unit tests.

What's left is dominated by one thing: there are effectively **one and a half categories**.
That is now the only problem that seriously limits the game.

---

## 1. More categories

**Why first, and now by a wide margin:** this is a party game with one real category in it. *Esimerkki: Pohjoismaat* is a
five-answer placeholder whose name literally tells you to go fill it in. Nothing else on this
list improves a game night as much as having six good categories to pick from.

It's also pure content — no architecture, no risk, and it can be crowd-sourced from the people
who play it. Good candidates are sets that are large, commonly known, and unambiguous: animals,
countries, foods, bands, verbs, things in a kitchen.

Cheaper than it used to be: stem matching means a new category needs only base forms, with no
inflection tables to write. `forms` is now only for words no prefix rule reaches.

**Watch out for:** categories where players disagree about what counts. The game gives a yellow
card for an answer that isn't on the list, so a category with fuzzy boundaries turns into an
argument with the phone. Large and well-defined beats clever.

## 2. Persist category edits

**The problem:** the admin screen is the only way to add a category, and everything it produces
dies on reload. That makes item 1 above almost impossible to act on — you can't accumulate work.

Two approaches, and they solve different halves:

- **Export / import JSON.** A download button and a file picker. This is the one I'd do first:
  it produces a real file you can paste into `js/categories.js` and commit, so category work
  becomes permanent and shareable rather than trapped in one browser.
- **`localStorage`.** Roughly ten lines, survives reload, zero friction. Caveat worth knowing:
  every `file://` page shares one origin, so storage is shared with any other local HTML file
  you open — fine here, but not a place for anything you care about.

Both together is the right end state: `localStorage` for convenience, export for permanence.

## 3. Finnish inflections for the other 52 cities — **done**

Matching on the stem, as planned. `stemOf()` cuts two characters from the base form, which is
what absorbs consonant gradation (*Helsinki* → `helsin`, so *Helsingissä* matches; *Lahti* →
`lah`, so *Lahdessa* does) and the *i → e* stem class (*Riihimäki* → `riihimä`). Words in
*-nen* take an *-s* stem instead (*Parainen* → `parais`).

Three things this plan didn't anticipate:

- **The longest matching stem has to win**, and that's correctness rather than polish.
  *Kemijärvellä* also matches `kem` (Kemi) and *Porvoossa* also matches `por` (Pori). Take the
  shorter stem and the wrong city silently wins.
- **The remainder needs to be a real case ending.** A bare prefix rule would accept *salaatti*
  as *Salo*. Requiring at most three leftover stem characters plus an actual ending
  (`-ssa`, `-lla`, `-sta`, `-lle`, or anything ending in `-n`) fixes that — and as a bonus
  rejects *porvoolainen*, which this plan had written off as acceptable collateral.
- **It's two cities, not three or fifty-two.** *Uusikaupunki* → *Uudessakaupungissa* and
  *Uusikaarlepyy* inflect both halves of the compound, so they keep hand-written forms.
  *Kristiinankaupunki* needs none — only its second half inflects.

Verified by a sweep over all 72 cities in the form a speaker actually says, plus a test that
the corpus still matches the city list so adding a city can't silently skip the sweep.

## 4. Stop accepting near-miss nonsense — **done**

Two changes, after item 3 as planned. The first-letter guard went in and rejects *talo* as
*Salo*.

**This plan was wrong about it being enough.** It claimed the guard would "kill most of the
false positives at a stroke", but the case it names — *poro* → *pori* — survives it, because
both words start with `p`. What actually kills it is dropping the `Math.max(1, ...)` floor on
the threshold, so canonicals under six characters allow no edits at all.

The cost: the five four-letter cities (*Kemi*, *Pori*, *Salo*, *Oulu*, *Akaa*) lose their
speech-to-text noise tolerance entirely. Affordable because item 3 landed first and covers
their inflected forms, which is most of what the tolerance was absorbing.

## 5. Make the matching logic testable — **done**

`normalize()`, `levenshtein()`, `stemOf()` and `matchAnswer()` now live in `js/matching.js`,
which ends in a `typeof module` guard: a no-op in the browser, a CommonJS export in Node.
`matchAnswer()` takes the answer list as an argument instead of reading globals.

**Cheaper than this plan feared.** It framed the choice as "a module system or a small
`window.X` seam" and concluded "pick ugly". A separate file needs neither: one extra classic
`<script>` tag, no bundler, no `window` namespace, and `file://` still works. Tests run on
`node:test` with no `package.json` and no dependencies.

It earned its keep immediately. The stem rule in item 3 would have been a guess without the
72-city sweep, and pinning *poro* → *pori* **before** touching the threshold is what made the
trade in item 4 visible in the diff instead of discovered later in a game.

## 6. A turn timer

Pure gameplay feel. Pressure is most of the fun in this genre, and "you took too long" is a
natural third way to earn a card. Small and self-contained; worth doing whenever it sounds fun
rather than at any particular point in the order.

## 7. Internal cleanups

Not urgent, none of it user-visible, listed so it isn't rediscovered from scratch:

- **Convert the inline `onclick=` attributes to `addEventListener`.** This one now has a
  concrete payoff rather than being taste: the deployed CSP needs
  `script-src 'unsafe-inline'` for those ~12 attributes, which makes it close to useless
  against XSS. Converting them lets it drop to `script-src 'self'`. It does **not** require
  modules and so does not threaten the `file://` workflow — constraint 1 in the README is
  about `type="module"`, not about `addEventListener`. Low stakes either way (no backend, no
  auth, no cookies, nothing cross-user), which is why it's here and not above.
- **Add a favicon.** Every page load logs a 404 for `/favicon.ico`, which is noise in a
  console that TESTING.md asks you to check is clean. Two minutes.
- `giveYellowCard()` decides control flow by **reading a DOM class** to check whether the game
  ended. A state flag would be honest about what it's actually asking.
- `checkGameOver()` is called from both `giveYellowCard()` and `nextTurn()`.
- `resetGame()` leaves `players`, `usedAnswers` and the stale name inputs in place, relying on
  `startGame()` to reinitialise everything.
- Screen switching is hand-rolled in five places; one `showScreen(id)` would replace all of them
  and would be the natural home for moving focus when a screen changes.
- Nothing stops two players having the same name. It works — elimination is index-based — but
  the scoreboard is confusing.
- Admin validation doesn't check that `forms` entries are strings, doesn't reject empty
  `answers`, and doesn't catch duplicate canonicals.

---

## Deliberately not planned

**Multi-device play.** The obvious "next big feature", and I'd argue against it. It means a
backend, hosting, session management, and a build step — and it would replace the thing that
makes the game work, which is a group of people looking at each other while one person holds a
phone. Passing a device around isn't a limitation being worked around; it's the format. If you
want this, treat it as a different project rather than an iteration on this one.

**A build system.** No dependencies, no compile step, double-click to play — still literally
true, and the public deploy didn't cost it. The `Containerfile` copies four files into a Caddy
image; it is packaging, not a build. The tests run on `node:test` with no `package.json`.
Nothing above needs this to change, and it's worth more than tidier syntax.

**Offline fonts.** Google Fonts is the only non-speech network dependency; offline it falls back
to system sans-serif and looks slightly worse. Vendoring the files would fix it. Low value —
speech needs the network anyway.
