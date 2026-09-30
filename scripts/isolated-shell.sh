#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# The isolation environment for a throwaway gnome-shell on the built extension
# (testing-and-build.md, "Layer 3"). Sourced, never run, by scripts/smoke.sh and
# scripts/sample.sh: it is the one list that keeps a test shell off the owner's
# session bus, settings and data, so it must not be copied inline anywhere else.
# It also owns the shell's private session bus, which can start only an
# allowlist of services, and the helpers that prove a run left the owner alone.

: "${ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# The UUID has one source: extension/metadata.json (PG-10).
: "${UUID:=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).uuid' "$ROOT/extension/metadata.json")}"

# The only homes an isolated shell may use.
ISOLATED_HOMES=(.smoke-home .sample-home)
# The only names the private bus can start: what gnome-shell, EDS and ibus activate in the smoke and
# the sample, minus portals, GNOME Online Accounts and org.gnome.Identity. Never a keyring. Copied
# from /usr/share/dbus-1/services by isolated_run; widening it is a safety decision (PG-11).
ISOLATED_BUS_SERVICES=(
    org.gnome.evolution.dataserver.Sources5
    org.gnome.evolution.dataserver.Calendar8
    org.gnome.evolution.dataserver.AddressBook10
    org.gnome.Shell.CalendarServer
    org.gnome.Shell.Notifications
    org.gnome.Shell.Screencast
    org.gnome.Shell.Extensions
    org.freedesktop.impl.portal.PermissionStore
    org.freedesktop.portal.IBus
    org.a11y.Bus
)
# The only NAME=value extras isolated_run accepts.
ISOLATED_RUN_EXTRAS=(LANG WAYLAND_DISPLAY GTK_A11Y PAYATTENTION_SMOKE_HOME PAYATTENTION_SAMPLE_HOME)

# Prints the canonical path of an isolated home, or refuses (stderr, return 1):
# its name must be one of ISOLATED_HOMES, its parent the repository, and it must not be a symlink.
_isolated_home() {
    local home="${1:-}" name parent repo allowed ok=0
    repo="$(cd -- "$ROOT" && pwd -P)"
    name="$(basename -- "$home")"
    parent="$(cd -- "$(dirname -- "$home")" 2>/dev/null && pwd -P)" || parent=""
    for allowed in "${ISOLATED_HOMES[@]}"; do
        [ "$name" = "$allowed" ] && ok=1
    done
    if [ -z "$home" ] || [ "$ok" -ne 1 ] || [ "$parent" != "$repo" ] || [ -L "$home" ]; then
        echo "isolated: refusing $home: an isolated home is $repo/.smoke-home or $repo/.sample-home" >&2
        return 1
    fi
    printf '%s\n' "$repo/$name"
}

# Installs dist/<UUID>.shell-extension.zip into <home>/data and creates the XDG directories an isolated shell needs.
# <home> must be <repository>/.smoke-home or <repository>/.sample-home (ISOLATED_HOMES).
isolated_install() {
    local home zip
    home="$(_isolated_home "${1:-}")" || return 1
    zip="$ROOT/dist/$UUID.shell-extension.zip"
    if [ ! -f "$zip" ]; then
        echo "isolated_install: $zip is missing; run scripts/build.sh first" >&2
        return 1
    fi
    mkdir -p "$home/data/gnome-shell/extensions" "$home/config/glib-2.0/settings" \
        "$home/config/evolution/sources" "$home/cache"
    env -i PATH="$PATH" HOME="$home" XDG_DATA_HOME="$home/data" gnome-extensions install --force "$zip"
}

