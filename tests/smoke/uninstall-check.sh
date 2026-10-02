#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

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
# The UUID has one source: extension/metadata.json (PG-10).
UUID="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).uuid' "$ROOT/extension/metadata.json")"

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

# 0. A throwaway keyring, unlocked, before anything can D-Bus-activate one (PG-4b fact 3).
command -v gnome-keyring-daemon >/dev/null || fail 0-keyring "gnome-keyring-daemon is not installed"
printf '%s' payattention-test-unlock | gnome-keyring-daemon --unlock --components=secrets --daemonize >/dev/null \
    || fail 0-keyring "could not start a throwaway keyring"
KEYRING="$ROOT/tests/ai/gjs/keyring.js"
# Throwaway values, never real keys.
KEY1="pa-test-key-$RANDOM$RANDOM$RANDOM"
KEY2="pa-test-key-$RANDOM$RANDOM$RANDOM"
KEY3="pa-test-key-$RANDOM$RANDOM$RANDOM"
# keys <ours> <other>: the keyring holds exactly that many of our items and of the other schema.
keys() { [ "$(gjs -m "$KEYRING" count)" = "KEYRING COUNT $1 $2" ]; }
no_keys_in_output() { ! contains "$KEY1" && ! contains "$KEY2" && ! contains "$KEY3"; }

# 1. A stand-in shell on the private bus, so the scripts' gdbus query sees UNKNOWN
#    (or LOADED for the UUIDs in $LOADED) instead of UNREACHABLE.
LOADED="$U/loaded"
: > "$LOADED"
SHELL_PID=
start_shell() {
    gjs -m "$ROOT/tests/smoke/fake-shell.js" "$LOADED" > "$U/fake-shell.log" 2>&1 &
    SHELL_PID=$!
    for _ in $(seq 100); do
        grep -q '^FAKE-SHELL READY' "$U/fake-shell.log" && return 0
        sleep 0.1
    done
    fail 1-shell "the stand-in shell did not start: $(cat "$U/fake-shell.log")"
}
stop_shell() {
    [ -n "$SHELL_PID" ] || return 0
    kill "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
    SHELL_PID=
}
trap stop_shell EXIT
start_shell

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
# show-test-alert left the schema in PG-13 (data.md "Removed keys"): a stored value is kept by a plain uninstall and erased by --purge.
dconf write "$KEYS/show-test-alert" true || fail 2-install "could not seed show-test-alert"
dconf write "$KEYS/travel-times" "{'hq': 30}" || fail 2-install "could not seed travel-times"
dconf write "$KEYS/meeting-travel-times" "{'series:uninstall-check': 45}" || fail 2-install "could not seed meeting-travel-times"
dconf write "$KEYS/ai-verdicts" "'{\"v\":1,\"items\":{}}'" || fail 2-install "could not seed ai-verdicts"
gjs -m "$KEYRING" store https://engine.example.test/v1 "$KEY1" >/dev/null || fail 2-install "could not seed the first key"
gjs -m "$KEYRING" store http://127.0.0.1:11434/v1 "$KEY2" >/dev/null || fail 2-install "could not seed the second key"
gjs -m "$KEYRING" store-other https://engine.example.test/v1 "$KEY3" >/dev/null || fail 2-install "could not seed the other schema's key"
keys 2 1 || fail 2-install "keyring seed count is wrong"
[ -d "$XDG_DATA_HOME/keyrings" ] || fail 0-keyring "the keyring is not in the throwaway home"

# A wrong argument changes nothing.
uninstall --bogus
no_keys_in_output || fail 2-bad-option "a key appeared in the output"
[ "$status" -eq 2 ] || fail 2-bad-option "--bogus exited $status, want 2"
[ -d "$DIR" ] || fail 2-bad-option "--bogus removed $DIR"

