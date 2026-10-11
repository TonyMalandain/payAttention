# Backlog

Delivery status. Not product documentation. Owned by the product manager.

Spec for everything below: `docs/prd/meeting-guardian.md` (covers R-1…R-19 in `docs/product/solution.md`).
Architecture: `docs/architecture/` (ADR-0001…0006).

## Done — the meeting guardian (PG-1)

- **PG-1a — The judgment and timing rules.** Built, reviewed (1 defect, fixed), accepted.
- **PG-1b — Reading the owner's calendars.** Built, reviewed (2 defects, fixed), accepted.
- **PG-1c — Alerts, top bar, settings, install.** Built, reviewed (2 defects and 1 risk, fixed), accepted in round 2.
- Checks at the end: lint clean, 647 unit tests, 66 calendar-reader tests, headless GNOME smoke test PASS, installed to `~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io` and enabled for the next login.

## Done — uninstall (PG-3)

- **PG-3 — Remove payAttention with one command.** Built, reviewed (2 defects, fixed), and checked by the product manager. `npm run uninstall:local` removes it and keeps saved choices. `npm run uninstall:local -- --purge` also erases them.

## Now — AI mode (PG-4, size L)

- **PG-4 — Rules or AI mode; AI judges every meeting from the whole invite** (spec: `docs/prd/meeting-guardian.md`, "Addendum 2026-09-27 — AI mode"; R-18, R-19, D-019, D-020, D-021). Size **L**, to be split by the architect's order: core pieces first, then the AI helper, the shell side, settings plus the password store, and uninstall `--purge`.
  - **What changes for the owner:** a mode switch in Settings. In AI mode, verdicts come from the engine they connect (endpoint, model, API key), with an "AI:" reason. The rules take over if it is down.
  - **Who it is for:** Calendar owner, Installer.
  - **Done when:** see the addendum's "Done when".
  - Architecture: ADR-0007, ADR-0009, ADR-0010, `interfaces.md` §6. Product rulings: D-019 to D-024.
  - Build order (each: plan → build → review):
    - **PG-4a — Core AI pieces (M). ACCEPTED** (review round 2).
      - Scope was: Settings keys and defaults, endpoint rules, the invite builder with its limits (D-020, D-022, D-023, D-024), fingerprint, prompt text, reply and protocol checks, and `judge` taking stored AI answers. Done when unit tests prove each rule in the addendum that core owns.
    - **PG-4a2 — Passcode follow-up (S). DONE** (D-029): dial-in strings removed; HTML line breaks treated as line ends; plural keywords and hidden marks inside a keyword handled; `buildInvite` doc comment refreshed. Done when unit tests cover a standard Zoom, Meet, Teams and Webex invite in plain text and HTML, and nothing that looks like a passcode or dial string survives. Runs after PG-6 (which touches the same file).
    - **PG-4a3 — Plain text first, passcode removal round 2 (S). DONE**, and passcode work is closed (D-030). It fixes the review defects:
      - direction marks inside a keyword;
      - no-break spaces and non-breaking hyphens in dial strings;
      - a space before the pause;
      - numbered dial lines;
      - `<br>` with attributes;
      - untested dial-rule edges.

      It also adds: HTML to plain text first, entities and `%xx` decoded, and one shared list of invisible marks. Done when every variant from the PG-4a2 review is removed by a test, and the agenda text survives.
    - **PG-4b — AI helper (M). ACCEPTED** (review round 1 fix: the 60 s socket timeout). A separate process that talks to the engine and reads the key from the password store. Done when tests against a fake engine pass, with no real cloud call.
    - **PG-4c — Shell side (M). ACCEPTED** (review round 1: test-only fixes). The queue, keeping old answers while asking again, the fallback, the budget, and "AI:" / "AI unavailable" in the menu. Done when no alert ever waits on the AI (tested). Also: both helper spawns (calendar and AI) drop `G_MESSAGES_DEBUG` from the child environment per `interfaces.md` §1 "Environment", tested.
    - **Carry-overs to fold into review fix rounds:**
    - **PG-4c2 — One bad invite never blocks the others (S). DONE**, accepted on mutation evidence (10 of 10 caught). In `extension/shell/aiQueue.js` (the `lost` branch), from the second `lost` in a row on the same meeting, that meeting backs off (1 min, doubling up to 30) and joins `failedKeys`, so the queue moves on. Spec: `interfaces.md` §6.5 "Lost streak". Done when unit tests prove a meeting whose invite always crashes the helper does not stop other meetings getting AI answers. Runs after the PG-4c fix round (same file).
    - **PG-4d — Settings page (S). ACCEPTED** (review round 1 fixes; full checks green 2026-09-27). Mode switch, endpoint, model, key, "Test connection", and the warning. The warning must include the D-030 wording: "Passcodes and dial-in numbers are removed first, on a best-effort basis." "Test connection" also drops `G_MESSAGES_DEBUG` from the helper it spawns (§1 "Environment").
    - **PG-4e — Uninstall `--purge` (S). ACCEPTED** (review round 1). One leftover: move the `OTHER_SCHEMA` block above `finish()`'s why-comment in `tests/ai/gjs/keyring.js`, and refresh that file's header. This goes with the next engineer run. Also erases the key and the stored AI answers.
