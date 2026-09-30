#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# The isolation environment for a throwaway gnome-shell on the built extension
# (testing-and-build.md, "Layer 3"). Sourced, never run, by scripts/smoke.sh and
# scripts/sample.sh: it is the one list that keeps a test shell off the owner's
# session bus, settings and data, so it must not be copied inline anywhere else.

: "${ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# The UUID has one source: extension/metadata.json (PG-10).
: "${UUID:=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).uuid' "$ROOT/extension/metadata.json")}"

# Installs dist/<UUID>.shell-extension.zip into <home>/data and creates the XDG directories an isolated shell needs.
# <home> must be a path directly under the repository whose name starts with "." (".smoke-home", ".sample-home").
isolated_install() {
    local home="${1:?isolated_install: usage: isolated_install <home>}"
    local name parent repo zip
    name="$(basename -- "$home")"
    parent="$(cd -- "$(dirname -- "$home")" 2>/dev/null && pwd -P)" || parent=""
    repo="$(cd -- "$ROOT" && pwd -P)"
    if [ "$parent" != "$repo" ] || [ "${name#.}" = "$name" ] || [ "$name" = "." ] || [ "$name" = ".." ]; then
        echo "isolated_install: refusing $home: an isolated home must be a dot directory directly under $repo (like .smoke-home)" >&2
        return 1
    fi
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
    local home="$1" id="$2" name="$3" email="$4"
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

# Runs a command with only the isolated environment, never the caller's.
# isolated_run <home> <user-home> [NAME=value ...] -- command [args ...]
isolated_run() {
    if [ "$#" -lt 2 ]; then
        echo "isolated_run: usage: isolated_run <home> <user-home> [NAME=value ...] -- command [args ...]" >&2
        return 1
    fi
    local home="$1" user_home="$2"
    shift 2
    local extras=() found_separator=0
    while [ "$#" -gt 0 ]; do
        if [ "$1" = "--" ]; then
            found_separator=1
            shift
            break
        fi
        case "$1" in
            DBUS_SESSION_BUS_ADDRESS=* | DISPLAY=* | XDG_CONFIG_HOME=* | XDG_DATA_HOME=* | XDG_CACHE_HOME=* | GSETTINGS_BACKEND=*)
                echo "isolated_run: refusing ${1%%=*}: an isolated shell never takes the caller's bus, X display, or settings and data directories" >&2
                return 1
                ;;
            [A-Za-z_]*=*) extras+=("$1") ;;
            *)
                echo "isolated_run: '$1' is not NAME=value; put the command after --" >&2
                return 1
                ;;
        esac
        shift
    done
    if [ "$found_separator" -ne 1 ] || [ "$#" -eq 0 ]; then
        echo "isolated_run: no command after --; usage: isolated_run <home> <user-home> [NAME=value ...] -- command [args ...]" >&2
        return 1
    fi
    env -i PATH="$PATH" HOME="$user_home" USER="$USER" LOGNAME="${LOGNAME:-$USER}" \
        XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
        XDG_CONFIG_HOME="$home/config" XDG_DATA_HOME="$home/data" XDG_CACHE_HOME="$home/cache" \
        GSETTINGS_BACKEND=keyfile GIO_USE_VFS=local \
        "${extras[@]}" "$@"
}
