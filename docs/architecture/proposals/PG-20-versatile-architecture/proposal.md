# PG-20 — A versatile architecture: proposal

- **Status:** proposed — awaiting owner approval. Nothing here is accepted.
  Until the owner approves it, the accepted record (`overview.md`,
  `boundaries.md`, `interfaces.md`, `data.md`, `constraints.md`, the ADRs)
  stands unchanged, and no engineer may plan or build from this folder.
- **Date:** 2026-10-10
- **Built from:** the code on `master` at `edbc7a0` and the accepted record
  (ADR-0001 to ADR-0014). Every claim about today's code has a `file:line`.
- **Serves:** D-049 (the GNOME extension is one front end around reusable core
  logic) and the owner's PG-20 request; must keep R-1 to R-22 and D-001 to
  D-050 true; places PG-16 to PG-19.
- **Files in this folder:** this proposal; `resulting-design.md` (the system
  after migration: diagrams, every component, processes, folder tree, change
  impact of each future); `migration.md` (the slices from today to there);
  `adr-draft-platform-packs.md` (the decision to record if approved).

## 1. The verdict in one paragraph

payAttention does **not** need a rewrite. Since ADR-0011 it already has the
shape the owner is asking for: pure rules in `core/`, GNOME-free orchestration
in `app/` that receives every outside part through its constructor, and GNOME
adapters around them. A KDE, web or mobile version would reuse `core/` and
`app/` unchanged in almost every respect. What stands in the way is a short
list of specific leaks: platform names that sit inside `core/`, a password
store with no port, network logic that is GNOME-free but cannot be told apart
from the GNOME program around it, a product rule (setting ranges) that only
GSettings enforces, no single unit that *is* "the GNOME integration", and a
folder tree that does not show which parts a second platform would replace.
The recommendation closes those leaks in seven small slices, adds no process,
no runtime and no install step, and changes nothing the owner sees. Everything
a future platform would need beyond that is designed here, but not built.

## 2. What the owner asked for, as qualities

The owner's three examples, restated as qualities the design must have
(`judging.md`: a quality the owner stated is a requirement, not speculation):

| # | Owner's words | The quality | Test of the design |
|---|---|---|---|
| Q1 | "build a kde or web version quickly by only rebuilding the UI (or part of it) and repackage the integration with the platform" | A second platform replaces **one named set of parts**: the UI and one platform pack. Nothing in `core/` or `app/` names a platform. | Can you point at one folder and one composition root and say "this is all of GNOME"? |
| Q2 | "use IoC for the various integration points between the core logic and the platform (for calendar access for instance)" | The kernel **receives** every integration; it never creates, looks up or imports one. | Is every outside part a port, filled only in a composition root? |
| Q3 | "integrate with Google or Microsoft O365 calendars" | A calendar provider is one more implementation of the calendar-source port, producing the same snapshot. | Does a Google or Graph reader change anything in `core/` or `app/`? |
| Q4 | "without bending over backward or ending up with an architecture for platform A partly decided b/c of platform B" | Each seam is justified by today's needs **or** by keeping the kernel free of a platform, never by a guess about platform B. GNOME pays nothing for platforms that may never exist. | No new process, runtime, install step or user-visible change today. |

The product limits stay: GNOME only, calendars already on the desktop with no
second login (R-2), calendar contents stay on the machine unless the owner
turns on a cloud AI engine or the map service (R-3), no phone, GNOME 50 only,
the GNOME review rules (`constraints.md`).

## 3. What stands in the way today (evidence)

Read at `edbc7a0`. Each item says which quality it breaks and what it costs if
nothing changes.

### P1 — Platform names inside `core/` (breaks Q1, Q4)

- `extension/core/aiEngine.js:12-14` defines the libsecret schema name
  `org.gnome.shell.extensions.payattention.EngineKey` and its attribute. That
  is GNOME's password store's storage format, held in the platform-free rules.
- `extension/core/protocol.js:16` defines `HELPER_ENV_UNSET =
  ['G_MESSAGES_DEBUG']`, a GLib logging variable, so that the three spawners
  agree (`shell/helperProcess.js:24`, `prefs.js:209`). It is a spawn rule of
  gjs subprocesses, not a calendar contract.
