# Deploying

The server is a 1 GB / 1 CPU VPS that already runs a Caddy serving other
sites. It never builds anything: GitHub Actions builds the image and pushes it
to GHCR, and the server pulls a finished artefact.

```
push to main → Actions: CI → build → ghcr.io/juusoi/say-it-once:latest
                                            │
                          (server polls, ~5 min)
                                            ▼
          podman-auto-update.timer → pull → restart → health check
                                            │              │
                                            │       unhealthy → roll back
                                            ▼
    host Caddy (TLS) → reverse_proxy 127.0.0.1:8080 → container Caddy → /srv
```

Nothing pushes *to* the server, so no SSH key or deploy credential ever leaves
GitHub.

## Why HTTPS is not optional

Chrome will not hand a microphone to an origin it does not trust. `file://`
and `localhost` count as trustworthy; `http://<ip>` does not. Speech is the
game's primary input, so a plain-HTTP or bare-IP deploy does not have a
degraded microphone — it has none. The host Caddy already terminates TLS for
other sites here, so this costs nothing, but it does mean a real hostname is a
hard prerequisite rather than a nicety.

## Before you start

Everything below runs **on the server**, as the normal (non-root) user that
will own the container. Four things have to be true before the setup steps
work, and each one fails in a way that is hard to read backwards from.

### podman has to be new enough to have Quadlet

```sh
podman --version                                          # 4.4 or newer
systemctl --user list-unit-files podman-auto-update.timer # must be listed
```

Quadlet — the thing that turns `say-it-once.container` into a systemd service
— arrived in podman 4.4. On anything older the `.container` file is simply
ignored: `daemon-reload` succeeds, `systemctl --user start say-it-once` says
`Unit say-it-once.service not found`, and nothing anywhere explains why.
Debian 12 ships podman 4.3.1, so that is the usual way to hit this; Debian 13,
Ubuntu 24.04 and current Fedora are all fine.

`podman-auto-update.timer` comes from the same package. If it is not listed,
the entire pull-on-a-timer design has nothing to run it.

If `systemctl --user` answers `Failed to connect to bus` over SSH:

```sh
export XDG_RUNTIME_DIR=/run/user/$(id -u)
```

### Port 8080 has to be free

```sh
ss -ltn 'sport = :8080'
```

This box already serves other sites, so the port is worth checking rather than
assuming. If something holds it, change only the *host* side of `PublishPort=`
in the unit — `127.0.0.1:8081:8080` — and point the Caddy site block at the
same number. `preflight.sh` parses `PublishPort=` out of the unit, so it
follows the change on its own.

### DNS has to resolve here already

```sh
getent hosts game.example.fi             # or: dig +short game.example.fi
curl -fsS https://ifconfig.me; echo      # compare
```

`getent` rather than `dig` because it is always present; a minimal VPS often
has no `dnsutils`/`bind-utils`.

Caddy requests a certificate the moment you reload it with the new site block.
If the name does not resolve to this box the ACME challenge fails and the site
serves an error rather than the game. There is no firewall step: 80 and 443
are necessarily already open, since the host Caddy is already serving other
sites over TLS.

### The deploy files have to be on the box

The server never builds anything, but it does need two files from this repo —
the Quadlet unit and the preflight script:

```sh
git clone --depth 1 https://github.com/juusoi/say-it-once.git ~/src/say-it-once
cd ~/src/say-it-once/deploy
```

A clone is the convenient form, because `git pull` later gets you an updated
unit and an updated `preflight.sh`. It is *only* a copy of those files:
nothing on the server builds from this checkout, and the running site does not
come from it — it comes from the image. If you would rather not have a
checkout on the box at all, two files copied over are enough — this one from
your laptop, at the repo root, and it is the only command in this document
that does not run on the server:

```sh
scp deploy/say-it-once.container deploy/preflight.sh <server>:
```

## One-time setup

### 1. Confirm the GHCR package is public

**This is already done** — an anonymous manifest fetch returns `HTTP 200`, so
the package is public and the server needs no credentials. It stays first in
this list because it is the thing that breaks silently if it ever changes.

GHCR packages default to private even for a public repository. When that
happens the server gets a 401 on every pull and `podman auto-update` quietly
does nothing — no error on the box, no failed unit, just a version that never
changes. Confirm from the server, with no credentials configured:

```sh
podman pull ghcr.io/juusoi/say-it-once:latest
```

