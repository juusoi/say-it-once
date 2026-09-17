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
                                            │       never healthy → roll back
                                            ▼
    host Caddy (TLS) → reverse_proxy 127.0.0.1:8080 → container Caddy → /srv
```

Nothing pushes *to* the server, so no SSH key or deploy credential ever leaves
GitHub.

That `roll back` edge is not automatic podman behaviour you get for free — it
works because the unit sets `Notify=healthy`, which withholds the systemd READY
message until the health check passes. Auto-update judges an update by whether
restarting the unit succeeded, and systemd judges that by READY, so a new image
that never goes healthy fails its start and auto-update restores the previous
one. Without that key a broken-but-running image is reported as a clean start
and nothing rolls back. It is checked in step 7.

## Why HTTPS is not optional

Chrome will not hand a microphone to an origin it does not trust. `file://`
and `localhost` count as trustworthy; `http://<ip>` does not. Speech is the
game's primary input, so a plain-HTTP or bare-IP deploy does not have a
degraded microphone — it has none. The host Caddy already terminates TLS for
other sites here, so this costs nothing, but it does mean a real hostname is a
hard prerequisite rather than a nicety.

> **`game.example.com` throughout this document is a placeholder.** Substitute
> the real hostname everywhere it appears — the DNS check, the Caddy site
> block and the browser check. It is deliberately
> a reserved `example.com` name (RFC 2606), so a line pasted without
> substituting fails against a domain nobody owns rather than reaching a
> stranger's server. The real hostname is intentionally not committed.

## Before you start

Everything below runs **on the server**, as the normal (non-root) user that
will own the container. Four things have to be true before the setup steps
work, and each one fails in a way that is hard to read backwards from.

### podman has to have Quadlet, and rootless has to actually work

```sh
podman --version                                          # 5.0 or newer
systemctl --user list-unit-files podman-auto-update.timer # must be listed
podman run --rm docker.io/library/alpine true             # must exit 0
```

Two separate version floors hide behind that first line.

Quadlet — the thing that turns `say-it-once.container` into a systemd service
— arrived in podman 4.4. On anything older the `.container` file is simply
ignored: `daemon-reload` succeeds, `systemctl --user start say-it-once` says
`Unit say-it-once.service not found`, and nothing anywhere explains why.
Debian 12's 4.3.1 is the usual way to hit that.

`Notify=healthy` arrived in podman **5.0**, and that is the real floor for this
unit. On 4.4–4.x everything appears to work — the unit starts, the site serves,
the container reports healthy — but the key is unknown, the health check stops
gating the deploy, and automatic rollback is gone. That is the failure this
whole design is built to avoid, so treat 5.0 as the requirement rather than the
nicety. Ubuntu 24.04 and later, Debian 13 and current Fedora all ship something
new enough.

`podman-auto-update.timer` comes from the same package. If it is not listed,
the entire pull-on-a-timer design has nothing to run it.

The third line is the one worth actually running. Version and packaging are
easy to eyeball; whether *this user* can start a rootless container is not,
and it fails for two reasons that look nothing alike:

**No subuid/subgid range.** Rootless podman maps container UIDs into a range
delegated to the user, and a user created without one gets
`ERRO[0000] cannot find UID/GID for user …: no subuid ranges found`. Accounts
made by `adduser` on a desktop-style install have a range; ones made by
`useradd`, by cloud-init, or as system users often do not.

```sh
grep "^$USER:" /etc/subuid /etc/subgid     # expect one line in each
# if missing:
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$USER"
podman system migrate                      # re-map existing containers
```

**AppArmor blocking unprivileged user namespaces.** Ubuntu restricts them by
default (`kernel.apparmor_restrict_unprivileged_userns=1`, on since 23.10) and
permits known binaries through a shipped profile. Podman from the Ubuntu
archive is covered; a podman installed from a third-party build or copied in
by hand is not, and fails with `Operation not permitted` on namespace
creation rather than anything mentioning AppArmor.

```sh
sysctl kernel.apparmor_restrict_unprivileged_userns   # 1 is normal on Ubuntu
```

A `1` here is not a problem on its own — only a `1` *together with* a failing
`podman run` is. Do not turn it off to make the error go away; install podman
from the archive so its profile applies.

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
same number. The container side stays 8080; that is what Caddy listens on
inside the image.

### DNS has to resolve here already

```sh
getent hosts game.example.com             # or: dig +short game.example.com
curl -fsS https://ifconfig.me; echo      # compare
```