# Adds one local calendar to <home>: <id> is its directory, <name> its display name, <email> its owner.
# The iCalendar text is read from stdin.
isolated_calendar() {
    if [ "$#" -ne 4 ]; then
        echo "isolated_calendar: usage: isolated_calendar <home> <id> <name> <email> < calendar.ics" >&2
        return 1
    fi
    local home id="$2" name="$3" email="$4"
    home="$(_isolated_home "$1")" || return 1
    if ! [[ "$id" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
        echo "isolated_calendar: refusing id '$id'" >&2
        return 1
    fi
    if [[ "$name$email" == *$'\n'* ]]; then
        echo "isolated_calendar: refusing a name or email with a line break" >&2
        return 1
    fi
    mkdir -p "$home/config/evolution/sources" "$home/data/evolution/calendar/$id"
    cat > "$home/config/evolution/sources/$id.source" <<EOF
[Data Source]
DisplayName=$name
Enabled=true
Parent=local-stub

[Calendar]
BackendName=local
Selected=true

[Local Backend]
EmailAddress=$email
EOF
    cat > "$home/data/evolution/calendar/$id/calendar.ics"
}

# Runs a command in the isolated environment on its own private session bus, which can start only
# ISOLATED_BUS_SERVICES. Never the caller's bus, variables or service directories.
# isolated_run <home> <user-home> [NAME=value ...] -- command [args ...]
isolated_run() {
    if [ "$#" -lt 2 ]; then
        echo "isolated_run: usage: isolated_run <home> <user-home> [NAME=value ...] -- command [args ...]" >&2
        return 1
    fi
    local home user_home="$2"
    home="$(_isolated_home "$1")" || return 1
    shift 2
    case "$user_home" in
        /*) ;;
        *)
            echo "isolated_run: refusing user home '$user_home': it must be an absolute path" >&2
            return 1
            ;;
    esac
    if [ -z "${XDG_RUNTIME_DIR:-}" ]; then
        echo "isolated_run: XDG_RUNTIME_DIR is not set" >&2
        return 1
    fi
    local extras=() found_separator=0 allowed ok arg
    while [ "$#" -gt 0 ]; do
        if [ "$1" = "--" ]; then
            found_separator=1
            shift
            break
        fi
        case "$1" in
            [A-Za-z_]*=*) ;;
            *)
                echo "isolated_run: '$1' is not NAME=value; put the command after --" >&2
                return 1
                ;;
        esac
        ok=0
        for allowed in "${ISOLATED_RUN_EXTRAS[@]}"; do
            [ "${1%%=*}" = "$allowed" ] && ok=1
        done
        if [ "$ok" -ne 1 ]; then
            echo "isolated_run: refusing ${1%%=*}: an isolated shell accepts only ${ISOLATED_RUN_EXTRAS[*]}" >&2
            return 1
        fi
        extras+=("$1")
        shift
    done
    if [ "$found_separator" -ne 1 ] || [ "$#" -eq 0 ]; then
        echo "isolated_run: no command after --; usage: isolated_run <home> <user-home> [NAME=value ...] -- command [args ...]" >&2
        return 1
    fi
    # A nested launcher would start a default bus with every standard service directory.
    for arg in "$@"; do
        case "$(basename -- "$arg")" in
            dbus-run-session | dbus-daemon | dbus-launch | dbus-broker | dbus-broker-launch)
                echo "isolated_run: refusing $arg: isolated_run provides the private bus itself" >&2
                return 1
                ;;
        esac
    done

    # The private bus: one service directory holding copies of the allowlist, and nothing else.
    local name file
    rm -rf "$home/bus"
    mkdir -p "$home/bus/services" "$home/state"
    for name in "${ISOLATED_BUS_SERVICES[@]}"; do
        file="/usr/share/dbus-1/services/$name.service"
        # A name without its system file could not start today either.
        if [ -f "$file" ] && grep -qx "Name=$name" "$file"; then
            cp -- "$file" "$home/bus/services/$name.service"
        fi
    done
    cat > "$home/bus/session.conf" <<'EOF'
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<!-- Written by scripts/isolated-shell.sh: a private session bus that can start only the services in ./services. -->
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:tmpdir=/tmp</listen>
  <auth>EXTERNAL</auth>
  <servicedir>services</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
  <!-- The limits of /usr/share/dbus-1/session.conf, copied verbatim. -->
  <limit name="max_incoming_bytes">1000000000</limit>
  <limit name="max_incoming_unix_fds">250000000</limit>
  <limit name="max_outgoing_bytes">1000000000</limit>
  <limit name="max_outgoing_unix_fds">250000000</limit>
  <limit name="max_message_size">1000000000</limit>
  <limit name="service_start_timeout">120000</limit>
  <limit name="auth_timeout">240000</limit>
  <limit name="pending_fd_timeout">150000</limit>
  <limit name="max_completed_connections">100000</limit>
  <limit name="max_incomplete_connections">10000</limit>
  <limit name="max_connections_per_user">100000</limit>
  <limit name="max_pending_service_starts">10000</limit>
  <limit name="max_names_per_connection">50000</limit>
  <limit name="max_match_rules_per_connection">50000</limit>
  <limit name="max_replies_per_connection">50000</limit>
</busconfig>
EOF
    env -i PATH="$PATH" HOME="$user_home" USER="$USER" LOGNAME="${LOGNAME:-$USER}" \
        XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
        XDG_CONFIG_HOME="$home/config" XDG_DATA_HOME="$home/data" XDG_CACHE_HOME="$home/cache" XDG_STATE_HOME="$home/state" \
        GSETTINGS_BACKEND=keyfile GIO_USE_VFS=local PAYATTENTION_ISOLATED_HOME="$home" \
        "${extras[@]}" dbus-run-session --config-file="$home/bus/session.conf" -- "$@"
}

# Prints a listing of <dir> and everything under it (never its parent), one line per entry; "absent" if <dir> does not exist.
# Two equal listings mean nothing under <dir> was added, removed, replaced, resized or touched.
isolated_snapshot() {
    local dir="${1:?isolated_snapshot: usage: isolated_snapshot <dir>}"
    if [ -e "$dir" ] || [ -L "$dir" ]; then
        # find without -L follows no symlink; <dir> itself is the line with an empty path, so its mtime
        # catches entries added or removed directly under it.
        { find "$dir" -printf '%P\t%y\t%i\t%s\t%T@\t%l\n' 2>&1 || true; } | LC_ALL=C sort
    else
        echo absent
    fi
}

# Stops (SIGTERM) every process of this user whose environment carries <home>'s isolation marker; prints how many.
isolated_stop() {
    local home pid n=0
    home="$(_isolated_home "${1:-}")" || return 1
    for pid in $(pgrep -u "$(id -u)"); do
        # Bus-activated services inherit the marker from dbus-run-session; the owner's own processes never carry it.
        if grep -qzxF "PAYATTENTION_ISOLATED_HOME=$home" "/proc/$pid/environ" 2>/dev/null; then
            kill "$pid" 2>/dev/null && n=$((n + 1))
        fi
    done
    echo "$n"
}