If that ever fails, set visibility on the package page (*Packages* →
`say-it-once` → *Package settings*). The alternative is `podman login ghcr.io`
with a read-only PAT, which means a long-lived credential on the box and a
token to rotate. Public is simpler and the source is public anyway.

`preflight.sh` covers this too: it runs `podman auto-update --dry-run`, which
walks the same pull path the timer does, so a 401 surfaces as a failure rather
than as silence.

### 2. Let the user's units run without a login session

```sh
loginctl enable-linger "$USER"
```

Without this, rootless units stop when the user logs out.

### 3. Install the Quadlet unit

```sh
install -Dm644 say-it-once.container \
  ~/.config/containers/systemd/say-it-once.container
systemctl --user daemon-reload
systemctl --user start say-it-once
systemctl --user status say-it-once
```

Run it from the `deploy/` directory you cloned or copied to. Quadlet generates
the systemd service from the `.container` file, so there is no unit to
hand-write and no `podman generate systemd` output to keep in sync. Step 1
already pulled the image, so `start` comes up immediately instead of racing a
download against the unit's start timeout.

Install it as committed and do not edit `Image=`. It has to stay a floating
tag or the server stops receiving deploys — the reasoning is written out above
that line in the unit itself, and step 7 checks it.

Check it is up and healthy before touching Caddy:

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/   # 200
podman inspect --format '{{.State.Health.Status}}' systemd-say-it-once
```

### 4. Add one site block to the existing Caddyfile

Do not replace the host Caddyfile — add to it:

```caddy
game.example.fi {
	reverse_proxy 127.0.0.1:8080
}
```

Then `caddy validate --config /etc/caddy/Caddyfile` and reload.

**Check the existing config for global or site-wide `header` directives
first.** The container sets its own CSP, `X-Content-Type-Options` and
`Referrer-Policy`; if the host sets them too you get duplicated headers, and a
duplicated CSP is intersected by browsers, which can break the page in ways
that look nothing like a header problem.

Do not add compression on the host — the container already does `encode zstd
gzip` and Caddy will not double-encode.

### 5. Make auto-update actually timely

`podman-auto-update.timer` runs **daily** by default, which would mean a
deploy landing up to 24 hours after the merge.

```sh
mkdir -p ~/.config/systemd/user/podman-auto-update.timer.d
cat > ~/.config/systemd/user/podman-auto-update.timer.d/override.conf <<'EOF'
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
EOF
systemctl --user daemon-reload
systemctl --user enable --now podman-auto-update.timer
systemctl --user list-timers podman-auto-update.timer
```

A registry digest check every five minutes is negligible on one CPU — it is a
`HEAD` request unless something actually changed.

### 6. Keep the disk from filling

Auto-update does not remove the image it superseded, and this is a small VPS.

```sh
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/podman-prune.service <<'EOF'
[Unit]
Description=Remove superseded container images

[Service]
Type=oneshot
ExecStart=/usr/bin/podman image prune -f
EOF
cat > ~/.config/systemd/user/podman-prune.timer <<'EOF'
[Unit]
Description=Weekly container image prune

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now podman-prune.timer
```

### 7. Preflight

Everything above fails quietly when it fails. Run the check rather than
assuming the setup took:

```sh
./preflight.sh                  # container, unit and timer
./preflight.sh game.example.fi  # and the public URL
```

It exits non-zero if anything is wrong, and each line says what to do. It
asserts the things that otherwise produce no error anywhere:

| It checks | Because otherwise |
|---|---|
| `Image=` is a floating tag | a `sha-` tag or digest can never trigger auto-update |
| `AutoUpdate=registry` is set and not commented out | nothing ever updates |
| the timer is enabled and active | nothing ever updates |
| the timer is off the daily default | deploys land up to 24 h late *(warning)* |
| linger is enabled | everything stops when you log out |
| the unit is active and the container healthy | a bad image has nothing to roll back from |
| `auto-update --dry-run` reports nothing pending | the running image is stale, or the package went private |
| the published port serves 200 | serving is broken behind a working proxy |

Without a hostname argument it does not touch the public URL, so a green run
on its own does not prove the site is reachable from outside. It says so.

Re-run it any time you are unsure whether the running version is current —
that is the question it exists to answer.

### 8. Open it in a browser and say something

The one thing `preflight.sh` cannot check is the thing the game is for. A 200
from `https://game.example.fi/` proves the bytes are served; it does not prove
the browser will hand over a microphone. Open the site on a real device, start
a round, and confirm speech recognition actually fires — see the smoke test in
[TESTING.md](../TESTING.md).