`getent` rather than `dig` because it is always present; a minimal VPS often
has no `dnsutils`/`bind-utils`.

Caddy requests a certificate the moment you reload it with the new site block.
If the name does not resolve to this box the ACME challenge fails and the site
serves an error rather than the game. There is no firewall step: 80 and 443
are necessarily already open, since the host Caddy is already serving other
sites over TLS.

### The Quadlet unit has to be on the box

The server never builds anything, and it needs exactly one file from this
repo — `deploy/say-it-once.container`. Copy it from your laptop, at the repo
root; this is the only command in this document that does not run on the
server:

```sh
scp deploy/say-it-once.container <server>:
```

A `git clone --depth 1` on the server works too and makes picking up a later
change to the unit a `git pull`. Either way it is *only* a copy of that one
file: nothing on the server builds from it, and the running site does not come
from it — it comes from the image.

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

`podman auto-update --dry-run` covers this too, and is the check in step 7: it
walks the same pull path the timer does, so a 401 surfaces as a failure rather
than as silence.

### 2. Let the user's units run without a login session

```sh
loginctl enable-linger "$USER"
```

Without this, rootless units stop when the user logs out.

### 3. Install the Quadlet unit

```sh
mkdir -p ~/.config/containers/systemd
cp say-it-once.container ~/.config/containers/systemd/
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

`start` taking a few seconds is expected, not a hang: `Notify=healthy` means
systemd waits for the first passing health check before calling the unit
started. Measured on the published image, healthy about 4 s in.

### 4. Add one site block to the existing Caddyfile

Do not replace the host Caddyfile — add to it:

```caddy
game.example.com {
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

The image this prunes is the one automatic rollback would restore: once
auto-update moves on, the superseded image is untagged and therefore dangling.
Not a conflict in practice — rollback happens within seconds of a bad update,
and this runs weekly — but it does mean the local copy of a *previously good*
image is not a rollback mechanism you can rely on days later. Both documented
rollback paths are registry-side for that reason.

### 7. Check the setup took

Every step above fails quietly when it fails: the site keeps serving whatever
it already has, no unit fails, nothing is logged, and the only symptom is that
a merge to main never shows up. Five commands cover it:

```sh
podman auto-update --dry-run                           # this container, Updated=false
systemctl --user list-timers podman-auto-update.timer  # NEXT within ~5 min
loginctl show-user "$USER" --property=Linger           # Linger=yes
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/   # 200

# Must print --sdnotify=healthy:
systemctl --user show say-it-once -p ExecStart | grep -o -- '--sdnotify=[a-z]*'
```

`--dry-run` is the one to reach for day to day: it answers "is the running
image current?" directly. It walks the same pull path the timer does, so it
also catches the GHCR package going private — a 401 surfaces as an error
rather than as silence. `Updated=false` means current; `pending` means the
timer has not run yet.

`NEXT` showing tomorrow rather than minutes from now means the timer drop-in
in step 5 did not take, and deploys will land up to 24 h late.

The `--sdnotify` check is the one that is invisible from every other angle. If
it prints `--sdnotify=conmon` — an old podman that does not know
`Notify=healthy`, or an edited unit — the site still serves, the container still
reports healthy, `--dry-run` still passes, and nothing else in this list
notices. The loss shows up exactly once: the day a broken image ships and stays.

It reads the unit Quadlet actually generated, so it works before the first start
and does not depend on an inspect field name. Read it from `show -p ExecStart`
rather than `systemctl --user cat`: `cat` includes the comments, and the comment
explaining this key mentions `--sdnotify=conmon`, so a plain grep over it
matches both and tells you nothing.

None of this touches the public URL, so passing it does not prove the site is
reachable from outside. That is step 8.

### 8. Open it in a browser and say something

The one thing no command above checks is the thing the game is for. A 200
from `https://game.example.com/` proves the bytes are served; it does not prove
the browser will hand over a microphone. Open the site on a real device, start
a round, and confirm speech recognition actually fires — see the smoke test in
[TESTING.md](../TESTING.md).

If the page loads but the microphone never activates, check the browser
console for a CSP violation before suspecting the hardware. A duplicated
`Content-Security-Policy` — one from the container, one from a global `header`
block in the host Caddyfile — is intersected by the browser, and the failure
looks nothing like a header problem. That is what step 4 is warning about.

## Verifying a deploy

`podman auto-update --dry-run` answers "is the running image current?"
directly, and is the quickest check. To watch a specific deploy land, merge
something trivial to main, then on the server:

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

### Proving the rollback works

Worth doing once, on install and after any podman upgrade. Automatic rollback is
the load-bearing claim in this document, and an untested one is indistinguishable
from an absent one — the failure mode it guards against is silent, so silence
proves nothing either way.

The drill is to break the health check on purpose and confirm the unit *fails*
rather than reporting success. Point `HealthCmd` at a port nothing listens on, in
the installed copy of the unit only — never in the committed one:

```sh
u=~/.config/containers/systemd/say-it-once.container
cp "$u" /tmp/say-it-once.container.bak
sed -i 's|http://127.0.0.1:8080/|http://127.0.0.1:9/|' "$u"
systemctl --user daemon-reload
time systemctl --user restart say-it-once      # expect FAILURE in well under a minute
systemctl --user show say-it-once -p Result    # expect Result=exit-code
```

**A failure here is the pass condition.** A non-zero exit from `restart`, with
`Result=exit-code` and `status=137/n/a` in the journal, means the gate is
working: the check failed `HealthRetries` times, `HealthOnFailure=kill` took the
container down, and the unit's start failed. That is exactly the signal
`podman auto-update` reads to decide an update failed and to restore the
previous image. Measured here at about 7 s.

If `restart` instead returns success in under a second, leaving a container that
`podman ps` shows as `unhealthy`, then the gate is not there — a broken deploy
would ship and stay. Check step 7's `--sdnotify` line and the podman version.

Restore, stopping cleanly first. Skipping the `stop` and `reset-failed` will
have `restart` pick up the tail of the failed job and report a failure that
looks like the restore not working:

```sh
cp /tmp/say-it-once.container.bak "$u"
systemctl --user stop say-it-once
systemctl --user reset-failed say-it-once
systemctl --user daemon-reload
systemctl --user restart say-it-once
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/   # 200
podman inspect --format '{{.State.Health.Status}}' systemd-say-it-once  # healthy
```

The drill covers the half that was missing and easy to get wrong — whether an
unhealthy container fails the unit. Given that, the restore-previous-image half
is podman's own documented behaviour.

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

**Automatic path — a bad image never sticks.** If a new image starts but never
goes healthy, podman restores the previous one by itself, within seconds of the
update.

Two things have to be true for that, and both are easy to get half-right:

- The health check has to be in the **Quadlet unit**, not the Containerfile.
  Not because an image-level `HEALTHCHECK` would be ignored — this image is
  built by BuildKit, which records it, and podman honours it on pull — but
  because `HealthCmd=` overrides the image's, so declaring both leaves two
  sources of truth with the unit silently winning, and because the keys that
  make the check gate anything (`Notify=healthy`, `HealthOnFailure=`) exist
  only in the unit.
- The unit has to set **`Notify=healthy`**. Auto-update decides an update failed
  by restarting the unit and reading systemd's verdict, and systemd's verdict
  comes from the READY message; podman-auto-update(1) says plainly that
  "without that, restarting the systemd unit may succeed even if the container
  has failed shortly after". Quadlet's default sends READY when the container
  process launches, which reports a broken image as a clean start.

The rollback is therefore not triggered by the container being *labelled*
unhealthy — systemd is never told that. It is triggered by the unit's start
failing. Two things can make it fail, and it is worth knowing which:

- `HealthOnFailure=kill` takes the container down once the check has failed
  `HealthRetries` times, so `podman run` exits 137 and the start fails with
  `Result=exit-code`. This is the normal path and it is fast — measured at
  about 7 s with the check pointed at a dead port.
- `TimeoutStartSec` (90 s) is the backstop, for an image that hangs rather than
  failing. It is set explicitly in the unit for that reason, not as a
  formality.

## Testing the image locally

The published image is built for `linux/arm64` as well as `linux/amd64`, so
this is the real artefact rather than an approximation:

```sh
podman run --rm -p 8080:8080 ghcr.io/juusoi/say-it-once:latest
open http://localhost:8080
```

`localhost` is a trustworthy origin, so speech recognition works here and the
full smoke test in [TESTING.md](../TESTING.md) applies.

## Reusing this pattern elsewhere

This document is the pattern with say-it-once's specifics baked in. Two
companion documents generalise it:

- [REPLICATE.md](REPLICATE.md) — a prompt that reproduces the repo-side half
  (Containerfile, CI, rollback workflow, Quadlet unit) in another repository,
  plus what to check in the result.
- [HOST-SETUP.md](HOST-SETUP.md) — the server-side half with placeholders, for
  a box that is not this one.
