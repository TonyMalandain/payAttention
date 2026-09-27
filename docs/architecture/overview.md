# payAttention — system overview

What the system is, in one page. The product side is in `docs/product/solution.md`
(requirements R-1 to R-19) and the build spec is `docs/prd/meeting-guardian.md`.
Contracts are in `interfaces.md`, stored data in `data.md`, numbers in
`constraints.md`.

## The shape

A GNOME Shell 50 extension (UUID `payattention@tonymalandain.github.io`, see ADR-0006) made
of one in-shell part and one small helper process.

```
 evolution-data-server (already running; fed by GNOME Online Accounts)
        │ D-Bus, via ECal/EDataServer GObject introspection
        ▼
 ┌────────────────────┐   stdout: one JSON snapshot per line   ┌──────────────────────────── gnome-shell process ───┐
 │ calendar helper    │ ─────────────────────────────────────► │ calendar feed ──► controller ◄── store ◄──► GSettings
 │ (gjs subprocess,   │ ◄───────────────────────────────────── │  (supervises       │  1 s tick,   (typed        (dconf)
 │  read-only)        │   stdin: refresh requests; EOF = exit  │   helper)          │  env signals  access)         ▲
 └────────────────────┘                                        │                    ▼                                │
                                                               │   core (pure): judge() → plan() → reduce()         │
                                                               │                    │ Plan                          │
                                                               │                    ▼                                │
                                                               │   ui: top-bar indicator + menu, card, takeover,    │
                                                               │       sound  ── user actions ──► controller        │
                                                               └────────────────────────────────────────────────────┘
                                                                  prefs.js (separate GTK4/Adw process) ◄──► GSettings

 Only in AI mode (ADR-0010):
 controller ── stdin: configure, judge{bounded invite} ──► AI helper (gjs subprocess) ── HTTPS/HTTP ──► engine (local or cloud)
            ◄─ stdout: verdict | failed{code} ────────       │ reads key from the GNOME keyring (ADR-0009)
 answers → store (ai-verdicts) → judge(…, aiVerdicts) ; the tick and plan() never wait for it
```

**Ports and adapters (ADR-0011).** The rules (`core/`) and the orchestration
(`app/`) are GNOME-free; each GNOME part is an adapter behind a named port
(`boundaries.md`). A second front end, the terminal verdict preview (R-20,
ADR-0012, `interfaces.md` §7), is designed to reuse the verdict pipeline, the
calendar helper and the AI helper, and never to write or alert.

## Subsystems and what each is for

| Subsystem | Directory | Responsible for |
|---|---|---|
| **Calendar helper** | `extension/helper/` | The only code that touches evolution-data-server. Lists the calendars the clock menu shows, expands recurring meetings into occurrences for a time range, and writes a faithful, judgment-free transcription of each occurrence as JSON to stdout. Read-only. Runs as its own process so an EDS or GI fault cannot take the desktop down (ADR-0001). |
| **Calendar feed** | `extension/shell/` (adapter; health and backoff rules in `extension/app/`) | Spawns and supervises the helper, reads its output line by line without blocking, validates each snapshot against the protocol, keeps the last good snapshot and how fresh it is, restarts the helper with backoff, and asks it to refresh on resume. |
| **Core** | `extension/core/` | Pure logic with no GNOME imports (ADR-0002). `judge`: occurrence → verdict + one-line reason, online/in-person, join link, travel time, deadline. `plan`: now + judged occurrences + alert state + timing settings → what should be on screen. `reduce`: alert state + user action → new alert state. Also the protocol validator and the key functions (occurrence, series, place). |
| **Store** | `extension/shell/` | Typed read and write of everything in GSettings: settings, verdict overrides, attendance-mode overrides, travel times per place, alert state. Coalesces writes and prunes old entries (ADR-0003). |
| **Controller** | `extension/app/` | The one orchestrator. Owns the 1-second tick and the environment signals (idle, resume). Re-runs `judge` when inputs change and `plan` on every tick, hands the Plan to the UI, turns UI actions into store writes or `reduce` calls, triggers sounds on step transitions, and runs the test alert. Catches and logs any exception per tick so one bad meeting cannot stop the loop. |
| **UI** | `extension/ui/` | Draws the Plan: top-bar indicator and menu, the corner/centre card, the all-monitor takeover with its modal grab, the sound. Emits actions. Decides nothing (ADR-0004). |
| **AI helper** | `extension/ai/` | Only in AI mode. The only code with network access and the only reader of the API key. It turns one bounded invite into one OpenAI-compatible request, validates the reply with core, and returns a verdict with an 80-character reason, or a failure code. Separate process so that a slow, failing or hostile engine cannot touch the desktop (ADR-0007, ADR-0010). |
| **Preferences** | `extension/prefs.js` | GTK4/libadwaita window, in its own process, that edits the settings keys. Writes the AI key to the keyring and runs "Test connection" through the AI helper. |
| **Composition root** | `extension/extension.js` | Builds all of the above in `enable()` and destroys all of it in `disable()`. No logic. |

## Time and escalation model (ADR-0002)

The alert ladder is **level-triggered, not edge-triggered.** Nothing schedules a
timer for "show the nudge at 10:50". Instead, once a second, the controller asks
the pure `plan()` function "given the time now, these meetings, and what the owner
has already done, what should be on screen?", and the UI reconciles to the answer.
A Plan equal to the previous one costs nothing.