If the page loads but the microphone never activates, check the browser
console for a CSP violation before suspecting the hardware. A duplicated
`Content-Security-Policy` — one from the container, one from a global `header`
block in the host Caddyfile — is intersected by the browser, and the failure
looks nothing like a header problem. That is what step 4 is warning about.

## Verifying a deploy

`./preflight.sh` answers "is the running image current?" directly, and is the
quickest check. To watch a specific deploy land, merge something trivial to
main, then on the server:

```sh
# Did the timer run, and did it see a new digest?
journalctl --user -u podman-auto-update.service -n 40

# Is the container younger than the merge?
podman ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}'

# Which digest is actually running? Compare against the Release step summary.
podman inspect --format '{{.ImageDigest}}' systemd-say-it-once
```

The digest is the only value worth comparing. A matching `:latest` tag proves
nothing, since the tag moves.

To force a check instead of waiting:

```sh
podman auto-update --dry-run     # what would change
podman auto-update               # do it now
```

## Rolling back

**None of these involve editing the unit file.** Earlier versions of this
runbook told you to point `Image=` at a `sha-<commit>` tag; that works once and
then stops the server receiving deploys for ever if you forget to undo it,
because a `sha-` tag always resolves to the same digest and
`AutoUpdate=registry` has nothing left to notice. The `sha-` tags identify a
build and are what the fast path below re-tags *from* — they are not something
to point the server at.

**Durable path — `git revert`.** Revert, merge to main, and the new image
ships in about five minutes. This is the one that keeps the server's state and
the repository's state identical, and it is what you want in almost every
case.

**Fast path — move `:latest` back onto an earlier release.** `Release` takes a
manual dispatch naming a commit, and re-tags `:latest` onto the image that
already shipped for it. Nothing is rebuilt and nothing on the server changes:

```sh
gh workflow run release.yml -f sha=<commit>
gh run watch "$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

A short SHA is fine, as is a tag or branch name — the job resolves it. Because
a single manifest-list source makes the copy exact, `:latest` ends up on the
same digest, the same two platforms, and the same bytes that ran before.

It **builds nothing**, which is the point. An earlier version of this rebuilt
the old commit and it did not work: a dispatch checks out old code but runs
`ci.yml` from `main`, so current lint and test steps ran against a tree that
lacked the config they needed, and any commit old enough to be worth rolling
back to failed. Re-tagging avoids that entirely, and needs no CI — the image
it points at was already gated when it shipped.

Three things to know before using it:

- **It is temporary.** `main` still holds the bad commit, so the next merge
  publishes straight over your rollback. It buys time to write the revert; it
  is not the revert.
- **Only released commits are available.** Merge commits that triggered a
  `Release` have a `sha-` tag; commits inside a multi-commit push do not. List
  the real ones with `gh run list --workflow=release.yml`. If the commit you
  want was never released, use `git revert`.
- **Check the Actions queue is empty first.** The `release` concurrency group
  queues rather than cancels, so a push-triggered run already waiting will
  execute after yours and republish what you just rolled away from.

A bad input cannot hurt you: the job resolves the commit and confirms the
source image exists *before* it touches `:latest`, so a typo fails the run and
leaves the tag alone. The step summary records what was requested, what it
resolved to, the resulting digest, and that the rollback is temporary.

Because it re-tags rather than rebuilds, a rollback also carries that release's
`deploy/Caddyfile` and headers — correct for a rollback, and worth remembering
when reasoning about a header change.

**Automatic path — a bad image never sticks.** If a new image starts but fails
its health check, podman restores the previous one by itself. That is the whole
reason the health check is declared in the Quadlet unit: podman builds OCI
images by default and silently ignores a `HEALTHCHECK` instruction in the
Containerfile, so putting it there would look like protection without being
any.

## Testing the image locally

The published image is built for `linux/arm64` as well as `linux/amd64`, so
this is the real artefact rather than an approximation:

```sh
podman run --rm -p 8080:8080 ghcr.io/juusoi/say-it-once:latest
open http://localhost:8080
```

`localhost` is a trustworthy origin, so speech recognition works here and the
full smoke test in [TESTING.md](../TESTING.md) applies.
