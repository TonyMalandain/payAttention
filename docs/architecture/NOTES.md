# Architect working log

Append only. Newest at the bottom.

## 2026-09-26 — Handoff taken: where calendar data comes from
- **Kind:** decision
- **Fact:** Took the product handoff "Where the calendar data comes from" (product NOTES, 2026-09-26). Answer: EDS through an out-of-process gjs helper (ADR-0001).
- **Why:** The shell's CalendarServer lacks the fields the verdict rules need; in-process EDS can crash the session.
- **Source:** experiments on the author's machine, recorded in ADR-0001.
- **Touches:** ADR-0001, interfaces.md

## 2026-09-26 — Shell CalendarServer is too thin
- **Kind:** interface
- **Fact:** `org.gnome.Shell.CalendarServer` exposes only `SetTimeRange(x,x,b)` and `EventsAddedOrUpdated(a(ssxxa{sv}))`.
- **Why:** Rules out the no-helper option; no attendees, partstat, organiser, or transparency.
- **Source:** `gdbus introspect --session --dest org.gnome.Shell.CalendarServer --object-path /org/gnome/Shell/CalendarServer`
- **Touches:** ADR-0001

## 2026-09-26 — gjs segfaults disposing EDS objects
- **Kind:** constraint
- **Fact:** A gjs script that creates `EDataServer.SourceRegistry.new_sync` and exits segfaults (4/4); trace: `source_registry_dispose` → `g_main_context_iteration` → NULL, called from the GC sweep.
- **Why:** This is why EDS must never run in the shell process, and why the helper's own exit path needs care.
- **Source:** `coredumpctl info` on /usr/bin/gjs-console, 2026-09-26 00:19
- **Touches:** ADR-0001, constraints.md, testing-and-build.md

## 2026-09-26 — Async instance expansion unusable from gjs
- **Kind:** constraint
- **Fact:** `ECal.Client.generate_instances` (async) takes 4 arguments in gjs and has no completion callback; `generate_instances_sync` works.
- **Why:** Forces blocking expansion, which is only acceptable out of the shell.
- **Source:** gjs warning "expected 4, got 5"; probe run.
- **Touches:** ADR-0001

## 2026-09-26 — What the author's calendars contain (counts only)
- **Kind:** data
- **Fact:** 9 enabled+selected sources (7 GOA CalDAV, 1 local, 1 contacts); next 7 days: 26 occurrences, 22 recurring, 8 with attendees (22 total, all CUTYPE individual), 8 with organiser, 5 with the source's own address among attendees (partstat: 3 accepted, 2 needs-action), 26 opaque, 7 with location, 25 with description, 6 with X-GOOGLE-CONFERENCE, 0 with RFC 7986 CONFERENCE, all times in named TZIDs, 1 occurrence present in two sources, all STATUS confirmed.
- **Why:** Sizes the design and shows which fields are really populated; duplicates must be merged; Google's link is in X-GOOGLE-CONFERENCE.
- **Source:** read-only gjs probe, 2026-09-26.
- **Touches:** constraints.md, interfaces.md

## 2026-09-26 — EDS remote refresh is 30 minutes
- **Kind:** constraint
- **Fact:** All 9 sources have ESourceRefresh enabled at 30 minutes.
- **Why:** A meeting added on the provider's side can take up to 30 min to reach the machine; the helper asks EDS to sync every 10 min to narrow this.
- **Source:** probe reading `SOURCE_EXTENSION_REFRESH`.
- **Touches:** constraints.md, ADR-0001

## 2026-09-26 — Freshness trade: helper-requested sync every 10 minutes
- **Kind:** decision
- **Fact:** The helper asks EDS to refresh remote sources every 10 min and on resume.
- **Why:** 30 min lag could make a newly-added meeting miss its 30-min heads-up. Traffic goes only to the owner's own providers, as EDS already does, so R-3 holds. The number is assumed.
- **Source:** assumed
- **Touches:** constraints.md

## 2026-09-26 — Headless shell smoke test works; devkit not installed
- **Kind:** stack
- **Fact:** `dbus-run-session -- gnome-shell --headless --virtual-monitor 1280x720 --virtual-monitor 1024x768 --automation-script <file>` with isolated XDG dirs and `GSETTINGS_BACKEND=keyfile` runs an extension to state ACTIVE with 2 monitors and exits when the script ends. `--devkit` needs the absent `mutter-devkit` package.
- **Why:** Gives a real shell test without touching the author's session.
- **Source:** probe extension run, 2026-09-26 00:24.
- **Touches:** testing-and-build.md