- **Owner's machine (not product work):** the NVIDIA driver is not built for the running kernel, so a local engine runs on the processor (about 5 to 20 s per verdict, estimated).

## Now — small fixes from the owner

- **PG-5 — "See Details" in Extension Manager opens the GitHub repository (S).**
  - **What changes for the owner:** in Extension Manager, "See Details" opens the project's GitHub page instead of showing an error.
  - **Who it is for:** Installer.
  - **Why it fails today:** the extension does not declare a project address, so the link has nowhere to go.
  - **Done when:**
    - the extension declares the repository address;
    - "See Details" opens it (checked by hand in Extension Manager after reinstalling);
    - the README links to it too.
  - **Unblocked 2026-09-29:** the repository exists at `https://github.com/TonyMalandain/payAttention` (private).
- **PG-6 — Apply the Apache License 2.0 (S)** (D-026). **DONE**, accepted in review (2173b15).
  - **What changes for the owner:**
    - GitHub shows "Apache-2.0" on the repository page;
    - the project states its licence clearly;
    - nothing it uses conflicts with that licence.
  - **Who it is for:** Installer, and anyone who reuses the code.
  - **Done when:**
    - **GitHub recognises it:** `LICENSE` is at the repository root and holds the Apache 2.0 text exactly as published by the Apache Software Foundation, unmodified. GitHub only detects an unmodified text. The copyright line goes in a `NOTICE` file and in the file tags, never inside `LICENSE`.
    - **`NOTICE`** at the root: "payAttention — Copyright 2026 Tony Malandain" (holder assumed; the owner confirms).
    - **Build file licence field** says `Apache-2.0`, replacing `GPL-2.0-or-later`.
    - **Each source file** starts with `SPDX-License-Identifier: Apache-2.0` and the copyright line.
    - **README** has a "License" section.
    - **The packed extension** contains `LICENSE` and `NOTICE`, and no third-party code.
    - **Dependency check, recorded as `THIRD-PARTY.md`** (or a README section):
      - No package ships inside the extension.
      - The development-only tools are all under permissive licences (MIT, Apache-2.0, BSD, ISC, BlueOak) and are never shipped.
      - The GNOME libraries it uses at run time are provided by the system, not copied (LGPL or MPL/LGPL; GNOME Shell GPL-2.0-or-later).
      - The engineer re-runs this check against the current dependency list, and a new dependency under a copyleft or unknown licence fails the check.

- **PG-7 — Use the owner's GNOME alert sound, not a fixed alarm (S).** **BUILT**, accepted in review (2173b15). Closes after the owner's check in PG-2, step 7.
  - **What changes for the owner:** the sound at the insist and takeover steps is the alert sound they chose in GNOME Settings (Sound → Alert Sound), not a fixed alarm-clock noise.
  - **Who it is for:** Calendar owner.
  - **Why:** the owner calls the current sound "noise". A familiar sound they chose is more likely to be accepted than tuned out.
  - **Done when:**
    - the insist and takeover steps play the alert sound selected in GNOME Settings;
    - changing it in GNOME Settings changes what payAttention plays, without reinstalling;
    - the existing sound on/off setting still silences it;
    - it still plays once per step, as today;
    - checked by hand in the real session.
  - **Open for the engineer:** what plays if the selected alert sound cannot be found. A silent failure is not acceptable (fall back to a standard sound).

