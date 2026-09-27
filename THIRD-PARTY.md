# Third-party software

payAttention is licensed under the [Apache License 2.0](LICENSE) (decision D-026 in [`docs/product/decisions.md`](docs/product/decisions.md)).

## Shipped with the extension

None. The zip holds only this project's files plus `LICENSE` and `NOTICE`.

## Development tools (never shipped, `devDependencies` only)

| Package | Version | Licence |
|---|---|---|
| `eslint` | 10.11.0 | MIT |
| `@eslint/js` | 10.0.1 | MIT |
| `globals` | 17.12.0 | MIT |

With their transitive dependencies, measured 2026-09-27: 79 packages. MIT 55, Apache-2.0 12, BSD-2-Clause 6, ISC 4, BSD-3-Clause 1, BlueOak-1.0.0 1.

Checked on every `npm test` by `tests/unit/licensing.test.js` against `package-lock.json`. A licence outside MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, BlueOak-1.0.0 fails the check.

## Provided by the system at run time (not copied)

These come with GNOME on the owner's machine. payAttention calls them and copies none of their code. The licence shown is the main one for each Fedora 44 package. `rpm -q --qf '%{LICENSE}\n' <package>` gives the full expression.

| Library | Licence | Used by |
|---|---|---|
| GNOME Shell 50 and Mutter | GPL-2.0-or-later | the extension |
| GJS | MIT / LGPL, see package | the extension and the helper |
| GLib, Gio, GObject | LGPL-2.1-or-later | everywhere |
| Pango | LGPL-2.0-or-later | the extension |
| GTK 4 | LGPL-2.1-or-later | preferences only |
| libadwaita | LGPL-2.1-or-later | preferences only |
| Evolution Data Server | LGPL-2.0-or-later | the calendar helper |
| libical-glib | LGPL-2.1-only OR MPL-2.0 | the calendar helper |
| libcanberra | LGPL-2.1-or-later | the alert sound, through the shell's sound player |

## Compatibility

GNOME's review rules say an extension must be distributable under terms compatible with GPL-2.0-or-later. Apache 2.0 is compatible with GPL-3.0, and GNOME Shell is GPL-2.0-*or-later*, so the combination can be distributed. A reviewer on extensions.gnome.org could still question it if the extension is ever published there. This does not affect installing it from the repository.