## 2026-09-26 — gnome-extensions tooling pitfalls
- **Kind:** stack
- **Fact:** `install` fails across filesystems when the zip has subdirectories ("Can't recursively copy directory"); `pack` segfaults if `--out-dir` is missing; `pack` needs `--extra-source` for every code dir; `install` compiles schemas.
- **Why:** Each one would otherwise cost the engineers an hour.
- **Source:** runs on 2026-09-26.
- **Touches:** testing-and-build.md

## 2026-09-26 — Fixture EDS works for helper tests
- **Kind:** stack
- **Fact:** A private EDS (isolated XDG dirs, `dbus-run-session`) with a `local` backend `.source` file and a fixture `.ics` is read by ECal; a TZID America/New_York 06:00 event came back as 10:00Z.
- **Why:** The helper can be integration-tested without the owner's data.
- **Source:** run on 2026-09-26.
- **Touches:** testing-and-build.md

## 2026-09-26 — Guests exclude rooms and resources
- **Kind:** decision
- **Fact:** "Guests" in verdict counts means attendees with CUTYPE individual or unknown, excluding the owner; rooms, resources and groups are not guests.
- **Why:** Google adds meeting rooms as attendees; counting them would inflate "N guests" and could turn a personal block into a "small meeting". Sent to product to confirm the meaning.
- **Source:** assumed
- **Touches:** interfaces.md (core judge), docs/inbox.md

## 2026-09-26 — In-person step times are out of order in the PRD
- **Kind:** question
- **Fact:** With the PRD values, the in-person takeover (1 min before leave-by) comes before insist (at leave-by). `plan` clamps offsets to be non-decreasing, so with these defaults insist is never shown for in-person meetings.
- **Why:** Clamping makes any setting safe; the product value is the product manager's call. Sent to product.
- **Source:** PRD §3 table.
- **Touches:** overview.md, data.md, docs/inbox.md

## 2026-09-26 — Owner not invited
- **Kind:** question
- **Fact:** 3 of 8 occurrences with guests do not list the source's own address as organiser or attendee (another person's calendar, or an alias). The PRD rules would fall through to "small meeting: must-attend".
- **Why:** A risk of false takeovers, which users.md names as a reason to give up. Core will compute an owner-role fact (organiser / attendee / not listed / unknown); the verdict for "not listed" is product's. Sent to product.
- **Source:** probe counts, 2026-09-26.
- **Touches:** docs/inbox.md

## 2026-09-26 — Cancelled meetings
- **Kind:** question
- **Fact:** STATUS:CANCELLED is carried in the DTO; the PRD rules do not mention cancelled meetings.
- **Why:** Some providers keep a cancelled occurrence on the calendar; without a rule it would alert. Sent to product.
- **Source:** RFC 5545; none present in the author's data today.
- **Touches:** docs/inbox.md

## 2026-09-26 — Code-side names for glossary terms
- **Kind:** question
- **Fact:** The code-side names are in `overview.md` ("Words" table) rather than in `docs/product/glossary.md`.
- **Why:** This run was told not to edit product documents; the glossary is shared and the product manager may copy them across.
- **Source:** task instruction.
- **Touches:** overview.md

## 2026-09-26 — In-person ordering question closed by D-008
- **Kind:** decision
- **Fact:** In-person defaults are 10/5/2/0 min before leave-by; `data.md` and `overview.md` updated.
- **Why:** D-008 closed the ordering finding logged earlier today; core clamps offsets anyway.
- **Source:** `docs/product/decisions.md` D-008; inbox (PG-1a, PG-1c plans).
- **Touches:** data.md, overview.md

## 2026-09-26 — Guests: organiser and groups count (supersedes "Guests exclude rooms and resources" wording on groups)
- **Kind:** decision
- **Fact:** Guests are people other than the owner: individual, group and unknown attendees plus the organiser; rooms and resources are not.
- **Why:** D-011 says "people"; a group is people, and counting more guests errs toward warning (D-004).
- **Source:** inbox (PG-1a plan); D-011.
- **Touches:** interfaces.md §2

## 2026-09-26 — Settings: `extra-owner-addresses` and integer ranges
- **Kind:** data
- **Fact:** Added key `extra-owner-addresses` (`as`, `[]`) and recorded the PG-1c ranges for every integer key.
- **Why:** D-009 names extra owner addresses; ranges keep bad values out of core. Additive, so no ADR (interfaces.md §5).
- **Source:** inbox (PG-1a, PG-1c plans).
- **Touches:** data.md

