#!/usr/bin/env bash
# Install and uninstall check for scripts/smoke.sh: runs scripts/install.sh and
# scripts/uninstall.sh in a throwaway home under .smoke-home/, with its own
# D-Bus session, XDG directories and dconf database (the real dconf mechanism,
# no GSETTINGS_BACKEND override). It never reaches the owner's session bus,
# dconf database or ~/.local/share.
# Usage: bash tests/smoke/uninstall-check.sh <absolute dir under .smoke-home/>
# Prints PAYATTENTION-UNINSTALL PASS, or PAYATTENTION-UNINSTALL FAIL <check>: <reason>.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${ROOT:?}"
UUID=payattention@tonymalandain.github.io

fail() {
    echo "PAYATTENTION-UNINSTALL FAIL $1: $2"
    exit 1
}

if [ "${1:-}" != "--inner" ]; then
    U="${1:-}"
    case "$U" in
        "$ROOT/.smoke-home/"?*) ;;
        *) fail 0-isolation "'$U' is not an absolute path under $ROOT/.smoke-home/" ;;
    esac
    case "/$U/" in
        */../*|*/./*) fail 0-isolation "'$U' contains . or .. components" ;;
    esac
    rm -rf "$U"
    mkdir -p "$U"/{home,data,config,cache}
    mkdir -m 700 "$U/run"
    exec env -i PATH="$PATH" LANG=C.UTF-8 HOME="$U/home" \
        XDG_DATA_HOME="$U/data" XDG_CONFIG_HOME="$U/config" XDG_CACHE_HOME="$U/cache" XDG_RUNTIME_DIR="$U/run" \
        PAYATTENTION_UNINSTALL_HOME="$U" \
        timeout 180 dbus-run-session -- bash "$0" --inner
fi

# Inner part: a fresh environment and a private session bus.
U="${PAYATTENTION_UNINSTALL_HOME:-}"
[ -n "$U" ] || fail 0-isolation "PAYATTENTION_UNINSTALL_HOME is not set"
[ "$HOME" = "$U/home" ] || fail 0-isolation "HOME is $HOME"
[ "$XDG_DATA_HOME" = "$U/data" ] || fail 0-isolation "XDG_DATA_HOME is $XDG_DATA_HOME"
[ "$XDG_CONFIG_HOME" = "$U/config" ] || fail 0-isolation "XDG_CONFIG_HOME is $XDG_CONFIG_HOME"
[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || fail 0-isolation "no private session bus"

DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
OTHER="$XDG_DATA_HOME/gnome-shell/extensions/other@example.test"
KEYS=/org/gnome/shell/extensions/payattention
OTHER_KEY=/org/gnome/shell/extensions/payattention-other/kept

# Runs uninstall.sh with the given arguments; sets $status and $out (stdout and stderr).
uninstall() {
    status=0
    out="$(bash "$ROOT/scripts/uninstall.sh" "$@" 2>&1)" || status=$?
    printf '%s\n' "$out"
}
contains() { printf '%s\n' "$out" | grep -qF -- "$1"; }

# 2. Other extensions and settings that uninstall must leave alone.
gsettings set org.gnome.shell enabled-extensions "['other@example.test']" || fail 2-seed "could not seed enabled-extensions"
gsettings set org.gnome.shell disabled-extensions "['third@example.test']" || fail 2-seed "could not seed disabled-extensions"
dconf write "$OTHER_KEY" 1 || fail 2-seed "could not seed $OTHER_KEY"
mkdir -p "$OTHER" && echo '{}' > "$OTHER/metadata.json" || fail 2-seed "could not create $OTHER"

# Install into the isolated data directory.
bash "$ROOT/scripts/install.sh" || fail 2-install "install.sh exited $?"
[ -f "$DIR/schemas/gschemas.compiled" ] || fail 2-install "no compiled schemas in $DIR"
gsettings get org.gnome.shell enabled-extensions | grep -qF "'$UUID'" \
    || fail 2-install "$UUID is not in enabled-extensions"
gsettings set org.gnome.shell disabled-extensions "['third@example.test', '$UUID']" \
    || fail 2-install "could not add $UUID to disabled-extensions"
dconf write "$KEYS/snooze-minutes" 5 || fail 2-install "could not seed snooze-minutes"
dconf write "$KEYS/travel-times" "{'hq': 30}" || fail 2-install "could not seed travel-times"

# A wrong argument changes nothing.
uninstall --bogus
[ "$status" -eq 2 ] || fail 2-bad-option "--bogus exited $status, want 2"
[ -d "$DIR" ] || fail 2-bad-option "--bogus removed $DIR"

# Uninstall with no shell on the bus: files and list entries go, settings stay.
uninstall
[ "$status" -eq 0 ] || fail 2-uninstall "exited $status: $out"
[ ! -e "$DIR" ] || fail 2-uninstall "$DIR still exists"
enabled="$(gsettings get org.gnome.shell enabled-extensions)"
[ "$enabled" = "['other@example.test']" ] || fail 2-uninstall "enabled-extensions is $enabled"
disabled="$(gsettings get org.gnome.shell disabled-extensions)"
[ "$disabled" = "['third@example.test']" ] || fail 2-uninstall "disabled-extensions is $disabled"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 2-uninstall "snooze-minutes was not kept"
[ -f "$OTHER/metadata.json" ] || fail 2-uninstall "another extension's files were removed"
[ "$(dconf read "$OTHER_KEY")" = 1 ] || fail 2-uninstall "$OTHER_KEY was not kept"
contains "Removed: $DIR" || fail 2-uninstall "no 'Removed: $DIR' line"
contains "Kept: saved settings" || fail 2-uninstall "no 'Kept: saved settings' line"
contains "Calendars and other extensions were not touched." || fail 2-uninstall "no closing line"
! contains "Stopped:" || fail 2-uninstall "claimed to stop a shell that is not running"
! contains "Nothing to remove" || fail 2-uninstall "said 'Nothing to remove' after removing the install"

# A second run succeeds and says there was nothing to remove.
uninstall
[ "$status" -eq 0 ] || fail 2-second-run "exited $status: $out"
contains "Nothing to remove: payAttention is not installed." || fail 2-second-run "no 'Nothing to remove' line"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 2-second-run "snooze-minutes was not kept"

# 3. --purge refuses when settings live outside dconf, and changes nothing.
status=0
out="$(GSETTINGS_BACKEND=keyfile bash "$ROOT/scripts/uninstall.sh" --purge 2>&1)" || status=$?
printf '%s\n' "$out"
[ "$status" -eq 2 ] || fail 3-purge-refused "exited $status, want 2: $out"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 3-purge-refused "snooze-minutes was erased"

# --purge erases our settings path only.
uninstall --purge
[ "$status" -eq 0 ] || fail 3-purge "exited $status: $out"
left="$(dconf dump "$KEYS/")"
[ -z "$left" ] || fail 3-purge "settings remain: $left"
[ "$(dconf read "$OTHER_KEY")" = 1 ] || fail 3-purge "$OTHER_KEY was erased"
enabled="$(gsettings get org.gnome.shell enabled-extensions)"
[ "$enabled" = "['other@example.test']" ] || fail 3-purge "enabled-extensions is $enabled"
disabled="$(gsettings get org.gnome.shell disabled-extensions)"
[ "$disabled" = "['third@example.test']" ] || fail 3-purge "disabled-extensions is $disabled"
contains "Erased: saved settings" || fail 3-purge "no 'Erased: saved settings' line"
! contains "Kept:" || fail 3-purge "printed 'Kept:' with --purge"

# Purging again is safe.
uninstall --purge
[ "$status" -eq 0 ] || fail 3-purge-again "exited $status: $out"
contains "Erased: saved settings" || fail 3-purge-again "no 'Erased: saved settings' line"

# 4. Failure paths. Each case puts stub commands first on PATH for one
#    uninstall.sh run only, inside this isolated environment, after a clean
#    install with settings and both list entries restored.
REAL_DCONF="$(command -v dconf)"
STUBS="$U/stubs"

# stub <case> <command> <body>: writes an executable $STUBS/<case>/<command>.
stub() {
    mkdir -p "$STUBS/$1"
    printf '#!/usr/bin/env bash\n%s\n' "$3" > "$STUBS/$1/$2"
    chmod +x "$STUBS/$1/$2"
}
# Runs uninstall.sh with $STUBS/<case> first on PATH; sets $status and $out.
uninstall_stubbed() {
    local dir="$STUBS/$1"
    shift
    status=0
    out="$(PATH="$dir:$PATH" bash "$ROOT/scripts/uninstall.sh" "$@" 2>&1)" || status=$?
    printf '%s\n' "$out"
}
# A clean install, with the UUID in both lists and saved settings; records the lists.
reinstall() {
    bash "$ROOT/scripts/install.sh" >/dev/null || fail "$1" "install.sh failed"
    gsettings set org.gnome.shell disabled-extensions "['third@example.test', '$UUID']" \
        || fail "$1" "could not add $UUID to disabled-extensions"
    dconf write "$KEYS/snooze-minutes" 5 || fail "$1" "could not seed snooze-minutes"
    [ -d "$DIR" ] || fail "$1" "no install at $DIR"
    lists_before="$(gsettings get org.gnome.shell enabled-extensions; gsettings get org.gnome.shell disabled-extensions)"
}
lists_unchanged() {
    [ "$(gsettings get org.gnome.shell enabled-extensions; gsettings get org.gnome.shell disabled-extensions)" = "$lists_before" ]
}

# a) The running shell knows it but cannot stop it: nothing is removed.
reinstall 4-stop-failed
stub stop-failed gnome-extensions 'case "$1" in info) exit 0 ;; uninstall) exit 1 ;; *) exit 2 ;; esac'
uninstall_stubbed stop-failed
[ "$status" -eq 1 ] || fail 4-stop-failed "exited $status, want 1: $out"
contains "Nothing was removed." || fail 4-stop-failed "no 'Nothing was removed.' in: $out"
[ -d "$DIR" ] || fail 4-stop-failed "$DIR was removed although the shell was not stopped"
lists_unchanged || fail 4-stop-failed "the extension lists changed"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 4-stop-failed "snooze-minutes changed"

# b) Uninstall reports success but the shell still has it loaded.
reinstall 4-still-loaded
stub still-loaded gnome-extensions 'case "$1" in info|uninstall) exit 0 ;; *) exit 2 ;; esac'
uninstall_stubbed still-loaded
[ "$status" -eq 1 ] || fail 4-still-loaded "exited $status, want 1: $out"
contains "still has payAttention loaded" || fail 4-still-loaded "no 'still has payAttention loaded' in: $out"
[ -d "$DIR" ] || fail 4-still-loaded "$DIR was removed while the shell still has it loaded"
lists_unchanged || fail 4-still-loaded "the extension lists changed"

# c) The list edit fails: an error, and no claim that the entries were removed.
reinstall 4-lists-failed
stub lists-failed gjs 'exit 1'
uninstall_stubbed lists-failed
[ "$status" -eq 1 ] || fail 4-lists-failed "exited $status, want 1: $out"
contains "could not remove $UUID from the GNOME extension lists" || fail 4-lists-failed "no 'could not remove' in: $out"
! contains "Removed: $UUID from the" || fail 4-lists-failed "claimed a list entry was removed: $out"

# c') The list edit says it removed the entries but they were not stored.
reinstall 4-lists-not-stored
stub lists-not-stored gjs 'printf "enabled-extensions\ndisabled-extensions\n"'
uninstall_stubbed lists-not-stored
[ "$status" -eq 1 ] || fail 4-lists-not-stored "exited $status, want 1: $out"
contains "could not remove $UUID from the GNOME extension lists" || fail 4-lists-not-stored "no 'could not remove' in: $out"
! contains "Removed: $UUID from the" || fail 4-lists-not-stored "claimed a list entry was removed before checking it was stored: $out"

# d) --purge cannot erase the settings.
reinstall 4-purge-failed
stub purge-failed dconf "[ \"\$1\" = reset ] && exit 1; exec '$REAL_DCONF' \"\$@\""
uninstall_stubbed purge-failed --purge
[ "$status" -eq 1 ] || fail 4-purge-failed "exited $status, want 1: $out"
contains "could not erase $KEYS/" || fail 4-purge-failed "no 'could not erase' in: $out"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 4-purge-failed "snooze-minutes was erased"
! contains "Erased:" || fail 4-purge-failed "claimed the settings were erased: $out"

echo PAYATTENTION-UNINSTALL PASS
