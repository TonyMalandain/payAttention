#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Tony Malandain

# Sourced by scripts/install.sh and scripts/uninstall.sh, never run. The shared
# part of the rule in docs/architecture/testing-and-build.md, "Switching an
# existing install to the new UUID" (ADR-0006 amendment, D-034): what the running
# shell knows of an extension, and which installed copies are former identities
# of payAttention. The caller sets ROOT and UUID, and defines die().

SCHEMA=org.gnome.shell.extensions.payattention
EXT="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"

# shell_state <uuid>: prints LOADED, UNKNOWN or UNREACHABLE. A read-only D-Bus
# call; org.gnome.Shell is not D-Bus-activatable, so it never starts a shell.
# Not gnome-extensions info: it exits 2 both for "no such extension" and "no shell".
shell_state() {
    local out
    if ! out="$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Extensions.GetExtensionInfo "$1" 2>/dev/null)"; then
        echo UNREACHABLE
    elif [ "$out" = '(@a{sv} {},)' ]; then
        echo UNKNOWN
    elif [[ "$out" == *"'uuid': <'$1'>"* ]]; then
        echo LOADED
    else
        echo UNREACHABLE
    fi
}

# former_copies: prints the UUID of each former copy, one per line: a real
# directory EXT/payattention@* (not a symlink, not UUID) whose metadata.json has
# "uuid" equal to its name and "settings-schema" equal to SCHEMA. Found by
# schema, never by name: no former UUID may be written in this repository.
former_copies() {
    node -e '
        const fs = require("fs");
        const path = require("path");
        const [ext, current, schema] = process.argv.slice(1);
        let names = [];
        try {
            names = fs.readdirSync(ext);
        } catch (e) {
            if (e.code !== "ENOENT")
                throw e;
        }
        for (const name of names.sort()) {
            if (!name.startsWith("payattention@") || name === current || name.includes("\n"))
                continue;
            const dir = path.join(ext, name);
            if (!fs.lstatSync(dir).isDirectory())
                continue;
            let metadata;
            try {
                metadata = JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8"));
            } catch {
                // Missing or unparsable metadata: by the rule, not a former copy. Left alone.
                continue;
            }
            if (metadata?.uuid === name && metadata["settings-schema"] === schema)
                console.log(name);
        }' "$EXT" "$UUID" "$SCHEMA"
}

# refuse_if_unreachable <uuid>...: exits 1, before anything changes, when the
# shell state of any former copy cannot be known.
refuse_if_unreachable() {
    local former
    for former in "$@"; do
        if [ "$(shell_state "$former")" = UNREACHABLE ]; then
            die "an earlier payAttention install ($EXT/$former) must be switched over from a terminal inside your GNOME session. Nothing was changed."
        fi
    done
}

# remove_former <uuid>: removes one former copy by its shell state, queried now.
# LOADED: the shell unloads it and deletes the directory itself, so files are
# never removed under a copy it holds. UNKNOWN: its files are not in use.
# UNREACHABLE (the shell went away mid-run): left in place, and the run stops.
remove_former() {
    local former="$1" dir="$EXT/$1"
    case "$(shell_state "$former")" in
        LOADED)
            gnome-extensions uninstall "$former" >/dev/null 2>&1 \
                || die "could not remove the earlier payAttention install ($dir): the running session refused to uninstall it. Log out and in, then run this again."
            ;;
        UNKNOWN)
            case "$dir" in
                /*/gnome-shell/extensions/payattention@*) ;;
                *) die "refusing to remove '$dir': it is not a payAttention install directory." ;;
            esac
            [ "$dir" != "$EXT/$UUID" ] || die "refusing to remove '$dir': it is the current install."
            [ ! -L "$dir" ] || die "refusing to remove '$dir': it is a symbolic link."
            rm -rf -- "$dir"
            ;;
        *)
            die "an earlier payAttention install ($dir) must be switched over from a terminal inside your GNOME session. It was left in place."
            ;;
    esac
    [ ! -e "$dir" ] && [ "$(shell_state "$former")" = UNKNOWN ] \
        || die "the earlier payAttention install ($dir) is still there after removing it. Log out and in, then run this again."
    echo "Removed: an earlier payAttention install ($dir)."
}
