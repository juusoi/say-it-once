# Replicating this deploy on another app

This directory implements one specific pattern: **GitHub Actions builds an
image, the server pulls it on a timer, and a health check gates the rollback.**
Nothing pushes to the server, so no deploy credential ever leaves GitHub, and a
broken image that still starts does not stay.

The prompt below reproduces that pattern in another repository. It is written
for [Claude Code](https://claude.ai/code) or a comparable coding agent run from
the root of the target repo, and it deliberately makes the agent inspect the
repo and report back *before* writing anything — the shape of the health check,
the volumes and the dependency ordering all depend on what the app actually is,
and an agent that guesses those produces a unit that looks right and silently
does not gate.

Host setup for the resulting unit is in [HOST-SETUP.md](HOST-SETUP.md). For this
app specifically, see [README.md](README.md) — it is the same pattern with the
placeholders filled in, and worth reading alongside whatever the agent produces.

## What the pattern is, in one paragraph

CI builds and pushes two tags: a floating `:latest` and an immutable
`:sha-<commit>`. A rootless podman Quadlet unit on the server runs the image
with `AutoUpdate=registry`, and `podman-auto-update.timer` re-resolves `:latest`
every few minutes and restarts the unit when the digest moves. `Notify=healthy`
makes systemd withhold "started" until the container's health check passes, which
is what lets `podman auto-update` tell a good deploy from a bad one and restore
the previous image. Rollback on demand is a registry-side re-tag of `:latest`
onto an existing `:sha-` tag — no rebuild, no server change.

## The prompt

Everything between the markers goes to the agent verbatim.

<!-- BEGIN PROMPT -->

    Set up a pull-based container deploy for this repo using podman Quadlet and
    `podman auto-update`, with a health check that actually gates rollback.

    **First, interrogate the repo and report what you found before writing
    anything:**

    - Language/runtime, build system, how the app is started
    - What port it listens on, and whether it has a real readiness endpoint
      (`/health`, `/readyz`) or whether the only probe available is `GET /`
    - Whether it needs secrets or env vars, a database, or any dependency that
      must be up first
    - Whether it writes to disk at runtime — this decides `ReadOnly=` and which
      volumes are needed
    - Whether a registry or CI pipeline already exists, and what it publishes
    - Which base image the app will run on, and therefore whether `wget`,
      `curl`, or neither is present for the health command

    Then implement the following. Where a choice depends on what you found
    above, make it and say why.

    ### Containerfile

    Multi-stage if there is a build step. **Do not add a `HEALTHCHECK`
    instruction.** podman builds OCI images by default and silently ignores it
    ("HEALTHCHECK is not supported for OCI image format and will be ignored"),
    which is worse than having none because it reads as protection. The check
    goes in the Quadlet unit.

    ### CI (GitHub Actions)

    Build and push on merge to the default branch, gated on the existing tests.

    - Tag **both** a floating `:latest` and an immutable `:sha-<commit>`.
    - Pin every action to a commit SHA with a trailing `# vX.Y.Z` comment, and
      add `.github/dependabot.yml` for `github-actions` so the pins do not
      freeze. A tag is mutable; `@v4` follows whatever it points at today.
    - Set `provenance: false` on the build-push action. Attestations add extra
      manifests to the image index and some podman versions handle the result
      poorly.
    - Set `persist-credentials: false` on checkout unless a step pushes with git.
    - Print the pushed **digest** to `$GITHUB_STEP_SUMMARY`. The digest is the
      only value worth comparing against the server; a matching `:latest` tag
      proves nothing because the tag moves.

    ### A `workflow_dispatch` rollback job

    Takes a commit-ish and moves `:latest` onto the already-published
    `:sha-<commit>` with `docker buildx imagetools create` — a registry-side
    manifest copy.

    - It must **build nothing**. A dispatch that checks out old code still runs
      the workflow from the default branch, so current lint and test config runs
      against a tree that lacks it, and any commit old enough to be worth
      rolling back to fails. The image it re-tags was already CI-gated when it
      shipped.
    - Resolve the input to a full SHA and verify the **source image exists**
      before touching `:latest`, so a typo fails the run instead of damaging the
      tag the server follows.
    - Pass the input through `env:` rather than interpolating `${{ }}` into a
      `run:` block.
    - `concurrency: {group: release, cancel-in-progress: false}`. Note in the
      docs that queueing means a push-triggered run already waiting will execute
      *after* a rollback and republish what was rolled away from.
    - Record in the step summary that the rollback is temporary: the default
      branch still holds the bad commit, so the next merge publishes over it.

    ### `deploy/<app>.container` — the Quadlet unit

    Rootless, installed to `~/.config/containers/systemd/`. Non-negotiables:

    - **`Image=` must be the floating tag.** `AutoUpdate=registry` works by
      re-resolving the tag name and diffing the digest against the running one.
      A `sha-` tag or a digest always resolves to the same thing, so there is
      nothing to notice and the server stops receiving deploys permanently —
      with no error, no failed unit and nothing in the journal. Write that
      reasoning into a comment above the line.
    - `AutoUpdate=registry`.
    - **`Notify=healthy`** — the one people leave out. Rollback detection
      depends on the container sending READY via SDNOTIFY; podman-auto-update(1)
      says "without that, restarting the systemd unit may succeed even if the
      container has failed shortly after". Quadlet's default is `Notify=false`
      (`--sdnotify=conmon`), which sends READY the moment the container process
      launches, so an unhealthy new image is reported to systemd as a clean
      start and **nothing rolls back**. This key requires podman 5.0+; state
      that as a prerequisite.
    - `HealthCmd=` using a binary that actually exists in the image — `wget` on
      Alpine/BusyBox, `curl` on Debian-slim. Verify, do not assume. Probe the
      real readiness endpoint if the app has one.
    - `HealthInterval` around `10s`. Under `Notify=healthy` this sits on the
      *startup* path: READY arrives at the first passing check, so a 30s
      interval means a 30s start on every deploy and every reboot.
    - `HealthOnFailure=kill` with `[Service] Restart=always`. This does two
      jobs: it recovers a container that started healthy and wedged later, and
      it is what makes a *bad deploy* fail fast — killing the container makes
      `podman run` exit 137, so the start fails with `Result=exit-code` in
      seconds instead of waiting out the start timeout.
    - **`HealthStartPeriod=` sized to the app's real warm-up**, if it has one.
      It suppresses the `starting`→`unhealthy` transition, and
      `HealthOnFailure=kill` acts on exactly that transition — so for anything
      that takes a moment to become ready, omitting it means the first checks
      fail during normal boot, the container is killed, and the unit never comes
      up. Omit it only for something that serves immediately, and say which case
      applies.
    - **`[Service] TimeoutStartSec=` set explicitly.** With `Notify=healthy`
      systemd is never told "unhealthy" — only "READY never arrived" — so
      without a bound, an image that *hangs* rather than failing would sit in
      `activating` and auto-update would never reach its rollback.
      `HealthOnFailure=kill` handles the fail-fast case; this is the backstop,
      and it should not live in an invisible default.
    - `PublishPort=127.0.0.1:<port>:<port>` if a host reverse proxy terminates
      TLS. Never bind `0.0.0.0` for a proxied service.
    - `ReadOnly=true`, `NoNewPrivileges=true`, and a `MemoryMax=` sized to the
      box. Add named volumes for whatever the app genuinely writes — including
      paths the base image writes to on its own, which is easy to miss.
    - **Do not add `DropCapability=ALL` reflexively.** A binary carrying file
      capabilities fails to exec with "Operation not permitted" and the container
      never starts. Rootless podman already gives a restricted default set.
    - No `After=`/`Wants=network-online.target`. That is a system target and this
      is a user unit; systemd cannot order one against the other, and Quadlet
      already orders generated user units after
      `podman-user-wait-network-online.service`.
    - `[Install] WantedBy=default.target`. Note that a Quadlet-generated unit
      cannot be `systemctl enable`d — `[Install]` is how it starts at boot.

    ### `deploy/README.md` — the runbook

    Every step in this design fails **silently**: the service keeps serving
    whatever it already has, no unit fails, nothing is logged, and the only
    symptom is that a merge never shows up. So every step needs a positive
    check, not just an instruction. At minimum:

    ```sh
    podman auto-update --dry-run                      # container listed; a 401 from
                                                      # a private registry surfaces
                                                      # here rather than as silence
    systemctl --user show <app> -p ExecStart \
      | grep -o -- '--sdnotify=[a-z]*'                # must print =healthy.
                                                      # Read ExecStart, not
                                                      # `systemctl cat`: cat
                                                      # includes comments, which
                                                      # may mention conmon too.
    systemctl --user list-timers podman-auto-update.timer
    loginctl show-user "$USER" --property=Linger
    ```

    Also document:

    - `podman-auto-update.timer` is **daily** by default, so a deploy would land
      up to 24 hours after the merge. It needs a drop-in override.
    - `podman image prune` deletes the superseded image, which is the local
      rollback target — which is part of why both on-demand rollback paths are
      registry-side.
    - The prerequisites that fail unreadably on a fresh box: missing
      subuid/subgid ranges, AppArmor restricting unprivileged user namespaces,
      `systemctl --user` needing `XDG_RUNTIME_DIR` over SSH, and the port already
      being taken.
    - **A one-time, reversible drill** that deliberately breaks the health check
      and confirms the unit *fails* rather than reporting success. An untested
      rollback is indistinguishable from an absent one, and this is the claim the
      whole design rests on.
    - What the deploy does *not* prove. A 200 from the health endpoint is not the
      same as the feature working; name the manual check that closes that gap.

    ### Style

    Write comments that explain **why**, especially wherever the failure mode is
    silent — those are the ones a future reader cannot reconstruct from the
    config. Match the repo's existing tone and conventions. Do not add
    speculative configuration.

    Then propose a branch and a PR. Do not commit to the default branch, and do
    not merge without sign-off.

<!-- END PROMPT -->

## Reviewing what comes back

Four things are worth checking by hand, because each one produces a unit that
works in every visible way while the deploy quietly does not:

1. **`Notify=healthy` is present**, and the target podman is 5.0 or newer.
   Without it the health check is decorative.
2. **`Image=` is a floating tag.** A digest or a `sha-` tag means the server
   never updates again.
3. **The health command's binary exists in the image.** `curl` is absent from
   Alpine, `wget` from many slim Debian images. A health command that cannot run
   is a container that never goes healthy, which under `Notify=healthy` means a
   unit that never starts.
4. **`HealthStartPeriod` covers the app's warm-up** if it has one, given that
   `HealthOnFailure=kill` will otherwise kill it during a normal boot.
5. **`TimeoutStartSec` is set explicitly**, and is longer than a healthy start
   but short enough that you are willing to wait it out when an image hangs.

Then run the drill the agent was asked to document, on a real host. Everything
above can be right on paper and still not gate the deploy; a deliberate
health-check failure that makes `systemctl --user start` return non-zero is the
only evidence that it does.
