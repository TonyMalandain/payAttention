#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# Packs the extension into dist/<uuid>.shell-extension.zip (testing-and-build.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

glib-compile-schemas --strict --dry-run extension/schemas
# gnome-extensions pack segfaults when the out dir does not exist.
mkdir -p dist
# pack takes only metadata, extension.js, prefs.js, stylesheet.css and schemas/ by default.
gnome-extensions pack extension \
    --extra-source=core --extra-source=helper --extra-source=shell --extra-source=ui --extra-source=ai \
    --extra-source=../LICENSE --extra-source=../NOTICE \
    --force --out-dir=dist
test -f dist/payattention@tonymalandain.github.io.shell-extension.zip
unzip -Z1 dist/payattention@tonymalandain.github.io.shell-extension.zip | grep -x 'ai/main.js' >/dev/null \
    || { echo "ai/ is missing from the zip" >&2; exit 1; }
# Not grep -q: it exits at the first match, unzip then dies of SIGPIPE, and pipefail fails the build.
for f in LICENSE NOTICE; do
    unzip -Z1 "dist/payattention@tonymalandain.github.io.shell-extension.zip" | grep -x "$f" >/dev/null \
        || { echo "build: $f missing from the zip" >&2; exit 1; }
done
echo "Built dist/payattention@tonymalandain.github.io.shell-extension.zip"