- **PG-11 — Changing the travel time from an alert is obvious and readable (S). DONE 2026-09-30** (Parts A–E accepted; the owner accepted the look in `npm run sample`). Reaches the owner's real session with the PG-2 reinstall. Part A (readable boxes, Change travel time button) **ACCEPTED** in review round 1 (9350ce5). Part B (hold) **ACCEPTED** in review round 2 (091132a, c1aa1c2); Part C (menu marks) **ACCEPTED** in review round 1 (20e0ae8); Part D (visible sample) **ACCEPTED** in review round 2 (0b9d1a8, 95eda8e); the owner's look at the window closes PG-11. Refines R-11 (in-person meetings count down to the leave-by time).
  - **What changes for the owner:** on a heads-up or nudge card for an in-person meeting, they can see how to change the travel time, and they can read the number in every box.
  - **Who it is for:** Calendar owner.
  - **Why:** the owner's first real use (2026-09-30). The underlined "· change" did not look clickable. The boxes showed no readable numbers, so the owner had to guess which was shorter. A guessed travel time gives a wrong leave-by time. The owner is fine with today's row of boxes once the numbers can be read.
  - **Done when** the cards behave as in the spec (`docs/prd/meeting-guardian.md`, §4 Travel time):
    - the travel line has a "Change travel time" button that looks like the card's other buttons;
    - the number in every box ("10 min" … "90 min") reads in full on the heads-up card (the narrowest) and on the nudge card, with the current one marked;
    - picking one saves it and moves the alert times at once; it does not stop the escalation;
    - the heads-up card does not go away on its own while the boxes are shown;
    - a check fails if a box's text is cut off on the narrowest card; screenshots of both cards are added to `docs/screenshots/`.
    - **top-bar menu:** in a meeting's expanded travel list, the mark on the current value sits in the same column, and is the same kind of mark, as the marks on the other values. Today the current one shows a check mark slightly left of the round marks on the other lines (owner report, 2026-09-30). One value can be chosen, so every line uses the same single-choice style;
  - **Not in this ticket:** the list of values.
  - **Part E — owner's look at the sample (2026-09-30): the Part A layout is rejected.** Built (63c2bec); **the owner accepted it in the sample** (2026-09-30); **ACCEPTED** in review round 1. Owner, word for word: "new UI is worse. The change time button is too invasive. a Change Time hyperlink is probably enough. The time buttons are too big. A single row with the values was nice and compact. The only problem is that we couldn't read the values". Done when (PRD §4):
    - the button becomes a small "Change time" link that reads as a link;
    - the boxes are one compact row of numbers only (10 … 90), "min" said once, every number readable, on one line of the heads-up card (the narrowest);
    - Part B (the card stays while the boxes are shown) and the menu marks (Part C) are unchanged;
    - the smoke checks that no number is cut off and that the row stays on one line within the card; screenshots replaced;
    - the owner looks at it again in `npm run sample`.

- **PG-12 — "Test alert" is hidden from the menu unless turned on (M: one new setting reaching about ten places). DONE 2026-10-01**, accepted in review round 1 (8fb899a). D-036. A test alert already running keeps going if the switch is turned off.
  - **What changes for the owner:** the everyday menu no longer shows "Test alert". Settings gets a switch, "Show Test alert in the menu", off by default; turning it on shows the item at once, without a re-login, and turning it off hides it.
  - **Who it is for:** Calendar owner.
  - **Why:** the owner: "Useless in prod."
  - **Done when:**
    - with the switch off (the default, also for an existing install), the menu has no "Test alert" item;
    - turning the switch on or off in Settings updates the menu while it runs;
    - `npm run sample` turns the switch on in its throwaway settings, so the sample still offers Test alert;
    - an uninstall with `--purge` erases the switch like every other setting;
    - README "First five minutes" and the PG-2 checklist say to turn the switch on first;
    - the smoke checks the menu without the item by default and with it when the switch is on.

