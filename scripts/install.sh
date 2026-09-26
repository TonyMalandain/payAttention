#!/usr/bin/env bash
# Installs the built extension into the owner's session and marks it enabled
# for the next login. On Wayland the running shell does not load it until the
# owner logs out and back in; this script never touches the running shell.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID=payattention@tonymalandain.github.io

bash "$ROOT/scripts/build.sh"
# Also compiles the schemas into the install directory.
gnome-extensions install --force "$ROOT/dist/$UUID.shell-extension.zip"
test -f "$HOME/.local/share/gnome-shell/extensions/$UUID/schemas/gschemas.compiled"

gjs -c "const {Gio} = imports.gi; const s = new Gio.Settings({schema_id: 'org.gnome.shell'}); const u = '$UUID';
  const e = s.get_strv('enabled-extensions'); if (!e.includes(u)) s.set_strv('enabled-extensions', [...e, u]);
  const d = s.get_strv('disabled-extensions'); if (d.includes(u)) s.set_strv('disabled-extensions', d.filter(x => x !== u));
  Gio.Settings.sync();"

if [ "$(gsettings get org.gnome.shell disable-user-extensions)" = "true" ]; then
    echo "Warning: user extensions are disabled (org.gnome.shell disable-user-extensions is true); payAttention will not load until they are enabled." >&2
fi

echo "Installed $UUID. On Wayland, log out and back in to load it. Then check: gnome-extensions info $UUID"
