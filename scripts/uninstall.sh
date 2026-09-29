#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# Removes payAttention from the owner's session: stops it in the running shell
# (the shell runs its disable() before it answers), removes its install
# directory, and takes its UUID out of org.gnome.shell enabled-extensions and
# disabled-extensions. Saved settings (including the stored AI answers) and any
# AI engine keys in the keyring are kept unless --purge is given, which erases
# /org/gnome/shell/extensions/payattention/ and the keyring items of
# payAttention's own key schema, and nothing else. Earlier installs under a
# former UUID are removed too (testing-and-build.md, "Switching an existing
# install to the new UUID"). With no shell reachable it refuses, because a
# shell it cannot see may hold the files.
# It never touches calendars, other extensions, or any other setting.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The UUID has one source: extension/metadata.json (PG-10).
UUID="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).uuid' "$ROOT/extension/metadata.json")"
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
SETTINGS_PATH=/org/gnome/shell/extensions/payattention/
# The libsecret schema of the AI engine keys: ENGINE_KEY_SCHEMA_NAME in extension/core/aiEngine.js (ADR-0009).
# A shell script cannot import it; tests/smoke/uninstall-check.sh proves the two agree.
KEY_SCHEMA=org.gnome.shell.extensions.payattention.EngineKey
USAGE='Usage: npm run uninstall:local [-- --purge]'

die() {
    echo "uninstall: $1" >&2
    exit 1
}

# a. Arguments, all checked before anything changes.
purge=0
for arg in "$@"; do
    case "$arg" in
        --purge) purge=1 ;;
        -h|--help) echo "$USAGE"; exit 0 ;;
        *) echo "uninstall: unknown option '$arg'. Nothing was changed." >&2; echo "$USAGE" >&2; exit 2 ;;
    esac
done
if [ "$purge" -eq 1 ] && [ -n "${GSETTINGS_BACKEND:-}" ] && [ "$GSETTINGS_BACKEND" != dconf ]; then
    echo "uninstall: --purge erases the dconf database, but GSETTINGS_BACKEND=$GSETTINGS_BACKEND keeps settings elsewhere. Nothing was changed." >&2
    exit 2
fi

# shell_state and the former-copy rule, shared with install.sh.
source "$ROOT/scripts/extension-state.sh"

did=0
removed_dir=0

# b. Preflight: earlier installs under a former UUID are removed on every
#    uninstall (program files, not user data); refuse while any cannot be checked.
formers="$(former_copies)" || die "could not look for an earlier payAttention install in $EXT. Nothing was changed."
mapfile -t FORMERS <<< "$formers"
[ -n "${FORMERS[0]:-}" ] || FORMERS=()
refuse_if_unreachable "${FORMERS[@]}"

# What the running shell knows of it. With no shell reachable, a shell
#    elsewhere may still hold these files, so nothing is removed.
state="$(shell_state "$UUID")"
if [ "$state" = UNREACHABLE ] && [ -e "$DIR" ]; then
    die "cannot tell whether a running session has payAttention loaded. Run this from a terminal inside your GNOME session. Nothing was changed."
fi

# c. Stop it in the running shell. uninstall is the one call that runs
#    disable() before it returns; disable only changes the lists and lets the
#    shell act later.
existed=0
[ -e "$DIR" ] && existed=1
if [ "$state" = LOADED ]; then
    gnome-extensions uninstall "$UUID" >/dev/null 2>&1 \
        || die "could not stop payAttention in the running session (gnome-extensions uninstall failed). Nothing was removed. Log out and in, then run this again."
    if [ "$(shell_state "$UUID")" != UNKNOWN ]; then
        die "the running session still has payAttention loaded after uninstall."
    fi
    echo "Stopped: payAttention in the running session."
    did=1
    if [ "$existed" -eq 1 ]; then
        echo "Removed: $DIR"
        removed_dir=1
    fi
fi