# No shell reachable: uninstall cannot tell whether a shell somewhere has it
# loaded, so it refuses and changes nothing (the files may be in use).
stop_shell
lists_before="$(gsettings get org.gnome.shell enabled-extensions; gsettings get org.gnome.shell disabled-extensions)"
uninstall
no_keys_in_output || fail 2-unreachable "a key appeared in the output"
[ "$status" -eq 1 ] || fail 2-unreachable "exited $status, want 1: $out"
contains "from a terminal inside your GNOME session" || fail 2-unreachable "no 'from a terminal inside your GNOME session' in: $out"
contains "Nothing was changed." || fail 2-unreachable "no 'Nothing was changed.' in: $out"
[ -d "$DIR" ] || fail 2-unreachable "$DIR was removed with no shell reachable"
[ "$(gsettings get org.gnome.shell enabled-extensions; gsettings get org.gnome.shell disabled-extensions)" = "$lists_before" ] \
    || fail 2-unreachable "the extension lists changed"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 2-unreachable "snooze-minutes changed"
start_shell

# Uninstall with a shell that does not know it: files and list entries go, settings stay.
uninstall
no_keys_in_output || fail 2-uninstall "a key appeared in the output"
[ "$status" -eq 0 ] || fail 2-uninstall "exited $status: $out"
[ ! -e "$DIR" ] || fail 2-uninstall "$DIR still exists"
enabled="$(gsettings get org.gnome.shell enabled-extensions)"
[ "$enabled" = "['other@example.test']" ] || fail 2-uninstall "enabled-extensions is $enabled"
disabled="$(gsettings get org.gnome.shell disabled-extensions)"
[ "$disabled" = "['third@example.test']" ] || fail 2-uninstall "disabled-extensions is $disabled"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 2-uninstall "snooze-minutes was not kept"
[ "$(dconf read "$KEYS/show-test-alert")" = true ] || fail 2-uninstall "show-test-alert was not kept"
[ -n "$(dconf read "$KEYS/meeting-travel-times")" ] || fail 2-uninstall "meeting-travel-times was not kept"
[ -f "$OTHER/metadata.json" ] || fail 2-uninstall "another extension's files were removed"
[ "$(dconf read "$OTHER_KEY")" = 1 ] || fail 2-uninstall "$OTHER_KEY was not kept"
contains "Removed: $DIR" || fail 2-uninstall "no 'Removed: $DIR' line"
contains "Kept: saved settings" || fail 2-uninstall "no 'Kept: saved settings' line"
contains "Calendars and other extensions were not touched." || fail 2-uninstall "no closing line"
! contains "Stopped:" || fail 2-uninstall "claimed to stop a shell that is not running"
! contains "Nothing to remove" || fail 2-uninstall "said 'Nothing to remove' after removing the install"
keys 2 1 || fail 2-uninstall "a plain uninstall changed the keyring"
[ -n "$(dconf read "$KEYS/ai-verdicts")" ] || fail 2-uninstall "ai-verdicts was not kept"
contains "Kept: saved settings and AI answers" || fail 2-uninstall "no 'Kept: saved settings and AI answers' line"
contains "Kept: AI engine keys in your keyring" || fail 2-uninstall "no 'Kept: AI engine keys' line"

# A second run succeeds and says there was nothing to remove.
uninstall
no_keys_in_output || fail 2-second-run "a key appeared in the output"
[ "$status" -eq 0 ] || fail 2-second-run "exited $status: $out"
contains "Nothing to remove: payAttention is not installed." || fail 2-second-run "no 'Nothing to remove' line"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 2-second-run "snooze-minutes was not kept"

# 3. --purge refuses when settings live outside dconf, and changes nothing.
status=0
out="$(GSETTINGS_BACKEND=keyfile bash "$ROOT/scripts/uninstall.sh" --purge 2>&1)" || status=$?
printf '%s\n' "$out"
no_keys_in_output || fail 3-purge-refused "a key appeared in the output"
[ "$status" -eq 2 ] || fail 3-purge-refused "exited $status, want 2: $out"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 3-purge-refused "snooze-minutes was erased"
keys 2 1 || fail 3-purge-refused "the keyring changed"

# --purge erases our settings path only.
uninstall --purge
no_keys_in_output || fail 3-purge "a key appeared in the output"
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
keys 0 1 || fail 3-purge "our keys were not all erased, or another schema's item was"
contains "Erased: AI engine keys from your keyring." || fail 3-purge "no 'Erased: AI engine keys' line"
contains "Erased: saved settings and AI answers" || fail 3-purge "no 'Erased: saved settings and AI answers' line"
keys_line="$(printf '%s\n' "$out" | grep -nF "Erased: AI engine keys" | cut -d: -f1)"
settings_line="$(printf '%s\n' "$out" | grep -nF "Erased: saved settings" | cut -d: -f1)"
[ "$keys_line" -lt "$settings_line" ] || fail 3-purge "keys must be erased before settings"

