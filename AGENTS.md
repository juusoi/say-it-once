# AGENTS.md

Instructions and invariants for coding agents working in `say-it-once`. Read this before
changing code, tests, CI, or deploy configuration.

## Overview & language split

`say-it-once` is a single-device party game in Finnish. One phone or laptop is passed around;
each player has 30 seconds on their turn to say (via Web Speech API) or type an answer in the
active category without repeating an earlier answer.

- **All user-facing UI and game copy is in Finnish** (`index.html`, `js/rules.js`, `js/game.js`,
  `js/categories.js`). Keep Finnish grammar and inflections accurate (e.g. `1 varoitus` vs
  `0 varoitusta` / `2 varoitusta`).
- **All code identifiers, comments, commit messages, and documentation are in English**
  (`README.md`, `TESTING.md`, `ROADMAP.md`, `AGENTS.md`, `deploy/*.md`).
- **Comments explain *why*, not *what*.** Preserve existing rationale comments when editing
  files; do not strip them as "cleanup".

## Hard architectural invariants (do not "modernize")

1. **Zero dependencies, no build step, no `package.json`.** No `package.json`, `node_modules`,
   bundlers, TypeScript, or test frameworks.
2. **Must work when opened directly from disk (`file://`).**
   - Never convert `<script>` tags to `type="module"` (CORS-blocked on `file://`, and breaks
     inline `onclick=` handlers that resolve against global scope).
   - Never load category data via `fetch()` (CORS-blocked on `file://`); it lives in
     `js/categories.js` as a plain script.
3. **Strict script load order at the end of `<body>` (no `defer`, no `async`):**
   `matching.js` → `rules.js` → `categories.js` → `version.js` → `game.js`.
   `js/game.js` runs top-level code against the parsed DOM and calls globals defined in the
   four preceding files.
4. **The `typeof module` seam for unit-testable code:** `js/matching.js`, `js/rules.js`,
   `js/categories.js`, and `js/version.js` are pure (no DOM, no `window`/`document`) and end
   with `if(typeof module !== 'undefined') module.exports = { ... }`. A no-op in the browser,
   a CommonJS export in Node. Put any new rules, matching, or data validation logic behind this
   seam so `node:test` can cover it directly.

## Verification commands & traps

Run these before finishing any code change:

```sh
node --test test/*.test.js                                # 1. unit tests (Node built-in runner)
node --check js/matching.js                               # 2. syntax check every script
node --check js/rules.js
node --check js/categories.js
node --check js/version.js
node --check js/game.js
npx --yes @biomejs/biome@2.5.13 ci --error-on-warnings .  # 3. lint (pinned binary, no install)
```

- **Use `node --test test/*.test.js`, never `node --test test/`.** Passing the directory fails
  because Node resolves `test/` as a module entry point.
- **Never run `biome lint --write` or enable Biome's formatter.** `js/game.js` defines global
  functions called by inline `onclick=` attributes in `index.html`; Biome cannot see HTML
  references and would delete those handlers under `noUnusedVariables` + `--write`. Read
  `biome.jsonc` before changing any lint rule.
- **Adding a new `js/*.js` file requires updating four places:**
  1. `index.html` (`<script src="...">` in dependency order before `js/game.js`)
  2. `.github/workflows/ci.yml` (`Syntax-check every script` step)
  3. `.github/workflows/ci.yml` (the container HTTP smoke-test `for f in ...` loop)
  4. `README.md` / `TESTING.md` project structure and script lists

## Git, container, and deploy invariants

- **Whitelist `.gitignore`:** it starts with `*` and `!*/`, then re-includes tracked paths
  (`!/js/*`, `!/css/*`, `!/test/*`, `!/*.md`, etc.). A new top-level non-Markdown file or new
  directory is **invisible to `git status`** unless re-included; check with
  `git check-ignore -v <path>`.
- **Container image (`Containerfile`, `.containerignore`):** only the static files served by
  Caddy (`index.html`, `css/`, `js/`) and `deploy/Caddyfile` belong in the image; `**/*.md`,
  `test/`, and `.github/` stay excluded.
- **Health checks and rollback (`deploy/say-it-once.container`):** do **not** add `HEALTHCHECK`
  to `Containerfile`; health checking lives solely in the Quadlet unit (`Notify=healthy`,
  `HealthCmd=`, `HealthOnFailure=kill`) so `podman auto-update` gates deploys and rolls back
  unhealthy images. Do **not** change `Image=ghcr.io/juusoi/say-it-once:latest` to a
  `sha-<commit>` tag or digest; `AutoUpdate=registry` requires a floating tag.
- **CSP and microphone access (`deploy/Caddyfile`):** do not tighten `connect-src` or add a
  restrictive `Permissions-Policy` without testing live microphone speech recognition in Chrome
  against the running container.
- **GitHub Actions (`.github/workflows/*.yml`):** pin every third-party action to a full
  40-character commit SHA with a `# vX.Y.Z` comment, and keep embedded `run:` scripts clean
  under `actionlint` / ShellCheck.

## Versioning

`APP_VERSION` lives in `js/version.js` (rendered in `#version-line` as `Versio X.Y.Z`, tested by
`test/version.test.js`). While pre-1.0 (`0.x`), bump it in the same change when requested:
MAJOR — a rules change that invalidates how existing players understand the game; MINOR — a new
gameplay feature (or pre-1.0 gameplay change); PATCH — a bug fix, copy tweak, or internal
cleanup with no gameplay change.

## Key documents

- [README.md](README.md) — rules, architecture rationale, versioning policy, known limitations
- [TESTING.md](TESTING.md) — unit tests, Biome setup, `file://` vs `localhost` vs container, manual smoke test
- [ROADMAP.md](ROADMAP.md) — completed milestones, prioritized next steps, and internal cleanups
- [deploy/README.md](deploy/README.md) — server architecture, Quadlet setup, verification, and rollback runbook