# d. Remove the files, if no shell did. The shell does not know them, so they are not in use.
if [ -e "$DIR" ]; then
    case "$DIR" in
        /*/gnome-shell/extensions/"$UUID") ;;
        *) die "refusing to remove '$DIR': it is not a payAttention install directory." ;;
    esac
    rm -rf -- "$DIR"
    if [ "$removed_dir" -eq 0 ]; then
        echo "Removed: $DIR"
        did=1
    fi
fi
for former in "${FORMERS[@]}"; do
    remove_former "$former"
    did=1
done

# e. Take the UUID, and every former UUID, out of both lists in one write. The
#    shell leaves them in enabled-extensions. Prints each list that held the UUID.
#    A failure here is caught by the check below, in a fresh process.
changed="$(gjs -c "const {Gio} = imports.gi; const s = new Gio.Settings({schema_id: 'org.gnome.shell'});
  const [u, ...former] = ARGV;
  for (const key of ['enabled-extensions', 'disabled-extensions']) {
    const list = s.get_strv(key);
    s.set_strv(key, list.filter(x => x !== u && !former.includes(x)));
    if (list.includes(u)) print(key);
  }
  Gio.Settings.sync();" "$UUID" "${FORMERS[@]}")" || changed=''
# Safe to discard a failed edit: the check below reads both lists again and
# stops if any of the UUIDs is still in either.
lists="$(gsettings get org.gnome.shell enabled-extensions && gsettings get org.gnome.shell disabled-extensions)" \
    || die "could not remove $UUID from the GNOME extension lists. Run this from a terminal inside your GNOME session."
for u in "$UUID" "${FORMERS[@]}"; do
    [[ "$lists" != *"'$u'"* ]] \
        || die "could not remove $u from the GNOME extension lists. Run this from a terminal inside your GNOME session."
done
# Reported only now that the removal is known to be stored.
while IFS= read -r key; do
    case "$key" in
        enabled-extensions) echo "Removed: $UUID from the enabled extensions."; did=1 ;;
        disabled-extensions) echo "Removed: $UUID from the disabled extensions."; did=1 ;;
    esac
done <<< "$changed"

if [ "$did" -eq 0 ]; then
    echo "Nothing to remove: payAttention is not installed."
fi

# f. Saved settings. The trailing slash makes the reset an exact directory:
#    /org/gnome/shell/extensions/payattention-other/ is not touched.
if [ "$purge" -eq 1 ]; then
    # Keys first: a locked keyring then leaves keys and settings both in place.
    # Empty attributes match every item of our schema and only those. A clear
    # on a locked keyring removes nothing and reports no error, so the second
    # search decides. Secrets are never loaded or printed.
    keyring="$(gjs -c "imports.gi.versions.Secret = '1'; const {Secret} = imports.gi;
      const schema = new Secret.Schema('$KEY_SCHEMA', Secret.SchemaFlags.NONE, {endpoint: Secret.SchemaAttributeType.STRING});
      const service = Secret.Service.get_sync(Secret.ServiceFlags.NONE, null);
      Secret.password_clear_sync(schema, {}, null);
      print(service.search_sync(schema, {}, Secret.SearchFlags.ALL, null).length === 0 ? 'cleared' : 'locked');" 2>/dev/null)" \
        || keyring=''
    case "$keyring" in
        cleared) echo "Erased: AI engine keys from your keyring." ;;
        locked) die "could not erase the AI engine keys: your keyring is locked. Unlock it (for example in Passwords and Keys), then run this again. Saved settings were not erased." ;;
        *) die "could not reach your keyring to erase the AI engine keys. Run this from a terminal inside your GNOME session. Saved settings were not erased." ;;
    esac
    if ! dconf reset -f "$SETTINGS_PATH" || ! left="$(dconf dump "$SETTINGS_PATH")" || [ -n "$left" ]; then
        die "could not erase $SETTINGS_PATH. Run this from a terminal inside your GNOME session."
    fi
    echo "Erased: saved settings and AI answers ($SETTINGS_PATH)."
else
    echo "Kept: saved settings and AI answers ($SETTINGS_PATH). To erase them: npm run uninstall:local -- --purge"
    echo "Kept: AI engine keys in your keyring, if you saved any (Passwords and Keys). To erase them: npm run uninstall:local -- --purge"
fi

echo "Calendars and other extensions were not touched."