- **PG-13 — "Test alert" is a developer tool, not a setting (M). DONE 2026-10-01**, accepted in review round 1 (6f4a058), no defects. D-037 supersedes D-036; undoes the switch from PG-12.
  - **What changes:** Settings no longer has "Show Test alert in the menu". A normal install never shows Test alert. The developer turns it on with a development option, not a setting: the sample desktop always has it, and the developer can install a build into their real desktop that has it. The architect chooses the option (build time or run time).
  - **Who it is for:** Calendar owner (shorter menu, one setting fewer); developer (needs it in the sample and for the real-desktop checks in PG-2).
  - **Why:** the owner: "The test alert is a dev feature. What's the point of having a dev feature activable via settings? I meant we should use a feature flag either triggered at build time or runtime via a command line argument or config file option when running the mutter-devkit".
  - **Done when:**
    - `npm run install:local` installs a copy whose menu never shows Test alert, and Settings has no switch for it;
    - an install that had the PG-12 switch turned on also shows no Test alert after the update;
    - `npm run sample` shows Test alert in the menu with no extra step;
    - one documented command or option puts a copy with Test alert into the developer's real desktop, and the normal install command removes it again;
    - the smoke checks both: no item in a normal build, the item in a developer run;
    - README "First five minutes" no longer mentions Test alert; the Development section says how to get it.
    - README "The alert ladder" shows a screenshot of each step (heads-up, nudge, insist, takeover), from the existing files in docs/screenshots/, because D-037 says the README now shows the ladder in place of Test alert. Size set: **M** (plan docs/plans/PG-13.md).

- **PG-14 — A place means in person; every in-person meeting can get a travel time (L: three behaviours, a new stored key, contracts across every layer; plan docs/plans/PG-14.md).** **DONE 2026-10-04**, accepted in review round 1 (c198414..9b3723a, follow-up 7f5c074); the owner checked "Client workshop" in `npm run sample`. D-038 (supersedes D-007), D-039. Refines R-10 and R-11.
  - **What changes for the owner:** a meeting with a physical place counts as in person even with a video link. Every in-person meeting shows travel choices in the menu and "Change time" on its alert, with or without a place.
  - **Who it is for:** Calendar owner.
  - **Why:** the owner: "if location -> set to in person. then UI should be: if 'in person', then let user change travel time. Travel time shouldn't be tied to a location set. sometimes the user will know the location and won't need it written down". Two real afternoon meetings switched to in person could not get a travel time.
  - **Done when:**
    - a meeting with a physical place and a video link is in person; with only a link, or a place like "Zoom", or no place, it is online; the owner's switch still wins;
    - an in-person meeting with no place shows the travel choices in the menu and "Change time" on its alert;
    - picking a time there saves it for the whole series (or that one meeting if it does not repeat), and the alert times move at once;
    - a meeting with a place still remembers its time for the place, as before;
    - `npm run uninstall:local -- --purge` erases the new saved times; a plain uninstall keeps them;
    - Join stays on every meeting with a video link, also when it is in person (D-040);
    - a location made only of video-call wording ("Join Zoom Meeting", "Teams-Besprechung") stays online; one that also names a place ("Board room + Zoom") is in person;
    - "Clear travel times" clears both kinds;
    - README "How it decides" / "First five minutes" say this; the owner checks it in `npm run sample`.

