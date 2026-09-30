#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# The sample shell (testing-and-build.md, "Layer 3b"): a separate GNOME Shell on
# the extension built from the working tree, with a throwaway home, keyfile
# settings, its own private session bus and one test calendar, so the owner can
# look at it without logging out. `npm run sample` shows it in a window (drawn by
# mutter-devkit); `--check` runs the same setup headless and checks it, as the
# smoke's last step. It never touches the owner's session bus, calendars,
# keyring, dconf, or extensions folder.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ROOT:?}"
source "$ROOT/scripts/isolated-shell.sh"

# 1. Arguments.
if [ "$#" -eq 0 ]; then
    MODE=window
elif [ "$#" -eq 1 ] && [ "$1" = --check ]; then
    MODE=check
else
    echo "usage: bash scripts/sample.sh [--check]" >&2
    echo "  no argument: open the sample shell in a window (npm run sample)" >&2
    echo "  --check:     run it headless and check it (part of npm run smoke)" >&2
    exit 2
fi

# 2. Preflight, before any change.
case "$(gnome-shell --version 2>/dev/null || true)" in
    'GNOME Shell 50.'*) ;;
    *)
        echo "sample: the sample needs GNOME Shell 50 (found: $(gnome-shell --version 2>&1 || echo 'no gnome-shell'))" >&2
        exit 1
        ;;
esac
if [ "$MODE" = window ]; then
    if [ ! -x /usr/libexec/mutter-devkit ]; then
        echo "sample: The sample window needs the mutter-devkit package. Install it once with: sudo dnf install mutter-devkit" >&2
        exit 1
    fi
    if [ -z "${WAYLAND_DISPLAY:-}" ]; then
        echo "sample: run npm run sample from a terminal inside your GNOME session (WAYLAND_DISPLAY is not set)" >&2
        exit 1
    fi
fi

# 3. The home: fresh, in the repository (gnome-extensions install fails across filesystems).
T="$ROOT/.sample-home"
if [ -L "$T" ]; then
    echo "sample: $T is a symlink; refusing to remove or write through it" >&2
    exit 1
fi
rm -rf "$T"
bash "$ROOT/scripts/build.sh"
isolated_install "$T"
mkdir -p "$T/home" "$T/state"

# 4. The calendar: one in-person must-attend meeting ("client" is a built-in
#    important word; a place and no link make it in person). With the default
#    30 min travel, leave-by is S - 30 = now + 9 min, so the heads-up (10 min
#    before leave-by) is due at start and the nudge (5 min before) comes about
#    4 minutes later.
S=$(( $(date +%s) / 60 * 60 + 39 * 60 ))
DTSTART=$(date -u -d "@$S" +%Y%m%dT%H%M%SZ)
DTEND=$(date -u -d "@$(( S + 1800 ))" +%Y%m%dT%H%M%SZ)
printf '%s\r\n' \
    'BEGIN:VCALENDAR' 'VERSION:2.0' 'PRODID:-//payAttention//sample//EN' \
    'BEGIN:VEVENT' \
    'UID:sample-visit@sample.test' 'DTSTAMP:20260101T000000Z' \
    "DTSTART:$DTSTART" "DTEND:$DTEND" \
    'SUMMARY:Client site visit' \
    'LOCATION:Client office\, 1 Example Street' \
    'ORGANIZER:mailto:owner@sample.test' \
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:owner@sample.test' \
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:guest@external.test' \
    'END:VEVENT' 'END:VCALENDAR' \
    | isolated_calendar "$T" sample-cal Sample owner@sample.test

# 5. Shell settings: the extension enabled; the heads-up stays 120 s, the top of
#    its own range, so there is time to look. No Do Not Disturb: the owner sees
#    what they would see.
cat > "$T/config/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$UUID']
welcome-dialog-last-shown-version='999'

[org/gnome/shell/extensions/payattention]
headsup-display-seconds=120
EOF

# 6. No keyring, no portals: the private bus reads $XDG_DATA_HOME/dbus-1/services
#    before the system directories, so these masks win. The Secret Service (and
#    any keyring) never starts, and GTK does not wait for portals on this bus.
mkdir -p "$T/data/dbus-1/services"
for name in org.freedesktop.secrets org.freedesktop.portal.Desktop org.freedesktop.portal.Documents; do
    printf '[D-BUS Service]\nName=%s\nExec=/bin/false\n' "$name" > "$T/data/dbus-1/services/$name.service"
done

# 7. Guard, and clean-up on any exit. The owner's extensions folder is read from
#    the caller's environment, before env -i.
OWNER_EXTENSIONS="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
owner_listing() {
    ls -la --time-style=full-iso "$OWNER_EXTENSIONS" 2>&1 || true
}
BEFORE="$(owner_listing)"
cleanup() {
    local status=$? pattern pids
    pattern="$(printf '%s' "$T/" | sed 's/[][\.*^$()+?{}|]/\\&/g')"
    pids="$(pgrep -f -- "$pattern" || true)"
    if [ -n "$pids" ]; then
        # Unquoted on purpose: one pid per word.
        kill $pids 2>/dev/null || true
        echo "sample: stopped $(wc -w <<< "$pids") leftover process(es) of the sample" >&2
    else
        echo "sample: no leftover process of the sample" >&2
    fi
    if [ "$(owner_listing)" != "$BEFORE" ]; then
        echo "sample: your extensions folder changed during the run" >&2
        exit 1
    fi
    exit "$status"
}
trap cleanup EXIT

# 8. Run.
if [ "$MODE" = check ]; then
    isolated_run "$T" "$T/home" LANG="${LANG:-C.UTF-8}" XDG_STATE_HOME="$T/state" PAYATTENTION_SAMPLE_HOME="$T" -- \
        timeout 120 dbus-run-session -- gnome-shell --headless --virtual-monitor 1280x800 \
            --wayland-display "pa-sample-$$" \
            --automation-script "$ROOT/tests/smoke/sample-check.js" > "$T/shell.log" 2>&1 || true
    grep 'PAYATTENTION-SAMPLE' "$T/shell.log" || true
    if ! grep -q '^PAYATTENTION-SAMPLE PASS' "$T/shell.log" || grep 'JS ERROR' "$T/shell.log"; then
        echo "sample: check FAILED; last 40 lines of $T/shell.log:" >&2
        tail -n 40 "$T/shell.log" >&2
        exit 1
    fi
    echo "sample: check PASS"
    exit 0
fi

cat <<'EOF'
sample: a separate GNOME Shell opens in a window, with one test calendar; your own session is not used.
  - Within about a minute, the heads-up for "Client site visit" shows "Travel: 30 min (default)".
  - Its "Change travel time" button shows the travel choices.
  - The alarm icon in the window's top bar opens the menu; the "Client site visit" row expands to the travel choices.
  - The heads-up stays 120 s here instead of 15 s, so there is time to look.
  - To stop: close the window, or press Ctrl+C here.
EOF
isolated_run "$T" "$T/home" LANG="${LANG:-C.UTF-8}" XDG_STATE_HOME="$T/state" \
    WAYLAND_DISPLAY="$WAYLAND_DISPLAY" GTK_A11Y=none -- \
    dbus-run-session -- gnome-shell --devkit --wayland --wayland-display "pa-sample-$$" > "$T/shell.log" 2>&1
