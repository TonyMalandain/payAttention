#!/usr/bin/env bash
# The smoke test (testing-and-build.md, layer 3): a GJS store check, then a
# headless gnome-shell with two virtual monitors, its own D-Bus session, its
# own XDG directories and one fixture calendar written here. It never touches
# the owner's calendars, settings or session bus.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ROOT:?}"
UUID=payattention@tonymalandain.github.io
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

# 2. Isolated home with the built extension installed.
mkdir -p "$T/data/gnome-shell/extensions" "$T/config/glib-2.0/settings" "$T/config/evolution/sources" \
    "$T/data/evolution/calendar/smoke-cal" "$T/cache"
XDG_DATA_HOME="$T/data" gnome-extensions install --force "$ROOT/dist/$UUID.shell-extension.zip"

# 3. The fixture calendar: one must-attend online meeting 2-3 h ahead, so no
#    real step fires during the run.
cat > "$T/config/evolution/sources/smoke-cal.source" <<'EOF'
[Data Source]
DisplayName=Smoke
Enabled=true
Parent=local-stub

[Calendar]
BackendName=local
Selected=true

[Local Backend]
EmailAddress=owner@smoke.test
EOF
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
    'END:VEVENT' 'END:VCALENDAR' \
    > "$T/data/evolution/calendar/smoke-cal/calendar.ics"

# 4. Shell settings: the extension enabled, and Do Not Disturb on (R-12).
cat > "$T/config/glib-2.0/settings/keyfile" <<'EOF'
[org/gnome/shell]
enabled-extensions=['payattention@tonymalandain.github.io']
welcome-dialog-last-shown-version='999'

[org/gnome/desktop/notifications]
show-banners=false
EOF

# 5. The headless shell, with a minimal environment: never the caller's, which
#    carries the real DBUS_SESSION_BUS_ADDRESS, WAYLAND_DISPLAY and DISPLAY.
env -i PATH="$PATH" HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" LANG=C.UTF-8 \
    XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    XDG_CONFIG_HOME="$T/config" XDG_DATA_HOME="$T/data" XDG_CACHE_HOME="$T/cache" \
    GSETTINGS_BACKEND=keyfile GIO_USE_VFS=local PAYATTENTION_SMOKE_HOME="$T" \
    timeout 300 dbus-run-session -- gnome-shell --headless \
        --virtual-monitor 1280x720 --virtual-monitor 1024x768 \
        --wayland-display "pa-smoke-$$" \
        --automation-script "$ROOT/tests/smoke/alert-ladder.js" > "$T/shell.log" 2>&1 || true

grep 'PAYATTENTION-' "$T/shell.log" || true

fail=0
grep -q '^PAYATTENTION-SMOKE PASS' "$T/shell.log" || fail=1
if grep -E -e 'JS ERROR' -e 'JS WARNING.*payattention' \
        -e 'payattention: (tick-failed|destroy-failed|grab-failed|protocol-mismatch|helper-spawn-failed)' \
        -e 'payattention-helper: (registry-failed|helper-failed)' "$T/shell.log"; then
    fail=1
fi
if [ "$fail" -ne 0 ]; then
    echo "smoke: FAILED; last 80 lines of $T/shell.log:" >&2
    tail -n 80 "$T/shell.log" >&2
    exit 1
fi
echo "smoke: PASS"
