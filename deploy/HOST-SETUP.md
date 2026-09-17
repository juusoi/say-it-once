# Host setup for a rootless podman auto-update deploy

Generic version of the server-side half of this deploy, for reuse on another
app. For this app with the placeholders filled in, read [README.md](README.md)
instead — it is the same sequence with the reasoning specific to say-it-once.
To generate the repo-side half (Containerfile, CI, Quadlet unit) for another
app, see [REPLICATE.md](REPLICATE.md).

Substitute `<app>`, `<port>`, `<owner>` and `<host>` throughout.

Everything here runs **on the server**, as the ordinary non-root user that will
own the container. Nothing needs root except the one `usermod` below, and only
if the account is missing a subuid range.

## Prerequisites

Four things have to be true before the setup steps work, and each fails in a way
that is hard to read backwards from.

### podman 5.0 or newer, with rootless actually working

```sh
podman --version                                          # 5.0 or newer
systemctl --user list-unit-files podman-auto-update.timer # must be listed
podman run --rm docker.io/library/alpine true             # must exit 0
```

Two version floors hide behind the first line. **Quadlet** — the generator that
turns a `.container` file into a systemd service — arrived in podman 4.4; on
anything older the file is simply ignored, `daemon-reload` succeeds, and
`systemctl --user start <app>` says `Unit <app>.service not found` with nothing
anywhere explaining why. **`Notify=healthy`** arrived in podman 5.0, and that is
the real floor: on 4.x the unit starts and the service runs, but the health check
stops gating the deploy and automatic rollback is gone — invisibly. Debian 12
(4.3.1) fails both; Ubuntu 24.04+, Debian 13 and current Fedora are fine.

`podman-auto-update.timer` ships in the same package. If it is not listed, the
entire pull-on-a-timer design has nothing to run it.

The third line is the one worth actually running. Version and packaging are easy
to eyeball; whether *this user* can start a rootless container is not, and it
fails for two reasons that look nothing alike.

**No subuid/subgid range.** Rootless podman maps container UIDs into a range
delegated to the user. An account created without one gets
`ERRO[0000] cannot find UID/GID for user …: no subuid ranges found`. Accounts
made by `adduser` on a desktop-style install have a range; ones made by
`useradd`, by cloud-init, or as system users often do not.

```sh
grep "^$USER:" /etc/subuid /etc/subgid     # expect one line in each
# if missing:
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$USER"
podman system migrate                      # re-map any existing containers
```

**AppArmor blocking unprivileged user namespaces.** Ubuntu restricts them by
default (`kernel.apparmor_restrict_unprivileged_userns=1`, on since 23.10) and
permits known binaries through a shipped profile. Podman from the Ubuntu archive
is covered; a third-party build or a binary copied in by hand is not, and fails
with `Operation not permitted` on namespace creation — nothing in the error
mentions AppArmor.

```sh
sysctl kernel.apparmor_restrict_unprivileged_userns   # 1 is normal on Ubuntu
```

A `1` is not a problem on its own; only a `1` *together with* a failing
`podman run` is. Do not switch it off to make the error go away — install podman
from the distro archive so its profile applies.

If `systemctl --user` answers `Failed to connect to bus` over SSH:

```sh
export XDG_RUNTIME_DIR=/run/user/$(id -u)
```

### The port has to be free

```sh
ss -ltn "sport = :<port>"
```

Worth checking rather than assuming on any box that already serves something. If
something holds it, change only the **host** side of `PublishPort=` in the unit
— `127.0.0.1:<other>:<port>` — and point the reverse proxy at the same number.
The container side stays whatever the app listens on inside the image.

### DNS has to resolve here already, if you are terminating TLS

```sh
getent hosts <host>             # getent, not dig: a minimal VPS has no dnsutils
curl -fsS https://ifconfig.me; echo      # compare
```

Caddy (or any ACME client) requests a certificate the moment you reload it with
the new site block. If the name does not resolve to this box the challenge fails
and the site serves an error rather than the app.

### The unit file has to be on the box

The server never builds anything and needs exactly one file from the repo:

```sh
scp deploy/<app>.container <server>:      # run this from your laptop
```

A `git clone --depth 1` on the server works too and makes picking up a later
change to the unit a `git pull`. Either way it is only a copy of that one file:
nothing on the server builds from it, and the running service comes from the
image, not from it.

## Setup

### 1. Confirm the registry is reachable with no credentials

```sh
podman pull ghcr.io/<owner>/<app>:latest
```

GHCR packages default to **private even for a public repository**. When that
happens the server gets a 401 on every pull and `podman auto-update` quietly does
nothing — no error on the box, no failed unit, just a version that never changes.
Fix it on the package settings page rather than putting a long-lived read-only
PAT on the server; if the image must stay private, `podman login ghcr.io` works
but you now own a credential to rotate.

This step also pre-pulls, so the first `start` below comes up immediately instead
of racing a download against the unit's start timeout.

### 2. Let the user's units run without a login session

```sh
loginctl enable-linger "$USER"
```

Without this, rootless units stop when the user logs out.

### 3. Install the Quadlet unit

```sh
mkdir -p ~/.config/containers/systemd
cp <app>.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user start <app>
systemctl --user status <app>
```

Quadlet generates the systemd service from the `.container` file, so there is no
unit to hand-write and no `podman generate systemd` output to keep in sync. A
generated unit cannot be `systemctl enable`d — `[Install] WantedBy=default.target`
in the file is what makes it start at boot.

