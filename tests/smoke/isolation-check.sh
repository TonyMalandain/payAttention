#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# Isolation check for scripts/smoke.sh: proves that scripts/isolated-shell.sh
# writes only into the throwaway homes, accepts only its allowlisted extras,
# always runs the command on its own private session bus, that this bus can
# start only ISOLATED_BUS_SERVICES and no keyring, and that its snapshot and
# clean-up helpers see what they must and kill nothing they did not start.
# It never activates a D-Bus service: it only lists names.
# Usage: bash tests/smoke/isolation-check.sh <repository>/.smoke-home
# Prints PAYATTENTION-ISOLATION PASS, or PAYATTENTION-ISOLATION FAIL <check>: <reason>.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${ROOT:?}"

fail() {
    echo "PAYATTENTION-ISOLATION FAIL $1: $2"
    exit 1
}

[ "${1:-}" = "$ROOT/.smoke-home" ] || fail 0-usage "usage: bash tests/smoke/isolation-check.sh $ROOT/.smoke-home (got '${1:-}')"
H="$1"
source "$ROOT/scripts/isolated-shell.sh"

PROBE="$ROOT/.isolation-probe"
trap 'rm -rf "$ROOT/.isolation-probe"' EXIT
rm -rf "$PROBE"

# Every name that starts a keyring daemon on this machine (measured on Fedora 44,
# /usr/share/dbus-1/services). None may ever be startable on the private bus.
KEYRING_NAMES=(org.freedesktop.secrets org.gnome.keyring org.freedesktop.impl.portal.Secret
    org.kde.secretservicecompat org.freedesktop.impl.portal.desktop.kwallet org.kde.kwalletd5 org.kde.kwalletd6)

# refuses <command...>: the command returns non-zero and says "refusing" on stderr.
refuses() {
    local err status=0
    err="$("$@" 2>&1 >/dev/null)" || status=$?
    [ "$status" -ne 0 ] && grep -q refusing <<< "$err"
}
# in_list <word> <list...>: the word is one of the list.
in_list() {
    local word="$1" item
    shift
    for item in "$@"; do
        [ "$item" = "$word" ] && return 0
    done
    return 1
}

# 0. Only the throwaway homes can be written.
refuses isolated_install "$PROBE" || fail 0-refuse-home "isolated_install accepted $PROBE"
[ ! -e "$PROBE" ] || fail 0-refuse-home "isolated_install wrote into $PROBE"
refuses isolated_install "$HOME/.smoke-home" || fail 0-refuse-home "isolated_install accepted $HOME/.smoke-home"
refuses isolated_install "$ROOT/.git" || fail 0-refuse-home "isolated_install accepted $ROOT/.git"
printf x | refuses isolated_calendar "$PROBE" c N e@example.test \
    || fail 0-refuse-home "isolated_calendar accepted $PROBE"
printf x | refuses isolated_calendar "$H" ../x N e@example.test \
    || fail 0-refuse-home "isolated_calendar accepted the id ../x"
refuses isolated_run "$PROBE" "$H/home" -- true || fail 0-refuse-home "isolated_run accepted $PROBE"
[ ! -e "$PROBE" ] || fail 0-refuse-home "a refused call wrote into $PROBE"

# 1. No extra can override what isolated_run sets, and no nested bus is allowed.
for NAME in PATH HOME USER LOGNAME XDG_RUNTIME_DIR XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME \
        XDG_DATA_DIRS GSETTINGS_BACKEND GIO_USE_VFS DBUS_SESSION_BUS_ADDRESS DISPLAY PAYATTENTION_ISOLATED_HOME \
        PAYATTENTION_OTHER; do
    if isolated_run "$H" "$H/home" "$NAME=/x" -- true > /dev/null 2>&1; then
        fail 1-extras "isolated_run accepted the extra $NAME"
    fi
done
if isolated_run "$H" "$H/home" -- timeout 5 dbus-run-session -- true > /dev/null 2>&1; then
    fail 1-extras "isolated_run accepted a nested dbus-run-session"
fi

# 2. The command is on a private bus, never the owner's. No bus is called here.
addr="$(isolated_run "$H" "$H/home" -- sh -c 'printf %s "${DBUS_SESSION_BUS_ADDRESS:-}"')" \
    || fail 2-private-bus "isolated_run failed"
[ -n "$addr" ] || fail 2-private-bus "no DBUS_SESSION_BUS_ADDRESS: the command would reach \$XDG_RUNTIME_DIR/bus"
[ "$addr" != "unix:path=$XDG_RUNTIME_DIR/bus" ] || fail 2-private-bus "the command is on the owner's session bus"