- `extension/core/aiSetup.js:31-33, 50, 89, 93` hold Settings texts that say
  "keyring". Minor: they are the Settings window's words, and only that window
  uses them.

**Cost if nothing changes:** a KDE or server build imports `core/` and
inherits GNOME's storage names; the next person copies the pattern.

### P2 — The password store has no port (breaks Q1, Q2, Q3; the owner asked for it on 2026-10-04)

- The same libsecret schema is built twice: `extension/ai/keyring.js:16`
  (read) and `extension/prefs.js:63` (store, search, clear at `:87`, `:122`,
  `:147`); `scripts/uninstall.sh:22` repeats its name. ADR-0011 recorded this
  as Leak 4.
- The AI service already receives the lookup as a function
  (`extension/ai/service.js:39-44`, `lookupKey` injected by `ai/main.js:44`),
  so the read side is a port in all but name; the write side is not.

**Cost if nothing changes:** every new secret (the Google key of PG-16; an
OAuth token for a direct Google or Microsoft 365 calendar) is a third and
fourth copy, and no other platform can supply its own store. The owner's own
rule — "key storage should be abstracted, so that there is no direct
dependency between core software and Gnome" (product NOTES 2026-10-04) — is
not met.

### P3 — Network logic is platform-free but lives inside a GNOME program (breaks Q1, Q3)

- `extension/ai/service.js` and `extension/ai/chat.js` import no `gi://`
  (`service.js:4-6` says so), but they sit in `ai/`, which is linted as a gjs
  program (`boundaries.md`, import rules). Nothing stops the next change from
  adding Soup or GLib to them, and a server or KDE build cannot tell which
  files of `ai/` it may take.
- The OpenAI request and reply format (`ai/chat.js`) is a provider wire
  format, the same kind of thing PG-16 put in `core/routes.js` for Google.

**Cost if nothing changes:** a server-side AI engine, the maps service and any
direct calendar reader would each re-implement request building and reply
reading, or drag a gjs program into a non-GNOME host.

### P4 — There is no single "GNOME integration" unit (breaks Q1, Q2)

- The composition is written out three times. `extension/extension.js:25-40`
  builds the adapters and names both programs' paths;
  `extension/preview/main.js:96-104` names the same paths again;
  `extension/prefs.js:167, 211` names the AI program's path a third time.
- The factories reach the kernel as a long list of loose parameters
  (`app/controller.js:52-66`, `app/verdicts.js:42`). There is no named
  contract that says "this is what a platform must supply".

**Cost if nothing changes:** "repackage the integration with the platform"
(Q1) has no package to repackage. A KDE port would reverse-engineer the list
from two composition roots and a settings window.

### P5 — A product rule is enforced only by GNOME's store (breaks Q1, Q4)