# Purging again is safe.
uninstall --purge
no_keys_in_output || fail 3-purge-again "a key appeared in the output"
[ "$status" -eq 0 ] || fail 3-purge-again "exited $status: $out"
contains "Erased: saved settings" || fail 3-purge-again "no 'Erased: saved settings' line"
contains "Erased: AI engine keys from your keyring." || fail 3-purge-again "no 'Erased: AI engine keys' line"
keys 0 1 || fail 3-purge-again "the keyring is not left with only the other schema's item"

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

# a) The running shell has it loaded but cannot stop it: nothing is removed.
reinstall 4-stop-failed
echo "$UUID" > "$LOADED"
stub stop-failed gnome-extensions 'case "$1" in uninstall) exit 1 ;; *) exit 2 ;; esac'
uninstall_stubbed stop-failed
: > "$LOADED"
no_keys_in_output || fail 4-stop-failed "a key appeared in the output"
[ "$status" -eq 1 ] || fail 4-stop-failed "exited $status, want 1: $out"
contains "Nothing was removed." || fail 4-stop-failed "no 'Nothing was removed.' in: $out"
[ -d "$DIR" ] || fail 4-stop-failed "$DIR was removed although the shell was not stopped"
lists_unchanged || fail 4-stop-failed "the extension lists changed"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 4-stop-failed "snooze-minutes changed"

# b) Uninstall reports success but the shell still has it loaded.
reinstall 4-still-loaded
echo "$UUID" > "$LOADED"
stub still-loaded gnome-extensions 'case "$1" in uninstall) exit 0 ;; *) exit 2 ;; esac'
uninstall_stubbed still-loaded
: > "$LOADED"
no_keys_in_output || fail 4-still-loaded "a key appeared in the output"
[ "$status" -eq 1 ] || fail 4-still-loaded "exited $status, want 1: $out"
contains "still has payAttention loaded" || fail 4-still-loaded "no 'still has payAttention loaded' in: $out"
[ -d "$DIR" ] || fail 4-still-loaded "$DIR was removed while the shell still has it loaded"
lists_unchanged || fail 4-still-loaded "the extension lists changed"

# c) The list edit fails: an error, and no claim that the entries were removed.
reinstall 4-lists-failed
stub lists-failed gjs 'exit 1'
uninstall_stubbed lists-failed
no_keys_in_output || fail 4-lists-failed "a key appeared in the output"
[ "$status" -eq 1 ] || fail 4-lists-failed "exited $status, want 1: $out"
contains "could not remove $UUID from the GNOME extension lists" || fail 4-lists-failed "no 'could not remove' in: $out"
! contains "Removed: $UUID from the" || fail 4-lists-failed "claimed a list entry was removed: $out"

# c') The list edit says it removed the entries but they were not stored.
reinstall 4-lists-not-stored
stub lists-not-stored gjs 'printf "enabled-extensions\ndisabled-extensions\n"'
uninstall_stubbed lists-not-stored
no_keys_in_output || fail 4-lists-not-stored "a key appeared in the output"
[ "$status" -eq 1 ] || fail 4-lists-not-stored "exited $status, want 1: $out"
contains "could not remove $UUID from the GNOME extension lists" || fail 4-lists-not-stored "no 'could not remove' in: $out"
! contains "Removed: $UUID from the" || fail 4-lists-not-stored "claimed a list entry was removed before checking it was stored: $out"

# d) --purge cannot erase the settings.
reinstall 4-purge-failed
stub purge-failed dconf "[ \"\$1\" = reset ] && exit 1; exec '$REAL_DCONF' \"\$@\""
uninstall_stubbed purge-failed --purge
no_keys_in_output || fail 4-purge-failed "a key appeared in the output"
[ "$status" -eq 1 ] || fail 4-purge-failed "exited $status, want 1: $out"
contains "could not erase $KEYS/" || fail 4-purge-failed "no 'could not erase' in: $out"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 4-purge-failed "snooze-minutes was erased"
! contains "Erased: saved settings" || fail 4-purge-failed "claimed the settings were erased: $out"
contains "Erased: AI engine keys from your keyring." || fail 4-purge-failed "no 'Erased: AI engine keys' line: $out"

