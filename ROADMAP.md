# Roadmap

Where the prototype stands and what's worth doing next, roughly in the order I'd do it.
Nothing here is committed to — it's a menu with the trade-offs written down.

## Where it stands

The game is playable end to end: setup, turns, yellow cards, elimination, winner. The initial
repo pass fixed the bugs that made it feel broken — feedback that was wiped before anyone
could read it, a mic button that jammed on a second press, error messages that hid the actual
reason. What's left is less about defects and more about **content and reach**.

Two things dominate everything below: there are effectively **one and a half categories**, and
**52 of the 72 cities only accept their base form**. Both are content problems, and both hurt
the game more than any architectural concern does.

---

## 1. More categories

**Why first:** this is a party game with one real category in it. *Esimerkki: Pohjoismaat* is a
five-answer placeholder whose name literally tells you to go fill it in. Nothing else on this
list improves a game night as much as having six good categories to pick from.

It's also pure content — no architecture, no risk, and it can be crowd-sourced from the people
who play it. Good candidates are sets that are large, commonly known, and unambiguous: animals,
countries, foods, bands, verbs, things in a kitchen.

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

## 3. Finnish inflections for the other 52 cities

**The problem:** say *"Tampereella"* and you're fine; say *"Porvoossa"* and you get a yellow
card for a correct answer. That's the most unfair-feeling failure in the game, and it hits 52
of 72 cities. People do not speak in nominative.

Three ways out, worst to best:

- **Hand-write the forms.** 52 cities × 4 cases = 208 strings, each an opportunity for a typo.
  Accurate but joyless, and it doesn't generalise to any new category.
- **Generate them with rules.** Tempting and harder than it looks — Finnish consonant gradation
  means *Helsinki → Helsingissä* and *Lahti → Lahdessa*, which no simple suffix rule produces.
  A real morphological library would do it, but that's a dependency and a build step, and this
  project's whole premise is having neither.
- **Match on the stem instead.** Accept an answer whose leading characters match a canonical
  answer's stem, so `porvoo*` covers every case ending at once. One change, covers all 72
  cities *and* every future category, no data entry.

I'd try the stem approach. It's the only one whose cost doesn't scale with content, and this
game will live or die on content. It will accept some nonsense (`porvoolainen`), which matters
much less than wrongly carding a correct answer.

## 4. Stop accepting near-miss nonsense

The Levenshtein fallback allows one edit for answers up to 11 characters, so `poro` is accepted
as `pori` and `salo` as `talo`. It's there to absorb speech-to-text noise and it does that job,
but the threshold is loose on short words specifically.

Cheap improvement: require the first letter to match before allowing a fuzzy match. STT rarely
mangles the initial sound, and it kills most of the false positives at a stroke.

Do this **after** item 3, not before — stem matching changes what the fuzzy fallback is even
being asked to catch, and tuning the threshold twice is wasted work.

## 5. Make the matching logic testable

`normalize()`, `levenshtein()` and `matchAnswer()` hold all the genuinely tricky logic and have
no DOM dependencies, but `js/game.js` is a classic script with no exports, so there's nothing to
import from a test.

Worth doing **when items 3 and 4 land**, not before — those change matching behaviour
substantially, and that's exactly the point where a regression corpus starts earning its keep.
See [TESTING.md](TESTING.md) for what's worth covering.

The cost is real and should be weighed: exports mean either a module system or a small
`window.X` seam, and modules would break the `file://` workflow that makes this thing pleasant.
The `window` seam is ugly and keeps that property. Pick ugly.

## 6. A turn timer

Pure gameplay feel. Pressure is most of the fun in this genre, and "you took too long" is a
natural third way to earn a card. Small and self-contained; worth doing whenever it sounds fun
rather than at any particular point in the order.

## 7. Internal cleanups

Not urgent, none of it user-visible, listed so it isn't rediscovered from scratch:

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

**A build system.** No dependencies, no compile step, double-click to play. Everything above is
achievable without giving that up, and it's worth more than tidier syntax.

**Offline fonts.** Google Fonts is the only non-speech network dependency; offline it falls back
to system sans-serif and looks slightly worse. Vendoring the files would fix it. Low value —
speech needs the network anyway.
