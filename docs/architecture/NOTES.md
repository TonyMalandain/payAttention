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

## 2026-09-27 — PG-4 revised for D-019/D-020/D-021: ADR-0008 superseded by ADR-0010
- **Kind:** decision
- **Fact:** ADR-0010 replaces ADR-0008. In AI mode, every occurrence without an override is eligible, and one bounded invite is sent per request. ADR-0007 and ADR-0009 are amended, not superseded, because their decisions still hold.
- **Why:** The eligibility rule, the prompt input and the settings shape all changed. The separate process and the "stored data, never on the alert path" design carried over unchanged.
- **Source:** docs/product/decisions.md D-019–D-021; PRD addendum 2026-09-27.
- **Touches:** adr/, 00-index.md

## 2026-09-27 — One endpoint and model; mode key named verdict-source
- **Kind:** data
- **Fact:** `verdict-source` (`rules`/`ai`), `ai-endpoint` and `ai-model` replace `ai-enabled`, `ai-location` and the local/cloud URL and model pairs. None of those keys shipped (`extension/schemas` has no `ai-` key, checked 2026-09-27), so nothing has to be migrated.
- **Why:** The owner described one endpoint and one key. "Local or cloud" is worked out from the endpoint (`endpointClass`), so it cannot disagree with the address. The name avoids `mode`, which already means online or in-person.
- **Source:** D-021; `extension/schemas/*.gschema.xml` (no ai keys).
- **Touches:** data.md, interfaces.md §6.4

## 2026-09-27 — Keys stay per endpoint even with one key field
- **Kind:** constraint
- **Fact:** The keyring item is still keyed by the normalised endpoint.
- **Why:** If the owner edits the endpoint, a saved cloud key is never sent to the new, possibly mistyped, address. Keyless local engines need no switch.
- **Source:** design, this session.
- **Touches:** ADR-0009 amendment

## 2026-09-27 — Stale-while-revalidate for AI answers
- **Kind:** interface
- **Fact:** When the fingerprint differs, the old answer still applies (`aiStale`) while it is re-asked. The controller withholds those entries when the AI is unavailable or that key's ask failed.
- **Why:** In AI mode, RSVPs change the fingerprint close to the start. Falling back to the rules would flash an alert the AI had silenced. The controller can tell stale keys apart from `aiAsk` without computing a hash.
- **Source:** design, this session.
- **Touches:** interfaces.md §6.3, §6.5; ADR-0010

## 2026-09-27 — Invite bounds
- **Kind:** constraint
- **Fact:** Title ≤ 200, description ≤ 1 500, place ≤ 200, link ≤ 300, names ≤ 80, emails ≤ 254 characters; ≤ 25 guests plus the true total; the whole invite ≤ 8 192 bytes (guests dropped first, then the description cut).
- **Why:** On the CPU, prompt processing is the slow part. Meeting descriptions from Teams or Zoom are mostly boilerplate. The caps keep the worst case at about 2 500 tokens.
- **Source:** assumed (no local engine has been measured yet).
- **Touches:** interfaces.md §6.2, constraints.md

## 2026-09-27 — Budget and timeouts for asking every meeting
- **Kind:** constraint
- **Fact:** Still one request in flight. 120 per hour and 1 000 per 24 h, per engine tag, in memory. The timeout is 90 s for loopback or private endpoints, 45 s for public ones.
- **Why:** The owner's volume is about 5–30 requests an hour at first sight (estimated from 26 occurrences in 7 days). The daily cap guards a cloud bill against RSVP churn. Nothing waits on the queue, so serial is enough. The revisit trigger is in ADR-0010.
- **Source:** assumed.
- **Touches:** constraints.md, interfaces.md §6.5

## 2026-09-27 — Auth pause is time-boxed, not "until settings change"
- **Kind:** interface
- **Fact:** An `auth`/`config`/`no-key` failure pauses the engine for 30 min, or until an engine setting changes.
- **Why:** A key saved in prefs goes to the keyring, where the shell cannot see the change. A time box avoids adding a GSettings signal key just for that.
- **Source:** design, this session.
- **Touches:** interfaces.md §6.5

## 2026-09-27 — for-product findings on AI mode
- **Kind:** for-product
- **Fact:** Five entries were added to docs/inbox.md: cancelled/declined/all-day meetings are asked too, the calendar name is not sent, stale answers apply while a meeting is re-asked, the `http:` and key transport limits, and passcodes in video links.
- **Why:** Each one either narrows or widens D-019/D-020, or is a behaviour the owner will see.
- **Source:** this session.
- **Touches:** docs/inbox.md

## 2026-09-27 — AI eligibility narrowed by fact (D-023)
- **Kind:** interface
- **Fact:** Cancelled, owner-declined, all-day and no-start occurrences are not eligible in AI mode; their stored answers are ignored and they keep the rule's `ignore`.
- **Why:** Product decided these are facts, not importance judgments (D-023). Deciding from facts, not the rule code, keeps an all-day `not-invited` meeting unsent too.
- **Source:** docs/product/decisions.md D-023; docs/plans/PG-4a.md; inbox entry 2026-09-27 (taken and removed).
- **Touches:** interfaces.md §6.1; ADR-0010 amendment; testing-and-build.md Layer 1

## 2026-09-27 — Calendar name joins the invite (D-024)
- **Kind:** interface
- **Fact:** The invite has `calendar` after `title`, the kept copy's source name, ≤ 80 characters, `""` when unknown; it is in the fingerprint.
- **Why:** Strongest clue between family and work (D-024). Field name, place and cap follow the PG-4a plan so docs and code match.
- **Source:** decisions.md D-024; docs/plans/PG-4a.md (INVITE_CAPS, INVITE_FIELDS).
- **Touches:** interfaces.md §6.2; data.md; constraints.md; ADR-0010 amendment

## 2026-09-27 — Passcodes: link queries cut, text passcodes replaced (D-022, D-025)
- **Kind:** interface
- **Fact:** `videoLink` and allowlisted links in description/place lose query and fragment; the value after passcode/password/pwd/PIN in description/place becomes `[removed]`, before the cap.
- **Why:** Zoom repeats the link and the passcode in the description, so cutting only `videoLink` would still send it. Redacting before the cap stops a cut leaving half a passcode.
- **Source:** decisions.md D-022, D-025.
- **Touches:** interfaces.md §6.2; ADR-0010 amendment

## 2026-09-27 — PG-4a plan predates D-025
- **Kind:** question
- **Fact:** docs/plans/PG-4a.md:37 and :921 say not to redact prose passcodes ("waiting on product"); D-025 has since decided it, and interfaces.md §6.2 now requires it.
- **Why:** Without it the passcode that D-022 removes from links is still sent as text. It is a core change beside `withoutConferenceQueries`; which ticket carries it is for the senior engineer and product manager.
- **Source:** docs/plans/PG-4a.md; decisions.md D-025.
- **Touches:** interfaces.md §6.2

## 2026-09-27 — AI protocol refuses unknown keys; helper import allowlist
- **Kind:** boundary
- **Fact:** Every AI message and invite level has exactly its keys, both directions; `ai/` may import exactly core/aiProtocol.js, aiPrompt.js and aiEngine.js.
- **Why:** Both ends ship in one zip, so no version skew to tolerate; the exact key set is the guard. Keeping `invite.js` out of the allowlist means the helper can check an invite, never build or reshape one. Opposite of the calendar protocol's rule on purpose.
- **Source:** docs/plans/PG-4a.md (module layout, messages).
- **Touches:** interfaces.md §6.6; boundaries.md import rules; ADR-0010 amendment

## 2026-09-27 — Parsing stored ai-verdicts belongs in core (PG-4c)
- **Kind:** boundary
- **Fact:** Validating the stored `ai-verdicts` JSON is core's job, deferred to PG-4c.
- **Why:** Stored text is untrusted input to `judge`; parsing it in core keeps it pure and testable like the other stored formats.
- **Source:** inbox entry 2026-09-27.
- **Touches:** data.md (when PG-4c is designed)

## 2026-09-27 — Text passcodes: to end of line, on raw text (D-027)
- **Kind:** interface
- **Fact:** `core/invite.js` removes text passcodes to the end of the line, after cutting conferencing queries and before cleaning and the cap; §6.2 now says so.
- **Why:** Cleaning joins lines, so the "end of line" rule must see raw text; the separator run spans line breaks, so a value on the next line still goes. The inbox said "after cleaning"; the code changed since (d5357f0).
- **Source:** extension/core/invite.js:14-42; decisions.md D-027.
- **Touches:** interfaces.md §6.2; testing-and-build.md Layer 1

## 2026-09-27 — PG-4a design gaps closed in code
- **Kind:** interface
- **Fact:** `videoLink` scheme is lower-cased to `https://`; `normaliseAddress` is exported from `core/owner.js` and shared; `buildInvite` throws on a non-finite start.
- **Why:** The allowlist accepts any case but §6.6 requires `https://`; one normaliser keeps invite and owner matching aligned; a throw stops a future direct caller building an invalid invite silently.
- **Source:** extension/core/invite.js:4,48,73; commit d5357f0.
- **Touches:** interfaces.md §6.2