# e) --purge cannot reach the keyring: it stops before erasing the settings.
reinstall 4-keyring-unreachable
gjs -m "$KEYRING" store https://engine.example.test/v1 "$KEY1" >/dev/null || fail 4-keyring-unreachable "could not seed"
REAL_GJS="$(command -v gjs)"
# Fails only the gjs run whose program mentions Secret, so the list step still works.
stub keyring-unreachable gjs "case \"\$*\" in *Secret*) exit 1 ;; esac; exec '$REAL_GJS' \"\$@\""
uninstall_stubbed keyring-unreachable --purge
no_keys_in_output || fail 4-keyring-unreachable "a key appeared in the output"
[ "$status" -eq 1 ] || fail 4-keyring-unreachable "exited $status, want 1: $out"
contains "could not reach your keyring to erase the AI engine keys" || fail 4-keyring-unreachable "no 'could not reach your keyring' in: $out"
contains "Saved settings were not erased." || fail 4-keyring-unreachable "no 'Saved settings were not erased.' in: $out"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 4-keyring-unreachable "snooze-minutes was erased"
! contains "Erased:" || fail 4-keyring-unreachable "claimed something was erased: $out"
keys 1 1 || fail 4-keyring-unreachable "the keyring changed"

# f) --purge with a locked keyring: nothing is erased. Last case: the keyring stays locked.
reinstall 4-keyring-locked
gjs -m "$KEYRING" store https://engine.example.test/v1 "$KEY1" >/dev/null || fail 4-keyring-locked "could not seed"
gjs -m "$KEYRING" lock >/dev/null || fail 4-keyring-locked "could not lock the keyring"
uninstall --purge
no_keys_in_output || fail 4-keyring-locked "a key appeared in the output"
[ "$status" -eq 1 ] || fail 4-keyring-locked "exited $status, want 1: $out"
contains "your keyring is locked" || fail 4-keyring-locked "no 'your keyring is locked' in: $out"
contains "Saved settings were not erased." || fail 4-keyring-locked "no 'Saved settings were not erased.' in: $out"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 4-keyring-locked "snooze-minutes was erased"
! contains "Erased:" || fail 4-keyring-locked "claimed something was erased: $out"
keys 1 1 || fail 4-keyring-locked "the keyring changed"

# 5. Former copies (PG-10, testing-and-build.md "Switching an existing install to
#    the new UUID"). Placeholder UUIDs only: former copies are found by schema.
EXTDIR="$XDG_DATA_HOME/gnome-shell/extensions"
FORMER=payattention@former.example.test
FORMER2=payattention@earlier.example.test
DECOY=payattention@decoy.example.test
LINK=payattention@link.example.test
LINK_TARGET="$U/link-target"
# plant <uuid> <settings-schema>: a minimal installed copy declaring that schema.
plant() {
    mkdir -p "$EXTDIR/$1" || fail 5-seed "could not create $EXTDIR/$1"
    printf '{"uuid": "%s", "settings-schema": "%s"}\n' "$1" "$2" > "$EXTDIR/$1/metadata.json"
    echo 'export default class {}' > "$EXTDIR/$1/extension.js"
}
# Runs install.sh; sets $status and $out.
install_run() {
    status=0
    out="$(bash "$ROOT/scripts/install.sh" "$@" 2>&1)" || status=$?
    printf '%s\n' "$out"
}
lists() { gsettings get org.gnome.shell enabled-extensions; gsettings get org.gnome.shell disabled-extensions; }
SCHEMA=org.gnome.shell.extensions.payattention

