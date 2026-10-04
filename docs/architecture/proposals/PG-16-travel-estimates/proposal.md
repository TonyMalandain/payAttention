# PG-16 — Estimated travel time with Google: architecture proposal

- **Status:** PROPOSED, awaiting the owner's approval. Nothing here is accepted.
  Until the owner approves it, the accepted record (`boundaries.md`,
  `interfaces.md`, `data.md`, the ADRs) stands unchanged, and no engineer may
  plan or build from this file.
- **Date:** 2026-10-04 (revision 3: after the owner's feedback D-046, D-047,
  D-048 and the wrapper rule D-049)
- **Serves:** R-21 (estimated travel time), R-11 (travel time), R-3 (what
  leaves the machine); D-041 to D-049. PRD: "Addendum 2026-10-04 — Estimated
  travel time".
- **Owner:** the architect.

## 1. The design in one paragraph

The travel rules stay pure: `core/travel.js` picks the travel time (owner's
own > estimate > default, D-042), works out where the trip starts (D-043), and
turns Google's answer into a rough or live estimate (D-048). A new GNOME-free
orchestration part, `app/travelEstimates.js`, decides when an estimate is due
(when the meeting is found, and at its heads-up, D-047), holds the answers in
memory only, and asks through a **route-estimate port**. The port's adapter is
a client of the existing independent network program (today's AI helper),
which gains a second service, `MapsService`, beside `AiService`. The Google
request and reply format live in `core/routes.js`, so no GNOME code knows
Google's wire format. Keys move behind a **KeyStore port** with one shared
libsecret adapter, used by the network program (read) and the Settings window
(write).

## 2. Does it honour the wrapper rule (D-049 / ADR-0011)?

**Yes.** Every part below is labelled **Logic** (GNOME-free, Node-tested,
lint-enforced) or **GNOME part** (an adapter or front end that could be
replaced without touching the logic).

- The travel rules (D, F), when to ask and what is held (G), what the owner
  sees (H), and the network services that build the Google and AI requests and
  read the replies (C) are all logic. None imports `gi://`, `resource://`, the
  `system` built-in or Node built-ins; lint fails the build if one does.
- Everything GNOME — the password store (A's adapter), the process that hosts
  the services and its HTTP transport (B), the client that spawns it (E), the
  settings store (I) and the Settings window (J) — sits behind a named port.
  Another password store, HTTP stack, process model or front end replaces an
  adapter; the logic does not change.
- The one gap the product manager found in revision 2 — "it does not say that
  the Google request and reply logic is GNOME-free" — is closed by D and C:
  Google's request body and reply parsing are in `core/routes.js`, and
  `MapsService` is lint-enforced GNOME-free.

## 3. Components

```
Component A: Key storage
  Layer:            Port = Logic (core/); adapter = GNOME part; test double = test support
  Responsible for:  Saving, reading and clearing a secret key for one purpose, never
                    prompting. Two purposes: "ai-engine" (scoped by the normalised engine
                    address, as today) and "maps" (one key, scope "google"). One new
                    libsecret schema, org.gnome.shell.extensions.payattention.Key, with
                    attributes "purpose" and "scope". The old EngineKey schema is no
                    longer read: a saved AI key is not carried over (D-046); the owner
                    types it again. --purge clears both schemas.
  Depends on:       Port: nothing. Adapter: gi://Secret, Gio, GLib.
  Used by:          B (reads, through the port, handed to C), J (writes and clears),
                    scripts/uninstall.sh (clears, by schema name).
  Classes/modules:  core/keyStore.js — the KeyStore port (JSDoc interface: lookup(purpose,
                      scope) -> {state:'found',key} | {state:'absent'} | {state:'unavailable'};
                      store(purpose, scope, key) -> boolean; clear(purpose, scope)), the
                      purpose names and the schema name/attribute constants.
                    keystore/libsecretKeyStore.js — LibsecretKeyStore, the only code that
                      imports gi://Secret. Replaces ai/keyring.js and the schema copy in
                      prefs.js (repays ADR-0011 Leak 4).
                    tests/unit/support/memoryKeyStore.js — MemoryKeyStore, an in-memory
                      KeyStore for Node tests of C.

Component B: Network program host
  Layer:            GNOME part (a gjs subprocess, out of the shell process)
  Responsible for:  Being the one independent program that talks to the network and reads
                    keys: starting, reading requests on stdin, routing each to the right
                    service, writing replies on stdout, ending on EOF. Owns the HTTP
                    transport (Soup) and the transport rule by endpoint class. Runs when AI
                    mode is on OR estimates are on (today it runs only in AI mode).
                    Rename ai/ -> net/ is optional; the owner has not decided. The design
                    is the same either way.
  Depends on:       A (LibsecretKeyStore), C (services), core protocol modules, gi://Soup,
                    Gio, GioUnix, GLib, the system built-in.
  Used by:          E (spawns it and speaks the protocol), J ("Test connection" spawns it
                    once).
  Classes/modules:  net/main.js (composition and exit only), net/stdio.js (Stdout,
                    watchStdin, reportDiagnostic), net/transport.js (HttpTransport).

Component C: Network services
  Layer:            Logic (lint-enforced GNOME-free: no gi://, resource://, system, Node
                    built-ins; transport, key store and clock injected)
  Responsible for:  Turning one validated request into one outgoing HTTP request and one
                    reply into a validated answer or a short failure code. AiService and
                    chat.js do this for the AI engine (behaviour unchanged). MapsService
                    does it for a route estimate: looks up the "maps" key through the
                    KeyStore port, builds the request with D, posts it through the
                    injected transport, reads the reply with D, returns minutes or a
                    failure code (no-key, bad-key, not-found, network, quota, bad-reply).
                    Never logs addresses or keys.
  Depends on:       D (core/routes.js), core/aiProtocol.js, core/aiPrompt.js,
                    core/aiEngine.js, the KeyStore and transport ports (injected).
  Used by:          B.
  Classes/modules:  net/services/aiService.js (AiService, today ai/service.js),
                    net/services/chat.js (today ai/chat.js), net/services/mapsService.js
                    (MapsService).

Component D: Route request and reply rules
  Layer:            Logic (core/, pure)
  Responsible for:  Google's wire format and nothing else: the Routes API endpoint and
                    field mask, the request body for one origin, one destination, a
                    departure time and a kind, and the reply validator. Kind "rough" asks
                    trafficModel PESSIMISTIC (the slow end of the range, D-048); kind
                    "live" asks BEST_GUESS with no departure time (now). Bounds the
                    address lengths it will send. Also the protocol message shapes for a
                    route request and reply between E and B.
  Depends on:       nothing outside core/.
  Used by:          C (MapsService), E (message shapes), tests.
  Classes/modules:  core/routes.js (routesRequest, readRoutesReply), additions to
                    core/aiProtocol.js (or a sibling core/netProtocol.js if renamed with B).

Component E: Network program client
  Layer:            GNOME part (shell/ adapter: Gio.Subprocess via spawnHelper)
  Responsible for:  Spawning B, restarting it with backoff, matching replies to requests,
                    and exposing two ports to app/: the AI engine port (as today) and the
                    route-estimate port estimate(from, to, departAt, kind) -> Promise of
                    {minutes} or {failure}. One process serves both ports. Starts the
                    process when either port is needed and stops it when neither is.
  Depends on:       B (as a process), D (message shapes), app/backoff.js,
                    shell/helperProcess.js.
  Used by:          G (route-estimate port), the AI queue (AI engine port), extension.js
                    and preview/main.js (composition).
  Classes/modules:  shell/aiHelperClient.js (AiHelperClient, the process owner; renamed
                    shell/netClient.js if B is renamed), shell/mapsClient.js (MapsClient,
                    a thin facade implementing the route-estimate port over the shared
                    process).

Component F: Travel rules
  Layer:            Logic (core/, pure)
  Responsible for:  Which travel time applies and where it came from, in one place:
                    owner's own (place or series, ADR-0014) > estimate > default (D-042).
                    Where the trip starts: Work on Monday-Friday, Home on Saturday-Sunday,
                    Home when no Work, none when neither (D-043). Turning a reply into an
                    estimate: rough = Google's slow-end minutes + 30 (D-048); live =
                    Google's minutes. Whether a meeting is eligible: in person, with a
                    place, no owner's time, not cancelled or declined. judge takes the
                    estimates map as one more input and records the source on each judged
                    occurrence ("own", "estimated", "default").
  Depends on:       nothing outside core/.
  Used by:          G (eligibility, start place, rough/live arithmetic), judge (ranking),
                    via app/verdicts.js only.
  Classes/modules:  core/travel.js (startPlace, isEstimable, estimateFromReply,
                    pickTravel), core/judge.js (one new input, estimates by occurrence key).

Component G: Travel estimates
  Layer:            Logic (app/, GNOME-free orchestration, every outside part injected)
  Responsible for:  Deciding when an estimate is due and holding the answers. Asks a rough
                    estimate when an eligible meeting is first seen and a live one when its
                    heads-up fires (D-047); asks again when the place, the start time or
                    the start place changes; never asks for a meeting with the owner's own
                    time. Holds estimates in memory only, keyed by occurrence key and the
                    inputs they were asked for (Google's terms; nothing is stored, so
                    --purge has nothing to erase). Never makes an alert wait: until an
                    answer arrives, the default applies. Reports estimate health (off,
                    no key, bad key, no network, no Home/Work) for the one-line menu
                    status. Caps calls per day (see risks).
  Depends on:       F, the route-estimate port (E), the clock, the settings reader (I).
  Used by:          the verdict component (app/verdicts.js passes its estimates into
                    judge), the controller (heads-up event, health).
  Classes/modules:  app/travelEstimates.js (TravelEstimates).

Component H: View
  Layer:            Logic (app/)
  Responsible for:  What the owner reads: "Travel: 25 min (estimated)", "(default)", no
                    mark for the owner's own time; the one status line when estimates are
                    not working, beside "AI unavailable — using rules".
  Depends on:       F's source field on each judged occurrence, G's health.
  Used by:          ui/ (draws it), the controller.
  Classes/modules:  app/view.js (buildView, buildRow, statusLine).

Component I: Settings store
  Layer:            GNOME part (GSettings adapter); keys declared in the schema
  Responsible for:  Three new durable settings: the estimate switch (off by default), Home,
                    Work. Read by the store reader, written by Settings only. Not the key
                    (that is A).
  Depends on:       GSettings.
  Used by:          G (via the reader), F (via G: Home, Work), J (writes).
  Classes/modules:  schemas/org.gnome.shell.extensions.payattention.gschema.xml,
                    shell/settingsKeys.js, shell/store.js (StoreReader).

Component J: Settings window
  Layer:            GNOME part (front end, GTK4/Adw process)
  Responsible for:  The "Travel" section: Home, Work, the switch, the Google key field,
                    "Test connection" (spawns B once, reads one answer), the privacy
                    warning; asking the owner to re-enter the AI key (D-046). Holds no
                    decisions: those stay in core (aiSetup.js and a travel counterpart).
  Depends on:       A (LibsecretKeyStore, write/clear), I, B (spawned for the test), core.
  Used by:          the owner.
  Classes/modules:  prefs.js.
```

## 4. Folder structure change

```
extension/
  core/keyStore.js          NEW  KeyStore port, purposes, schema constants        (logic)
  core/routes.js            NEW  Google request/reply rules                       (logic)
  core/travel.js            NEW  ranking, start place, rough/live arithmetic      (logic)
  keystore/                 NEW  shared GNOME adapter, the only gi://Secret code
    libsecretKeyStore.js         imported by net/main.js and prefs.js only
  net/                      RENAMED from ai/ (optional; owner to decide)
    main.js, stdio.js, transport.js                                              (GNOME part)
    services/               NEW  lint-enforced GNOME-free
      aiService.js, chat.js, mapsService.js                                      (logic)
  ai/keyring.js             REMOVED (replaced by keystore/libsecretKeyStore.js)
  shell/mapsClient.js       NEW  route-estimate port adapter                      (GNOME part)
  app/travelEstimates.js    NEW                                                   (logic)
tests/unit/support/memoryKeyStore.js   NEW  test double for the KeyStore port
```

**Why `extension/keystore/`, a directory of its own.** The adapter has exactly
two importers, the network program and the Settings window, and both are
already allowed `gi://Secret`. It cannot live in `shell/` (shell code must not
import Secret, and it runs in the desktop's own process), nor in `net/`
(`prefs.js` must not import the network program), nor in `core/` (pure). A
directory whose only job is the libsecret adapter lets lint say it in one line:
only `net/main.js` and `prefs.js` may import `keystore/`, and only `keystore/`
may import `gi://Secret`.

## 5. Where estimates live, and after a restart or screen lock

- **In memory only**, inside `app/travelEstimates.js`. Never in GSettings,
  never on disk. Reason: Google's Maps Platform terms limit caching their
  results, and an estimate is worthless after the traffic it described.
- **After a restart, a log-out, or a screen lock** (locking disables the
  extension, ADR-0005), the memory is gone. On the next enable, every eligible
  meeting in the calendar window (1 hour back to 36 hours ahead) is asked
  again: a rough estimate for a meeting not yet at its heads-up, a live one
  for a meeting already past it. Until each answer arrives the default travel
  time applies, so no alert waits.

## 6. The Google call

- **Service:** Google Routes API, `computeRoutes`.
- **Endpoint:** `POST https://routes.googleapis.com/directions/v2:computeRoutes`
- **Headers:** `Content-Type: application/json`, `X-Goog-Api-Key: <maps key>`,
  `X-Goog-FieldMask: routes.duration` (only the duration comes back).
- **Body, rough (at detection):**
  ```json
  {
    "origin": {"address": "<Home or Work>"},
    "destination": {"address": "<meeting place text>"},
    "travelMode": "DRIVE",
    "routingPreference": "TRAFFIC_AWARE_OPTIMAL",
    "trafficModel": "PESSIMISTIC",
    "departureTime": "<meeting start minus the default travel time, RFC 3339>"
  }
  ```
- **Body, live (at the heads-up):** the same with `"trafficModel":
  "BEST_GUESS"` and no `departureTime` (leave now).
- **Reply:** `{"routes":[{"duration":"1234s"}]}`; no route means "not found".
- **What is sent (D-041):** the start address, the place text, a departure
  time. Never titles, descriptions or guests.
- **Cost:** traffic-aware routing bills as the Compute Routes **Pro** SKU:
  5,000 free requests a month, then about $10 per 1,000 (Google's price list,
  checked 2026-10-04; it can change). Two calls per in-person meeting plus
  re-asks after locks; ordinary use is far inside the free tier (`assumed`,
  not measured).

## 7. Hosting: the existing network program, not the calendar helper

The owner asked why Google would be "an independent program". It is not a new
one. It is a second service inside the independent program we already have,
the AI helper, called from it as the owner suggested. Reasons:

- **Why out of the shell process at all:** on Wayland the shell process is the
  whole desktop. Network code and keys stay out of it (ADR-0008, ADR-0010); a
  hung request or a crash there freezes or ends the session.
- **Why the AI helper and not the calendar helper:** the AI helper already
  holds the HTTP transport, the key lookup and the "never log what is sent"
  rules. The calendar helper is the read-only calendar reader; it must not
  know settings, places-as-meaning, the network or secrets (`boundaries.md`).
  Putting Google there would give it two owners and widen what a calendar
  bug can leak.
- **Cost of the choice:** the program now runs when AI mode **or** estimates
  are on, so its name ("AI helper", `ai/`) stops being true; hence the
  optional rename to `net/`.

## 8. The flow

1. The calendar helper sends a snapshot; the verdict component judges it.
2. `TravelEstimates` (G) sees an eligible meeting for the first time (F says:
   in person, with a place, no owner's time) and works out the start place
   (F: Work on weekdays, Home at weekends).
3. G asks the route-estimate port: `estimate(start, place, departAt, 'rough')`.
4. `MapsClient` (E) sends the request to the network program (B), which hands
   it to `MapsService` (C). C reads the maps key through the KeyStore port
   (A), builds the body with D, posts it, reads the reply with D.
5. The answer returns to G; F turns it into minutes + 30. G holds it in memory
   and the verdict component re-judges: the travel time is now "(estimated)"
   and the leave-by and alert times follow.
6. At the heads-up, the controller tells G; G asks `'live'`. The answer
   replaces the rough one and can move the later alert times (D-047).
7. Any failure leaves the default in place and sets estimate health; the view
   (H) shows one status line.

## 9. Tickets (proposed split of PG-16)

Sizes use the house scale. Dependencies are technical prerequisites only.

| Ticket | What it is | Size | Needs first |
|---|---|---|---|
| K1 | Key storage: KeyStore port, `keystore/libsecretKeyStore.js`, MemoryKeyStore, new schema with purposes, AI key not carried over (D-046), uninstall clears both schemas, lint rules | L (new stored format, contract change) | nothing |
| K2 | Network program: optional rename, services split out and lint-enforced GNOME-free, `core/routes.js`, `MapsService`, route request in the protocol, `MapsClient` and the route-estimate port, process runs when AI or estimates are on | L (new concept, contract change) | K1 |
| K3 | Settings: switch, Home, Work in the schema and store; the Travel section, key field and Test connection in Settings | M | K1, K2 (Test connection spawns the program) |
| K4 | Travel rules: `core/travel.js`, judge's new estimates input and source field, the "(estimated)/(default)" view | L (contract change to judge) | nothing (built against injected estimates) |
| K5 | Travel estimates: `app/travelEstimates.js`, when to ask, memory only, heads-up hook, daily cap, health line, composition in `extension.js` | L | K2, K3, K4 |

## 10. ADRs to write after approval

- **New, superseding ADR-0009** (keys in the GNOME keyring): keys behind a
  KeyStore port, one shared libsecret adapter, schema `...Key` with purpose and
  scope, no carry-over.
- **New, amending ADR-0010** (AI mode) where it says the helper runs only in AI
  mode and is the only network code: one network program hosts the AI and
  maps services, GNOME-free services, runs when either is on. ADR-0008 is
  already superseded and stays as it is.
- **New:** travel estimates through Google Routes, memory-only, asked at
  detection and at the heads-up, ranked under the owner's time.
- **Unchanged:** ADR-0003 (estimates are not durable state), ADR-0005 (its
  consequence for re-asking is recorded in the new ADR), ADR-0007 (own HTTP
  client), ADR-0011 (followed), ADR-0014 (the owner's time keeps one target).

## 11. Risks

- **Wrong place match.** Calendar places are often room or business names;
  Google may match the wrong place and return a plausible but wrong time,
  which is worse than "not found". Mitigation: the "(estimated)" mark, and the
  owner's own time always wins (D-042). Not solvable in the design.
- **extensions.gnome.org review.** The pack will send addresses to a
  third-party service and read a key from the keyring. Reviewers ask for
  network use to be off by default, declared and out of the shell process;
  this design does all three, but a review can still refuse or delay.
  `assumed`, not tested with a reviewer.
- **Billing on unlock.** Estimates are memory-only and locking disables the
  extension, so every unlock re-asks every eligible meeting in the 36-hour
  window. An owner who locks often with many in-person meetings can leave the
  free tier and pay. Mitigation inside G: a per-day call cap, and live
  re-asks only for meetings past their heads-up. The cap's number is the
  owner's choice (product finding).

## 12. How PG-17 and PG-18 fit

- **PG-17, start from the meeting before (D-044):** one more rule in F's start
  place (a must-attend, in-person meeting with a place ending at most 2 hours
  before, same day) and one more re-ask trigger in G (the meeting before
  changed). No new component, no contract change beyond F. Needs K4 and K5.
- **PG-18, buffer (D-045):** one setting in I and J, one addition in F after
  the ranking (own, estimated or default, plus the buffer), and the
  "+ 10 min buffer" text in H. It does not need any K ticket and can be built
  before PG-16.
