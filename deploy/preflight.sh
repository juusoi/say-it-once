#!/bin/sh
# Check that this server will actually receive deploys.
#
# Every failure this script looks for is silent: the site keeps serving the
# version it already has, no unit fails, nothing is logged, and the only
# symptom is that a merge to main never shows up. Run it after the one-time
# setup in README.md, and any time you are not sure the running version is
# current.
#
#   ./preflight.sh                 check the container, unit and timer
#   ./preflight.sh game.example.com also check the public URL
#
# Exits 0 if every check passed (warnings are allowed), 1 if any check failed.

set -u

UNIT_PATH="${UNIT_PATH:-$HOME/.config/containers/systemd/say-it-once.container}"
SERVICE="${SERVICE:-say-it-once.service}"
CONTAINER="${CONTAINER:-systemd-say-it-once}"
PUBLIC_HOST="${1:-}"

fails=0
warns=0

ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; warns=$((warns + 1)); }
fail() { printf '  FAIL  %s\n' "$*"; fails=$((fails + 1)); }
note() { printf '        %s\n' "$*"; }
head_() { printf '\n%s\n' "$*"; }

# Last value of an uncommented "Key=" line. The leading anchor is what makes a
# commented-out "# AutoUpdate=registry" correctly read as absent -- which is
# exactly the state an old-style pinned rollback used to leave behind.
unit_value() {
	sed -n "s/^[[:space:]]*$1=[[:space:]]*\\(.*\\)\$/\\1/p" "$UNIT_PATH" | tail -n 1
}

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- environment

head_ 'Environment'

for tool in podman systemctl loginctl curl; do
	if have "$tool"; then
		ok "$tool is available"
	else
		fail "$tool not found -- this script expects the deploy host (rootless podman + systemd)"
	fi
done

if [ "$(id -u)" = 0 ]; then
	warn 'running as root; the deploy is meant to be rootless under a normal user'
else
	ok "running as non-root user $(id -un)"
fi

# ----------------------------------------------------------------- the unit

head_ "Quadlet unit ($UNIT_PATH)"

if [ ! -f "$UNIT_PATH" ]; then
	fail 'unit file not found -- see the install step in README.md'
	IMAGE=''
	AUTOUPDATE=''
	PUBLISH=''
else
	ok 'unit file present'
	IMAGE=$(unit_value Image)
	AUTOUPDATE=$(unit_value AutoUpdate)
	PUBLISH=$(unit_value PublishPort)
fi

# The check this whole script exists for. AutoUpdate=registry works by
# re-resolving the *same tag name* and comparing digests, so it can only ever
# fire against a tag that moves. A sha-<commit> tag points at one build for
# ever and its digest never changes, so a unit pinned to one stops receiving
# deploys permanently, without any error.
if [ -z "$IMAGE" ]; then
	[ -f "$UNIT_PATH" ] && fail 'no Image= in the unit'
else
	image_name=${IMAGE##*/}
	case "$IMAGE" in
	*@sha256:*)
		fail "Image= is pinned to a digest, which can never update: $IMAGE"
		note 'auto-update needs a floating tag. Use :latest.'
		;;
	*)
		case "$image_name" in
		*:sha-*)
			fail "Image= is pinned to a commit tag, which can never update: $IMAGE"
			note 'A sha-<commit> tag always resolves to the same digest, so'
			note 'auto-update has nothing to notice. Use :latest, and roll back'
			note 'with the Release workflow instead -- see README.md.'
			;;
		*:latest | *:main)
			ok "Image= uses a floating tag: $IMAGE"
			;;
		*:*)
			warn "Image= tag is not one of the known floating tags: $IMAGE"
			note 'Fine if that tag is one you republish; deploys never arrive if not.'
			;;
		*)
			warn "Image= has no explicit tag, so it means :latest: $IMAGE"
			;;
		esac
		;;
	esac
fi

if [ "$AUTOUPDATE" = registry ]; then
	ok 'AutoUpdate=registry is set'
elif [ -z "$AUTOUPDATE" ]; then
	[ -f "$UNIT_PATH" ] && fail 'AutoUpdate=registry is missing or commented out -- nothing will ever update'
else
	fail "AutoUpdate is '$AUTOUPDATE', expected 'registry'"
fi

# ------------------------------------------------------------------- service

head_ 'Service'

if ! have systemctl; then
	fail 'cannot check the service without systemctl'
elif systemctl --user is-active --quiet "$SERVICE" 2>/dev/null; then
	ok "$SERVICE is active"
else
	fail "$SERVICE is not active: $(systemctl --user is-active "$SERVICE" 2>&1)"
fi

if have loginctl; then
	linger=$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null || true)
	if [ "$linger" = yes ]; then
		ok 'linger is enabled, so units survive logout'
	else
		fail "linger is not enabled (Linger=${linger:-unknown}) -- everything stops when you log out"
		note "fix: loginctl enable-linger $(id -un)"
	fi
fi