uninstall >/dev/null
plant "$FORMER" "$SCHEMA"
plant "$FORMER2" "$SCHEMA"
plant "$DECOY" org.example.other
mkdir -p "$LINK_TARGET"
printf '{"uuid": "%s", "settings-schema": "%s"}\n' "$LINK" "$SCHEMA" > "$LINK_TARGET/metadata.json"
ln -sfn "$LINK_TARGET" "$EXTDIR/$LINK"
gsettings set org.gnome.shell enabled-extensions "['other@example.test', '$FORMER']" || fail 5-seed "could not seed enabled-extensions"
gsettings set org.gnome.shell disabled-extensions "['third@example.test', '$FORMER2']" || fail 5-seed "could not seed disabled-extensions"
decoys_untouched() {
    [ -f "$EXTDIR/$DECOY/metadata.json" ] && [ -L "$EXTDIR/$LINK" ] && [ -f "$LINK_TARGET/metadata.json" ]
}

# a) No shell reachable: install refuses before the build and changes nothing.
stop_shell
lists_before="$(lists)"
install_run
[ "$status" -eq 1 ] || fail 5-install-unreachable "exited $status, want 1: $out"
contains "must be switched over from a terminal inside your GNOME session" || fail 5-install-unreachable "no 'must be switched over' in: $out"
contains "Nothing was changed." || fail 5-install-unreachable "no 'Nothing was changed.' in: $out"
! contains "Built " || fail 5-install-unreachable "it built before refusing: $out"
[ -d "$EXTDIR/$FORMER" ] && [ -d "$EXTDIR/$FORMER2" ] || fail 5-install-unreachable "a former copy was removed"
[ ! -e "$DIR" ] || fail 5-install-unreachable "$DIR was installed"
[ "$(lists)" = "$lists_before" ] || fail 5-install-unreachable "the extension lists changed"

# b) No shell reachable: uninstall refuses too.
uninstall
[ "$status" -eq 1 ] || fail 5-uninstall-unreachable "exited $status, want 1: $out"
contains "must be switched over from a terminal inside your GNOME session" || fail 5-uninstall-unreachable "no 'must be switched over' in: $out"
contains "Nothing was changed." || fail 5-uninstall-unreachable "no 'Nothing was changed.' in: $out"
[ -d "$EXTDIR/$FORMER" ] && [ -d "$EXTDIR/$FORMER2" ] || fail 5-uninstall-unreachable "a former copy was removed"
[ "$(lists)" = "$lists_before" ] || fail 5-uninstall-unreachable "the extension lists changed"
start_shell

# c) The list edit claims success but stores nothing: the former copies stay
#    enabled and installed, never removed while a list still names them.
stub swap-not-stored gjs 'exit 0'
status=0
out="$(PATH="$STUBS/swap-not-stored:$PATH" bash "$ROOT/scripts/install.sh" 2>&1)" || status=$?
printf '%s\n' "$out"
[ "$status" -eq 1 ] || fail 5-swap-not-stored "exited $status, want 1: $out"
contains "could not switch the GNOME extension lists" || fail 5-swap-not-stored "no 'could not switch' in: $out"
[ -d "$EXTDIR/$FORMER" ] && [ -d "$EXTDIR/$FORMER2" ] || fail 5-swap-not-stored "a former copy was removed"
! contains "earlier payAttention install (" || fail 5-swap-not-stored "claimed a removal: $out"

# d) A shell that does not know the former copies: one install switches over.
install_run
[ "$status" -eq 0 ] || fail 5-switch "exited $status: $out"
[ ! -e "$EXTDIR/$FORMER" ] && [ ! -e "$EXTDIR/$FORMER2" ] || fail 5-switch "a former copy remains"
[ -f "$DIR/schemas/gschemas.compiled" ] || fail 5-switch "no compiled schemas in $DIR"
enabled="$(gsettings get org.gnome.shell enabled-extensions)"
[ "$enabled" = "['other@example.test', '$UUID']" ] || fail 5-switch "enabled-extensions is $enabled"
disabled="$(gsettings get org.gnome.shell disabled-extensions)"
[ "$disabled" = "['third@example.test']" ] || fail 5-switch "disabled-extensions is $disabled"
decoys_untouched || fail 5-switch "a copy declaring another schema, or a symlink, was touched"
[ -f "$OTHER/metadata.json" ] || fail 5-switch "another extension's files were removed"
[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ] || fail 5-switch "snooze-minutes was not kept"
contains "Removed: an earlier payAttention install ($EXTDIR/$FORMER)." || fail 5-switch "no removal line for $FORMER: $out"
contains "Removed: an earlier payAttention install ($EXTDIR/$FORMER2)." || fail 5-switch "no removal line for $FORMER2: $out"
contains "log out and back in" || fail 5-switch "no 'log out and back in' in: $out"