## 2026-09-27 — Licence is Apache-2.0
- **Kind:** constraint
- **Fact:** constraints.md now says Apache-2.0 (D-026), with the GPL-2.0-or-later review rule as an accepted cost.
- **Why:** The constraint predated the owner's choice; the record contradicted a closed decision.
- **Source:** decisions.md D-026.
- **Touches:** constraints.md (GNOME review rules)

## 2026-09-27 — A private bus does not isolate the keyring
- **Kind:** constraint
- **Fact:** Layer 2b now also requires throwaway `HOME`/`XDG_*` and `env -i`; a headless unlocked test keyring is verified.
- **Why:** The first Secret call D-Bus-activates gnome-keyring-daemon, which opens `$XDG_DATA_HOME/keyrings/` — the owner's real file with the real home.
- **Source:** measured by the PG-4b planner (docs/plans/PG-4b.md facts 1, 3).
- **Touches:** testing-and-build.md Layer 2b

## 2026-09-27 — The AI helper never prompts for the keyring
- **Kind:** decision
- **Fact:** Key read via `Secret.Service.search(ALL | LOAD_SECRETS)` without `UNLOCK`; locked-only gives `no-key`, none gives keyless.
- **Why:** `password_lookup` returns null for a locked item after a prompt, so it confuses locked with absent (a keyless send the ADR forbids) and shows the owner a prompt from a background process.
- **Source:** docs/plans/PG-4b.md fact 4.
- **Touches:** ADR-0009 amendment 2; interfaces.md §6.6

## 2026-09-27 — §6.7 failure cases the mapping missed
- **Kind:** interface
- **Fact:** 3xx→config, status outside 200–599→server, body >1 MiB→bad-reply, libsoup errors→network, malformed stored key→config (never sent); one `timeoutMs` deadline covers lookup, request and retry.
- **Why:** Unmapped cases invite ad-hoc codes; the cap stops memory exhaustion; the single deadline keeps the retry inside the shell watchdog.
- **Source:** docs/plans/PG-4b.md (decided in the plan).
- **Touches:** interfaces.md §6.7

## 2026-09-27 — Keyring schema constants live in core/aiEngine.js
- **Kind:** data
- **Fact:** `ENGINE_KEY_SCHEMA_NAME` and `ENGINE_KEY_ATTRIBUTE` are defined once in core.
- **Why:** Prefs writes and the helper reads; one definition means they cannot disagree on the only stored format ADR-0009 has.
- **Source:** docs/plans/PG-4b.md (ai/keyring.js).
- **Touches:** data.md

## 2026-09-27 — ai/stdio.js duplicates helper/stdio.js
- **Kind:** debt
- **Fact:** PG-4b adds a near-copy of the calendar helper's stdio module in `ai/`.
- **Why:** `ai/` may not import `helper/` (boundaries.md). Repaid by a shared stdio module both helpers may import — a boundary change, not a ticket-local one.
- **Source:** docs/plans/PG-4b.md.
- **Touches:** boundaries.md

## 2026-09-27 — Lint did not enforce the Soup/Secret/ai boundary
- **Kind:** boundary
- **Fact:** boundaries.md claimed lint forbids Soup and Secret outside `ai/`/prefs; `eslint.config.js` did not. PG-4b Step 1 adds it; boundaries.md notes the gap until then.
- **Why:** Drift: the doc stated intent, the config never caught up. Intent is the doc.
- **Source:** docs/plans/PG-4b.md:24.
- **Touches:** boundaries.md

## 2026-09-27 — Build ships LICENSE and NOTICE
- **Kind:** constraint
- **Fact:** The pack command adds `--extra-source=../LICENSE --extra-source=../NOTICE`; `scripts/build.sh` checks the zip with `grep -x`, not `grep -q`.
- **Why:** Apache-2.0 requires both files in what ships (PG-6); `grep -q` exits early, `unzip` dies of SIGPIPE and `pipefail` fails the build.
- **Source:** scripts/build.sh:15-21; inbox entry from the PG-6/PG-7 engineer.
- **Touches:** testing-and-build.md (build row, pitfalls) — folded.

## 2026-09-27 — Invite text removal order after D-029
- **Kind:** interface
- **Fact:** Description and place now go: invisible marks, conferencing queries, HTML line ends, dial-in strings, text passcodes (plurals included), cleaning, cap.
- **Why:** Marks go first so none can hide a keyword; HTML ends become line ends before the line-based passcode rule; dial strings go before the keyword rule because they carry codes with no keyword.
- **Source:** extension/core/invite.js:24-74 (PG-4a2); inbox entry.
- **Touches:** interfaces.md §6.2, testing-and-build.md layer 1 — folded.

## 2026-09-27 — Invite text: plain text first (D-030)
- **Kind:** interface
- **Fact:** `withoutPasscodes` now runs: HTML to plain text, entities decoded once, shared invisible marks dropped, separators made plain, conferencing queries cut, `%xx` decoded, dial strings removed, text passcodes removed, cleaned, capped.
- **Why:** Rule-by-rule fixes kept meeting new formats; converting to one format first closes whole classes of leak. Entities after tags, in one pass, so an encoded tag stays text and is never read as a line end.
- **Source:** extension/core/invite.js:24-122 (PG-4a3); inbox entry.
- **Touches:** interfaces.md §6.2, testing-and-build.md layer 1 — folded.

## 2026-09-27 — One shared INVISIBLE_MARKS list
- **Kind:** interface
- **Fact:** `core/aiProtocol.js` exports `INVISIBLE_MARKS`; `cleanText` (invite fields and AI reasons) and the invite builder both use it, and `validateInvite` rejects any text `cleanText` would change.
- **Why:** Two lists drift; a mark the builder misses but the validator allows could hide a keyword. One list makes "cleaned" mean the same thing everywhere.
- **Source:** extension/core/aiProtocol.js:52-76, 128-130.
- **Touches:** interfaces.md §6.2, §6.8 — folded.

## 2026-09-27 — Passcode removal is best effort
- **Kind:** constraint
- **Fact:** Removal of passcodes and dial-in strings is a courtesy, not a guarantee; Settings says so beside the "whole invite is sent" warning.
- **Why:** The owner chose to send the whole invite (D-020); chasing every crafted format has no end (D-030). A new format that slips through is a known limit, and adding a rule for it is a product call.
- **Source:** docs/product/decisions.md D-030.
- **Touches:** interfaces.md §6.2, §6.9; testing-and-build.md — folded.

## 2026-09-27 — Dial-string scan must stay linear
- **Kind:** constraint
- **Fact:** The dial-in rule finds each number once and resumes after it; no backtracking pattern over digit runs.
- **Why:** Invite text is untrusted and runs inside gnome-shell; a super-linear regex on a long digit run freezes the desktop.
- **Source:** extension/core/invite.js:36-39, 82-97.
- **Touches:** interfaces.md §6.2 step 7 — folded.

## 2026-09-27 — Helpers spawned without G_MESSAGES_DEBUG
- **Kind:** interface
- **Fact:** Every helper spawner (calendar feed, shell AI side, prefs "Test connection") removes `G_MESSAGES_DEBUG` from the child environment; the list is one core constant.
- **Why:** With it set, GLib's default writer sends DEBUG/INFO (endpoint URL included) to stdout, the protocol channel, whenever stderr is not the journal. The helper cannot redirect it itself.
- **Source:** measured 2026-09-27, gjs 1.88.1 / GLib 2.88.3: without the variable stdout is clean; with journal stderr (systemd-cat) GLib writes to the journal; `GLib.log_writer_default_set_use_stderr(true)` in module code fails `g_thread_n_created () == 0`, and GIO DEBUG lines print before module code. Inbox, PG-4b.
- **Touches:** interfaces.md §1 (Environment), §6.6 — folded.

## 2026-09-27 — Env strip rejected in favour of an in-helper writer: not possible
- **Kind:** decision
- **Fact:** Option not taken: each helper installing its own log writer.
- **Why:** Under gjs the default-writer switch asserts (threads exist before module code) and gjs/GIO log before the helper runs, so it would miss lines. Cost accepted: helper library debug output is only seen by running the helper by hand.
- **Source:** measurement above.
- **Touches:** interfaces.md §1 — folded.

## 2026-09-27 — Env rule lands with PG-4c and PG-4d
- **Kind:** for-product
- **Fact:** The shell spawns (the new AI spawn and `shell/calendarFeed.js:100`) belong in PG-4c; prefs' probe spawn (`docs/plans/PG-4d.md:566`, `Gio.Subprocess.new`) belongs in PG-4d. PG-4b needs no change.
- **Why:** The fix is in spawn code, not in the helpers; the calendar feed spawn is shell code PG-4c already touches in kind. Ticket scope is the product manager's to confirm.
- **Source:** extension/shell/calendarFeed.js:100-101; docs/plans/PG-4d.md:566.
- **Touches:** none (ticket scope).

