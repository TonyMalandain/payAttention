#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# The smoke test (testing-and-build.md, layer 3): a GJS store check, an
# install/uninstall check in a throwaway home with its own dconf, then a
# headless gnome-shell with two virtual monitors, its own D-Bus session, its
# own XDG directories and one fixture calendar written here. It never touches
# the owner's calendars, settings or session bus.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ROOT:?}"
# The UUID has one source: extension/metadata.json (PG-10).
UUID="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).uuid' "$ROOT/extension/metadata.json")"
source "$ROOT/scripts/isolated-shell.sh"
# On the home filesystem, never /tmp: gnome-extensions install fails across filesystems.
T="$ROOT/.smoke-home"
rm -rf "$T"

bash "$ROOT/scripts/build.sh"

# 1. Store check, against the real compiled schema and a memory backend.
mkdir -p "$T/schemas"
glib-compile-schemas --targetdir="$T/schemas" "$ROOT/extension/schemas"
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 GSETTINGS_SCHEMA_DIR="$T/schemas" GSETTINGS_BACKEND=memory \
    gjs -m "$ROOT/tests/smoke/store-check.js" | tee "$T/store.log"
if ! grep -q '^PAYATTENTION-STORE PASS' "$T/store.log"; then
    echo "smoke: store check failed" >&2
    exit 1
fi

# 1b. Install and uninstall, in their own home, bus and dconf database.
bash "$ROOT/tests/smoke/uninstall-check.sh" "$T/uninstall" 2>&1 | tee "$T/uninstall.log" || true
if ! grep -q '^PAYATTENTION-UNINSTALL PASS' "$T/uninstall.log"; then
    echo "smoke: uninstall check failed" >&2
    exit 1
fi

# 2. Isolated home with the built extension installed.
isolated_install "$T"

# 2b. The isolation environment itself: throwaway homes only, allowlisted extras,
#     a private bus that can start no keyring, a guard and a clean-up that work.
bash "$ROOT/tests/smoke/isolation-check.sh" "$T" 2>&1 | tee "$T/isolation.log" || true
if ! grep -q '^PAYATTENTION-ISOLATION PASS' "$T/isolation.log"; then
    echo "smoke: isolation check failed" >&2
    exit 1
fi

# 3. The fixture calendar: one must-attend online meeting 2-3 h ahead, so no
#    real step fires during the run, and two all-day events, which are always in
#    today's menu (whatever the hour) and never alert: one for the menu check,
#    one in person for the travel marks check.
S=$(( ( $(date +%s) / 3600 + 3 ) * 3600 ))
DTSTART=$(date -u -d "@$S" +%Y%m%dT%H%M%SZ)
DTEND=$(date -u -d "@$(( S + 1800 ))" +%Y%m%dT%H%M%SZ)
printf '%s\r\n' \
    'BEGIN:VCALENDAR' 'VERSION:2.0' 'PRODID:-//payAttention//smoke//EN' \
    'BEGIN:VEVENT' \
    'UID:smoke-client@smoke.test' 'DTSTAMP:20260101T000000Z' \
    "DTSTART:$DTSTART" "DTEND:$DTEND" \
    'SUMMARY:Smoke client review' \
    'ORGANIZER:mailto:owner@smoke.test' \
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:owner@smoke.test' \
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:guest@external.test' \
    'END:VEVENT' \
    'BEGIN:VEVENT' \
    'UID:smoke-allday@smoke.test' 'DTSTAMP:20260101T000000Z' \
    "DTSTART;VALUE=DATE:$(date +%Y%m%d)" "DTEND;VALUE=DATE:$(date -d tomorrow +%Y%m%d)" \
    'SUMMARY:Smoke all-day check' \
    'END:VEVENT' \
    'BEGIN:VEVENT' \
    'UID:smoke-site@smoke.test' 'DTSTAMP:20260101T000000Z' \
    "DTSTART;VALUE=DATE:$(date +%Y%m%d)" "DTEND;VALUE=DATE:$(date -d tomorrow +%Y%m%d)" \
    'SUMMARY:Smoke all-day site visit' \
    'LOCATION:Smoke site\, 1 Example Street' \
    'END:VEVENT' 'END:VCALENDAR' \
    | isolated_calendar "$T" smoke-cal Smoke owner@smoke.test

# 4. Shell settings: the extension enabled, and Do Not Disturb on (R-12).
cat > "$T/config/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$UUID']
welcome-dialog-last-shown-version='999'

[org/gnome/desktop/notifications]
show-banners=false
EOF

# 5. The headless shell, with a minimal environment: never the caller's, which
#    carries the real DBUS_SESSION_BUS_ADDRESS, WAYLAND_DISPLAY and DISPLAY.
#    isolated_run provides the private session bus.
isolated_run "$T" "$HOME" LANG=C.UTF-8 PAYATTENTION_SMOKE_HOME="$T" -- \
    timeout 300 gnome-shell --headless \
        --virtual-monitor 960x540 --virtual-monitor 1024x768 \
        --wayland-display "pa-smoke-$$" \
        --automation-script "$ROOT/tests/smoke/alert-ladder.js" > "$T/shell.log" 2>&1 || true

grep 'PAYATTENTION-' "$T/shell.log" || true

fail=0
grep -q '^PAYATTENTION-SMOKE PASS' "$T/shell.log" || fail=1
# "already disposed" anywhere: its stack trace often names only shell files (a menu
# item destroyed during its own activate() did).
if grep -E -e 'JS ERROR' -e 'JS WARNING.*payattention' -e 'has been already disposed' \
        -e 'payattention: (tick-failed|destroy-failed|grab-failed|protocol-mismatch|helper-spawn-failed|ai-failed|ai-protocol-mismatch|ai-spawn-failed)' \
        -e 'payattention-helper: (registry-failed|helper-failed)' "$T/shell.log"; then
    fail=1
fi
# Any other Gjs-CRITICAL whose line or stack trace (up to the next blank line) names our files.
if awk '/Gjs-CRITICAL/ { inblock = 1; block = "" }
        inblock { block = block $0 "\n" }
        inblock && /^$/ { if (block ~ /payattention/) { printf "%s", block; found = 1 } inblock = 0 }
        END { if (inblock && block ~ /payattention/) { printf "%s", block; found = 1 } exit !found }' "$T/shell.log"; then
    fail=1
fi
if [ "$fail" -ne 0 ]; then
    echo "smoke: FAILED; last 80 lines of $T/shell.log:" >&2
    tail -n 80 "$T/shell.log" >&2
    exit 1
fi
# Last: the sample shell's headless check (Layer 3b), so its fixture and settings cannot rot unseen.
bash "$ROOT/scripts/sample.sh" --check || { echo "smoke: sample check failed" >&2; exit 1; }
echo "smoke: PASS"