## 2026-09-26 — No `ownerAddresses` protocol field for aliases
- **Kind:** interface
- **Fact:** The protocol keeps one `ownerEmail` per source; aliases go in `extra-owner-addresses`.
- **Why:** On the author's machine the 2 enabled mail identities have 0 aliases and exactly the same 2 addresses as the calendars' `cal-email-address`, so reading mail identities would add nothing today. D-009 accepts the cost. Revisit if an owner reports an unmatched alias.
- **Source:** read-only gjs probe, counts only, 2026-09-26.
- **Touches:** interfaces.md §1

## 2026-09-26 — Controller ↔ UI reshaped; gi-free shell modules tested under Node
- **Kind:** interface
- **Fact:** Accepted PG-1c's `dispatch(action)`, controller-recorded heads-up, `View` from `shell/view.js`, `core/display.js`, and injected GNOME factories.
- **Why:** Keeps every "what to show" decision out of `ui/` and testable without a shell. Internal contract, so no ADR.
- **Source:** inbox (PG-1c plan).
- **Touches:** interfaces.md §2–3, boundaries.md

## 2026-09-26 — GioUnix allowed in the helper; `system` helper-only
- **Kind:** boundary
- **Fact:** `helper/` may import `gi://GioUnix` and gjs's `system`; `shell/`, `ui/`, `extension.js`, `prefs.js` must not import `system`.
- **Why:** GLib ≥ 2.80 moved the Unix streams to GioUnix and the old names warn on every use (measured, GLib 2.88.3). `System.exit` in the shell process would end the session.
- **Source:** inbox (PG-1b plan).
- **Touches:** boundaries.md

## 2026-09-26 — `ECal.Client.refresh` only schedules
- **Kind:** constraint
- **Fact:** `refresh` + `refresh_finish` returned `true` in 0–1 ms on all 7 CalDAV sources; all showed `online` true and `connection-status` CONNECTED.
- **Why:** The planned `sync-failed` status can never report an offline provider, so it cannot drive D-013.
- **Source:** read-only gjs probe, 2026-09-26.
- **Touches:** ADR-0001 evidence 6, constraints.md, interfaces.md addendum

## 2026-09-26 — D-013 mechanism: link state per source, judged in the shell
- **Kind:** interface
- **Fact:** Sources gain optional `remote` and `connection`; the shell keeps a per-source "last seen online and connected" clock and warns when the oldest is 15 min old.
- **Why:** EDS exposes no last-sync time; link state is the only read-only signal. Optional fields keep protocol v1 (the validator accepts unknown properties). Per-source (oldest), not newest, because one failing account hides that account's meetings; sent to product to confirm.
- **Source:** probe above; `extension/core/protocol.js` (unknown properties accepted).
- **Touches:** interfaces.md addendum 2026-09-26

## 2026-09-26 — Health clocks persist across lock
- **Kind:** decision
- **Fact:** `health-data-at` and `health-provider-at` are written on `disable()` and seed the clocks at `enable()`; 60 s grace before the first snapshot.
- **Why:** `disable()` runs on every lock (ADR-0005); in-memory clocks would give an offline owner 15 min of false "all fine" after every unlock, which defeats D-010/D-013. One write per lock, never per tick.
- **Source:** inbox (PG-1c plan asked "confirm, or persist").
- **Touches:** data.md, interfaces.md addendum

## 2026-09-26 — Residual gap: provider errors while connected
- **Kind:** debt
- **Fact:** A provider that is reachable but fails the sync (server error) is not detected by the D-013 rule.
- **Why:** No read-only EDS API reports sync outcome. Repaid only if EDS exposes a last-sync time or a sync-error signal to clients.
- **Source:** assumed (not reproduced).
- **Touches:** interfaces.md addendum

## 2026-09-26 — Test and build facts folded in
- **Kind:** stack
- **Fact:** Folded into `testing-and-build.md`: quoted `node --test` globs (Node 24.11), helper entry `main.js`, isolated EDS has 2 built-in sources, private `dbus-daemon`, smoke additions, `install:local`, the exit rule, EDS/libical traps. gjs lacks `URL`/`structuredClone` added to `constraints.md`.
- **Why:** Each was measured by the senior engineers and costs hours to rediscover.
- **Source:** inbox (PG-1a, PG-1b, PG-1c plans).
- **Touches:** testing-and-build.md, constraints.md

