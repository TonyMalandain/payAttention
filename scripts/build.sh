#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# Packs both bundles (testing-and-build.md, ADR-0013): the normal one, dist/<uuid>.shell-extension.zip,
# and the developer one, dist/<uuid>.developer.shell-extension.zip, whose metadata.json alone carries
# "payattention-developer": true. Never writes to extension/.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# The UUID has one source: extension/metadata.json (PG-10).
UUID="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).uuid' "$ROOT/extension/metadata.json")"
ZIP="dist/$UUID.shell-extension.zip"
DEV_ZIP="dist/$UUID.developer.shell-extension.zip"
MARKER=payattention-developer
STAGE="dist/.developer-stage"
trap 'rm -rf "$STAGE"' EXIT
# The directories both bundles ship besides pack's defaults.
DIRS=(core helper shell app ui ai preview)

glib-compile-schemas --strict --dry-run extension/schemas
# gnome-extensions pack segfaults when the out dir does not exist.
mkdir -p dist
# A failed build must never leave an old developer zip next to a new normal one.
rm -f "$DEV_ZIP"
# pack takes only metadata, extension.js, prefs.js, stylesheet.css and schemas/ by default.
extra=()
for d in "${DIRS[@]}"; do
    extra+=("--extra-source=$d")
done
gnome-extensions pack extension \
    "${extra[@]}" \
    --extra-source=../LICENSE --extra-source=../NOTICE \
    --force --out-dir=dist
test -f "$ZIP"
unzip -Z1 "$ZIP" | grep -x 'ai/main.js' >/dev/null \
    || { echo "ai/ is missing from the zip" >&2; exit 1; }
# Not grep -q: it exits at the first match, unzip then dies of SIGPIPE, and pipefail fails the build.
unzip -Z1 "$ZIP" | grep -x 'app/controller.js' >/dev/null \
    || { echo "app/ is missing from the zip" >&2; exit 1; }
unzip -Z1 "$ZIP" | grep -x 'preview/main.js' >/dev/null \
    || { echo "preview/ is missing from the zip" >&2; exit 1; }
for f in LICENSE NOTICE; do
    unzip -Z1 "$ZIP" | grep -x "$f" >/dev/null \
        || { echo "build: $f missing from the zip" >&2; exit 1; }
done

# The developer bundle: the normal one, unpacked, plus the marker, repacked by the same tool.
rm -rf "$STAGE"
mkdir -p "$STAGE/src" "$STAGE/out"
unzip -q "$ZIP" -d "$STAGE/src"
node -e '
const fs = require("fs");
const [file, marker] = process.argv.slice(1);
const m = JSON.parse(fs.readFileSync(file, "utf8"));
m[marker] = true;
fs.writeFileSync(file, JSON.stringify(m, null, 4) + "\n");
' "$STAGE/src/metadata.json" "$MARKER"
gnome-extensions pack "$STAGE/src" \
    "${extra[@]}" \
    --extra-source=LICENSE --extra-source=NOTICE \
    --force --out-dir="$STAGE/out"
mv "$STAGE/out/$UUID.shell-extension.zip" "$DEV_ZIP"

unzip -p "$ZIP" metadata.json | node -e 'const m = JSON.parse(require("fs").readFileSync(0, "utf8")); process.exit(Object.hasOwn(m, process.argv[1]) ? 1 : 0)' "$MARKER" \
    || { echo "build: the normal bundle's metadata.json has $MARKER" >&2; exit 1; }
test -f "$DEV_ZIP" || { echo "build: the developer bundle is missing" >&2; exit 1; }
diff <(unzip -Z1 "$ZIP" | sort) <(unzip -Z1 "$DEV_ZIP" | sort) \
    || { echo "build: the developer bundle's files differ from the normal bundle's" >&2; exit 1; }
node -e '
const { execFileSync } = require("child_process");
const util = require("util");
const [zip, devZip, marker] = process.argv.slice(1);
const read = z => JSON.parse(execFileSync("unzip", ["-p", z, "metadata.json"], { encoding: "utf8" }));
const normal = read(zip), dev = read(devZip);
if (dev[marker] !== true) process.exit(1);
delete dev[marker];
process.exit(util.isDeepStrictEqual(dev, normal) ? 0 : 1);
' "$ZIP" "$DEV_ZIP" "$MARKER" \
    || { echo "build: the developer bundle's metadata.json is not the normal one plus \"$MARKER\": true" >&2; exit 1; }
echo "Built $ZIP"
echo "Built $DEV_ZIP (developer copy: its menu offers Test alert)"
