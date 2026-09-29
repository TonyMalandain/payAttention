#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# Installs the built extension into the owner's session and marks it enabled
# for the next login. On Wayland the running shell does not load it until the
# owner logs out and back in. It also switches over from any earlier install
# under a former UUID (testing-and-build.md, "Switching an existing install to
# the new UUID"): the lists swap in one write, and the running shell, never this
# script, deletes a former copy it has loaded.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The UUID has one source: extension/metadata.json (PG-10).
UUID="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).uuid' "$ROOT/extension/metadata.json")"
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

die() {
    echo "install: $1" >&2
    exit 1
}

# shell_state and the former-copy rule, shared with uninstall.sh.
source "$ROOT/scripts/extension-state.sh"

# 1. Preflight, before the build and before any change.
formers="$(former_copies)" || die "could not look for an earlier payAttention install in $EXT. Nothing was changed."
mapfile -t FORMERS <<< "$formers"
[ -n "${FORMERS[0]:-}" ] || FORMERS=()
refuse_if_unreachable "${FORMERS[@]}"

# 2. Build and install. A failure here leaves any former copy enabled and running.
bash "$ROOT/scripts/build.sh"
# Also compiles the schemas into the install directory.
gnome-extensions install --force "$ROOT/dist/$UUID.shell-extension.zip"
test -f "$DIR/schemas/gschemas.compiled"

# 3. One settings write: no stored list ever holds a former UUID and UUID together.
#    The running shell runs a former copy's disable() and ignores UUID until login.
#    A failure here is caught by the check below, in a fresh process.
gjs -c "const {Gio} = imports.gi; const s = new Gio.Settings({schema_id: 'org.gnome.shell'});
  const [u, ...former] = ARGV; const drop = x => x !== u && !former.includes(x);
  s.set_strv('enabled-extensions', [...s.get_strv('enabled-extensions').filter(drop), u]);
  s.set_strv('disabled-extensions', s.get_strv('disabled-extensions').filter(drop));
  Gio.Settings.sync();" "$UUID" "${FORMERS[@]}" || true
enabled="$(gsettings get org.gnome.shell enabled-extensions)" || enabled=''
disabled="$(gsettings get org.gnome.shell disabled-extensions)" || disabled=''
switched=1
[[ "$enabled" == *"'$UUID'"* ]] || switched=0
for former in "${FORMERS[@]}"; do
    [[ "$enabled$disabled" != *"'$former'"* ]] || switched=0
done
[ "$switched" -eq 1 ] || die "could not switch the GNOME extension lists to $UUID. Run this from a terminal inside your GNOME session."

# 4. Remove each former copy by its state, queried again now; remove_former
#    also checks it is gone (step 5).
for former in "${FORMERS[@]}"; do
    remove_former "$former"
done

if [ "$(gsettings get org.gnome.shell disable-user-extensions)" = "true" ]; then
    echo "Warning: user extensions are disabled (org.gnome.shell disable-user-extensions is true); payAttention will not load until they are enabled." >&2
fi

if [ "${#FORMERS[@]}" -gt 0 ]; then
    echo "Switched: payAttention is now installed as $UUID. Settings, saved choices and AI keys were kept."
    echo "payAttention is off until you log out and back in. Then check: gnome-extensions info $UUID"
else
    echo "Installed $UUID. On Wayland, log out and back in to load it. Then check: gnome-extensions info $UUID"
fi
