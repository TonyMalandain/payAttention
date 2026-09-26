# payAttention — architecture record

Owned by the architect. Engineers treat these documents and the ADRs as the
authority; none of them may add or change an ADR.

| Document | What it holds |
|---|---|
| `overview.md` | The system on one page: subsystems, the time/escalation model, idle/suspend/lock, the UI layer, product term → code name |
| `boundaries.md` | Repository layout, what each directory owns, may import, and must not know |
| `interfaces.md` | The helper snapshot protocol, core ↔ controller ↔ UI contracts, the public extension method, the settings contract |
| `data.md` | GSettings schema (keys, types, defaults), key formats, alert state, pruning |
| `constraints.md` | Numbers (timing, scale, budgets), privacy and security rules, GNOME review rules |
| `stack.md` | Every technology and why; build-vs-adopt calls |
| `testing-and-build.md` | The validation sequence, the four test layers, build/install commands, pitfalls found |
| `NOTES.md` | Append-only architect working log |
| `adr/` | Decision records, `ADR-NNNN-<slug>.md` |

## Decisions

| ADR | Decision |
|---|---|
| ADR-0001 | Calendar data comes from EDS through an out-of-process gjs helper speaking JSON lines over stdio |
| ADR-0002 | Verdicts and the ladder are a pure core, driven by a 1-second level-triggered tick |
| ADR-0003 | All durable state lives in GSettings, keyed by iCalendar UID (stored format) |
| ADR-0004 | Alerts are the extension's own shell actors and modal grab, never notifications |
| ADR-0005 | Run in the `user` session mode only; locking disables the extension |
| ADR-0006 | UUID `payattention@tonymalandain.github.io`, schema `org.gnome.shell.extensions.payattention`, GNOME 50 only |

Last restructure: none.