## 2026-09-27 — PG-4a3 fix round folded
- **Kind:** interface
- **Fact:** §6.2 step 1 now names comments, `<style>`/`<script>` blocks, conditional markers, namespaced tags and opening line-end tags; step 7 allows spaces only before a pause, never before `#`/`*`.
- **Why:** "Order 1234567 #urgent" is not a dial string; Outlook HTML carries passcodes behind those constructs.
- **Source:** extension/core/invite.js:36-55, 57-107; inbox.
- **Touches:** interfaces.md §6.2 — folded. The `ai/stdio.js` duplicate was already recorded (boundaries.md, NOTES 2026-09-27).

## 2026-09-27 — D-031: engine down split from per-meeting failure
- **Kind:** interface
- **Fact:** §6.5 now keeps two failure states: `engineDown` (engine-level failures, budget refusal, lost helper, client failure; cleared by a verdict or `bad-reply`) and `failedKeys` (any `failed`, cleared by that key's verdict); withholding uses both, and the status is `unavailable` only while a waiting meeting has engine down or its key failed.
- **Why:** One sticky flag both withheld and drove the menu line, so one bad invite kept "AI unavailable" on while every other meeting had a current answer (D-031 part 1).
- **Source:** docs/product/decisions.md D-031; docs/plans/PG-4c.md:289-310; inbox.
- **Touches:** interfaces.md §6.5, data.md, ADR-0010 amendment — folded.

## 2026-09-27 — D-031: unreachable codes pause the engine, capped at 90 s, spends returned
- **Kind:** constraint
- **Fact:** `network`/`timeout`/`tls`/`server` pause the engine 30 s doubling to 90 s; outage probes do not advance per-meeting retry; their spends (and `lost`'s) are refunded via `RequestBudget.refund`.
- **Why:** Per-meeting backoff alone reaches 30 min and 30 waiting meetings spend the 120/h budget in about 4 min, so recovery could take an hour. 90 s is the largest cap keeping first answer ≤ 5 min: 100 s in-flight + 90 s pause + 1 s pump + 90 s answer ≈ 281 s.
- **Source:** D-031; constraints.md timeouts (90 s local, watchdog +10 s); arithmetic, not measured.
- **Touches:** interfaces.md §6.5, constraints.md — folded.

## 2026-09-27 — Option not taken: separate engine health check
- **Kind:** decision
- **Fact:** Recovery probes are real asks of the soonest waiting meeting, not a `/models` or ping request.
- **Why:** A second request shape widens the helper protocol and proves only that the address answers; the real ask is both the probe and the work.
- **Source:** assumed (design judgement).
- **Touches:** ADR-0010 amendment — folded.

## 2026-09-27 — ADR-0010 Consequences contradicted §6.3 on engine change
- **Kind:** decision
- **Fact:** After an engine or model change, stored answers become stale and keep applying while re-asked; ADR-0010 wrongly said rule verdicts show. Corrected in place with a dated note.
- **Why:** Drift inside the record; §6.3 and data.md were the intent (flicker avoidance is the ADR's own deciding reason).
- **Source:** inbox (PG-4c plan finding).
- **Touches:** ADR-0010 — folded.

## 2026-09-27 — constraints.md "tick does not read AI state" tightened
- **Kind:** constraint
- **Fact:** The tick reads the queue's last published frozen state and makes one call, the daily prune (in-memory filter + coalesced write); it never calls or waits on the helper.
- **Why:** The old wording was false as written and a reviewer would have flagged a correct build.
- **Source:** docs/plans/PG-4c.md:42-46; inbox.
- **Touches:** constraints.md — folded.

## 2026-09-27 — PG-4d/PG-4e plan notes folded
- **Kind:** boundary
- **Fact:** prefs.js stays one root file (widgets, keyring write, probe run) with decisions in `core/aiSetup.js`; key rule is `isSendableKey`/`MAX_KEY_LENGTH` in `core/aiEngine.js`; §6.9 now "as applied"; `uninstall.sh` repeats the key schema name, guarded by the uninstall check; `gtk4-broadwayd -u` and `glib-compile-resources` listed for tests.
- **Why:** GNOME loads prefs.js from the root; a directory for one file is structure without a second caller. Acting on unapplied fields could save a key under an address it is never sent to. A shell script cannot import core after removal. broadwayd without `-u` listens on TCP on every interface.
- **Source:** docs/plans/PG-4d.md:41-42, 56, 83; docs/plans/PG-4e.md:45; inbox.
- **Touches:** interfaces.md §6.7, §6.9; boundaries.md; data.md; testing-and-build.md — folded.

## 2026-09-27 — Loopback endpoints bypass the proxy
- **Kind:** interface
- **Fact:** An ask to a loopback endpoint never goes through a proxy; other endpoints honour the desktop proxy.
- **Why:** A proxy whose ignore list lacks loopback would receive the bearer key in clear over `http:` and carry the invite off the computer, breaking the "stays on this computer" claim. Option not taken: leave it to GNOME's default ignore list (true by default, but the owner can change it). Not yet in code: `extension/ai/transport.js:45` builds one session with the default resolver. No key can be saved before the settings page (PG-4d), so the exposure starts there.
- **Source:** inbox (PG-4b review); `gsettings get org.gnome.system.proxy ignore-hosts` = localhost, 127.0.0.0/8, ::1; gjs: `Soup.Session` default `proxy_resolver` is GProxyResolverGnome, `proxy_resolver: null` gives null (measured 2026-09-27).
- **Touches:** interfaces.md §6.7, stack.md — folded.

## 2026-09-27 — Engine pause reset aligned with §6.5
- **Kind:** constraint
- **Fact:** The unreachable backoff resets on `verdict`, `bad-reply` or an engine change, not on "any engine reply".
- **Why:** `auth` and `rate-limited` are replies too but set their own longer pause; the §6.5 table was the intent and the row was drift.
- **Source:** interfaces.md §6.5 table; inbox (PG-4c plan).
- **Touches:** constraints.md — folded.

## 2026-09-27 — Smoke failure codes include the AI codes
- **Kind:** constraint
- **Fact:** The smoke fails on `ai-failed`, `ai-protocol-mismatch`, `ai-spawn-failed` as well.
- **Why:** The document was one release behind `scripts/smoke.sh:106`.
- **Source:** scripts/smoke.sh:105-106.
- **Touches:** testing-and-build.md Layer 3 — folded.

## 2026-09-27 — Timing guards: keep the bounds, time the fastest run
- **Kind:** constraint
- **Fact:** The 20 ms judge bound stays; the tests compare the fastest of at least 10 timed runs after warm-up instead of the mean of 10 after 2.
- **Why:** Measured judge over 2 000 events at 5.4–7.7 ms mean, 9.5–10.8 ms worst single run, alone; the bound has about 3x margin, so the flake is measurement, not budget. Parallel test files and GC only add time, so the minimum is stable while still catching an order-of-magnitude regression. Options not taken: raising the bound (hides real regressions), running the budget file serially (slows the suite and CI still shares the machine). Same change applies to the plan and AI-mode guards in the same file.
- **Source:** tests/unit/budget.test.js:15-22, 61-65; ad hoc run of the same fixture, 3x30 runs (measured 2026-09-27); inbox (PG-4c).
- **Touches:** testing-and-build.md Layer 1, constraints.md — folded.

## 2026-09-27 — A key lost twice in a row backs off like a failure
- **Kind:** interface
- **Fact:** The AI queue counts each key's own `lost` outcomes in a row; from the second (`LOST_STREAK_LIMIT` = 2) the key joins failed keys and its retry advances; the count is deleted on that key's `verdict` or `failed`, and on an engine change. Spend is still returned.
- **Why:** Product rule: one meeting's invite must never block AI answers for other meetings. Before this, `lost` left no retry record, so an invite that crashed the helper every time stayed at the queue head forever and AI mode quietly stopped. Two, not one, so a single system-killed helper costs a meeting nothing. `downAtSend` cannot gate it: the first `lost` sets engine down, so the re-ask is always sent "while down". Option not taken: have the client report whether the helper was handed the invite (would spare innocent keys during a spawn failure) — a change to `AiOutcome` for a case where nothing can be asked anyway. Accepted price: while the helper cannot start, waiting keys back off one by one (first retry 1 min).
- **Source:** inbox (PG-4c review); `extension/shell/aiQueue.js:346-351` (lost path, no retry), `extension/shell/aiHelperClient.js:75, 202, 242` (the three `lost` sources).
- **Touches:** interfaces.md §6.5 table and "Lost streak" note, constraints.md "AI retry per occurrence" — folded. Carried by a small follow-up to PG-4c (S: `shell/aiQueue.js` and its tests only).

## 2026-09-27 — Handoff taken: owner's ports-and-adapters principle
- **Kind:** decision
- **Fact:** Took the product handoff of the owner's "the gnome-extension should be a shell" statement (product NOTES, 2026-09-27); recorded as ADR-0011 (three rings core/app/adapters, named ports, only the verdict component calls judge).
- **Why:** The preview (R-20) is the first second front end; without a named principle it would copy the composition.
- **Source:** the owner via product NOTES; code read at 8cc50e5.
- **Touches:** ADR-0011, boundaries.md, overview.md — folded.

## 2026-09-27 — Leak: verdict pipeline private to the alert controller
- **Kind:** boundary
- **Fact:** Engine sync, AI pump, dirty flag and the two-pass judge with withheld answers live in `extension/shell/controller.js:217-272, 376-383`; the constructor writes (prune, line 117).
- **Why:** A second front end could only reuse it by building the whole controller, which writes and ticks; this blocks PG-8's "no copy" and "never writes".
- **Source:** extension/shell/controller.js.
- **Touches:** interfaces.md §7.2 — designed.

## 2026-09-27 — Leak: store port is one read-write facet
- **Kind:** interface
- **Fact:** StorePort (`controller.js:21-37`) has no read-only facet; §7.2 splits it into reader and writer.
- **Why:** "Never writes" should be structural (the preview is never handed a writer), not a promise.
- **Source:** extension/shell/controller.js:21-37.
- **Touches:** interfaces.md §7.2 — designed.

## 2026-09-27 — Snapshot protocol is source-neutral
- **Kind:** interface
- **Fact:** The Occurrence DTO is iCalendar-shaped; Graph and Google Calendar expose every field it needs; `backend`, `remote`, `connection` are EDS-named and now defined by meaning.
- **Why:** The owner asked whether an O365/Google reader could replace EDS; the answer is yes as a new reader process with no protocol change. A network-backed reader would still need an ADR (network is the AI helper's only).
- **Source:** interfaces.md §1; Graph `iCalUId`/`showAs`/`onlineMeeting`, Google `iCalUID`/`originalStartTime` (from knowledge, not re-verified today — assumed).
- **Touches:** interfaces.md §1, ADR-0011 — folded.

## 2026-09-27 — Option not taken: full re-layout outside extension/
- **Kind:** decision
- **Fact:** core/ and app/ stay under `extension/`; the only move is gi-free modules from `shell/` to a new `app/`.
- **Why:** Every front end (extension, prefs, preview) runs from the installed pack; moving code out of the pack root costs a build assembly step and every import path for no present caller. Revisit if anything ships outside the GNOME zip.
- **Source:** assumed (design judgement).
- **Touches:** ADR-0011.

## 2026-09-27 — Preview runtime is gjs, not Node
- **Kind:** stack
- **Fact:** PG-8 is a gjs program in `extension/preview/`, shipped in the pack and run from the install directory (ADR-0012).
- **Why:** Node has no EDS or GSettings binding; it would need second implementations of the helper supervisors and a dconf reader (a copy), and would make Node a runtime dependency. Running from the installed copy is the only way the previewed code is the installed code.
- **Source:** extension/shell/calendarFeed.js, aiHelperClient.js, helperProcess.js; testing-and-build.md (schemas compiled into the install dir).
- **Touches:** ADR-0012, interfaces.md §7.3.

## 2026-09-27 — Preview read-only by delay-apply plus reader facet
- **Kind:** constraint
- **Fact:** The preview calls `Gio.Settings.delay()` before reading and never `apply()`, and holds only the store's reader facet; a keyfile-backend test checks no bytes change.
- **Why:** Belt and braces: the facet stops writes by design, delay-apply stops an accidental one from reaching dconf, the test proves it.
- **Source:** assumed (design); GSettings delay-apply semantics.
- **Touches:** interfaces.md §7.3, ADR-0012.

## 2026-09-27 — Terminal injection from invite titles
- **Kind:** constraint
- **Fact:** Every calendar- or engine-derived string the preview prints goes through `core/aiProtocol.js` `cleanText` (controls incl. ESC/C1 to spaces, bidi overrides removed).
- **Why:** Titles come from strangers; a raw ESC sequence in a title can rewrite the owner's terminal. Reusing cleanText keeps one cleaning rule.
- **Source:** extension/core/aiProtocol.js:71-77.
- **Touches:** interfaces.md §7.3 — folded.

## 2026-09-27 — Inbox PG-4e purge measurement folded
- **Kind:** constraint
- **Fact:** `--purge` on a locked keyring fails (exit 1) because `password_clear` returns false silently; keys are cleared before settings.
- **Why:** Was in the inbox only; the PG-4d entries were already folded (entry "PG-4d/PG-4e plan notes folded").
- **Source:** docs/inbox.md (PG-4e).
- **Touches:** testing-and-build.md — folded. The inbox entries stay: the inbox header says the owner removes them.

## 2026-09-27 — Preview may double engine asks
- **Kind:** for-product
- **Fact:** In AI mode the preview asks the engine for meetings with no current stored answer and never stores the answers, so the extension asks again; with both running an engine sees up to 240 asks/h.
- **Why:** "Never changes anything" (PG-8) forbids sharing answers through the store; the price is cost on a cloud engine and invites sent twice.
- **Source:** ADR-0012.
- **Touches:** docs/inbox.md (for-product), README when PG-8 is built.

## 2026-09-27 — app/ paths folded after PG-8a
- **Kind:** boundary
- **Fact:** boundaries.md, interfaces.md (§2, §3, §6.5, §7.1), overview.md, testing-and-build.md and ADR-0011 Leak 1 now name `app/` for the seven moved modules; `app/` is in the "must not import" column of helper/, ai/, ui/ and prefs.js, and extension.js may import it.
- **Why:** The docs still named `shell/`; the documented build command lacked `--extra-source=app` (and `ai`), so following it built a zip that fails to import.
- **Source:** docs/inbox.md (PG-8a/8b plan findings, removed); scripts/build.sh; eslint.config.js; extension/extension.js:8-15; extension/shell/calendarFeed.js:11-12.
- **Touches:** folded.

## 2026-09-27 — One caller of core/judge.js gets a lint guard, in PG-8c
- **Kind:** decision
- **Fact:** Only `app/verdicts.js` may import `core/judge.js`; the lint guard is carried by PG-8c, not PG-8b.
- **Why:** The guard is cheap and makes ADR-0011's single-caller rule structural; PG-8b is mid-build and its plan should not move under it, while PG-8c already edits eslint.config.js to forbid judge.js in preview/. The gap between the two is held by review.
- **Source:** eslint.config.js; docs/plans/PG-8b.md; human request (caller's instruction to decide).
- **Touches:** boundaries.md "One caller of core/judge.js" — folded.

## 2026-09-27 — ESLint flat config replaces rule options per block
- **Kind:** constraint
- **Fact:** When two flat-config blocks match a file and both set `no-restricted-imports`, the later block's options replace the earlier ones, so a cross-cutting guard must be added into each directory's pattern list, not as its own block.
- **Why:** A separate "judge.js" block would silently switch off the per-directory boundary rules for every file it matches.
- **Source:** ESLint flat config semantics (rule config merge overrides options); eslint.config.js structure.
- **Touches:** boundaries.md — folded.

## 2026-09-27 — PG-8b surface folded into interfaces §3 and §6.5
- **Kind:** interface
- **Fact:** interfaces.md §3 now describes Controller ↔ Verdicts ↔ UI: the controller's deps (`createStoreReader`/`createStoreWriter` replace `createStore`), which part each factory goes to, the two store facets' methods, and `Verdicts`' exposed surface; §6.5 now says the AI queue lives in the verdict component; §7 marks 7.2 built.
- **Why:** The single `StorePort` is gone and port typedefs now live with their consumer (`StoreReaderPort`, `FeedPort` in `app/verdicts.js`; `StoreWriterPort` in `app/controller.js`), so the old §3 named a contract that no longer exists.
- **Source:** extension/app/verdicts.js:14-58,93-174; extension/app/controller.js:18-60,141-150; extension/shell/store.js; extension/extension.js:24-26; commit 770c7dd.
- **Touches:** interfaces.md §2, §3, §6.5, §7 — folded.

## 2026-09-27 — Data ownership split by store facet
- **Kind:** data
- **Fact:** The verdict component reads through `StoreReader` and writes nothing itself (AI answers go through the controller-injected `writeAnswers`); every shell write goes through the controller's `StoreWriter`, which writes no owner settings key today.
- **Why:** The reader facet is what makes "the preview never changes anything" (ADR-0012) structural rather than a promise; the ownership table must show that seam.
- **Source:** extension/shell/store.js (StoreReader has no write method, private `#settings`); tests/smoke/store-check.js:162-175.
- **Touches:** boundaries.md "Ownership of data" and the stale "until PG-8b lands" sentence; overview.md subsystem table (Store row, new Verdict component row, Controller row) — folded.

## 2026-09-27 — `ai-verdicts` is read once, at construction
- **Kind:** data
- **Fact:** `ai-verdicts` is in `INTERNAL_KEYS`, so the reader's change signal never fires for it; the AI queue's in-memory answers are the live copy after the verdict component is built.
- **Why:** Otherwise the extension's own coalesced answer writes would trigger a full input reload and re-judge on every answer.
- **Source:** extension/shell/settingsKeys.js:30; extension/app/verdicts.js:76-79.
- **Touches:** interfaces.md §3 — folded.

## 2026-09-27 — Same-value GSettings writes are invisible to `changed`
- **Kind:** constraint
- **Fact:** On the memory backend a same-value write emits no `changed`, so tests must use `delay()` plus `get_has_unapplied()` to prove "no write happened".
- **Why:** A signal-counting check passes whether or not the code wrote, so it cannot guard the reader's read-only promise or the writer's no-op re-write.
- **Source:** tests/smoke/store-check.js:162-188; caller (PG-8b build).
- **Touches:** testing-and-build.md "Pitfalls" — folded.

## 2026-09-27 — PG-8c preview surface folded into §7.2 and §7.3
- **Kind:** interface
- **Fact:** `Verdicts.aiProgress(now)` → `{pending, byRules}` (via `aiProgressOf` in `app/aiQueue.js`, over `isWaiting`) is part of the verdict component's contract; the preview prints when `pending` is 0 or 5 min after the first snapshot.
- **Why:** The preview must wait on the same definition of "waiting" as the AI status, or its footer and the extension's "AI unavailable" would disagree; calling it also drives the AI pump, which a reader of the contract would not guess.
- **Source:** extension/app/verdicts.js:137-149 (aiProgress at :145); extension/app/aiQueue.js:108-132 (aiProgressOf at :120); extension/preview/session.js (step); inbox PG-8c plan notes.
- **Touches:** interfaces.md §7.2, §7.3 — folded.

## 2026-09-27 — Preview exit codes and JSON rules
- **Kind:** interface
- **Fact:** Stopped by a signal the preview exits 128 + signum (130 SIGINT, 129 SIGHUP, 143 SIGTERM); its JSON is ASCII-only with `cleanText` on title, reason and calendar strings but never on `key`/`seriesKey`; `overridden` is `verdictOverridden`; `generatedAt` is the moment the list was computed.
- **Why:** gjs `print()` converts to the locale charset, so raw UTF-8 could corrupt the one machine-readable output; keys must stay byte-identical to stored override keys; a mode override is not "your choice" of verdict.
- **Source:** extension/preview/cli.js:8-24; extension/preview/report.js (previewJson, asciiJson); tests/helper/preview.test.js SIGINT case.
- **Touches:** interfaces.md §7.3 — folded.

## 2026-09-27 — Preview import split: one gi entry, gi-free logic
- **Kind:** boundary
- **Fact:** Only `preview/main.js` may import gi (Gio, GLib, GLibUnix), `system` and the five shell adapters; the other preview files are linted like `app/`; from `app/` only `verdicts.js`; `StoreWriter` and dynamic `import()` are lint errors.
- **Why:** Keeps the preview's logic Node-testable and makes "reads only, never judges on its own" structural (ADR-0012) rather than reviewed; GLibUnix is needed because `GLib.unix_signal_add` moved there.
- **Source:** eslint.config.js (PREVIEW_COMMON and the two preview blocks).
- **Touches:** boundaries.md import-rule table — folded; the single-judge-caller guard is now lint-enforced, bullet updated.

## 2026-09-27 — The store runs outside the shell, so no connectObject
- **Kind:** constraint
- **Fact:** `shell/store.js` uses plain `connect`/`disconnect` because the preview runs it under plain gjs, where `connectObject` does not exist; `shell/environment.js` and `ui/` still use `connectObject`.
- **Why:** A shell adapter shared with a non-shell front end cannot rely on the shell's GObject monkey-patches; this is the rule for any future adapter the preview reuses.
- **Source:** extension/shell/store.js:43,85; commit e30f715; extension/shell/environment.js:17,29.
- **Touches:** testing-and-build.md "Pitfalls" — folded.

## 2026-09-27 — test:helper depends on a fresh build
- **Kind:** constraint
- **Fact:** `tests/helper/preview.test.js` installs `dist/` zip into a throwaway home and refuses to run when the zip is missing or older than `extension/`, so validation step 5 needs step 4 first; the build now packs and checks `preview/`.
- **Why:** The preview runs only from an installed copy (ADR-0012), so the only honest integration test is against the shipped zip.
- **Source:** tests/helper/preview.test.js:43-49; scripts/build.sh; package.json `preview` script.
- **Touches:** testing-and-build.md validation table and new Layer 2c — folded.

## 2026-09-29 — UUID becomes payattention@tonymalandain.github.io (D-034)
- **Kind:** decision
- **Fact:** ADR-0006 amended: the UUID is `payattention@tonymalandain.github.io`; schema id/path and the keyring schema name are unchanged, so no data migrates; the old literal is removed from every architecture document.
- **Why:** The owner does not want their work domain in the project (D-034); neither storage name contains the domain, so only the install identity moves.
- **Source:** docs/product/decisions.md D-034; grep of extension/ shows no JS names its own UUID (only metadata.json).
- **Touches:** adr/ADR-0006, 00-index, overview, boundaries, interfaces §7.3, ADR-0012, testing-and-build — done.

## 2026-09-29 — Former copies are found by settings schema, not by name
- **Kind:** interface
- **Fact:** install.sh/uninstall.sh treat any real `payattention@*` directory (≠ new UUID) whose metadata declares `org.gnome.shell.extensions.payattention` as a former copy.
- **Why:** The old UUID may not appear anywhere in the repository (owner, D-034), and splitting the literal to dodge grep would defeat the point; the schema is the stable identity (ADR-0006).
- **Source:** owner requirement relayed by the product manager, 2026-09-29.
- **Touches:** testing-and-build.md "Switching an existing install to the new UUID" — folded.

## 2026-09-29 — "Loaded" is asked of the shell with GetExtensionInfo; the shell deletes what it holds
- **Kind:** constraint
- **Fact:** `gdbus call … org.gnome.Shell.Extensions.GetExtensionInfo U` is tri-state (error = no shell, `(@a{sv} {},)` = unknown, dict with uuid = in the shell's map); `gnome-extensions info` exits 2 for both "unknown" and "no shell"; a copy the shell holds is removed only through the shell's UninstallExtension, which awaits disable before deleting.
- **Why:** The shell scans every extension directory at login, so a present former copy is always in its map; deleting its files from a script could break a later helper spawn or re-enable. The query only does lookup + serialise.
- **Source:** measured on the live session 2026-09-29 (gnome-shell 50.5); gnome-shell `ui/shellDBus.js` GetExtensionInfo/UninstallExtension, `ui/extensionDownloader.js:73-96`, `ui/extensionSystem.js:444-460,562-597` (extracted from libshell-18.so).
- **Touches:** testing-and-build.md switch-over rule — folded.

## 2026-09-29 — The switch-over costs alerts until the next login
- **Kind:** for-product
- **Fact:** Removing the former UUID from `enabled-extensions` makes the running shell disable it at once, and on Wayland the new copy loads only at login, so payAttention is silent from install until logout/login.
- **Why:** Two copies can never be listed as enabled at the next login, and nothing runs between shell exit and the next shell start that could swap them later; the gap is the price of the no-double-enable rule. install.sh tells the owner to log out now.
- **Source:** gnome-shell `ui/extensionSystem.js:562-597` (`_onEnabledExtensionsChanged` disables removed UUIDs live).
- **Touches:** ADR-0006 consequences — recorded; product manager to tell the owner.

## 2026-09-29 — Current-UUID uninstall cannot tell "no shell" from "unknown"
- **Kind:** question
- **Fact:** uninstall.sh step b uses `gnome-extensions info`, which exits 2 in both cases, so run with no reachable shell it `rm -rf`s the current copy even if a shell (on another bus) has it loaded.
- **Why:** The switch-over rule uses the tri-state gdbus query for former copies; the current-UUID path predates the measurement. Not changed here (scope); the same query would close it.
- **Source:** scripts/uninstall.sh:45-68; measured 2026-09-29.
- **Touches:** testing-and-build.md Pitfalls when decided.

## 2026-09-30 — The heads-up hold is a plan input, not UI state (PG-11 Part B)
- **Kind:** decision
- **Fact:** "While the travel boxes are shown the heads-up stays" is a required `plan()` env field `heldHeadsUpKey`, fed from controller memory; the UI only draws `travel.choicesOpen` and dispatches `toggleTravelChoices {key}`.
- **Why:** Visibility is decided only in `plan()` (ADR-0002); holding the card from `ui/` would draw a card the Plan says is gone. Rejected alternative: re-stamping `headsUpShownAt` through the reducer, which writes durable alert state every tick for a transient fact and breaks "shown once".
- **Source:** docs/plans/PG-11.md "For the architect"; PRD docs/prd/meeting-guardian.md §4; extension/core/plan.js:108-110.
- **Touches:** overview.md "Visible?" and glossary, interfaces.md §2 and §3, data.md "What is not stored" — folded.

## 2026-09-30 — A hold only lengthens the earlier-deadline rule; it cannot suppress a takeover
- **Kind:** constraint
- **Fact:** While held, a step-1 card with an earlier deadline stays primary over another meeting's visible nudge (and, with non-default step times, its insist, which then plays no sound because sound follows `view.alert`); a takeover still wins (`byPrimaryOrder`, extension/core/plan.js:60-69) and drops the hold.
- **Why:** Pre-existing PRD overlap rule ("earlier deadline takes the card"), today bounded by the 15 s display; the hold extends it up to the nudge. With default offsets (in-person nudge 5 min, online insist 3 min) a later-deadline insist cannot coincide with a held step 1.
- **Source:** extension/core/plan.js:60-69, 108-110; extension/app/controller.js:243-247; PRD §3 table.
- **Touches:** reported to product; no doc change.

## 2026-09-30 — Closed: the hold yields to any other meeting at step 2 or later
- **Kind:** decision
- **Fact:** The overlap consequence above is closed. `plan()` ignores `heldHeadsUpKey` while any other active occurrence is visible at step ≥ 2, so the Plan equals the no-hold Plan. The controller drops the hold on the render where the Plan shows such an occurrence (primary or `also`), so the hold ends rather than resuming later.
- **Why:** Product decision "The travel-box hold never delays another meeting" (docs/product/NOTES.md 2026-09-30, PRD §4). Keeping it in `plan()` makes the yield happen on the same tick, sound included, with no one-render lag. Keeping the drop in the controller makes it final. What is left is only the pre-existing earlier-deadline rule during an unspent heads-up display time (15 s by default), which is the same with or without a hold. Snoozed meetings do not count until their snooze ends, because a snooze, not the hold, is what hides them.
- **Source:** product manager decision; extension/core/plan.js:60-69, 108-110.
- **Touches:** interfaces.md §2 (effect of `heldHeadsUpKey`) and §3 (drop rule), overview.md "Visible?", all folded.

## 2026-09-30 — overview.md said the UI reports "heads-up shown"
- **Kind:** interface
- **Fact:** The controller dispatches `headsUpShown` from `recordHeadsUpShown`; the UI never reports it. overview.md "Visible?" wording corrected to match interfaces.md §2 and extension/app/controller.js:215-218.
- **Why:** Drift in the doc; the code and §2 agreed.
- **Source:** extension/app/controller.js:215-218.
- **Touches:** overview.md — fixed.

## 2026-09-30 — The sample shell is accepted as a developer command (PG-11 Part D)
- **Kind:** stack
- **Fact:** `mutter-devkit` becomes a development-only tool on the owner's machine, used only by `npm run sample` window mode; the smoke and the validation sequence must keep running without it.
- **Why:** gnome-shell 50.5 has no `--nested` mode; `--devkit` is the only way to see a nested shell in a window, and `--display-server` would take the real seat. Keeping `--check` devkit-free keeps the validation sequence runnable on any machine with GNOME Shell 50.
- **Source:** `gnome-shell --help` (measured 2026-09-30); docs/plans/PG-11.md Part D.
- **Touches:** stack.md, testing-and-build.md Layer 3/3b — folded.

## 2026-09-30 — One isolation environment for throwaway shells
- **Kind:** boundary
- **Fact:** `scripts/isolated-shell.sh` is the single definition of a throwaway shell's environment; a second inline copy is a defect. `uninstall-check.sh` stays separate on purpose.
- **Why:** The `env -i` list is what keeps a test shell off the owner's bus, dconf and data; two copies drift and one of them stops being safe.
- **Source:** scripts/smoke.sh step 5 (today's only copy); PG-11 Part D Seams 1.
- **Touches:** boundaries.md layout, testing-and-build.md Layer 3 — folded.

## 2026-09-30 — The sample shares Wayland, XDG_RUNTIME_DIR (PipeWire/Pulse) and the system bus with the live session
- **Kind:** constraint
- **Fact:** Accepted shared channels: the viewer window on the owner's compositor, the runtime dir (so the picture and any alert sound go through the owner's PipeWire), and the real system bus; none stores the owner's data.
- **Why:** The window is the point of the sample; a private PipeWire would be a second media stack to run for one look. The viewer using PipeWire is `assumed` from mutter's devkit design, to be confirmed by the first run.
- **Source:** assumed; libmutter-18.so strings (`org.gnome.Mutter.Devkit`, `/usr/libexec/mutter-devkit`).
- **Touches:** testing-and-build.md Layer 3b — folded.

## 2026-09-30 — Sample viewing aids must be existing settings
- **Kind:** constraint
- **Fact:** The sample's longer heads-up is `headsup-display-seconds=120` in its throwaway keyfile, within the setting's own 5–120 range; any other viewing aid must likewise be an existing setting, never sample-only code under `extension/`.
- **Why:** The owner confirms PG-11 by looking at the sample; if the sample ran different code, the look would not confirm what ships.
- **Source:** extension/schemas/…gschema.xml:51; data.md.
- **Touches:** testing-and-build.md Layer 3b — folded.

## 2026-09-30 — The "never delays another meeting" drop applies only to a step-1 opening
- **Kind:** interface
- **Fact:** The controller drops open travel choices because another occurrence is visible at step ≥ 2 only when they were opened at step 1; choices opened on a nudge card are closed only by the key/step rule.
- **Why:** Only a held heads-up can delay another meeting; applying the drop to a nudge card turned "Change travel time" off in the back-to-back case where it matters most (PG-11 Part B review regression).
- **Source:** product manager, docs/product/NOTES.md 2026-09-30 "Changing travel time always works on a nudge card".
- **Touches:** interfaces.md §3, overview.md "Visible?" — folded.

## 2026-09-30 — Throwaway shells run on a private allowlist bus owned by isolated_run
- **Kind:** constraint
- **Fact:** `isolated_run` always starts its own `dbus-run-session` with a generated config whose only service directory holds copies of `ISOLATED_BUS_SERVICES`; callers cannot add a bus, nest a bus launcher, or pass any extra outside `ISOLATED_RUN_EXTRAS`.
- **Why:** With `DBUS_SESSION_BUS_ADDRESS` unset GLib falls back to `$XDG_RUNTIME_DIR/bus`, the owner's live bus; leaving the private bus to each caller made safety depend on memory. A blocklist of masked names had already missed four keyring names, and blocklists fail open.
- **Source:** docs/plans/PG-11.md "Part D fix round 1" (reviewer's measurement of 0b9d1a8).
- **Touches:** testing-and-build.md Layer 3 isolation paragraph — folded.

## 2026-09-30 — Seven D-Bus names start a keyring on this machine
- **Kind:** constraint
- **Fact:** `org.freedesktop.secrets`, `org.gnome.keyring`, `org.freedesktop.impl.portal.Secret` (gnome-keyring-daemon), `org.kde.secretservicecompat`, `org.freedesktop.impl.portal.desktop.kwallet` (ksecretd), `org.kde.kwalletd5`, `org.kde.kwalletd6` (kwalletd6); the tripwire list lives only in `tests/smoke/isolation-check.sh`.
- **Why:** gnome-keyring-daemon started with a shared runtime folder reaches the owner's running daemon via `$XDG_RUNTIME_DIR/keyring/control`; the list is a tripwire over the allowlist, not the protection itself.
- **Source:** senior engineer's measurement of `/usr/share/dbus-1/services`, Fedora 44, 2026-09-30 (docs/plans/PG-11.md).
- **Touches:** testing-and-build.md Layer 3b — folded.

## 2026-09-30 — Isolation checks never activate a service
- **Kind:** constraint
- **Fact:** Checks prove the bus by `ListActivatableNames` only; no check calls `StartServiceByName`.
- **Why:** If a block were missing, an activating check would start the very keyring it guards against, so the red run itself would touch the owner's data.
- **Source:** docs/plans/PG-11.md "Part D fix round 1", Decision.
- **Touches:** testing-and-build.md Layer 3b — folded.

## 2026-09-30 — The sample's guard lists the extensions folder, never its parent, from before the build
- **Kind:** constraint
- **Fact:** The guard compares a recursive `find` listing of the owner's extensions folder taken before the build and after the run; clean-up stops only processes carrying `PAYATTENTION_ISOLATED_HOME`.
- **Why:** `ls -la` listed `..`, whose mtime the live shell changes when it saves state (a flaky red); the old snapshot missed the build and install; a command-line match could kill the owner's own `tail -f`.
- **Source:** docs/plans/PG-11.md "Part D fix round 1", defect 2 and Seams.
- **Touches:** testing-and-build.md Layer 3b — folded.

## 2026-09-30 — Runtime-folder sockets from bus-started helpers are accepted
- **Kind:** constraint
- **Fact:** Helpers started on the sample's private bus (e.g. the accessibility bus) may still create sockets in the shared `XDG_RUNTIME_DIR`.
- **Why:** The runtime folder is shared on purpose (the window needs it); sockets hold no owner data, and nothing that uses `$XDG_RUNTIME_DIR/keyring` can be activated.
- **Source:** docs/plans/PG-11.md "For the architect (fix round 1)" item 4.
- **Touches:** testing-and-build.md Layer 3b — folded.

## 2026-09-30 — Smoke check 2b wording confirmed
- **Kind:** decision
- **Fact:** The engineer's edit to "What the smoke script checks" item 2 (commit 20e0ae8, second in-person all-day fixture, travel marks) matches `tests/smoke/alert-ladder.js` `checkMenuTravelMarks` and `scripts/smoke.sh`; kept, with the check name `2b-menu-travel` added. Inbox entry removed.
- **Why:** Engineers may correct a fact in this file; the record stays mine by confirming it.
- **Source:** tests/smoke/alert-ladder.js:313-337, :556; scripts/smoke.sh:62-67.
- **Touches:** testing-and-build.md Layer 3 — folded.

## 2026-09-30 — The travel-choices control is the "Change time" link
- **Kind:** interface
- **Fact:** interfaces.md §3 now names the control that dispatches `toggleTravelChoices` the small "Change time" link, not a "Change travel time" button; the contract (a keyed toggle) is unchanged.
- **Why:** The owner replaced the button with a link and the choices with one compact row of numbers (PG-11 Part E); the contract text should use the words the UI shows. "The boxes" in the overview glossary still matches PRD §4 and stays.
- **Source:** docs/prd/meeting-guardian.md:78-80; docs/plans/PG-11.md Part E.
- **Touches:** interfaces.md §3 — folded.

## 2026-09-30 — The isolated shell uses a private bus by default, not exclusively
- **Kind:** constraint
- **Fact:** `isolated_run` puts its command on the private allowlist bus by default; a command that unsets `DBUS_SESSION_BUS_ADDRESS` reaches the owner's bus through the shared `$XDG_RUNTIME_DIR/bus`.
- **Why:** The runtime folder is shared on purpose (window, sound); closing the fallback would mean a private runtime folder, which the sample cannot have. Accepted because only commands written into the smoke and sample run there and none leaves the bus; one that did would be a defect in that command.
- **Source:** docs/inbox.md for-architecture entry 2026-09-30 (PG-11 Part D review, measured); scripts/isolated-shell.sh:120,208. Inbox entry removed.
- **Touches:** testing-and-build.md Layer 3 and 3b — folded. The plan's "a caller cannot reach the owner's bus" (docs/plans/PG-11.md:679) is the senior engineer's to reword.

## 2026-10-01 — New owner setting `show-test-alert` (PG-12, D-036)
- **Kind:** data
- **Fact:** `show-test-alert` (`b`, default `false`) is added to "Settings the owner edits"; it decides only whether the top-bar menu offers Test alert.
- **Why:** D-036 removes Test alert from the everyday menu behind a Settings switch. An addition needs no ADR (`interfaces.md` §5); defaulting to `false` means an existing install hides the item too, because an unset key reads its default. The default lives once in `DEFAULT_SETTINGS`, and the schema test pins the schema to it.
- **Source:** docs/product/decisions.md D-036; docs/plans/PG-12.md "For the architect" item 1 and Seams 1, 6.
- **Touches:** data.md — folded.

## 2026-10-01 — The View, not the UI, decides whether the menu shows Test alert
- **Kind:** interface
- **Fact:** `View.menu` carries `showTestAlert`, which is `true` only when the setting is strictly `true`; `ui/indicator.js` only applies it as `visible`.
- **Why:** `boundaries.md` keeps every "whether to show" decision out of `ui/`, and `ui/` may not read GSettings. If the field is missing, the item stays hidden, which is the product default, so the item can never appear by accident.
- **Source:** docs/plans/PG-12.md Seams 3–5.
- **Touches:** interfaces.md §3, overview.md "UI layer" — folded.

## 2026-10-01 — `runTestAlert()` stays ungated by the switch
- **Kind:** decision
- **Fact:** `show-test-alert` gates the menu item only, not `Controller.runTestAlert()`, the `runTestAlert` dispatch, or the Extension's `runTestAlert()`.
- **Why:** The smoke drives the ladder through the Extension's `runTestAlert()` with the setting at its default, and §4 forbids a test-only branch. A test alert already running when the switch is turned off runs to its end. Gating the entry point would break the smoke or force it to set a product setting just to run.
- **Source:** interfaces.md §4; docs/plans/PG-12.md "Rejected placements".
- **Touches:** interfaces.md §4 — folded.

## 2026-10-01 — The sample has a second viewing aid, and the smoke has check 2c
- **Kind:** constraint
- **Fact:** The sample keyfile sets `show-test-alert=true` beside `headsup-display-seconds=120`. The smoke adds `2c-menu-test-alert` (hidden by default, appears on a flip without restart). The real-session checklist now says to turn the switch on before running Test alert.
- **Why:** Layer 3b's rule is that a viewing aid must be an ordinary setting value, never a sample-only path; this one is a real product setting (D-036), so the rule holds.
- **Source:** docs/plans/PG-12.md "For the architect" item 4.
- **Touches:** testing-and-build.md Layers 3, 3b, 4 — folded.

## 2026-10-01 — Test alert is gated by the build, not a setting (PG-13, D-037)
- **Kind:** decision
- **Fact:** The menu offers Test alert only in a developer bundle, marked by `"payattention-developer": true` in the bundled `metadata.json` and read only by `extension.js` from `this.metadata` (ADR-0013). Supersedes the 2026-10-01 entries on `show-test-alert` above.
- **Why:** The owner rejected a setting for a developer tool. The marker is the only carrier the normal install removes by construction (install --force replaces the directory), costs no I/O of ours, and works the same in the nested sample and the real Wayland session, where gnome-shell's environment cannot be set per run.
- **Source:** the owner via D-037; measured 2026-10-01: pack keeps an unknown metadata key verbatim, install --force drops files absent from the new zip, install accepts a renamed zip; shell 50 `misc/extensionUtils.js` parses all of metadata.json.
- **Touches:** ADR-0013; interfaces.md §3, §4, §4.1 — folded.

## 2026-10-01 — `show-test-alert` removed; stored values left inert
- **Kind:** data
- **Fact:** The key leaves the schema; a stored `true` from PG-12 stays in dconf unread until `--purge`, and the name is never reused.
- **Why:** GSettings exposes no key outside the compiled schema, so the value cannot act; code to delete it would have to know the key forever. Reusing the name would resurrect the old value.
- **Source:** data.md "Removed keys"; interfaces.md §5.
- **Touches:** data.md, interfaces.md §5 — folded.

## 2026-10-01 — Two bundles, fixed names
- **Kind:** constraint
- **Fact:** `dist/<uuid>.shell-extension.zip` is always the normal bundle; the developer one is `dist/<uuid>.developer.shell-extension.zip`; the build never writes the marker into `extension/metadata.json`.
- **Why:** Anything that installs the normal path by hand (Layer 4, `isolated_install`) must never pick up a developer copy left by the last `npm run sample`; and a crashed build must not leave a flagged source tree for the next normal build to ship.
- **Source:** assumed design rule; measured that `gnome-extensions install` reads the UUID from inside the zip, not its name.
- **Touches:** boundaries.md layout, testing-and-build.md step 4 — folded.

## 2026-10-01 — `runTestAlert()` stays ungated in every build
- **Kind:** interface
- **Fact:** The marker gates only the menu item; the Extension's and controller's `runTestAlert()` work in the normal bundle.
- **Why:** The smoke must drive the ladder on the bundle that ships; gating would force the main smoke onto the developer bundle and leave the shipped one's alerts untested. A normal user cannot reach the method without Looking Glass.
- **Source:** interfaces.md §4.
- **Touches:** interfaces.md §4 — folded.

## 2026-10-01 — Inert test alert code ships; reviewer risk accepted
- **Kind:** constraint
- **Fact:** The normal bundle carries `core/testAlert.js`, `runTestAlert()` and the menu item code, inert without the marker.
- **Why:** Stripping at build time means two code bases and an untested shipped ladder. No review guideline found forbids inert code; `assumed` a reviewer accepts it. Fallback if not: the build leaves that code out of the normal bundle.
- **Source:** constraints.md GNOME review rules; ADR-0013 option 6.
- **Touches:** constraints.md — folded.

## 2026-10-01 — The sample has one viewing-aid setting again
- **Kind:** constraint
- **Fact:** The sample installs the developer bundle and drops `show-test-alert=true`; its only setting aid is `headsup-display-seconds=120`. Smoke check 2c now proves the normal bundle has no item and no key; sample check 3b proves the developer bundle has it; the install/uninstall check proves `install:local` removes a developer copy and `--purge` erases the orphan key.
- **Why:** D-037 "the smoke must check both"; the PG-12 flip check tests a setting that no longer exists.
- **Source:** docs/product/decisions.md D-037; BACKLOG PG-13 done-when.
- **Touches:** testing-and-build.md steps 4 and 6, Layers 3, 3b, 4 — folded.

## 2026-10-02 — A place decides the mode; a link does not (PG-14)
- **Kind:** boundary
- **Fact:** Without an override, a meeting is in person exactly when the place text from `core/attendance.js` is not empty; the link only decides `joinUrl` for an online meeting.
- **Why:** D-038 supersedes D-007. Keeping the rule inside core, on the same place text the travel target uses, means the mode and "has a place" can never disagree. The current code (`core/attendance.js:33`, link wins) is the loser.
- **Source:** docs/product/decisions.md D-038; extension/core/attendance.js:33, extension/core/judge.js:87.
- **Touches:** interfaces.md §2 — folded.

## 2026-10-02 — Placeless travel times live in their own key, keyed by series key
- **Kind:** data
- **Fact:** New GSettings key `meeting-travel-times` (`a{si}`), `series:<uid>` → minutes, for every in-person meeting with no place, recurring or not.
- **Why:** A separate key keeps free-text place keys from colliding with `series:` keys and keeps two lifetimes out of one map. The series key for a one-off meeting survives a move; an `occ:` key would lose the value and silently fall back to the default, which can make the leave-by time later than needed.
- **Source:** ADR-0014; data.md "Keys — the stored format".
- **Touches:** data.md, ADR-0014 — folded.

## 2026-10-02 — One travel target per meeting, no fallback
- **Kind:** interface
- **Fact:** `judge` returns `travelTarget` `{kind:'place'|'meeting', key}` (null when online); `setTravel` carries it instead of `placeKey`; the writer maps kind → settings key.
- **Why:** The value shown and the value a pick overwrites must be the same entry. A fallback (place, else series) would show one entry and write another.
- **Source:** ADR-0014; extension/app/view.js:41 (the `[]` for null place key), extension/app/controller.js:316.
- **Touches:** interfaces.md §2, §3 — folded.

## 2026-10-02 — Hybrid meetings lose Join by default
- **Kind:** question
- **Fact:** `judge` sets `joinUrl` only for online meetings (`extension/core/judge.js:116`), and PRD §3 offers Join for online meetings only. Under D-038 a meeting with a room and a video link is in person, so its alert no longer has Join unless the owner switches it online.
- **Why:** Not a design conflict; the PRD already says so. Raised so the product side knows it is a visible change of D-038, not an oversight.
- **Source:** docs/prd/meeting-guardian.md §3 "Join (online meetings with a link only)".
- **Touches:** nothing in architecture unless product changes it.

## 2026-10-02 — Unknown location wording now flips meetings to in person early
- **Kind:** for-product
- **Fact:** A location the built-in no-place list does not match exactly (for example "Join Zoom Meeting", a localised "Teams-Besprechung") used to be harmless when the meeting had a link; under D-038 it makes the meeting in person, with the default 30-minute travel time.
- **Why:** The failure is in the early direction (alerts about 30 minutes sooner), never silent; the owner can switch the series once. The verdict preview (ADR-0012) can show the owner which real meetings flip before the change ships.
- **Source:** extension/core/words.js:17 (whole-string match); extension/core/attendance.js:31.
- **Touches:** none; product decides whether it matters.

## 2026-10-02 — testing-and-build.md step 4 matched to the PG-13 build
- **Kind:** constraint
- **Fact:** Step 4 now says every build makes both bundles, no flag, and describes the pack command from the `DIRS` array.
- **Why:** The inbox note (2026-10-01, PG-13) found the row read as if the developer bundle were optional. Inbox entry left for the owner to remove, as `docs/inbox.md` says.
- **Source:** scripts/build.sh; docs/inbox.md.
- **Touches:** testing-and-build.md step 4 — folded.

## 2026-10-02 — "Hybrid meetings lose Join" question closed by D-040
- **Kind:** decision
- **Fact:** `joinUrl` is the allowlisted link whatever the mode, detected or overridden; the 2026-10-02 question entry "Hybrid meetings lose Join by default" is closed, and the behaviour it described (`extension/core/judge.js:116`, `mode === 'online' ? att.link : null`) is now the loser.
- **Why:** D-040: taking Join off a room-plus-link meeting removes the one-click way to join it and to stop its alerts (R-9). Mode and Join are independent facts, so no layer may gate one on the other.
- **Source:** docs/product/decisions.md D-040; docs/prd/meeting-guardian.md §3.
- **Touches:** interfaces.md §2, §3; testing-and-build.md core tests — folded.

## 2026-10-02 — Service names anywhere in a location mean no place (closes the 2026-10-02 for-product entry)
- **Kind:** boundary
- **Fact:** Place text is also empty when the location, links removed, names a video-call service anywhere as a whole word; this uses a separate list of service names only, matched with the existing `compileWords`/`findWord` in `core/words.js`, compiled once.
- **Why:** PRD §2 (D-040 round): "Join Zoom Meeting" and "Teams-Besprechung" must stay online. Generic words ("call", "meet", "remote") are kept whole-location only, because matching them anywhere would empty real places, which is the late direction (no travel time). Kept apart from the host allowlist in `core/links.js`: hosts gate what Join opens, names classify text; they change for different reasons.
- **Source:** docs/prd/meeting-guardian.md §2; extension/core/attendance.js:31, extension/core/words.js:17 (whole-location match only today).
- **Touches:** interfaces.md §2, data.md key formats, testing-and-build.md — folded.

## 2026-10-02 — A real place plus a service name reads as online
- **Kind:** for-product
- **Fact:** Under the "names a service anywhere" rule, "Board room + Zoom" or "Room 4.12 / Teams" has no place text, so the meeting is online with no travel time unless the owner switches it.
- **Why:** This is the late direction (alert at the start, not at leave-by), the opposite of the early-only failure the PRD §2 bullet weighs. Designed to the PRD as written; the owner's per-series switch is the recovery. Product may want to know it is the trade the wording makes.
- **Source:** docs/prd/meeting-guardian.md §2 (new bullet); assumed frequency.
- **Touches:** interfaces.md §2 "Accepted consequence" — folded.

## 2026-10-02 — "Clear travel times" clears both keys (assumption confirmed by D-040)
- **Kind:** data
- **Fact:** The prefs "Clear travel times" button resets `travel-times` and `meeting-travel-times`; today it resets only the first (`extension/prefs.js:522`), which is the loser.
- **Why:** D-040: one "clear" that leaves half the times behind would surprise the owner.
- **Source:** docs/product/decisions.md D-040; extension/prefs.js:522.
- **Touches:** data.md (already said so), boundaries.md (already said so), testing-and-build.md travel target — folded.

## 2026-10-02 — Place text is empty only when the location is all video-call wording (closes "A real place plus a service name reads as online")
- **Kind:** boundary
- **Fact:** Rule 2 of the place-text rule changed from "names a service anywhere" to "made entirely of video-call wording": take out every whole-word video-call phrase (service names as phrases, plus join, meeting, call, online, video, Besprechung, beitreten); if only punctuation, separators and whitespace remain, there is no place, otherwise the whole text is the place.
- **Why:** Product revised D-040's wording on the 2026-10-02 for-product finding: "Board room + Zoom" read as online fails late (no travel time). The new rule fails only early. Multi-word service names stay phrases so "Microsoft" or "Google" alone is still a place; whole-location words such as TBD, remote, none stay in the rule-1 list only, so they never consume part of a real place.
- **Source:** docs/prd/meeting-guardian.md §2; docs/product/NOTES.md 2026-10-02 "Mixed place and video wording counts as in person"; BACKLOG PG-14 Done when; extension/core/attendance.js:31 and extension/core/words.js:52 (edges reused).
- **Touches:** interfaces.md §2, data.md place key, testing-and-build.md online/in-person tests — folded. The earlier entries "Service names anywhere in a location mean no place" and "A real place plus a service name reads as online" are superseded and closed by this one.

## 2026-10-02 — "beitreten" counted as video-call wording
- **Kind:** decision
- **Fact:** The rule-2 vocabulary includes "beitreten" (German "join") beside "Besprechung", so "Microsoft Teams-Besprechung beitreten" stays online.
- **Why:** The PRD lists "join" as a generic word and gives "Besprechung" for German Teams invitations; "beitreten" is the same word in the same invitations. Leaving it out would make that text in person, the early direction, so the cost of getting it wrong either way is small.
- **Source:** assumed (reading of PRD §2 "words like join"); product may strike it.
- **Touches:** interfaces.md §2 — folded.

## 2026-10-04 — PG-16 proposal moved into a folder; resulting whole-system design drawn
- **Kind:** question
- **Fact:** The PG-16 proposal now lives at `proposals/PG-16-travel-estimates/proposal.md`, beside `resulting-design.md`, which draws the whole product after PG-16 (component and estimate-flow diagrams, every component, folder tree, outside systems); both are proposed, not authoritative.
- **Why:** The owner asked for the full resulting component picture at that path. Drawing it surfaced points the proposal leaves open: who builds TravelEstimates (verdict component or controller), whether the preview asks for estimates, whether a failed live ask keeps the rough estimate or returns to the default, where the old EngineKey schema name lives for `--purge`, and the name of the Settings window's travel-decisions module.
- **Source:** the owner's request, 2026-10-04; `resulting-design.md` §7.
- **Touches:** the PG-16 ADRs after approval; `boundaries.md`, `interfaces.md` only after approval.
