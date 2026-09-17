# The 1 GB / 1 CPU server never builds anything: GitHub Actions builds this
# image, pushes it to ghcr.io, and the server only ever pulls a finished
# artefact. See deploy/README.md.
FROM docker.io/library/caddy:2-alpine

COPY deploy/Caddyfile /etc/caddy/Caddyfile

# Fail the build on a Caddyfile syntax error rather than the deploy.
RUN caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile

COPY index.html /srv/index.html
COPY css/ /srv/css/
COPY js/ /srv/js/

EXPOSE 8080

# No HEALTHCHECK here on purpose, but not because the instruction would be
# dropped. An earlier version of this comment claimed podman builds OCI images
# by default and silently ignores HEALTHCHECK. That is true of `podman build`,
# and irrelevant here: this image is built by BuildKit via
# docker/build-push-action (see .github/workflows/release.yml), which records
# the instruction, and the server's podman would honour it on pull. Do not
# reinstate that reasoning -- it argues against a risk this pipeline does not
# run.
#
# The check is declared in deploy/say-it-once.container for two reasons that
# hold whatever built the image:
#
#   1. Quadlet's HealthCmd= overrides an image-level check. Declaring both
#      gives two sources of truth where the unit silently wins, which is
#      strictly worse than one.
#   2. Everything that gives the check teeth is unit-only: Notify=healthy,
#      HealthOnFailure=kill, the interval and retries, TimeoutStartSec. Split
#      the command away from those and "does this gate the deploy?" takes two
#      files to answer.
#
# Notify=healthy is the load-bearing half. Without it a container that starts
# and then fails its check is still reported to systemd as a successful start,
# so auto-update never rolls back. The unit comments spell this out.
#
# An in-image HEALTHCHECK is the better choice for an image that is also run
# by something that does not carry this unit -- compose, bare `podman run`, a
# different host. This one has exactly one consumer.
