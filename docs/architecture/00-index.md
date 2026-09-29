# payAttention — architecture record

Owned by the architect. Engineers treat these documents and the ADRs as the
authority; none of them may add or change an ADR.

| Document | What it holds |
|---|---|
| `overview.md` | The system on one page: subsystems, the time/escalation model, idle/suspend/lock, the UI layer, product term → code name |
| `boundaries.md` | Repository layout, the ports and where each adapter lives, what each directory owns, may import, and must not know |
| `interfaces.md` | The helper snapshot protocol, core ↔ controller ↔ UI contracts, the public extension method, the settings contract, AI mode (§6), the verdict component and the verdict preview (§7) |
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
| ADR-0006 | UUID `payattention@tonymalandain.github.io` (amended 2026-09-29, D-034: replaces the former work-domain UUID; one-time switch-over in `testing-and-build.md`), schema `org.gnome.shell.extensions.payattention`, GNOME 50 only |
| ADR-0007 | LLM engines are reached through the OpenAI-compatible protocol with our own small gjs client, not a bundled abstraction library (accepted as D-021; amended 2026-09-27) |
| ADR-0008 | [SUPERSEDED by ADR-0010] The AI second opinion on unsure verdicts runs in its own helper process and reaches `judge` as stored data |
| ADR-0009 | AI engine keys live in the GNOME keyring, per normalised endpoint, written by prefs and read only by the AI helper (amended 2026-09-27: one endpoint, keyless allowed, transport rule by endpoint) |
| ADR-0010 | AI mode: the AI helper judges every meeting without an override, from a bounded copy of the whole invite; stale answers serve while re-asked; settings are mode, endpoint, model. Amended 2026-09-27: cancelled, declined and all-day meetings are not asked; calendar name sent; passcodes removed; unknown protocol keys refused; D-031: engine-down vs per-meeting failure, unreachable engines paused ≤ 90 s with refunded spends, truthful "unavailable" line |
| ADR-0011 | Ports and adapters: rules (`core/`) and orchestration (`app/`) are GNOME-free; every GNOME part is an adapter behind a named port; only the verdict component calls `judge` (owner's principle, 2026-09-27) |
| ADR-0012 | The verdict preview (R-20, PG-8) is a gjs front end shipped in the pack, run from the installed copy, read-only by construction |

Last restructure: none.