if have podman; then
	if ! podman container exists "$CONTAINER" 2>/dev/null; then
		fail "container $CONTAINER does not exist"
	else
		health=$(podman inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || true)
		case "$health" in
		healthy) ok "container $CONTAINER is healthy" ;;
		'')
			warn "container $CONTAINER has no health status"
			note 'Without a health check, auto-update cannot roll back a bad image.'
			note 'HealthCmd= belongs in the unit: podman builds OCI images by default'
			note 'and silently ignores a HEALTHCHECK baked into the Containerfile.'
			;;
		*) fail "container $CONTAINER health is '$health'" ;;
		esac
	fi
fi

# --------------------------------------------------------------------- timer

head_ 'Auto-update timer'

if ! have systemctl; then
	fail 'cannot check the timer without systemctl'
else
	if systemctl --user is-enabled --quiet podman-auto-update.timer 2>/dev/null; then
		ok 'podman-auto-update.timer is enabled'
	else
		fail 'podman-auto-update.timer is not enabled -- deploys will never arrive'
		note 'fix: systemctl --user enable --now podman-auto-update.timer'
	fi

	if systemctl --user is-active --quiet podman-auto-update.timer 2>/dev/null; then
		ok 'podman-auto-update.timer is active'
	else
		fail 'podman-auto-update.timer is not active'
	fi

	# Upstream ships OnCalendar=daily. The README adds a drop-in with
	# OnUnitActiveSec, which shows up as a monotonic timer -- so an empty
	# TimersMonotonic means the drop-in is not in effect and a merge can take
	# up to a day to land.
	monotonic=$(systemctl --user show podman-auto-update.timer --property=TimersMonotonic --value 2>/dev/null || true)
	if [ -n "$monotonic" ]; then
		ok 'timer has a monotonic interval, so the drop-in is in effect'
		next=$(systemctl --user show podman-auto-update.timer --property=NextElapseUSecMonotonic --value 2>/dev/null || true)
		[ -n "$next" ] && note "next monotonic elapse: $next"
	else
		warn 'timer is on the daily default -- a merge can take up to 24h to arrive'
		note 'see the timer drop-in step in README.md'
	fi
fi

# ------------------------------------------------------------------ currency

head_ 'Is the running image current?'

# `podman auto-update --dry-run` is podman's own answer to "would anything
# change?", and it exercises the same path the timer does -- including the
# registry pull. That makes it the check that catches a private GHCR package
# too: a 401 surfaces here as an error rather than as silence.
#
# It only reports on containers carrying the autoupdate label, so it is
# meaningless unless the service is actually running. Treated accordingly.
if ! have podman; then
	fail 'cannot check currency without podman'
elif ! systemctl --user is-active --quiet "$SERVICE" 2>/dev/null; then
	warn 'skipped: the service is not running, so there is nothing to compare'
else
	dry=$(podman auto-update --dry-run --format '{{.Image}} {{.Updated}}' 2>&1)
	dry_status=$?
	if [ "$dry_status" -ne 0 ]; then
		fail 'podman auto-update --dry-run failed'
		note "$dry"
		note 'A 401 here means the GHCR package is private; see README.md.'
	elif [ -z "$dry" ]; then
		warn 'auto-update reports no candidates at all'
		note 'Expected at least one row for this container. Check AutoUpdate= above.'
	else
		printf '%s\n' "$dry" | while read -r img updated; do
			case "$updated" in
			false | "") printf '  ok    up to date: %s\n' "$img" ;;
			*) printf '  WARN  update pending for %s -- the timer has not run yet\n' "$img" ;;
			esac
		done
		# The subshell above cannot change our counters; re-test for the summary.
		if printf '%s\n' "$dry" | grep -qv ' false$'; then
			warns=$((warns + 1))
		fi
	fi
fi

# ------------------------------------------------------------------- serving

head_ 'Serving'

addr='127.0.0.1'
port='8080'
if [ -n "$PUBLISH" ]; then
	# e.g. 127.0.0.1:8080:8080 -> addr 127.0.0.1, host port 8080
	case "$PUBLISH" in
	*:*:*)
		addr=${PUBLISH%%:*}
		rest=${PUBLISH#*:}
		port=${rest%%:*}
		;;
	*:*) port=${PUBLISH%%:*} ;;
	esac
fi

if ! have curl; then
	fail 'cannot check serving without curl'
else
	code=$(curl -s -o /dev/null -w '%{http_code}' "http://$addr:$port/" 2>/dev/null || true)
	if [ "$code" = 200 ]; then
		ok "http://$addr:$port/ returns 200"
	else
		fail "http://$addr:$port/ returned '${code:-no response}'"
	fi

	if [ -n "$PUBLIC_HOST" ]; then
		code=$(curl -s -o /dev/null -w '%{http_code}' "https://$PUBLIC_HOST/" 2>/dev/null || true)
		if [ "$code" = 200 ]; then
			ok "https://$PUBLIC_HOST/ returns 200"
		else
			fail "https://$PUBLIC_HOST/ returned '${code:-no response}' -- check the host Caddy site block"
		fi
	else
		note 'public URL not checked; pass a hostname to include it'
		note 'A green run without one does not mean the site is reachable.'
	fi
fi

# ------------------------------------------------------------------- summary

head_ 'Summary'
if [ "$fails" -gt 0 ]; then
	printf '  %d failed, %d warning(s)\n\n' "$fails" "$warns"
	exit 1
fi
printf '  all checks passed, %d warning(s)\n\n' "$warns"
exit 0
