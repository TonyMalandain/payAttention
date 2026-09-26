#!/usr/bin/env bash
# Removes payAttention from the owner's session: stops it in the running shell
# (the shell runs its disable() before it answers), removes its install
# directory, and takes its UUID out of org.gnome.shell enabled-extensions and
# disabled-extensions. Saved settings are kept unless --purge is given, which
# erases /org/gnome/shell/extensions/payattention/ and nothing else.
# It never touches calendars, other extensions, or any other setting.
set -euo pipefail
UUID=payattention@tonymalandain.github.io
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
SETTINGS_PATH=/org/gnome/shell/extensions/payattention/
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

did=0
removed_dir=0

# b. Stop it in the running shell. uninstall is the one call that runs
#    disable() before it returns; disable only changes the lists and lets the
#    shell act later. Without a shell that knows it, info fails and we go on.
existed=0
[ -e "$DIR" ] && existed=1
if gnome-extensions info "$UUID" >/dev/null 2>&1; then
    gnome-extensions uninstall "$UUID" >/dev/null 2>&1 \
        || die "could not stop payAttention in the running session (gnome-extensions uninstall failed). Nothing was removed. Log out and in, then run this again."
    if gnome-extensions info "$UUID" >/dev/null 2>&1; then
        die "the running session still has payAttention loaded after uninstall."
    fi
    echo "Stopped: payAttention in the running session."
    did=1
    if [ "$existed" -eq 1 ]; then
        echo "Removed: $DIR"
        removed_dir=1
    fi
fi

# c. Remove the files, if no shell did.
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

# d. Take the UUID out of both lists. The shell leaves it in enabled-extensions.
#    A failure here is caught by the check below, in a fresh process.
changed="$(gjs -c "const {Gio} = imports.gi; const s = new Gio.Settings({schema_id: 'org.gnome.shell'}); const u = '$UUID';
  for (const key of ['enabled-extensions', 'disabled-extensions']) {
    const list = s.get_strv(key);
    if (list.includes(u)) { s.set_strv(key, list.filter(x => x !== u)); print(key); }
  }
  Gio.Settings.sync();")" || changed=''
# Safe to discard a failed edit: the check below reads both lists again and
# stops if the UUID is still in either.
if ! lists="$(gsettings get org.gnome.shell enabled-extensions && gsettings get org.gnome.shell disabled-extensions)" \
        || printf '%s\n' "$lists" | grep -qF "'$UUID'"; then
    die "could not remove $UUID from the GNOME extension lists. Run this from a terminal inside your GNOME session."
fi
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

# e. Saved settings. The trailing slash makes the reset an exact directory:
#    /org/gnome/shell/extensions/payattention-other/ is not touched.
if [ "$purge" -eq 1 ]; then
    if ! dconf reset -f "$SETTINGS_PATH" || ! left="$(dconf dump "$SETTINGS_PATH")" || [ -n "$left" ]; then
        die "could not erase $SETTINGS_PATH. Run this from a terminal inside your GNOME session."
    fi
    echo "Erased: saved settings ($SETTINGS_PATH)."
else
    echo "Kept: saved settings ($SETTINGS_PATH). To erase them: npm run uninstall:local -- --purge"
fi

echo "Calendars and other extensions were not touched."
