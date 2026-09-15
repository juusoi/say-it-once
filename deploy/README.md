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

## One-time setup

Run as the normal (non-root) user that will own the container.

### 1. Make the GHCR package public

**Miss this and nothing else works.** GHCR packages default to private even
for a public repository, so the server gets a 401 on every pull and
`podman auto-update` quietly does nothing — no error on the box, no failed
unit, just a version that never changes.

After the first successful `Release` run, go to the package page on GitHub
(*Packages* → `say-it-once` → *Package settings*) and set visibility to
public. Then confirm from the server, with no credentials configured:

```sh
podman pull ghcr.io/juusoi/say-it-once:latest
```

The alternative is `podman login ghcr.io` with a read-only PAT, which means a
long-lived credential on the box and a token to rotate. Public is simpler and
the source is public anyway.

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

Quadlet generates the systemd service from the `.container` file, so there is
no unit to hand-write and no `podman generate systemd` output to keep in sync.

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

## Verifying a deploy

Merge something trivial to main, then on the server:

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

**Normal path** — `git revert`, merge to main, and the new image ships in
about five minutes. Same mechanism as any other deploy, and it keeps the
server's state and the repository's state identical.

**Emergency path** — pin a specific build. Every release is also tagged
`sha-<commit>`:

```sh
# in ~/.config/containers/systemd/say-it-once.container
Image=ghcr.io/juusoi/say-it-once:sha-<commit>
# and comment out AutoUpdate=registry, or the next timer run undoes this
```

```sh
systemctl --user daemon-reload
systemctl --user restart say-it-once
```

Remember to put `:latest` and `AutoUpdate=registry` back afterwards. A pinned
unit silently stops receiving deploys, which is the failure mode that takes
longest to notice.

**Automatic path** — if a new image starts but fails its health check, podman
restores the previous one by itself. That is the whole reason the health check
is declared in the Quadlet unit: podman builds OCI images by default and
silently ignores a `HEALTHCHECK` instruction in the Containerfile, so putting
it there would look like protection without being any.

## Testing the image locally

The published image is built for `linux/arm64` as well as `linux/amd64`, so
this is the real artefact rather than an approximation:

```sh
podman run --rm -p 8080:8080 ghcr.io/juusoi/say-it-once:latest
open http://localhost:8080
```

`localhost` is a trustworthy origin, so speech recognition works here and the
full smoke test in [TESTING.md](../TESTING.md) applies.
