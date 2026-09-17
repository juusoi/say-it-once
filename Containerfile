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

# No HEALTHCHECK here on purpose. podman builds OCI images by default and
# silently ignores the instruction ("HEALTHCHECK is not supported for OCI
# image format and will be ignored"), which is worse than having none: it
# looks like protection that is not there.
#
# The check is declared in deploy/say-it-once.container instead, where it
# always runs regardless of image format -- and, crucially, where it sits next
# to the Notify=healthy that makes podman auto-update actually roll back on a
# failed one. Declaring the check is only half of it; without that key a
# container that starts and then fails its check is still reported to systemd
# as a successful start. The unit comments spell this out.
