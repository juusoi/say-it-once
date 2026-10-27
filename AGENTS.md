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

1. **Zero dependencies, no build step, no `package.json`.**
   Do not introduce `package.json`, `node_modules`, bundlers, TypeScript, or test frameworks.
2. **Must work when opened directly from disk (`file://`).**
   - Never convert `<script>` tags to `type="module"` (CORS-blocked on `file://`, and breaks
     inline `onclick=` handlers that resolve against global scope).
   - Never load category data via `fetch()` (CORS-blocked on `file://`). Category data lives in
     `js/categories.js` as a plain script.
3. **Strict script load order at the end of `<body>` (no `defer`, no `async`):**
   ```html
   <script src="js/matching.js"></script>
   <script src="js/rules.js"></script>
   <script src="js/categories.js"></script>
   <script src="js/version.js"></script>
   <script src="js/game.js"></script>
   ```
   `js/game.js` runs top-level code against the parsed DOM and calls globals defined in the
   four preceding files.
4. **The `typeof module` seam for unit-testable code:**
   `js/matching.js`, `js/rules.js`, `js/categories.js`, and `js/version.js` are pure (no DOM,
   no `window`/`document` access) and end with:
   ```js
   if(typeof module !== 'undefined') module.exports = { ... };
   ```
   This is a no-op in the browser and a CommonJS export in Node. Put any new rules, matching,
   or data validation logic behind this seam so `node:test` can cover it directly.

## Verification commands & traps

Run these before finishing any code change:

```sh
# 1. Unit tests (Node built-in runner)
node --test test/*.test.js

# 2. Syntax check every script
node --check js/matching.js
node --check js/rules.js
node --check js/categories.js
node --check js/version.js
node --check js/game.js

# 3. Lint (Biome pinned binary — no install needed)
npx --yes @biomejs/biome@2.5.13 ci --error-on-warnings .
```

### Traps to avoid

- **Use `node --test test/*.test.js`, never `node --test test/`.** Passing the directory fails
  because Node tries to resolve `test/` as a module entry point.
- **Never run `biome lint --write` or enable Biome's formatter.**
  The formatter is intentionally disabled in `biome.jsonc`. `js/game.js` defines global functions
  called by inline `onclick=` attributes in `index.html`; Biome cannot see HTML references and
  would delete those handlers if `noUnusedVariables` and `--write` were used. Read `biome.jsonc`
  before changing any lint rule.
- **Adding a new `js/*.js` file requires updating four places:**
  1. `index.html` (`<script src="...">` in dependency order before `js/game.js`)
  2. `.github/workflows/ci.yml` (`Syntax-check every script` step)
  3. `.github/workflows/ci.yml` (`for f in ...` container HTTP smoke-test loop)
  4. `README.md` / `TESTING.md` project structure and script lists

## Git, container, and deploy invariants

- **Whitelist `.gitignore`:**
  `.gitignore` starts with `*` and `!*/`, then explicitly re-includes tracked paths (`!/js/*`,
  `!/css/*`, `!/test/*`, `!/*.md`, etc.). Any new top-level non-Markdown file or new directory
  is **invisible to `git status`** unless re-included in `.gitignore`. Check missing files with:
  ```sh
  git check-ignore -v <path>
  ```
- **Container image (`Containerfile`, `.containerignore`):**
  Only the static files served by Caddy (`index.html`, `css/`, `js/`) and `deploy/Caddyfile`
  belong in the image. All `**/*.md`, `test/`, and `.github/` files stay excluded via
  `.containerignore`.
- **Health checks and rollback (`deploy/say-it-once.container`):**
  - Do **not** add `HEALTHCHECK` to `Containerfile`. Health checking lives solely in
    `deploy/say-it-once.container` (`Notify=healthy`, `HealthCmd=`, `HealthOnFailure=kill`) so
    `podman auto-update` gates deploys and rolls back unhealthy images automatically.
  - Do **not** change `Image=ghcr.io/juusoi/say-it-once:latest` in `deploy/say-it-once.container`
    to a `sha-<commit>` tag or digest; `AutoUpdate=registry` requires a floating tag.
- **CSP and microphone access (`deploy/Caddyfile`):**
  Do not tighten `connect-src` or add a restrictive `Permissions-Policy` without testing live
  microphone speech recognition in Chrome against the running container.
- **GitHub Actions (`.github/workflows/*.yml`):**
  Pin every third-party action to a full 40-character commit SHA with a `# vX.Y.Z` comment, and
  keep embedded `run:` scripts clean under `actionlint` / ShellCheck.

## Versioning

`APP_VERSION` lives in `js/version.js` (rendered in `#version-line` as `Versio X.Y.Z` and tested
by `test/version.test.js`). While pre-1.0 (`0.x`), bump it in the same change when requested:
- **MAJOR** — rules change that invalidates how existing players understand the game
- **MINOR** — new gameplay feature (or pre-1.0 gameplay change)
- **PATCH** — bug fix, copy tweak, or internal cleanup with no gameplay change

## Key documents

- [README.md](README.md) — rules, architecture rationale, versioning policy, known limitations
- [TESTING.md](TESTING.md) — unit tests, Biome setup, `file://` vs `localhost` vs container, manual smoke test
- [ROADMAP.md](ROADMAP.md) — completed milestones, prioritized next steps, and internal cleanups
- [deploy/README.md](deploy/README.md) — server architecture, Quadlet setup, verification, and rollback runbook