`start` taking about one `HealthInterval` is expected, not a hang: with
`Notify=healthy`, systemd waits for the first passing health check before calling
the unit started.

Then, before wiring up the proxy:

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/
podman inspect --format '{{.State.Health.Status}}' systemd-<app>   # healthy
```

### 4. Point the reverse proxy at it

With Caddy, add to the existing Caddyfile — do not replace it:

```caddy
<host> {
	reverse_proxy 127.0.0.1:<port>
}
```

Then `caddy validate --config /etc/caddy/Caddyfile` and reload.

**Check the existing config for global or site-wide `header` directives first.**
If the container sets its own security headers and the host sets them too, you
get duplicates — and a duplicated `Content-Security-Policy` is *intersected* by
browsers, which breaks pages in ways that look nothing like a header problem.
Likewise, do not add compression on the host if the container already compresses.

### 5. Make auto-update timely

`podman-auto-update.timer` runs **daily** by default, which would mean a deploy
landing up to 24 hours after the merge.

```sh
mkdir -p ~/.config/systemd/user/podman-auto-update.timer.d
cat > ~/.config/systemd/user/podman-auto-update.timer.d/override.conf <<'EOF'
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
EOF
systemctl --user daemon-reload
systemctl --user enable --now podman-auto-update.timer
```

A registry digest check every five minutes is negligible even on one CPU — it is
a `HEAD` request unless something actually changed.

### 6. Keep the disk from filling

Auto-update does not remove the image it superseded.

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

The image this prunes is the one automatic rollback would restore — once
auto-update moves on, the superseded image is untagged and therefore dangling.
Not a conflict in practice, since rollback happens within seconds of a bad update
and this runs weekly, but it does mean the local copy of an older good image is
not something to rely on days later. Keep on-demand rollback registry-side.

## Check the setup took

Every step above fails quietly: the service keeps serving whatever it already
has, no unit fails, nothing is logged, and the only symptom is that a merge never
shows up.

```sh
podman auto-update --dry-run                           # container listed, Updated=false
systemctl --user list-timers podman-auto-update.timer  # NEXT within ~5 min
loginctl show-user "$USER" --property=Linger           # Linger=yes
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/

# Must print --sdnotify=healthy:
systemctl --user show <app> -p ExecStart | grep -o -- '--sdnotify=[a-z]*'
```

`--dry-run` is the most valuable of these and is the direct answer to "is the
running image current?". It walks the same pull path the timer does, so a private
package surfaces as a 401 rather than as silence. `Updated=false` means current;
`pending` means the timer has not run yet.

The `--sdnotify` check is the only one here that is invisible from every other
angle. If it prints `--sdnotify=conmon` — an old podman that does not know the
key, or an edited unit — the service still serves, the container still reports
healthy, `--dry-run` still passes, and the loss shows up exactly once: the day a
broken image ships and stays. Read it from `show -p ExecStart` rather than
`systemctl --user cat`, which includes the unit's comments and so can match the
word in prose as well as in the command line.

`NEXT` showing tomorrow rather than minutes from now means the step 5 drop-in did
not take.

None of this touches the public URL, so passing it does not prove the service is
reachable from outside, and none of it proves the app's actual behaviour. Finish
by exercising the real thing over `https://<host>/`.

## Verifying a deploy

```sh
# Did the timer run, and did it see a new digest?
journalctl --user -u podman-auto-update.service -n 40

# Is the container younger than the merge?
podman ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}'

# Which digest is actually running? Compare against the CI step summary.
podman inspect --format '{{.ImageDigest}}' systemd-<app>
```

The digest is the only value worth comparing — a matching `:latest` proves
nothing, because the tag moves. To force a check instead of waiting:
`podman auto-update --dry-run` shows what would change, `podman auto-update`
does it.

## Proving the rollback works

Worth doing once, on install and after any podman upgrade. Automatic rollback is
the load-bearing claim of this design, and an untested one is indistinguishable
from an absent one.

Break the health check on purpose, in the installed copy of the unit only:

```sh
u=~/.config/containers/systemd/<app>.container
cp "$u" /tmp/<app>.container.bak
sed -i 's|http://127.0.0.1:<port>/|http://127.0.0.1:9/|' "$u"
systemctl --user daemon-reload
time systemctl --user restart <app>       # expect FAILURE
systemctl --user show <app> -p Result     # expect Result=exit-code
```

**A failure is the pass condition.** A non-zero exit with `Result=exit-code` and
`status=137/n/a` in the journal means the gate is working: the check failed
`HealthRetries` times, `HealthOnFailure=kill` took the container down, and the
start failed — which is exactly the signal `podman auto-update` reads to decide
an update failed and restore the previous image. Expect this in seconds, not at
`TimeoutStartSec`; that value is the backstop for an image that hangs instead of
failing.

If `restart` instead returns success in under a second while `podman ps` shows
the container `unhealthy`, the gate is not there and a broken deploy would ship
and stay. Check the `--sdnotify` line above and the podman version.

Restore, stopping cleanly first — skipping `stop`/`reset-failed` makes `restart`
pick up the tail of the failed job and report a failure that looks like the
restore itself not working:

```sh
cp /tmp/<app>.container.bak "$u"
systemctl --user stop <app>
systemctl --user reset-failed <app>
systemctl --user daemon-reload
systemctl --user restart <app>
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/
podman inspect --format '{{.State.Health.Status}}' systemd-<app>   # healthy
```
