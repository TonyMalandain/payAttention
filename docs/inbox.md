# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — PG-8c plan notes
- §7.2 should list `Verdicts.aiProgress(now)` and the new `aiProgressOf` in `app/aiQueue.js`.
- §7.3 should record:
  - exit codes 130/129/143 for Ctrl-C, terminal close and kill;
  - `cleanText` applied to the JSON output, and the JSON is ASCII-only;
  - `overridden` means `verdictOverridden`;
  - the 5-minute AI wait counts from the first snapshot, and `generatedAt` is the moment the list was computed.
- boundaries.md: the `preview/` row allows `GLibUnix`. The preview is one GNOME entry file (`main.js`) plus logic files linted like `app/`.
- testing-and-build.md:
  - the `connectObject` pitfall no longer applies to the store (it still applies to `environment.js`);
  - the build ships `preview/` and checks the zip;
  - `test:helper` now needs the zip from `npm run build`;
  - the preview integration test is a new layer.
- The preview runs only from the installed copy (ADR-0012). `npm run preview` is the shortcut; `npm run -s preview -- --json` is needed for clean JSON.