## 2026-09-26 — Inbox emptied (for-architecture)
- **Kind:** question
- **Fact:** All 12 `for-architecture` entries of 2026-09-26 taken and removed from `docs/inbox.md`; one `for-product` entry left there on D-013's per-calendar reading.
- **Why:** The inbox is not a log.
- **Source:** this session.
- **Touches:** —

## 2026-09-26 — Provider-clock grace after enable
- **Kind:** interface
- **Fact:** In the first 60 s after `enable()`, provider staleness is not shown while any counted source reports `connecting` or `offline`; after 60 s the D-013 rule is unchanged.
- **Why:** A remote calendar still reconnecting after unlock inherited the persisted provider clock and flashed "not updating since <lock time>". Product rule; the shell's `health.js` carries it.
- **Source:** product manager via inbox, after the PG-1c review.
- **Touches:** interfaces.md addendum (D-013)

## 2026-09-26 — The helper is stopped with SIGKILL
- **Kind:** interface
- **Fact:** `Gio.Subprocess.force_exit()` sends SIGKILL, not SIGTERM; `interfaces.md` §1 and ADR-0001's consequences now say so.
- **Why:** The helper is read-only and stateless, so no clean shutdown is owed; SIGKILL also sidesteps the gjs/EDS teardown segfault. The comment at `extension/shell/calendarFeed.js:83` still says SIGTERM (code, not mine to edit).
- **Source:** product manager via inbox; `extension/shell/calendarFeed.js:84`.
- **Touches:** interfaces.md §1, ADR-0001

## 2026-09-26 — Smoke isolation stops at the session bus
- **Kind:** constraint
- **Fact:** The headless smoke shares the real system bus (GDM registration attempt, logind `prepare-for-sleep`); accepted, with the rule that a smoke script never calls a system service that changes machine state.
- **Why:** Both observed uses are harmless; a private system bus would remove logind and change `environment.js` behaviour under test for no gain. Repaid, if ever needed, by a private `dbus-daemon --system` in `scripts/smoke.sh`.
- **Source:** PG-1c engineer via inbox.
- **Touches:** testing-and-build.md Layer 3

## 2026-09-26 — Headless virtual input and connectObject pitfalls
- **Kind:** stack
- **Fact:** Folded into testing-and-build.md pitfalls: re-send virtual pointer motion until it lands; confirm key arrival before asserting no effect; plain-gjs checks of `shell/` modules need a `connectObject` stand-in, shared once a second check needs it.
- **Why:** 1 of 6 smoke runs failed before the fix; each costs hours to rediscover.
- **Source:** PG-1c engineer via inbox; `tests/smoke/alert-ladder.js`, `tests/smoke/store-check.js:16`.
- **Touches:** testing-and-build.md

## 2026-09-26 — Engineer's smoke step 2 edit adopted
- **Kind:** stack
- **Fact:** Smoke step 2 now checks the indicator shows the fixture meeting `scripts/smoke.sh` writes into the isolated EDS, not "0 events".
- **Why:** It proves helper, `judge` and `plan` ran end to end on fixture data only.
- **Source:** commit 2295429, product manager asked to adopt.
- **Touches:** testing-and-build.md

## 2026-09-26 — Conformance pass after PG-1a/b/c
- **Kind:** debt
- **Fact:** Built tree, imports and schema match boundaries/interfaces/data and ADR-0001..0006; two enforcement gaps only: lint does not forbid St/Clutter in `shell/` nor `Gio.Settings` in `ui/` (neither is used today).
- **Why:** The boundary table claimed full lint enforcement; now it says those two are review-held. Repaid by two more `no-restricted-imports`/`no-restricted-syntax` patterns in `eslint.config.js`.
- **Source:** `eslint.config.js`, grep of `extension/` imports, 2026-09-26.
- **Touches:** boundaries.md

## 2026-09-26 — Doc drift fixed: ui/ imports GObject and Pango
- **Kind:** boundary
- **Fact:** `ui/indicator.js` imports `gi://GObject` and `gi://Pango`; added to the `ui/` allowed list.
- **Why:** Needed for a registered PanelMenu subclass and label ellipsizing; not a breach, the doc list was incomplete.
- **Source:** `extension/ui/indicator.js:3-4`.
- **Touches:** boundaries.md