Why: every awkward case — suspend and resume, lock and unlock, extension restart,
clock or timezone change, a meeting moved while an alert is up, a snooze that must
not run past the next step — collapses into "compute from scratch". R-13 (return
after being away shows the step that fits now) is a property of the model, not a
feature. And the ladder is fully unit-testable with fake times.

For one must-attend occurrence:

- **Deadline** = start (online or unknown mode), or start − travel minutes (in person).
- **Step times** T1..T4 = deadline − offset for heads-up, nudge, insist, takeover.
  Offsets come from settings, one set per mode. `plan` clamps them so that
  T1 ≤ T2 ≤ T3 ≤ T4. Defaults: online 30/10/3/1 min before start, in person
  10/5/2/0 min before leave-by (D-008).
- **Cutoff** = start + cutoff minutes (default 10). After it, no alert.
- **Current step** = the highest i with Ti ≤ now, while now < cutoff and the
  occurrence is not acknowledged or skipped. Passed steps are never replayed.
- **Visible?** Step 1 is visible until it has been displayed to an active user for
  the heads-up display time (the UI reports "heads-up shown at", the reducer
  records it). Steps 2–4 are visible unless snoozed. A snooze hides the card until
  min(snooze end, next step time); at step 4 only the snooze end counts.
- **Several at once:** the earliest deadline is the primary card; the rest are
  listed as "also".
- **Test alert:** a synthetic occurrence with a compressed offset table, fed through
  the same `plan()` and UI. Its alert state is kept in memory, never stored.

Sound is not in the Plan. The controller plays it when a (occurrence, step ≥ 3)
becomes visible, because "play once" is an edge and edges belong to the one place
that sees consecutive Plans.

## Environment: idle, suspend, lock, DND

- **Idle.** The controller reads the core idle monitor. The user counts as active
  when idle time is under 60 s (assumed). This only affects when the heads-up is
  marked "shown": a heads-up that appears while the owner is away is not consumed,
  so it is still there when they return. Nothing else changes when idle.
- **Suspend.** GLib timers do not count time spent asleep, but the tick reads the
  wall clock, so the first tick after resume computes the right step. On resume
  (logind `PrepareForSleep(false)`, via the shell's login manager) the controller
  also asks the helper to refresh, because calendar data may be stale.
- **Lock.** The extension runs in the `user` session mode only (ADR-0005). The shell
  disables it when the screen locks and enables it on unlock. `disable()` removes
  every actor, grab, timer and the helper; `enable()` rebuilds from GSettings. Lock
  and unlock therefore take the same path as a restart, and nothing ever shows on
  the lock screen (matching "nothing over the lock screen" in `solution.md`).
- **Do Not Disturb.** Alerts are the extension's own actors, not notifications.
  The message tray, and therefore DND, is never involved (R-12, ADR-0004).

## UI layer (ADR-0004)

- **Indicator and menu.** A panel button added to the status area. The menu shows
  today's remaining meetings with verdict, reason, mode, override toggle, travel
  chooser, and "Test alert".
- **Card (steps 1–3).** A shell actor added as chrome that stays above normal and
  full-screen windows and does not take keyboard focus. Shown on the monitor the
  owner is working on (`global.display.get_current_monitor()`). Step 3 is centred.
- **Takeover (step 4).** One full-monitor actor per monitor, in the layer the shell
  uses for modal dialogs, plus one modal grab (`Main.pushModal`) so keyboard and
  pointer go to the takeover. Escape does nothing. Rebuilt on monitor changes.
  If the grab cannot be taken (another grab is active, for example the screenshot
  UI), the overlays still show and the grab is retried on the next tick.
- **Never trap the owner.** Every path that removes the takeover — an action,
  `disable()`, an exception in the tick — must also release the grab. A stuck grab
  on Wayland leaves the desktop unusable, which is worse than a missed alert. So on
  an internal error the takeover fails open, and the error is logged.
- **Tiling (PaperWM).** PaperWM moves and scales window actors inside the window
  group. Cards and takeover live above the window group, so they are not affected.
  This is checked on the real session (see `testing-and-build.md`), because PaperWM
  is not present in the headless smoke run.
- **Untrusted text.** Titles, locations and names come from other people's invites.
  They are shown as plain text, never as Pango markup. "Join" opens only an https
  link whose host is on the conferencing allowlist in core.

## Words: product term → code name

| Product term (`docs/product/glossary.md`) | Code name |
|---|---|
| Meeting (one instance on one day) | occurrence |
| Recurring meeting as a whole | series |
| Verdict | `verdict`: `'must'` or `'ignore'`, with `reason` |
| Override | verdict override, scope `occ` or `series` |
| Online / in-person | `mode`: `'online'` or `'in-person'` |
| Leave-by time / start time | `deadline` |
| Escalation step | step 1–4: heads-up, nudge, insist, takeover |
| Acknowledge / skip / snooze | alert-state actions `ack`, `skip`, `snooze` |
| Travel time for a place | travel entry, keyed by place key |
| Mode: Rules / AI | `verdict-source`: `rules` / `ai` (not `mode`, which is online / in-person) |
| AI verdict ("AI: <reason>") | AI helper; `reasonCode` `ai-must` / `ai-ignore`; stored in `ai-verdicts` |
| A meeting the AI judges | eligible occurrence: AI mode with a usable engine, and no override (`interfaces.md` §6.1) |
| The whole invite | the bounded invite object (`interfaces.md` §6.2) |
| AI engine: endpoint, model, API key | `ai-endpoint`, `ai-model`; the key in the keyring per normalised endpoint (ADR-0009) |
| On this computer / leaves your computer | `endpointClass` `loopback` / anything else |