- **PG-15 — The menu stays open after a change in a meeting's row (M: one behaviour, all in the UI layer, a new row file and three smoke checks; plan docs/plans/PG-15.md).** **DONE 2026-10-04**, accepted in review round 2 (38ae593, cc3f260); the owner checked it in `npm run sample`. Round 1 found one test gap (a travel pick after an in-place redraw must use the meeting's current target), closed in cc3f260. Deviation recorded: the plan asked for one commit per step; the product manager committed the engineer's finished working tree as one commit (38ae593), so the behaviour-preserving move was not checked green on its own. The reviewer's mutations stand in for that proof. History is not rewritten. Refines R-6 and R-14; PRD §5.
  - **What changes for the owner:** clicking Switch to in person / online, a travel time, Apply to whole series, Back to automatic, or the Must attend switch no longer closes the menu. The menu stays open, the same meeting stays expanded, and it shows the new state.
  - **Who it is for:** Calendar owner.
  - **Why:** the owner, after trying PG-14 in the sample: "why does clicking on switching to in person / online make the menu disappear. Can it just be refreshed / redrawn instead?" Switching to in person and then picking a travel time takes two trips into the menu today.
  - **Done when:**
    - after each of those actions the menu is still open and the same meeting row is still expanded;
    - the row shows the new state: after Switch to in person, the travel choices are there; after a travel pick, the mark is on the new value; after Switch to online, the travel choices are gone;
    - other meetings' rows are unchanged and stay collapsed;
    - when the calendar refreshes while the menu is open, the expanded row stays expanded if that meeting is still listed;
    - the smoke checks at least Switch to in person followed by a travel pick without reopening the menu; the owner checks it in `npm run sample`.