- Valid ranges for the owner's settings exist only as `<range>` elements in
  the GSettings schema (14 of them; `data.md` "Every integer key gets a
  `<range>` in the schema, so a bad value cannot reach core"). `prefs.js:33`
  reads them back from the schema. `core/defaults.js` has the defaults but no
  ranges; `core/timing.js:4` says `plan()` clamps the offsets, and nothing
  clamps the rest.

**Cost if nothing changes:** on any other store (a KDE config file, a web
form, a database) a cutoff of 10 000 minutes or a negative large-meeting size
reaches `core/` unchecked. The rule belongs to the product; today the platform
owns it.

### P6 — The folder tree does not show the design (breaks Q1; `boundaries.md` check 7)

- The top level of `extension/` sorts code four ways at once: by ring
  (`core/`, `app/`), by process (`shell/` = in the desktop process), by kind
  (`ui/` = actors) and by program (`helper/`, `ai/`), plus a front end
  (`preview/`). A newcomer cannot tell from the tree which folders a second
  platform keeps and which it replaces.

**Cost if nothing changes:** low today; it is the first thing a KDE or web
port would get wrong.

### P7 — Some contracts are described as processes (breaks Q3, Q4 in the record, not in the code)

- ADR-0011's port table defines the calendar source as "Snapshot protocol v1,
  a process over stdio". In the code the port is already process-free:
  `FeedPort` in `app/verdicts.js:22-28` is "the last snapshot, its times,
  refresh, destroy". The process is how the GNOME pack fills it, because EDS
  inside the desktop process can crash the session (ADR-0001).
- `AiClientPort.kill` (`app/aiQueue.js:44`) is documented as "stops the
  helper".

**Cost if nothing changes:** a server pack, where a Google reader or an AI
client runs in-process, reads the record as requiring a subprocess. This is
the "platform A decided because of platform B" the owner warned about, in
reverse: GNOME's process boundary written into the kernel's contract.

### Not blocking anything today, but recorded so nobody rediscovers them

- **Local time is the process's time zone.** `core/display.js:9-11` builds
  `Intl.DateTimeFormat` with the default zone and locale; `app/view.js:122`
  and `app/aiQueue.js:145` read the process's offset. True on every desktop
  and in a browser; false on a server that serves owners in several zones.
- **One calendar source.** `app/verdicts.js:78` builds exactly one feed. Two
  readers side by side (EDS and a direct Google reader) need a merge of their
  snapshots.
- **The alert loop ticks every second per owner** (`app/controller.js`,
  ADR-0002). Ideal for one desktop; on a server with many owners it costs
  about 1 ms per owner per second (`constraints.md` per-tick budget,
  `assumed`).

### What is already right, and must not be undone

- `core/`: 22 files, no `gi://`, lint-enforced, also run under gjs (ADR-0002).
- `app/`: no `gi://`, every part injected, unit-tested under Node (ADR-0011).
- One caller of `judge` (`app/verdicts.js`), lint-enforced: a second front end
  gets the same verdicts by construction (ADR-0011, ADR-0012).
- The snapshot protocol is iCalendar-shaped, not EDS-shaped; ADR-0011 checked
  that a Microsoft Graph or Google Calendar reader can fill it.
- The display model (`app/view.js` `View`) and the owner's actions
  (`app/controller.js` `UiAction`) are plain data: strings, numbers, booleans,
  arrays, plain objects. A remote UI could carry them as JSON unchanged.
- Calendar reading and network access run outside the desktop process for
  reasons that hold on every platform that has a fragile host (ADR-0001,
  ADR-0010).

## 4. Principles

1. **Kernel and packs.** The *kernel* is `core/` (rules, formats, protocol
   validators, provider wire formats) plus `app/` (orchestration, including
   the network services). It is plain ES2022 with no host API, so it runs in
   gjs, Node, a browser, or any other ES2022 runtime. Everything else belongs
   to exactly one *platform pack* (GNOME today) or is a *front end* of one.
2. **The kernel receives; it never reaches.** Every integration is a port
   whose type lives with its consumer, filled in a composition root by plain
   constructor injection. No container, no service locator, no global
   registry, no module-level mutable state. Core receives data; `app/`
   receives factories. This *is* the IoC the owner asked for; a container
   library would add a dependency and indirection for about ten ports.
3. **Process placement belongs to the pack.** Ports describe what the kernel
   needs, never how it is delivered. GNOME runs calendar reading and network
   access in subprocesses because its host is the whole desktop; a server
   pack may run the same port implementations in-process. Each process needs a
   stated reason, and existing processes are reused before a new one is made.
4. **Product rules live in the kernel.** Defaults, valid ranges, wording of
   verdicts, eligibility, ranking: a platform's store or window may repeat
   them for its own reasons, but a test proves it repeats the kernel's.
5. **Enable, do not build.** A seam is built only when today's GNOME product
   needs it, or when it removes a platform name from the kernel. Seams that
   only a future platform needs are designed in `resulting-design.md` §8,
   with the trigger that would build each one.
6. **One owner per responsibility.** The password store, the platform
   composition and the settings rules each get exactly one owner; the copies
   go.

## 5. Option A (recommended) — complete the kernel, make the GNOME pack one unit

**In words.** Keep today's shape and process model. Close P1 to P7:

- move the two platform names out of `core/` (P1);
- add a key-store port with one libsecret adapter, keeping today's stored
  format so nobody re-enters a key (P2);
- move the AI service to `app/services/` and the OpenAI wire format to
  `core/providers/`, both lint-enforced platform-free; the gjs program keeps
  only stdin/stdout, the Soup transport and the key-store adapter (P3);
- one GNOME platform module that builds every adapter, and one `Platform`
  contract in `app/` listing what a pack supplies (P4);
- a settings specification in `core/` (default, kind, range per setting),
  with a test that keeps the GSettings schema equal to it (P5);
- regroup the tree: `core/`, `app/`, and `gnome/` (every GNOME adapter, by
  subsystem) under the pack root, with GNOME's mandated entry files and the
  preview's documented command where they are (P6);
- reword the port contracts so none names a process (P7, record only).

**Moving parts added:** two small modules (the platform module and the
key-store adapter), one typedef file (`Platform`), one core table (settings
spec). Removed: one duplicate key-store implementation, two duplicate path
lists. No process, no runtime, no dependency, no setting, no stored key.

**What it costs the GNOME product today:** nothing the owner sees. The zip
holds the same code in different folders; the preview command is unchanged
(ADR-0012); the AI key stays where it is. Development cost: seven slices, three
sized M and four sized S (`migration.md`). PG-18 and PG-19 depend on none of
them; parked PG-16 depends on two (the key-store port and the platform-free
services), which also make it smaller.

**Forever cost:** a third directory level (`gnome/…`) in import paths; the
`Platform` contract must be kept honest as ports are added; the settings spec
and the schema are kept equal by a test.

## 6. Option B (alternative) — one local agent process, every front end a client

**In words.** Move the whole kernel (verdicts, AI queue, alert session, store
access) out of the desktop process into one long-lived local agent (gjs),
which also hosts calendar reading and network access. Every front end — the
GNOME Shell UI, the Settings window, the preview, and later KDE, web and
mobile — becomes a thin client of one versioned local session protocol (the
View out, actions in). A web API is then "the same protocol over HTTP".

**Why it is attractive.** Every platform looks the same; GNOME, KDE and web
are symmetric; three programs become one; the shell process runs only
drawing code.

**Why it is not recommended.** It makes GNOME pay now for platforms that may
never exist, which the owner ruled out (Q4):

- **Reliability, the deciding reason.** Today the 1-second alert loop runs in
  the desktop process from the last good snapshot, so alerts keep coming when
  a helper dies or hangs (D-013, R-16; `interfaces.md` addendum 2026-09-26).
  With an agent, every alert crosses a process boundary every second; an
  agent crash or hang stops all alerts, and the takeover's modal grab would
  be driven from outside the process that must release it ("never trap the
  owner", `overview.md`).
- **R-3 loses its simple proof.** "In rules mode the AI program is never
  spawned, so nothing is sent" (`constraints.md`) becomes "the agent has
  network code but does not use it".
- **Cost now:** a new always-on process, a new versioned protocol, its
  supervisor, its tests, and a rewrite of the alert path, for no change the
  owner sees.

**When it would become right:** if a second platform is actually chosen
whose UI runtime cannot host ES modules (a KDE Plasma widget may be one), the
agent pattern is how *that* pack hosts the kernel (`resulting-design.md` §7,
KDE row). Option A does not prevent it: the alert session already talks to
its UI only through `render(View)` and `dispatch(UiAction)`, both plain data.

## 7. Risks

| Risk | What happens | Mitigation |
|---|---|---|
| The regroup breaks the zip or an import path | The installed extension fails to load; no alerts until fixed | The build already checks the zip for key files (`scripts/build.sh`); the regroup slice adds the moved entry points to that check, and the smoke runs the installed zip headless. Lint over resolved paths lands first (`migration.md` slice 1), so boundaries do not loosen while paths change. |
| Boundaries rest more on lint after the regroup | A `..` in the middle of a path still sidesteps the patterns today (`docs/inbox.md`, 2026-09-27; BACKLOG PG-9) | Slice 1 closes it before anything moves. |
| "Versatile" is read as "build the futures" | Speculative servers, protocols or readers creep in | Principle 5; `resulting-design.md` §8 lists each unbuilt seam with its trigger; every future in §7 there starts with the product decision it needs. |
| The `Platform` contract becomes a dumping ground | Ports with one caller pile up there | It only lists factories the kernel already takes; a new entry needs a consumer in `app/`. Its second real caller today is the preview. |
| The key-store slice and D-046 disagree | D-046 accepted that the owner re-enters the AI key "when keys move behind the new key-storage layer". This proposal keeps the stored format, so no re-entry is needed | Raised for the product manager (§9). Keeping the format is the cheaper path either way. |
| The PG-16 proposal goes stale | Its paths (`ai/` or `net/`, `keystore/`, `core/routes.js`) and tickets K1, K2 assume today's tree | `resulting-design.md` §6 maps every PG-16 component to its place here; when PG-16 is unparked its K1 shrinks to "add the maps purpose" and K2 to "add MapsService and its client". |
| The time-zone assumption is forgotten | A server pack formats every owner's times in the server's zone | Recorded in `resulting-design.md` §8 and the web row of §7 as the one kernel change that future needs. |

## 8. Questions only the owner can answer

1. **Regroup the folders now, or later?**
   - **Now (recommended):** `extension/` holds `core/`, `app/` and `gnome/`
     (every GNOME part, by subsystem), plus GNOME's entry files and the
     preview. One M slice of moves, no behaviour change. The tree then answers
     "what does a KDE port replace?" by itself.
   - **Later:** keep `shell/`, `ui/`, `helper/`, `ai/` where they are and
     write the mapping into `boundaries.md`. Saves the M slice now; the
     question is answered by a document instead of the tree, and the move
     happens when a second pack exists.
2. **Keep two helper programs, or merge them into one?**
   - **Keep two (recommended):** the calendar program (always on, read-only,
     no network, no secrets) and the network program (only while AI mode or
     estimates are on). A hung or crashing HTTP request never stops calendar
     snapshots, and "nothing is sent in rules mode" stays provable by "the
     network program is not running".
   - **Merge into one:** one process fewer, and PG-16 already showed the
     owner prefers reusing a program to adding one. The cost: a network fault
     can stop calendar reading, and the network code is loaded in rules mode
     too, so R-3's proof becomes a code argument instead of a process fact.

## 9. Findings for the product manager

Logged as `Kind: for-product` in `docs/architecture/NOTES.md`.

- **D-046 may be unnecessary.** The key-store port can keep today's keyring
  format for the AI key, so the owner never re-enters it. Whether D-046 still
  stands is a product call; it only matters when PG-16 is unparked.
- **D-050 widens what an AI engine receives.** "In AI mode the engine is told
  the owner's name and addresses" reverses a line of the accepted contract:
  the owner's own addresses are on the "never sent" list (`interfaces.md`
  §6.2, ADR-0010). With a cloud engine they would leave the machine. The
  architecture can carry it (one invite field, one prompt version, every
  meeting re-asked once); the product should confirm it, and the Settings
  warning would need to say it.
- **Microsoft 365 calendars already reach GNOME without a direct reader**, through
  GNOME Online Accounts and evolution-data-server, but only with the
  `evolution-ews` package installed (GNOME 47 and later). It is not
  installed on the author's machine (measured 2026-10-10, `rpm -q`). Google
  calendars already arrive this way (7 CalDAV sources, measured 2026-09-26).
  So "direct Google or Microsoft 365" only adds something where there is no
  desktop calendar service (a web server or a phone back end).
- **Every future in `resulting-design.md` §7 changes a product promise first**:
  "GNOME only" and R-1 for KDE; R-2 (a second login), R-3 (calendar data on a
  server), "no phone", R-12 (Do Not Disturb on a phone), R-17 (erasing data on
  a server) and D-001 (running a server costs money) for web and mobile; R-2
  for a direct Google or Microsoft 365 reader. The design marks where each one
  bites; it decides none of them.