## 2026-09-26 — Inbox emptied (for-architecture, PG-1c)
- **Kind:** question
- **Fact:** 4 `for-architecture` entries taken and removed from `docs/inbox.md`.
- **Why:** The inbox is not a log.
- **Source:** this session.
- **Touches:** —

## 2026-09-26 — Unlock grace is per source (D-013 addendum aligned)
- **Kind:** interface
- **Fact:** In the 60 s after `enable()`, only sources whose `connection` is `connecting` or `offline` are left out of provider staleness; any other counted source (e.g. `ssl-failed`) still warns at once. `interfaces.md` Verdict reworded to match `shell/health.js` (`RECONNECTING`, `dataHealth`).
- **Why:** Product manager ruled hiding a real failure is worse than a brief warning; the old "while any source is reconnecting" wording would have hidden it. Doc was the bug, code was right.
- **Source:** `extension/shell/health.js` `dataHealth`; product ruling in `docs/inbox.md`, 2026-09-26.
- **Touches:** interfaces.md (D-013 addendum)

## 2026-09-26 — Engineer's fix-round edits to testing-and-build.md adopted
- **Kind:** stack
- **Fact:** Adopted: smoke monitor 960x540, all-day fixture and Must attend menu check, worst-case alert and failed-construction checks, single parked virtual pointer pitfall. Corrected: the wrapper's failure patterns also include `JS WARNING` naming payattention and our own failure log codes.
- **Why:** Each matches `scripts/smoke.sh` and `tests/smoke/alert-ladder.js`; the pattern list was incomplete against `scripts/smoke.sh:94-96`.
- **Source:** commit e7cffe2; `scripts/smoke.sh:84,94-103`.
- **Touches:** testing-and-build.md Layer 3

## 2026-09-26 — Inbox emptied (for-architecture, PG-1c fix round)
- **Kind:** question
- **Fact:** 1 `for-architecture` entry (unlock grace wording) taken and removed from `docs/inbox.md`.
- **Why:** The inbox is not a log.
- **Source:** this session.
- **Touches:** —

## 2026-09-26 — Handoff taken: AI engine library, runtime, keys, engines (PG-4)
- **Kind:** decision
- **Fact:** Took the product handoff with the owner's words "you should use a llm abstraction library…". The answer is ADR-0007 (OpenAI-compatible protocol, own gjs client on libsoup 3, no bundled library), ADR-0008 (AI helper process, `aiVerdicts` as a `judge` input) and ADR-0009 (keys in the GNOME keyring).
- **Why:** No LLM abstraction library runs in gjs. Node is not in the session, and Python needs an explicit install under the review rules. All the named engines already share the protocol those libraries translate to.
- **Source:** product NOTES handoff 2026-09-26; probes below.
- **Touches:** ADR-0007, ADR-0008, ADR-0009, interfaces.md §6

## 2026-09-26 — gjs has no fetch; Soup 3 and Secret import
- **Kind:** stack
- **Fact:** `typeof fetch` and `typeof AbortController` are `undefined` in gjs 1.88. `gi://Soup?version=3.0` (3.6) and `gi://Secret` (libsecret 0.21.8) import. gnome-keyring owns `org.freedesktop.secrets`.
- **Why:** Rules out running JS LLM SDKs under gjs without polyfills. Makes Soup the HTTP client and libsecret the key store.
- **Source:** `gjs -c`/`gjs -m` probes; `busctl --user list`, 2026-09-26.
- **Touches:** ADR-0007, ADR-0009, stack.md

## 2026-09-26 — Option not taken: bundling LiteLLM or the Vercel AI SDK
- **Kind:** decision
- **Fact:** Rejected. The Vercel AI SDK and LangChain.js need Node or a polyfilled gjs port. LiteLLM needs a pip venv. LiteLLM Proxy stays available to the owner as a "custom" base URL.
- **Why:** The review rules require explicit user action for Python or other dependencies, and forbid binaries and minified code. PyPI litellm 1.82.7 and 1.82.8 stole API keys (2026-03-24). An extra runtime next to the key buys nothing for one request per meeting.
- **Source:** gjs.guide review guidelines (fetched 2026-09-26); docs.litellm.ai security update March 2026; BerriAI/litellm#24518.
- **Touches:** ADR-0007