# e) A second install finds no former copy.
install_run
[ "$status" -eq 0 ] || fail 5-second-install "exited $status: $out"
! contains "earlier payAttention install" || fail 5-second-install "found a former copy again: $out"
[ "$(gsettings get org.gnome.shell enabled-extensions)" = "['other@example.test', '$UUID']" ] \
    || fail 5-second-install "enabled-extensions changed"

# f) The shell has a former copy loaded but refuses to uninstall it (the stand-in
#    serves no UninstallExtension): the lists are already switched, the files stay.
plant "$FORMER" "$SCHEMA"
gsettings set org.gnome.shell enabled-extensions "['other@example.test', '$FORMER']" || fail 5-seed "could not seed enabled-extensions"
echo "$FORMER" > "$LOADED"
install_run
: > "$LOADED"
[ "$status" -eq 1 ] || fail 5-loaded-refused "exited $status, want 1: $out"
contains "refused to uninstall it" || fail 5-loaded-refused "no 'refused to uninstall it' in: $out"
[ -d "$EXTDIR/$FORMER" ] || fail 5-loaded-refused "the files of a loaded copy were removed"
[ "$(gsettings get org.gnome.shell enabled-extensions)" = "['other@example.test', '$UUID']" ] \
    || fail 5-loaded-refused "enabled-extensions is $(gsettings get org.gnome.shell enabled-extensions)"

# g) Uninstall removes a former copy the shell does not know, with the current install.
uninstall
[ "$status" -eq 0 ] || fail 5-uninstall "exited $status: $out"
[ ! -e "$EXTDIR/$FORMER" ] || fail 5-uninstall "the former copy remains"
[ ! -e "$DIR" ] || fail 5-uninstall "$DIR remains"
[ "$(gsettings get org.gnome.shell enabled-extensions)" = "['other@example.test']" ] \
    || fail 5-uninstall "enabled-extensions is $(gsettings get org.gnome.shell enabled-extensions)"
contains "Removed: an earlier payAttention install ($EXTDIR/$FORMER)." || fail 5-uninstall "no removal line: $out"
decoys_untouched || fail 5-uninstall "a copy declaring another schema, or a symlink, was touched"

# 6. The developer copy (PG-13, ADR-0013): install:developer puts the marker in the installed
#    metadata.json; install:local replaces the whole directory with the normal copy.
install_run --bogus
[ "$status" -eq 2 ] || fail 6-bad-option "exited $status, want 2: $out"
contains "unknown option '--bogus'. Nothing was changed." || fail 6-bad-option "no 'unknown option' in: $out"
! contains "Built " || fail 6-bad-option "it built before refusing: $out"
[ ! -e "$DIR" ] || fail 6-bad-option "$DIR was installed"

install_run --developer
[ "$status" -eq 0 ] || fail 6-developer "exited $status: $out"
node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(m["payattention-developer"] === true ? 0 : 1)' "$DIR/metadata.json" \
    || fail 6-developer "the installed metadata.json has no payattention-developer: true"
contains "This is the developer copy" || fail 6-developer "no 'This is the developer copy' in: $out"
gsettings get org.gnome.shell enabled-extensions | grep -qF "'$UUID'" || fail 6-developer "$UUID is not in enabled-extensions"
# A file the normal bundle lacks: the normal install must not leave it behind.
touch "$DIR/only-in-an-earlier-copy"

install_run
[ "$status" -eq 0 ] || fail 6-back-to-normal "exited $status: $out"
! grep -q payattention-developer "$DIR/metadata.json" || fail 6-back-to-normal "the installed metadata.json still has the marker"
[ ! -e "$DIR/only-in-an-earlier-copy" ] || fail 6-back-to-normal "a file of the developer copy was left behind"
contains "Replaced the developer copy" || fail 6-back-to-normal "no 'Replaced the developer copy' in: $out"

install_run
[ "$status" -eq 0 ] || fail 6-normal-again "exited $status: $out"
! contains "Replaced the developer copy" || fail 6-normal-again "claimed to replace a developer copy: $out"

echo PAYATTENTION-UNINSTALL PASS
