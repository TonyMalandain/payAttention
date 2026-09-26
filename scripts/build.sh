#!/usr/bin/env bash
# Packs the extension into dist/<uuid>.shell-extension.zip (testing-and-build.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

glib-compile-schemas --strict --dry-run extension/schemas
# gnome-extensions pack segfaults when the out dir does not exist.
mkdir -p dist
# pack takes only metadata, extension.js, prefs.js, stylesheet.css and schemas/ by default.
gnome-extensions pack extension \
    --extra-source=core --extra-source=helper --extra-source=shell --extra-source=ui \
    --force --out-dir=dist
test -f dist/payattention@tonymalandain.github.io.shell-extension.zip
echo "Built dist/payattention@tonymalandain.github.io.shell-extension.zip"