## 2026-09-26 — Anthropic compat endpoint ignores response_format
- **Kind:** constraint
- **Fact:** Anthropic's OpenAI SDK compatibility endpoint silently ignores unsupported fields, including `response_format`, and is described as intended for testing.
- **Why:** This is why every reply is validated by core whatever the engine promises, and why Anthropic direct is best effort, not in the first verified set.
- **Source:** Claude docs "OpenAI SDK compatibility" (via search, 2026-09-26).
- **Touches:** ADR-0007, stack.md

## 2026-09-26 — NVIDIA driver not loaded on the owner's kernel
- **Kind:** constraint
- **Fact:** Kernel 7.2.7 has no NVIDIA kmod (built for 7.0.12 and 7.1.10 only). No nvidia module is loaded, and `nvidia-smi` fails. The CPU is a Ryzen 5 7600, with 61 GB of RAM.
- **Why:** Local-engine latency will be CPU-bound until the owner's akmod rebuilds. Timeouts are 60 s local for that reason. Nothing on the alert path waits either way.
- **Source:** `lsmod`, `rpm -qa | grep nvidia`, `nvidia-smi`, `lscpu`, 2026-09-26.
- **Touches:** constraints.md

## 2026-09-26 — AI invalidation by fingerprint, not by event
- **Kind:** interface
- **Fact:** Stored AI answers apply only while a hash of (prompt version, engine, D-018 facts) matches. Otherwise `judge` keeps the rule verdict and emits `aiAsk`.
- **Why:** It keeps `judge` pure and level-triggered, like the rest of the core (ADR-0002). Nobody has to remember to invalidate. An engine or model change re-asks without separate clearing logic.
- **Source:** design, this session.
- **Touches:** interfaces.md §6.2–6.3, data.md

## 2026-09-26 — AI answers persisted in GSettings, with the model's reason
- **Kind:** data
- **Fact:** `ai-verdicts` (JSON in `s`) stores the fingerprint, verdict, 80-character reason and time per occurrence key, pruned at 7 days.
- **Why:** `disable()` runs on every lock (ADR-0005). Memory-only answers would re-ask every unsure meeting after each unlock, and the rule verdict would flicker back. The reason may paraphrase a title. This is accepted, bounded, and sent to product.
- **Source:** design, this session.
- **Touches:** data.md, ADR-0008

## 2026-09-26 — Start time sent with the current UTC offset
- **Kind:** debt
- **Fact:** Core formats the D-018 start time from one UTC offset that the controller passes in. A DST change inside the 36 h window shifts the sent time by an hour for later meetings, and re-asks them once.
- **Why:** It keeps core free of time-zone reads. The error does not change importance. Repaid by passing a per-occurrence local time from the shell, if it ever matters.
- **Source:** assumed.
- **Touches:** interfaces.md §6.2

## 2026-09-26 — Headless test keyring unverified
- **Kind:** question
- **Fact:** Whether `gnome-keyring-daemon --unlock --components=secrets` works inside a private `dbus-run-session` for helper tests is not verified. If it does not, the key path is checked only in Layer 4.
- **Why:** Tests must never touch the owner's real keyring (ADR-0009).
- **Source:** assumed.
- **Touches:** testing-and-build.md Layer 2b

## 2026-09-26 — PG-3 uninstall facts folded in
- **Kind:** stack
- **Fact:** Folded into testing-and-build.md: `uninstall-check.sh` (isolated home, bus, dconf, `XDG_RUNTIME_DIR`), smoke check `9-uninstall` during a takeover, `npm run uninstall:local [-- --purge]`, install.sh honouring `XDG_DATA_HOME`, and the pitfall that `gnome-extensions uninstall` leaves the UUID in `enabled-extensions`. boundaries.md `scripts/` now names uninstall.
- **Why:** Doc drift. The code and scripts were right, and the doc was behind.
- **Source:** inbox (PG-3); `tests/smoke/uninstall-check.sh`, `tests/smoke/alert-ladder.js:512-513`, `scripts/uninstall.sh`.
- **Touches:** testing-and-build.md, boundaries.md

## 2026-09-26 — Inbox emptied (for-architecture, PG-3); for-product added (PG-4)
- **Kind:** for-product
- **Fact:** Took and removed the PG-3 entry. Added five for-product entries on PG-4: the library deviation, which cloud key, the GPU driver, key and answers on uninstall, and the AI silencing must-attend verdicts.
- **Why:** The inbox is not a log. The product findings need decisions that only the owner or product can make.
- **Source:** this session.
- **Touches:** docs/inbox.md