# 3. The private bus can start only the allowlist. Listing names starts nothing.
declare -p ISOLATED_BUS_SERVICES > /dev/null 2>&1 || fail 3-allowlist "ISOLATED_BUS_SERVICES is not defined"
names="$(isolated_run "$H" "$H/home" -- sh -c 'exec gdbus call --address "$DBUS_SESSION_BUS_ADDRESS" --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.ListActivatableNames' \
    | grep -o "'[^']*'" | tr -d "'")" || fail 3-allowlist "could not list the private bus's activatable names"
for name in $names; do
    [ "$name" = org.freedesktop.DBus ] || in_list "$name" "${ISOLATED_BUS_SERVICES[@]}" \
        || fail 3-allowlist "the private bus can start $name, which is not in ISOLATED_BUS_SERVICES"
done
in_list org.gnome.evolution.dataserver.Sources5 $names \
    || fail 3-allowlist "the private bus cannot start org.gnome.evolution.dataserver.Sources5 (empty copy?)"

# 4. No keyring: no keyring name is allowed or startable, and no copied file runs a keyring program.
for name in "${KEYRING_NAMES[@]}"; do
    ! in_list "$name" "${ISOLATED_BUS_SERVICES[@]}" || fail 4-no-keyring "$name is in ISOLATED_BUS_SERVICES"
    ! in_list "$name" $names || fail 4-no-keyring "the private bus can start $name"
done
if found="$(grep -lE 'gnome-keyring-daemon|ksecretd|kwalletd' "$H/bus/services"/*.service 2>/dev/null)"; then
    fail 4-no-keyring "a copied service file starts a keyring: $found"
fi

# 5. The command sees the isolated environment and no display.
envs="$(isolated_run "$H" "$H/home" LANG=C.UTF-8 -- env)" || fail 5-environment "isolated_run failed"
for line in "HOME=$H/home" "XDG_CONFIG_HOME=$H/config" "XDG_STATE_HOME=$H/state" "PAYATTENTION_ISOLATED_HOME=$H"; do
    grep -qxF -- "$line" <<< "$envs" || fail 5-environment "no '$line'"
done
! grep -qE '^(DISPLAY|WAYLAND_DISPLAY)=' <<< "$envs" || fail 5-environment "a display was passed through"

# 6. The snapshot sees every change under a folder, and none of its parent's.
declare -F isolated_snapshot > /dev/null || fail 6-snapshot "isolated_snapshot is not defined"
P="$H/snapshot-probe"
rm -rf "$P"
mkdir -p "$P/share/extensions/a@example.test"
echo '{}' > "$P/share/extensions/a@example.test/metadata.json"
s1="$(isolated_snapshot "$P/share/extensions")"
sleep 1
touch "$P/share/application_state"
[ "$(isolated_snapshot "$P/share/extensions")" = "$s1" ] || fail 6-snapshot "a change to the parent folder changed the listing"
touch "$P/share/extensions/a@example.test/metadata.json"
s2="$(isolated_snapshot "$P/share/extensions")"
[ "$s2" != "$s1" ] || fail 6-snapshot "touching a file under the folder did not change the listing"
mkdir "$P/share/extensions/b@example.test"
[ "$(isolated_snapshot "$P/share/extensions")" != "$s2" ] || fail 6-snapshot "a new folder did not change the listing"
[ "$(isolated_snapshot "$P/none")" = absent ] || fail 6-snapshot "a missing folder is not 'absent'"
rm -rf "$P"

# 7. Clean-up stops what isolated_run started and nothing else, even with the home in its command line.
declare -F isolated_stop > /dev/null || fail 7-stop "isolated_stop is not defined"
isolated_run "$H" "$H/home" -- sleep 60 &
bash -c "sleep 61; : $H/probe" 2>/dev/null &
unmarked=$!
sleep 1
n="$(isolated_stop "$H")"
[ "$n" -ge 1 ] || fail 7-stop "isolated_stop stopped $n processes, want at least 1"
sleep 1
n="$(isolated_stop "$H")"
[ "$n" = 0 ] || fail 7-stop "a second isolated_stop stopped $n processes, want 0"
kill -0 "$unmarked" 2>/dev/null || fail 7-stop "isolated_stop killed a process without the marker"
pkill -P "$unmarked" 2>/dev/null || true
kill "$unmarked" 2>/dev/null || true
wait

echo "PAYATTENTION-ISOLATION PASS"