- **PG-16 — Estimated travel time with Google (XL, to be split by the architect's design).** R-21, D-041, D-042, D-043; spec: PRD "Addendum 2026-10-04 — Estimated travel time". **Waits for the owner to approve the architect's high-level design.**

- **PG-17 — Estimates start from the meeting before (follow-up to PG-16).** D-044, R-21. A must-attend in-person meeting with a place that ends no more than 2 hours before the next in-person meeting, same day, is the start of that trip. Owner: "'start from the meeting before' is a good idea to implement. It can be done as phase 2." Needs PG-16.
- **PG-18 — A buffer on every in-person trip (follow-up to PG-16).** D-045, R-22. One "Buffer" setting, 10 min by default, added to own, estimated and default travel times, shown apart ("+ 10 min buffer"); the leave-by time includes it. Owner: "a buffer time too in between meetings, e.g. time to say goodbye, walk to the car, or park the car on the other side." Does not need PG-16; it can be built before it.

- **PG-19 — Meetings on the owner's own secondary calendars count as the owner's (size set by the senior engineer, after the architect checks feasibility).** Refines R-4; keeps "Only meetings the owner is invited to" for calendars of others.
  - **What changes for the owner:** a meeting on a calendar the owner owns (for example a second Google calendar for a side business) is judged as the owner's meeting, even when the invite lists that calendar's address instead of the owner's email. A calendar of someone else that the owner only displays still never alerts.
  - **Who it is for:** Calendar owner.
  - **Why:** a real one-to-one video call on the owner's own secondary calendar was judged "not invited: someone else's meeting" and never alerted (2026-10-09). Owner: "It was incorrectly classified as optional / not to be alerted about."
  - **Done when:** a meeting whose organiser or attendee is one of the owner's own calendars' addresses is judged with the owner as organiser or attendee; a shared calendar of another person is unchanged; the owner needs no setting for it; the preview shows the right verdict.
  - **Open for the architect:** whether the desktop can tell the owner's own calendars from calendars shared with them, and get each one's address.

## Now — needs the owner (cannot be done unattended)

- **PG-2 — First real-session check (size S).** Log out and log back in. Then:
  0. Move to the new ID: run `npm run install:local` from a terminal inside the session, then log out and back in right away (alerts pause until then).
  1. `gnome-extensions info payattention@tonymalandain.github.io` shows `ACTIVE`. (Passed 2026-09-27 under the old ID; check again after the move.)
  2. `journalctl --user -b | grep -i payattention` shows no errors. **PASSED 2026-09-27**: no payAttention or shell script errors this boot.
  3. The top bar shows your next must-attend meeting. The menu lists today's meetings with their reasons.
  4. Run `npm run install:developer`, then log out and back in **Test alert** from the menu shows all four steps. The takeover covers both monitors, even over a full-screen window, and works alongside PaperWM.
  5. Mark a personal task that matters (for example the piano pick-up) as must-attend for the whole series.
  6. Optional: turn the network off for 15 minutes and check that the "not updating" warning names the calendar.
  7. Sound (PG-7): with the developer copy, run **Test alert** and hear your GNOME alert sound at the insist and takeover steps. Change it in GNOME Settings (for example to Swing, then Hum) and run it again with no re-login; the sound follows. Set GNOME's alert sound to "None" and confirm payAttention is silent (D-028). Then restore your choice.
  7b. Go back to the normal copy: `npm run install:local`, then log out and back in. The menu has no Test alert.
  8. AI mode (PG-4):
     - Settings → Verdicts: pick "AI".
     - Enter an endpoint and model. For example, install Ollama, then `ollama pull llama3.1:8b`, endpoint `http://127.0.0.1:11434/v1`, model `llama3.1:8b`, no key.
     - Press "Test connection" and get "Yes".
     - Open the menu: today's meetings show "AI: <reason>" within a few minutes.
     - Stop the engine: the menu says "AI unavailable — using rules", and alerts still come.
     - Start it again: AI answers return within 5 minutes.
     - Note: the GPU driver is not built for the running kernel, so a local model runs on the processor and may be slow.
  - The full checklist is in `docs/architecture/testing-and-build.md`, under the real-session section.

## Next — verdict preview command (PG-8, size M)

- **PG-8 — See what payAttention would decide, from a terminal** (R-20, D-032).
  - **What changes for the owner:** one command lists upcoming meetings with verdict, reason, online or in person, and "AI:" when AI mode is on. It uses the extension's own saved settings, overrides and AI engine, reads the real calendars, and never shows an alert or changes anything.
  - **Who it is for:** Calendar owner, Installer.
  - **Done when:**
    - it runs with no login or logout;
    - its verdicts match what the extension decides for the same meetings (tested);
    - it reuses the same core, calendar reader and AI helper, with no copy of logic;
    - the README shows how to use it.
  - Architecture: ADR-0011 (ports and adapters), ADR-0012 and `interfaces.md` §7 (the preview design). Product: D-033.
  - Build order:
    - **PG-8a — Move the GNOME-free orchestration into `extension/app/` (M, move only). DONE**, accepted on evidence (byte-identical move, all checks green). Leftover: the stale `./shell/controller.js` lint probe at `tests/unit/boundaries.test.js:60`. It moves controller, aiQueue, aiBudget, health, backoff, view and soundCue, with a lint block like core's. Done when all tests pass unchanged and lint forbids GNOME imports in `app/`.
    - **PG-8b — Extract the verdict component and split the store into reader and writer (M). ACCEPTED** (review round 1, no defects). Hard prerequisite for PG-8c. Done when the controller uses the new component, the existing controller tests keep their meaning, and the reader side cannot write.
    - **PG-8c — The preview command (M). ACCEPTED** (review round 1, no defects; fix round for wording and polish). Notes from the PG-8b planner: the preview's lint block must forbid importing `StoreWriter` by name; the AI only progresses when the judged list is fetched, so the preview fetches it on its own timer. It also carries the lint guard "only `app/verdicts.js` imports `core/judge.js`", added inside each directory's existing pattern list (see boundaries.md). From the PG-8b review: add one line to the public JSDoc of `judgedList` (AI asks happen only after `judgedList` is called again following a change); make `feedFacts` and `refresh` safe after destroy, like `judgedList`. `extension/preview/`, shipped in the zip. Done when the four parity checks in §7 pass and the README shows how to run it.

## Done — polish (PG-4f)

- Done with the PG-8c fix round.

## Now — new extension ID (PG-10, size S)

- **PG-10 — Change the extension ID to `payattention@tonymalandain.github.io`** (D-034). **DONE 2026-09-29**: code, docs and the full history are free of the old domain (zero matches); force-pushed. The owner still has to reinstall once (see PG-2).
  - **What changes for the owner:** the work domain disappears from the project. Settings, saved choices and AI keys are kept.
  - **Who it is for:** Installer.
  - **Done when:**
    - no file in the repository contains the old work domain;
    - **one source for the ID:** `extension/metadata.json` is the only file of code that spells it out. Scripts, tests and the build read it from there (the extension already asks GNOME at run time). Docs may name it for readers. A test fails if the ID is written out anywhere else in code;
    - moving an existing install to the new ID never leaves two copies enabled, never breaks the running session, and leaves no old copy behind once the owner has logged out and back in;
    - all checks pass;
    - the history is rewritten so no commit contains the old work domain, and it is force-pushed.
  - **Order:** the architect amends ADR-0006 and designs the switch-over; an engineer changes code, scripts, tests and README; the product manager rewrites history and pushes.

## Next — small follow-ups (PG-9, size S)

- The Settings Model field follows an outside change of `ai-model`.
- Lint: a `..` in the middle of a path (`../core/../shell/store.js`) still sidesteps every pattern. The architect decides a robust rule (for example resolving paths in a custom rule).

## Housekeeping (engineering)

- `mustWait` in the smoke stage helper builds its failure message before waiting, so a message with live state shows the state at the start of the wait, not at the timeout (PG-15).
- Plan sketches with an unused parameter fail the project lint; plans should match the lint (PG-15).
- PG-15: dragging the Must attend switch handle is not exercised by any test (a click is).
- PG-14 review preferences: the no-place view fixture pairs `series:j1` with `seriesKey` `series:p1`; the smoke "Site visit" card now carries a meeting target, which reads oddly.
- The unit test "digits split by spaces: under 200 ms" (invite tests) measures wall-clock time and failed once at 210 ms on a busy machine (PG-13 build). For the senior engineer: make it not depend on machine load.
- PG-13 review preferences: build checks run after both zips are written, so a failed build leaves bad zips in `dist/`; the controller test repeats the hand-built dependency list of the AI controller test; one uninstall-check line uses a loose match where the line above checks strictly.
- The plans in `docs/plans/` do not show the deviations accepted in review (the PG-1b start-up sync order, the PG-1c takeover panel layout, the menu idle rebuild, the compact takeover). Update them if the plans are reused.
- Two lint rules the architect logged as debt: forbid St/Clutter in `shell/`, and forbid creating settings in `ui/`.
- `buildInvite` accepts a start time beyond the range of a date (above 8.64e15 ms) and produces an invalid invite. Widen the check (PG-4a leftover).
- The PG-4a plan still says text passcodes are out of scope; D-025/D-027 superseded that.
- AiQueue `_retry`/`_failedKeys` are never pruned of past meetings (small, slow growth over a long session). Pruning needs a §6.5 retention rule first; dropped as a preference for now.
- Smoke check 6d guards readable travel numbers but not that the heads-up card stays within its width; only the screenshots guard that (PG-11 review preference).
- One `npm run test:helper` run gave 199/200 during concurrent commits and did not recur; the failing test was not captured. Possibly flaky (PG-11 Part C report).
- Sample shell safety (PG-11 Part D, for the senior engineer): take the extensions-folder snapshot before the build and install, not after; `isolated_install` should refuse `.git` and other dot names that are not throwaway homes.
- Each `npm run smoke` leaves `pa-smoke-*` sockets, locks and `.mutter-Xwaylandauth.*` files in the owner's runtime folder (124 had built up). Clean them up after a run (PG-11 Part D review).
- Isolation check 7 sometimes prints a harmless "A connection to the bus can't be made" line that reads like a failure.
- PG-11 plan line ~679 says "a caller cannot reach the owner's bus"; the architecture now says "never by default" (senior engineer rewords if the plan is reused). The plan's F4 widened-bus probe was replaced in the build by a safer fake service.
- Smoke 6d does not guard the travel boxes' height; removing `min-height: 0px` would bring back the big boxes the owner rejected and still pass (PG-11 Part E review).
- Smoke covers only the compact takeover size. Add a 1200x900 monitor to guard the regular size.

## Later candidates (not decided)

- Treat personal events with a physical place as must-attend, if several such series end up overridden (see NOTES, D-015).
- Revisit AI-assisted verdicts if overrides turn out frequent (see `solution.md` exclusions).
- Revisit live travel estimates if fixed travel times cause late arrivals.
