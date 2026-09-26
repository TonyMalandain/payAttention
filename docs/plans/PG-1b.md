# Plan — PG-1b: reading the owner's calendars (the calendar helper and its integration test)

**Sensitive: personal data.** The helper reads every meeting in the owner's calendars: titles, people's names and addresses, places, descriptions and links.
- It writes calendar content **only** as protocol lines on stdout.
- stderr carries short codes only (`payattention-helper: <code>`). Nothing else is ever logged.
- `--summary` prints counts only.
- It is read-only. It calls no EDS method that creates, modifies or removes anything. The allowed calls are listed under "EDS calls".
- Tests use synthetic data only (`*.test` domains), in an isolated EDS on a private D-Bus. The test code builds that environment from scratch, so it can never reach the real session bus.

## What changes, and for whom

`extension/helper/main.js` is a gjs program that the calendar feed (PG-1c) spawns.
- It lists the calendars the clock menu shows and expands recurring meetings.
- It writes complete protocol-v1 snapshots of `[now − 1 h, now + 36 h)` to stdout: on start, every 5 min, 2 s after any calendar change, and on a `refresh` request.
- It asks EDS to sync remote calendars at start, every 10 min, and on `refresh`.
- It exits with status 0 when stdin closes, and it does not dump core.

The calendar owner cannot see any of this yet. It is the data every alert in PG-1c depends on.

## The component

- **Responsible for:** turning the owner's selected EDS calendars into faithful protocol-v1 snapshots on stdout.
- **Has drifted by:** no drift. This is new code. Module responsibilities are fixed below so that drift cannot start here.
- **This change belongs here because:**
  - ADR-0001 and `boundaries.md` make `extension/helper/` the only code that may touch ECal, EDataServer or ICalGLib.
  - The helper transcribes and never judges. Owner detection, guest counting and link detection stay in core (PG-1a).

### Modules and what each one is for (one job each)

| File | Responsible for | Imports |
|---|---|---|
| `extension/helper/main.js` | Entry point. Parses argv, runs the main loop, wires the parts together, and is **the only place that ends the process**. | `gi://GLib`, `system`, the helper modules below |
| `extension/helper/stdio.js` | The process's three file descriptors. It writes protocol lines and summary text to fd 1, writes diagnostic codes to fd 2, and reads lines from fd 0. | `gi://Gio`, `gi://GioUnix`, `gi://GLib`, `../core/protocol.js` |
| `extension/helper/calendarReader.js` | Every EDS conversation: the registry, the per-source clients, the change views, instance expansion, and remote-sync requests. | `gi://ECal?version=2.0`, `gi://EDataServer?version=1.2`, `gi://ICalGLib?version=3.0`, `gi://Gio`, `gi://GLib`, `./transcribe.js`, `./range.js` |
| `extension/helper/transcribe.js` | Turns one expanded instance (ICal/ECal objects) into one Occurrence DTO. No I/O. | `gi://ECal?version=2.0`, `gi://ICalGLib?version=3.0`, `./text.js` |
| `extension/helper/snapshotService.js` | When to read: the timers, the debounce, one read at a time, and refresh commands. | `gi://GLib`, `../core/protocol.js`, `./range.js`, `./messages.js` |
| `extension/helper/messages.js` | Pure. Builds protocol message objects in canonical order. | `../core/protocol.js` |
| `extension/helper/range.js` | Pure. The snapshot range and the overlap rule. | none |
| `extension/helper/text.js` | Pure. Normalises addresses and truncates descriptions. | `../core/protocol.js` |
| `extension/helper/summary.js` | Pure. The counts-only text for `--summary`. | none |

`messages.js`, `range.js`, `text.js` and `summary.js` have no `gi://` imports, so Node imports them directly in `tests/helper/*.test.js`.

## Facts established on this machine (2026-09-26; gjs 1.88.1, EDS 3.60, GLib 2.88.3)

Each fact comes from a read-only probe: the fixture EDS, or real calendars with counts only. The plan depends on each one.

1. **Exiting.** The process must end with `System.exit(code)` called **from a GLib main-loop source callback**, while the loop is running. Measured in the isolated fixture EDS:
   - `System.exit` inside a `GLib.idle_add`, timeout or async-I/O callback exited 0 in 5/5 runs, and 10/10 on the stdin-EOF path.
   - Returning from the module, `System.exit` with no loop, and `loop.quit()` followed by a return all segfaulted (exit 139) in 5/5 runs each.
   - **`System.exit` called from a promise continuation (after `await`) hangs forever.** It also hung against the real calendars, and needed `kill -9`.
   - Deferring the call with `GLib.idle_add(GLib.PRIORITY_HIGH, …)` exits 0, on the fixture (5/5) and on the real calendars (3/3).
   - An explicit exit code works: `System.exit(3)` gave 3 with output intact.
2. `ECal.Client.connect(source, ECal.ClientSourceType.EVENTS, 0xFFFFFFFF, cancellable, cb)` with `ECal.Client.connect_finish(res)` works. `0xFFFFFFFF` is `(guint32) -1`, which means "do not wait for the backend to be online"; it reads EDS's cache. Passing `-1` throws "out of range for uint32". On the real calendars, all 9 sources connected in 1–14 ms.
3. A source whose backend does not exist fails `connect_finish` after about 30 ms with `Gio.IOErrorEnum` code 15. It does not hang.
4. `client.get_backend_property_sync(ECal.BACKEND_PROPERTY_CAL_EMAIL_ADDRESS, null)` returns `[true, value]`. The value is `""` for sources with no address (contacts, local without one). The `local` backend returns `[Local Backend] EmailAddress=` from the `.source` file, which is how the fixture gets a non-null `ownerEmail`. Real calendars: 7 of 9 sources have an address (all CalDAV).
5. `client.generate_instances_sync(startSec, endSec, null, (icomp, instanceStart, instanceEnd, cancellable) => true)` expands series. Each instance's `icomp` carries a `RECURRENCE-ID`, including instances generated from the master. Moved (detached) instances and `STATUS:CANCELLED` detached instances come back with their own values. `EXDATE` instances are absent.
6. **Time conversion.**
   - `ICalGLib.Time.as_timet()` **ignores the zone.** A 15:00 Asia/Tokyo time came back as 15:00Z.
   - Correct conversion is `t.as_timet_with_zone(zone)`, where `zone` is `t.get_timezone()` for a TZID time, the UTC zone when `t.is_utc()` (for `Z` times `get_timezone()` is `null`), and the local zone for DATE values and floating times.
   - `ECal.util_get_system_timezone()` ignores the `TZ` environment variable (it returned America/New_York under `TZ=Asia/Tokyo`). `GLib.TimeZone.new_local().get_identifier()` honours `TZ`.
   - `ICalGLib.Timezone.get_builtin_timezone('UTC')` returns `null`, and `get_builtin_timezone('Asia/Tokyo')` works.
7. **Attendee defaults.** `ECal.ComponentAttendee` already applies the RFC 5545 defaults:
   - no `CUTYPE` becomes `INDIVIDUAL`;
   - no `PARTSTAT` becomes `NEEDSACTION`;
   - no `ROLE` becomes `REQPARTICIPANT`;
   - `X-…` values come back as the `X` member.
8. `ECal.util_get_attendee_email(att)` and `ECal.util_get_organizer_email(org)` prefer the `EMAIL=` parameter and strip `mailto:` in any case. They do **not** lowercase.
9. **`ICalGLib.Property.isa()` throws on `CONFERENCE`** ("120 is not a valid value for enumeration PropertyKind"). Identify properties **by `get_property_name()` only**. `get_value_as_string()` returns URLs unescaped for `X-GOOGLE-CONFERENCE`, `CONFERENCE` and `URL`.
10. **Change views.** `client.get_view_sync('#t', null)` returns `[true, view]`. With `view.set_flags(ECal.ClientViewFlags.NONE)`, there is no initial flood of objects. `objects-added` fired about 1 s after another client created an object. Editing the `.ics` file directly does **not** notify (the file backend does not watch it), so the change test writes through EDS.
11. `client.check_refresh_supported()` is true for CalDAV and false for local and contacts. `client.refresh(null, cb)` with `refresh_finish(res)` returns `true` in about 3 ms (it only starts the sync).
12. An isolated EDS always has two built-in selected sources, `birthdays` (contacts) and `system-calendar` (local), both empty, besides any `.source` files you add. A source with `Selected=false` is listed by `list_enabled` and must be filtered by `get_selected()`.
13. `Gio.UnixInputStream` and `Gio.UnixOutputStream` still resolve, but print a `Gjs-WARNING` ("moved to … GioUnix") on every use. `gi://GioUnix` imports cleanly.
14. `node --test <dir>` fails on Node 24.11. `node --test "tests/helper/**/*.test.js"` works and does not pick up non-`.test.js` files such as the gjs writer.

## Seams

### `extension/helper/range.js` (pure)
```js
export const RANGE_BEFORE_MS = 3_600_000;      // constraints.md: [now − 1 h, now + 36 h)
export const RANGE_AFTER_MS = 129_600_000;
/** @returns {{rangeStart:number, rangeEnd:number}} */
export function snapshotRange(nowMs)
/** Protocol rule "occurrences overlapping [rangeStart, rangeEnd)". A zero-length occurrence at t overlaps when rangeStart <= t < rangeEnd. */
export function overlapsRange(start, end, rangeStart, rangeEnd)   // -> boolean
```
The clock is a parameter, so nothing in this module reads time.

### `extension/helper/text.js` (pure)
```js
/** Trim, strip one leading "mailto:" in any case, lowercase. null/undefined -> "". */
export function normaliseAddress(value)            // -> string
/** At most MAX_DESCRIPTION_LENGTH (from core/protocol.js) UTF-16 units; never ends on a lone high surrogate. null/undefined -> "". */
export function truncateDescription(text)          // -> string
```
Truncation rule:
1. If `text.length <= MAX_DESCRIPTION_LENGTH`, return it unchanged.
2. Otherwise let `cut = MAX_DESCRIPTION_LENGTH`.
3. If `text.charCodeAt(cut - 1)` is in `0xD800–0xDBFF`, set `cut -= 1`.
4. Return `text.slice(0, cut)`.

This keeps core's `description.length <= 32768` check true and never emits a broken character.

### `extension/helper/messages.js` (pure)
```js
export function helloMessage()                     // -> {type:'hello', protocol: PROTOCOL_VERSION}
/** Canonical order: sources by uid; events by start, then sourceUid, uid, recurrenceId (null first). Returns new arrays; never mutates inputs. */
export function snapshotMessage({generatedAt, rangeStart, rangeEnd, sources, events})
      // -> {type:'snapshot', protocol: PROTOCOL_VERSION, generatedAt, rangeStart, rangeEnd, sources, events}
export function statusMessage(level, code)         // -> {type:'status', level, code}
```
- `statusMessage` throws `TypeError('invalid status')` unless `level` is `'warn'` or `'error'` and `code` is one of the constants in `STATUS_CODES`.
- The misuse this rules out: a free-text (content-bearing) status. The codes are closed:

```js
export const STATUS_CODES = Object.freeze({
    REGISTRY_FAILED: 'registry-failed',   // error, fatal: EDS source registry could not be opened
    HELPER_FAILED: 'helper-failed',       // error, fatal: unexpected exception during startup
    SNAPSHOT_FAILED: 'snapshot-failed',   // error, not fatal: an unexpected exception while reading
    SNAPSHOT_INVALID: 'snapshot-invalid', // error, not fatal: core's formatHelperMessage rejected our own snapshot (a helper bug)
    BAD_COMMAND: 'bad-command',           // warn: a stdin line that parseShellLine rejects
    SYNC_FAILED: 'sync-failed',           // warn: at least one remote refresh failed in a sync round
    EVENT_SKIPPED: 'event-skipped',       // warn: at least one instance threw while being transcribed
});
export const SOURCE_ERRORS = Object.freeze({
    CONNECT_TIMEOUT: 'connect-timeout', CONNECT_FAILED: 'connect-failed', READ_FAILED: 'read-failed',
});
```

### `extension/helper/summary.js` (pure)
```js
/** Counts only. Never includes a title, name, address, place, description, link, uid or calendar name. */
export function formatSummary(snapshot)            // -> string, lines joined by '\n', with a trailing '\n'
```
The exact format has 7 lines. Keys and values are separated by single spaces:
```
payattention-helper summary (counts only)
protocol <PROTOCOL_VERSION>
sources <n> ok <n ok> failed <n !ok> with-owner-address <n ownerEmail !== null>
source-errors <code> <n> [<code> <n> …]         (codes sorted alphabetically; the word "none" when there are no errors)
occurrences <n> recurring <n> all-day <n> cancelled <n> tentative <n> with-attendees <n> with-organizer <n> with-conference-uri <n> with-location <n> with-description <n> transparent <n>
next-24h <n events with end > generatedAt and start < generatedAt + 86_400_000>
attendees <n> individual <n> group <n> resource <n> room <n> unknown <n>
```
- `with-location` and `with-description` mean a non-empty string.
- `with-conference-uri` means `conferenceUris.length > 0`.

### `extension/helper/stdio.js`
```js
export class Stdout {
    constructor()                          // wraps GioUnix.OutputStream.new(1, false)
    send(message)                          // line = formatHelperMessage(message) (core; throws TypeError if invalid); write_all(bytes) then flush()
    writeText(text)                        // for --summary only; write_all + flush
}
/** Writes `payattention-helper: <code>[ <detail>]\n` to fd 2. code must match /^[a-z0-9][a-z0-9._-]*$/; detail must match /^[A-Za-z0-9 ._:\[\]-]*$/, otherwise it is replaced with "(redacted)". */
export function reportDiagnostic(code, detail = '')
/** Reads fd 0 line by line with Gio.DataInputStream.read_line_async. Calls onLine(string) per line, onEof() once at EOF or on a read error. */
export function watchStdin({onLine, onEof})
```
- `send` goes through core's `formatHelperMessage`. **The helper cannot write a non-protocol line to stdout in protocol mode.**
- `reportDiagnostic` cannot carry free text.

`watchStdin` details:
- Use `new Gio.DataInputStream({base_stream: GioUnix.InputStream.new(0, false), close_base_stream: false})`.
- Inside `read_line_async(GLib.PRIORITY_DEFAULT, null, cb)`, call `read_line_finish_utf8(res)`, which returns `[line, length]`. A `null` line means EOF: call `onEof()`.
- If the finish call throws a `GLib.Error` that matches `GLib.ConvertError` or `Gio.IOErrorEnum.INVALID_DATA` (invalid UTF-8), call `onLine('�')`. The caller then reports `bad-command`. Then read on.
- Any other thrown error: call `onEof()`.

### `extension/helper/transcribe.js`
```js
/** @param {ICalGLib.Time} time @param {ICalGLib.Timezone} localZone @returns {number} epoch ms UTC */
export function toEpochMs(time, localZone)
/** One instance from generate_instances_sync -> OccurrenceDTO (core/types.js). Does not keep a reference to icalComponent. */
export function transcribeInstance(sourceUid, icalComponent, instanceStart, instanceEnd, localZone)
```

`toEpochMs` rule. Pick the zone as follows, then return `time.as_timet_with_zone(zone) * 1000`:
- `time.is_date()` gives `localZone`;
- otherwise `time.is_utc()` gives `ICalGLib.Timezone.get_utc_timezone()`;
- otherwise use `time.get_timezone() ?? localZone`.

`transcribeInstance` first builds `comp = ECal.Component.new_from_icalcomponent(icalComponent.clone())`. It must clone, because `new_from_icalcomponent` takes ownership. Then, field by field:

| DTO field | Source |
|---|---|
| `sourceUid` | the argument |
| `uid` | `comp.get_uid() ?? ''` |
| `recurrenceId` | `rid = icalComponent.get_recurrenceid()`: `null` when `!rid` or `rid.is_null_time()`, otherwise `toEpochMs(rid, localZone)` |
| `recurring` | `recurrenceId !== null` |
| `start`, `end` | `toEpochMs(instanceStart, localZone)`, `toEpochMs(instanceEnd, localZone)` |
| `allDay` | `instanceStart.is_date()` |
| `summary` | `comp.get_summary()?.get_value() ?? ''` |
| `location` | `comp.get_location() ?? ''` |
| `description` | `truncateDescription(comp.get_descriptions().map(t => t.get_value() ?? '').join('\n'))` |
| `conferenceUris` | walk `icalComponent.get_first_property(ICalGLib.PropertyKind.ANY_PROPERTY)` / `get_next_property(ANY_PROPERTY)`. Collect `p.get_value_as_string()` for names (compare `p.get_property_name().toUpperCase()`) `X-GOOGLE-CONFERENCE`, then `CONFERENCE`, then `URL`. The output order is those three groups, each in file order. Trim; drop empty values; drop exact duplicates, keeping the first. **Never call `p.isa()`** (fact 9). |
| `status` | `comp.get_status()` (an `ICalGLib.PropertyStatus`): `CONFIRMED` gives `'confirmed'`, `TENTATIVE` gives `'tentative'`, `CANCELLED` gives `'cancelled'`, anything else gives `'none'` |
| `transparency` | `comp.get_transparency()` (an `ECal.ComponentTransparency`): `OPAQUE` gives `'opaque'`, `TRANSPARENT` gives `'transparent'`, anything else gives `'unknown'` |
| `organizer` | `org = comp.get_organizer()`: `null`, or `{email: normaliseAddress(ECal.util_get_organizer_email(org)), name: org.get_cn() ?? ''}` |
| `attendees` | `comp.get_attendees().map(a => ({email: normaliseAddress(ECal.util_get_attendee_email(a)), name: a.get_cn() ?? '', partstat, cutype, role}))`, in file order |

Attendee enum mapping. Absent values are already defaulted by ECal (fact 7).
- **`ICalGLib.ParameterPartstat`:**
  - `NEEDSACTION` or `NONE` gives `'needs-action'`;
  - `ACCEPTED` gives `'accepted'`, `DECLINED` gives `'declined'`, `TENTATIVE` gives `'tentative'`, `DELEGATED` gives `'delegated'`;
  - anything else gives `'other'`.
- **`ICalGLib.ParameterCutype`:**
  - `INDIVIDUAL` or `NONE` gives `'individual'`;
  - `GROUP` gives `'group'`, `RESOURCE` gives `'resource'`, `ROOM` gives `'room'`;
  - anything else (`X`, `UNKNOWN`) gives `'unknown'`.
- **`ICalGLib.ParameterRole`:**
  - `CHAIR` gives `'chair'`;
  - `REQPARTICIPANT` or `NONE` gives `'req-participant'`;
  - `OPTPARTICIPANT` gives `'opt-participant'`, `NONPARTICIPANT` gives `'non-participant'`;
  - anything else gives `'other'`.

Write these three mappers and the two above as private functions in `transcribe.js`, each a `switch` with a `default`.

### `extension/helper/calendarReader.js`
```js
export const CONNECT_TIMEOUT_MS = 5000;               // constraints.md
/** Opens the EDS source registry (async). Rejects with the GLib.Error if it cannot. The only way to get a CalendarReader. */
export async function openCalendarReader({onChange})  // -> CalendarReader; onChange(): called on any registry/view/backend change (no arguments)
class CalendarReader {                                // NOT exported
    /** Complete read of every selected calendar source. Never rejects for one source's failure. */
    async read(rangeStart, rangeEnd)                  // -> {sources: SourceInfo[], events: OccurrenceDTO[], skipped: number}
    /** Asks EDS to sync every connected source that supports refresh. */
    async syncRemote()                                // -> {requested: number, failed: number}
}
```
Misuse ruled out: you cannot hold a reader whose registry is not open. The class is private, and the only factory awaits the registry. Nothing needs to be prepared before `read()`, because `read()` connects any source it has not connected yet.

**`openCalendarReader`**
- Wrap `EDataServer.SourceRegistry.new(null, (_o, res) => …EDataServer.SourceRegistry.new_finish(res))` in a Promise.
- Connect `source-added`, `source-removed`, `source-changed`, `source-enabled` and `source-disabled` on the registry, each to `() => onChange()`.

**`read(rangeStart, rangeEnd)`, in this order:**
1. **Local zone.**
   - `id = GLib.TimeZone.new_local().get_identifier()`.
   - If `id` is `'UTC'` or `'Etc/UTC'`, use `ICalGLib.Timezone.get_utc_timezone()`.
   - Otherwise use `ICalGLib.Timezone.get_builtin_timezone(id) ?? ECal.util_get_system_timezone() ?? ICalGLib.Timezone.get_utc_timezone()`.
   - Resolve this on every read, so a zone change is picked up.
2. **Sources.**
   - `registry.list_enabled(EDataServer.SOURCE_EXTENSION_CALENDAR).filter(s => s.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR).get_selected())`.
   - This is how the clock menu lists them.
3. **Retire vanished clients.**
   - For each cached client whose uid is no longer in the list: `view.stop()`, then disconnect every signal handler id stored for it.
   - Move the entry to `this._retired` (an array that is **never** cleared).
   - EDS objects are never released while the process runs, because disposal timing is what crashes gjs (ADR-0001, evidence 3).
4. **Connect.**
   - Connect every listed source that has no cached client, **in parallel**: `Promise.allSettled`.
   - Per source:
     - Create a `Gio.Cancellable`.
     - Start `GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONNECT_TIMEOUT_MS, () => { cancellable.cancel(); return GLib.SOURCE_REMOVE; })`.
     - Call `ECal.Client.connect(source, ECal.ClientSourceType.EVENTS, 0xFFFFFFFF, cancellable, cb)`, and in `cb` call `GLib.source_remove(timerId)` and then `connect_finish`.
   - On error, set the source error:
     - `connect-timeout` if `e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)`;
     - `connect-failed` otherwise.
   - A failure is not cached. The next read tries again.
   - On success, cache `{client, view, handlerIds}`:
     - `[, view] = client.get_view_sync('#t', null)`, then `view.set_flags(ECal.ClientViewFlags.NONE)`.
     - Connect `objects-added`, `objects-modified` and `objects-removed` to `() => onChange()`, then `view.start()`.
     - If `get_view_sync` throws, keep the client with `view = null`. Periodic snapshots still cover that source.
     - Connect the client's `backend-died` to a handler that retires this entry (as in step 3) and calls `onChange()`.
5. **Read each connected source, one after another.**
   1. `client.set_default_timezone(localZone)`.
   2. `[, value] = client.get_backend_property_sync(ECal.BACKEND_PROPERTY_CAL_EMAIL_ADDRESS, null)`, then `ownerEmail = normaliseAddress(value) || null`.
   3. Call `client.generate_instances_sync(Math.floor(rangeStart / 1000), Math.ceil(rangeEnd / 1000), null, cb)`.
      - The callback runs `transcribeInstance(uid, icomp, instanceStart, instanceEnd, localZone)` inside `try`/`catch`.
      - A throw increments `skipped`. Log nothing.
      - Keep the DTO only when `overlapsRange(dto.start, dto.end, rangeStart, rangeEnd)`.
      - Return `true`.
   4. If any call in this step throws: the source entry gets `ok:false, error:'read-failed'`, and that source contributes no events.
6. **One `SourceInfo` per listed source:**
   - `{uid: source.get_uid(), name: source.get_display_name() ?? '', backend: source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR).get_backend_name() ?? '', ownerEmail, ok, error}`.
   - `ownerEmail` is `null` when the source failed.

**`syncRemote()`**
- For every cached client where `client.check_refresh_supported()` is true, call `client.refresh(null, cb)`, and in `cb` call `refresh_finish(res)`. A throw counts as failed.
- Wait for all of them, then return `{requested, failed}`.
- The method does not decide what to report. The service does.

**EDS calls allowed anywhere in `extension/helper/` (the complete list; anything else is out of plan):**
- **Registry:** `SourceRegistry.new`, `new_finish`, `list_enabled`, `connect` (signals).
- **Source:** `get_uid`, `get_display_name`, `get_extension`; on the extension, `get_selected` and `get_backend_name`.
- **Client:** `ECal.Client.connect`, `connect_finish`, `get_backend_property_sync`, `set_default_timezone`, `generate_instances_sync`, `get_view_sync`, `check_refresh_supported`, `refresh`, `refresh_finish`, `connect`, `disconnect` (signals).
- **View:** `set_flags`, `start`, `stop`, `connect`, `disconnect`.
- **Components (reading only):** `ECal.Component.new_from_icalcomponent` and its getters; `ICalGLib.Component.clone`, `get_recurrenceid`, `get_first_property`, `get_next_property`; `ICalGLib.Property.get_property_name`, `get_value_as_string`; `ICalGLib.Time` getters.
- **Utilities:** `ECal.util_get_attendee_email`, `ECal.util_get_organizer_email`, `ECal.util_get_system_timezone`; `ICalGLib.Timezone.get_builtin_timezone`, `get_utc_timezone`.

### `extension/helper/snapshotService.js`
```js
export const RESNAPSHOT_INTERVAL_S = 300;     // constraints.md "periodic re-snapshot every 5 min"
export const REMOTE_SYNC_INTERVAL_S = 600;    // ADR-0001 / constraints.md
export const CHANGE_DEBOUNCE_MS = 2000;       // constraints.md "≤ 3 s (2 s debounce)"
/** Reads once and builds the snapshot message. nowMs is passed in; this function never reads the clock. */
export async function takeSnapshot(reader, nowMs)     // -> {message, skipped}
export class SnapshotService {
    constructor({reader, stdout})             // reader from openCalendarReader; stdout: Stdout
    start()                                   // snapshot now, then remote sync; installs the two periodic timers
    requestChangeSnapshot()                   // what main.js passes to openCalendarReader's onChange (via a closure)
    handleLine(line)                          // one stdin line
}
```
`takeSnapshot`:
- `{rangeStart, rangeEnd} = snapshotRange(nowMs)`;
- `{sources, events, skipped} = await reader.read(rangeStart, rangeEnd)`;
- `message = snapshotMessage({generatedAt: nowMs, rangeStart, rangeEnd, sources, events})`.

`SnapshotService` behaviour:

- **`_snapshotNow()`** (one read at a time):
  - If a read is in flight, set `this._again = true` and return.
  - Otherwise mark in flight and run `takeSnapshot(this._reader, Date.now())` (the clock is read here, at the edge). Then `stdout.send(message)`.
  - If `skipped > 0`, send `statusMessage('warn', EVENT_SKIPPED)`.
  - Catch errors:
    - A `TypeError` from `send` means `statusMessage('error', SNAPSHOT_INVALID)` plus `reportDiagnostic('snapshot-invalid', e.message)`. Core's message holds a code and a field path only.
    - Anything else means `statusMessage('error', SNAPSHOT_FAILED)` plus `reportDiagnostic('snapshot-failed')`.
  - `finally`: clear the in-flight mark. If `_again` is set, clear it and call `_snapshotNow()` again.
- **`requestChangeSnapshot()`:**
  - If a debounce timer is pending, do nothing. The timer is not extended, so latency stays at 2 s or less.
  - Otherwise `this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHANGE_DEBOUNCE_MS, () => { this._debounceId = 0; this._snapshotNow(); return GLib.SOURCE_REMOVE; })`.
- **`_syncRemoteNow()`:**
  - If a sync is in flight, return.
  - Otherwise `{requested, failed} = await reader.syncRemote()`.
  - If `failed > 0`, send `statusMessage('warn', SYNC_FAILED)`.
  - If `requested > 0`, call `requestChangeSnapshot()`, so that fetched data shows up even if a view misses it.
  - Catch any error the same way as `sync-failed`.
- **`start()`:**
  - Call `_snapshotNow()` and `_syncRemoteNow()`.
  - Add `GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RESNAPSHOT_INTERVAL_S, () => { this._snapshotNow(); return GLib.SOURCE_CONTINUE; })`.
  - Add the same with `REMOTE_SYNC_INTERVAL_S` and `_syncRemoteNow()`.
  - These timers are never removed. The process ends with them.
- **`handleLine(line)`:**
  - `r = parseShellLine(line)` (core).
  - If `!r.ok`, send `statusMessage('warn', BAD_COMMAND)`.
  - Otherwise: if a debounce timer is pending, `GLib.source_remove` it and clear the id; then call `_snapshotNow()` and `_syncRemoteNow()`. `resume` and `manual` are handled the same way.

### `extension/helper/main.js` (entry; the file name `main.js` is the contract with PG-1c's `HELPER_ENTRY`)

- `System.programArgs` decides the mode:
  - `[]` is serve mode;
  - `['--once']` is once mode;
  - `['--summary']` is summary mode;
  - anything else: call `reportDiagnostic('usage')`, then `exitSoon(2)`.
- One module-private function ends the process:
  ```js
  function exitSoon(code) { GLib.idle_add(GLib.PRIORITY_HIGH, () => { System.exit(code); return GLib.SOURCE_REMOVE; }); }
  ```
  - This is the only `System.exit` in the repository's `extension/` tree, and the only import of `system`.
  - **It is called from everywhere, including promise continuations.** Fact 1 is why it defers.
  - No other module receives an exit function.
- Module body:
  1. `const loop = new GLib.MainLoop(null, false);`
  2. `GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { run(mode).catch(fatal); return GLib.SOURCE_REMOVE; });`
  3. `loop.run();`
- **`run('serve')`:** in this exact order.
  1. `stdout = new Stdout()`, then `stdout.send(helloMessage())`.
  2. `let service = null`.
  3. `watchStdin({onLine: l => service?.handleLine(l), onEof: () => exitSoon(0)})`.
     - This comes before the registry opens, so EOF during startup still exits.
     - Lines that arrive before the service exists are dropped; the first snapshot follows at once anyway.
  4. `reader = await openCalendarReader({onChange: () => service?.requestChangeSnapshot()})`. If this rejects, send `statusMessage('error', REGISTRY_FAILED)`, call `reportDiagnostic('registry-failed')`, then `exitSoon(1)`, and return.
  5. `service = new SnapshotService({reader, stdout})` and `service.start()`.
- **`run('once')`:**
  1. Send `hello`.
  2. Open the reader. On failure, handle it as in serve mode.
  3. `{message, skipped} = await takeSnapshot(reader, Date.now())`, then send it. If `skipped > 0`, also send the `event-skipped` status.
  4. `exitSoon(0)`.
- **`run('summary')`:**
  - Same as once mode, but without `hello`. Call `stdout.writeText(formatSummary(message))`, then `exitSoon(0)`.
  - If the registry fails, call `stdout.writeText('error registry-failed\n')` and `exitSoon(1)`.
- **`fatal(e)`:**
  - `reportDiagnostic('helper-failed')`.
  - In serve or once mode, try `stdout.send(statusMessage('error', HELPER_FAILED))`, ignoring any throw.
  - `exitSoon(1)`.
  - Never print `e.message`, because a GLib error can carry a calendar name.
- SIGTERM keeps the default action, so there is no handler. SIGPIPE (the shell died) keeps the default action too. Neither one runs the GC, so neither can dump core.

## Test harness and fixture (test code, never packed)

### `tests/helper/isolatedEds.js` (Node)
```js
export const HOUR_MS = 3_600_000;
export const HELPER_MAIN;                          // absolute path of extension/helper/main.js (from import.meta.dirname)
export function nextWholeHour(nowMs)               // Math.ceil(nowMs / HOUR_MS) * HOUR_MS
export function fixtureIcs(baseMs)                 // -> the calendar.ics text below, CRLF line ends
export function tokyoDate(ms)                      // 'YYYYMMDD' of the Asia/Tokyo wall date = UTC date of ms + 9 h
export async function createIsolatedEds(name, baseMs)   // -> {home, env, stop}
export function runHelper(env, args)               // -> Promise<{code, signal, stdout, stderr}>; kills with SIGKILL and rejects after 30 s
export function startHelper(env)                   // -> HelperProcess (serve mode)
export function addFixtureEvent(env, veventText)   // -> Promise<void>; runs `gjs -m tests/helper/gjs/addEvent.js <veventText>`, rejects on non-zero exit
```

**`createIsolatedEds(name, baseMs)`:**
1. `home = <repo>/.test-home/helper-<name>`. Run `fs.rmSync(home, {recursive:true, force:true})` **first** (clean at start, not at the end, so there is no race with EDS still writing), then create `config/evolution/sources`, `data/evolution/calendar/fixture-cal` and `cache`.
2. Write the three `.source` files and `calendar.ics` below.
3. **Build `env` from scratch. Never spread `process.env`.** That would carry the real `DBUS_SESSION_BUS_ADDRESS` and read the owner's calendars. The keys are:
   - `PATH: process.env.PATH`, `HOME: process.env.HOME`, `LANG: 'C.UTF-8'`;
   - `XDG_CONFIG_HOME: home/config`, `XDG_DATA_HOME: home/data`, `XDG_CACHE_HOME: home/cache`;
   - `GSETTINGS_BACKEND: 'memory'`, `GIO_USE_VFS: 'local'`, `TZ: 'Asia/Tokyo'`.
4. Spawn `dbus-daemon --session --nofork --print-address=1` with that env. Read the first stdout line as the address and set `env.DBUS_SESSION_BUS_ADDRESS`.
   - A private bus (instead of `dbus-run-session` from `testing-and-build.md`) lets the helper and the test writer share one isolated EDS.
5. `stop()`: SIGTERM the daemon and await its exit. The EDS services on that bus exit when it goes.

**`HelperProcess`:**
- `nextMessage(timeoutMs)`: the next stdout line as `{line, parsed}`. `parsed` is `parseHelperLine(line)` from core, **asserted `ok`**, so every line is proven to validate. It rejects on timeout.
- `send(text)`: writes `text` to stdin.
- `closeStdin()`.
- `exited(timeoutMs)`: resolves to `{code, signal}`, and rejects on timeout.
- `stderr()`: all stderr so far.

Read stdout with `node:readline` over `child.stdout`, and queue the lines.

**The `.source` files** go in `home/config/evolution/sources/`:
```
fixture-cal.source
[Data Source]
DisplayName=Fixture
Enabled=true
Parent=local-stub

[Calendar]
BackendName=local
Selected=true

[Local Backend]
EmailAddress=Owner@Fixture.test

broken-cal.source    (same, but DisplayName=Broken, BackendName=no-such-backend, no [Local Backend] group)
hidden-cal.source    (same as fixture-cal, but DisplayName=Hidden, Selected=false, no [Local Backend] group)
```

**`fixtureIcs(H)`** uses these helpers:
- `u(ms)` is the UTC basic format `YYYYMMDDTHHMMSSZ`.
- `t(ms)` is the Tokyo wall time: `u(ms + 9 h)` without the `Z`.
- `D = tokyoDate(H + 24 h)`, and `D1` is the day after `D`.

Every VEVENT also carries `DTSTAMP:20260101T000000Z`. The file is `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//payAttention//fixture//EN`, the events in this order, then `END:VCALENDAR`.

| # | Lines (after `BEGIN:VEVENT`, before `END:VEVENT`) | Covers |
|---|---|---|
| 1 | `UID:tz-convert@fixture.test` · `DTSTART;TZID=Asia/Tokyo:{t(H+1h)}` · `DTEND;TZID=Asia/Tokyo:{t(H+2h)}` · `SUMMARY:Tokyo sync` · `STATUS:CONFIRMED` · `TRANSP:OPAQUE` · `ORGANIZER;CN=Alice Organiser:mailto:Alice@External.test` · `ATTENDEE;CN=Owner;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:owner@fixture.test` · `ATTENDEE;CN=Bob;PARTSTAT=TENTATIVE;ROLE=OPT-PARTICIPANT:MAILTO:Bob@External.test` · `ATTENDEE;CN=Board Room 4;CUTYPE=ROOM;PARTSTAT=ACCEPTED;ROLE=NON-PARTICIPANT:mailto:room4@rooms.fixture.test` · `ATTENDEE;CN=Projector;CUTYPE=RESOURCE;PARTSTAT=NEEDS-ACTION:mailto:projector@rooms.fixture.test` · `ATTENDEE;CN=Team;CUTYPE=GROUP;PARTSTAT=DECLINED;ROLE=CHAIR:mailto:team@fixture.test` · `ATTENDEE;CUTYPE=X-BOT;PARTSTAT=DELEGATED;ROLE=X-OBSERVER:mailto:bot@fixture.test` · `ATTENDEE;PARTSTAT=X-MAYBE:mailto:carol@external.test` · `ATTENDEE;CN=Erin;EMAIL=Erin@External.test:urn:uuid:erin-1` · `X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij` | TZID conversion, organiser, every PARTSTAT/CUTYPE/ROLE incl. ROOM, defaults, X values, `EMAIL=`, uppercase `MAILTO:`, Google link |
| 2 | `UID:zoom-description@fixture.test` · `DTSTART:{u(H+2h)}` · `DTEND:{u(H+3h)}` · `SUMMARY:Zoom in description` · `STATUS:TENTATIVE` · `TRANSP:TRANSPARENT` · `DESCRIPTION:Join: https://zoom.us/j/123456789\nPasscode 42` (a literal backslash-n in the file) | Zoom link only in description, tentative, transparent |
| 3 | `UID:conference-and-url@fixture.test` · `DTSTART:{u(H+4h)}` · `DTEND:{u(H+5h)}` · `SUMMARY:Teams via CONFERENCE` · `CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=Join:https://teams.microsoft.com/l/meetup-join/abc` · `URL:https://example.test/agenda` | RFC 7986 CONFERENCE and URL |
| 4 | `UID:location-only@fixture.test` · `DTSTART:{u(H+5h)}` · `DTEND:{u(H+6h)}` · `SUMMARY:Coffee at the office` · `LOCATION:12 Rue de Rivoli\, Paris` | Location only, escaped comma, absent status/transp |
| 5 | `UID:all-day@fixture.test` · `DTSTART;VALUE=DATE:{D}` · `DTEND;VALUE=DATE:{D1}` · `SUMMARY:Holiday` · `TRANSP:TRANSPARENT` | All-day, in the local (Tokyo) zone |
| 6 | `UID:cancelled@fixture.test` · `DTSTART:{u(H+6h)}` · `DTEND:{u(H+7h)}` · `SUMMARY:Cancelled call` · `STATUS:CANCELLED` · `ORGANIZER:mailto:dave@external.test` · `ATTENDEE;PARTSTAT=ACCEPTED:mailto:owner@fixture.test` | Cancelled event, organiser without CN |
| 7 | `UID:series@fixture.test` · `DTSTART:{u(H+3h)}` · `DTEND:{u(H+3h+30min)}` · `SUMMARY:Standup` · `RRULE:FREQ=HOURLY;INTERVAL=6;COUNT=4` · `EXDATE:{u(H+21h)}` | Series master: instances at H+3, H+9, H+15; H+21 excluded |
| 8 | `UID:series@fixture.test` · `RECURRENCE-ID:{u(H+9h)}` · `DTSTART:{u(H+10h)}` · `DTEND:{u(H+10h+30min)}` · `SUMMARY:Standup (moved)` · `SEQUENCE:1` | Moved instance |
| 9 | `UID:series@fixture.test` · `RECURRENCE-ID:{u(H+15h)}` · `DTSTART:{u(H+15h)}` · `DTEND:{u(H+15h+30min)}` · `SUMMARY:Standup` · `STATUS:CANCELLED` · `SEQUENCE:1` | Cancelled instance of a series |
| 10 | `UID:long-description@fixture.test` · `DTSTART:{u(H+7h)}` · `DTEND:{u(H+8h)}` · `SUMMARY:Long` · `DESCRIPTION:{'x' × 32767}😀yyyy` (U+1F600) | Truncation at a surrogate pair |
| 11 | `UID:too-late@fixture.test` · `DTSTART:{u(H+48h)}` · `DTEND:{u(H+49h)}` · `SUMMARY:Out of range` | After the range |
| 12 | `UID:too-early@fixture.test` · `DTSTART:{u(H-5h)}` · `DTEND:{u(H-3h)}` · `SUMMARY:Out of range` | Before the range |

- Lines are not folded. libical accepts long lines (measured with the 32 KB description).
- `H = nextWholeHour(Date.now())` is taken once per `describe` block.
- Why every expectation is stable however long the run takes (up to 1 h): the helper's `generatedAt` is at least the test's clock and less than H + 1 h, and every in-range event lies inside `[generatedAt − 1 h, generatedAt + 36 h)`.

**`tests/helper/gjs/addEvent.js`** (gjs, test-only; it writes to the **fixture** calendar only):
1. Inside `GLib.idle_add` on a running `GLib.MainLoop`, read the VEVENT text from `System.programArgs[0]`.
2. `EDataServer.SourceRegistry.new_sync(null).ref_source('fixture-cal')`.
3. `ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 0xFFFFFFFF, null)`.
4. `client.create_object_sync(ICalGLib.Component.new_from_string(text), ECal.OperationFlags.NONE, null)`.
5. `GLib.idle_add(GLib.PRIORITY_HIGH, () => System.exit(0))`. On any throw, do the same with 1.

### Expected snapshot for the fixture (`--once`, `TZ=Asia/Tokyo`)

- **Lines:** exactly 2. The first is `{"type":"hello","protocol":1}`; the second is a `snapshot`. Both pass `parseHelperLine`. The exit is `code 0, signal null`.
- **Range:** `rangeStart === generatedAt − 3_600_000` and `rangeEnd === generatedAt + 129_600_000`.
- **`sources`, in this order, deep-equal:**
  - `{uid:'birthdays', name:<any string>, backend:'contacts', ownerEmail:null, ok:true, error:null}`. Assert the fields except `name`.
  - `{uid:'broken-cal', name:'Broken', backend:'no-such-backend', ownerEmail:null, ok:false, error:'connect-failed'}`.
  - `{uid:'fixture-cal', name:'Fixture', backend:'local', ownerEmail:'owner@fixture.test', ok:true, error:null}`.
  - `{uid:'system-calendar', name:<any string>, backend:'local', ownerEmail:null, ok:true, error:null}`.
  - No `hidden-cal`.
  - **This list is also the isolation proof:** any other source means the test reached a real bus.
- **Events:** exactly 10, all with `sourceUid:'fixture-cal'`, sorted by `start` (non-decreasing). The multiset of `uid:recurrenceId` pairs:

| uid | recurrenceId | recurring | start | end | allDay | status | transparency |
|---|---|---|---|---|---|---|---|
| tz-convert@fixture.test | null | false | H+1h | H+2h | false | confirmed | opaque |
| zoom-description@fixture.test | null | false | H+2h | H+3h | false | tentative | transparent |
| series@fixture.test | H+3h | true | H+3h | H+3h30 | false | none | unknown |
| conference-and-url@fixture.test | null | false | H+4h | H+5h | false | none | unknown |
| location-only@fixture.test | null | false | H+5h | H+6h | false | none | unknown |
| cancelled@fixture.test | null | false | H+6h | H+7h | false | cancelled | unknown |
| long-description@fixture.test | null | false | H+7h | H+8h | false | none | unknown |
| series@fixture.test | H+9h | true | H+10h | H+10h30 | false | none | unknown |
| series@fixture.test | H+15h | true | H+15h | H+15h30 | false | cancelled | unknown |
| all-day@fixture.test | null | false | A | A+24h | true | none | transparent |

- `A = Date.UTC(D.y, D.m − 1, D.d) − 9 h`, which is Tokyo midnight.
- There is no `too-late`, no `too-early`, and no series instance with `recurrenceId` H+21h.

**Field details:**
- **`tz-convert`:**
  - `summary 'Tokyo sync'`, `location ''`, `description ''`.
  - `conferenceUris ['https://meet.google.com/abc-defg-hij']`.
  - `organizer {email:'alice@external.test', name:'Alice Organiser'}`.
  - `attendees`, deep-equal and in order:
    ```
    {email:'owner@fixture.test', name:'Owner', partstat:'accepted', cutype:'individual', role:'req-participant'}
    {email:'bob@external.test', name:'Bob', partstat:'tentative', cutype:'individual', role:'opt-participant'}
    {email:'room4@rooms.fixture.test', name:'Board Room 4', partstat:'accepted', cutype:'room', role:'non-participant'}
    {email:'projector@rooms.fixture.test', name:'Projector', partstat:'needs-action', cutype:'resource', role:'req-participant'}
    {email:'team@fixture.test', name:'Team', partstat:'declined', cutype:'group', role:'chair'}
    {email:'bot@fixture.test', name:'', partstat:'delegated', cutype:'unknown', role:'other'}
    {email:'carol@external.test', name:'', partstat:'other', cutype:'individual', role:'req-participant'}
    {email:'erin@external.test', name:'Erin', partstat:'needs-action', cutype:'individual', role:'req-participant'}
    ```
- **`zoom-description`:** `description 'Join: https://zoom.us/j/123456789\nPasscode 42'` (a real newline), `conferenceUris []`, `organizer null`, `attendees []`.
- **`conference-and-url`:** `conferenceUris ['https://teams.microsoft.com/l/meetup-join/abc', 'https://example.test/agenda']`.
- **`location-only`:** `location '12 Rue de Rivoli, Paris'`, `description ''`, `conferenceUris []`, `organizer null`, `attendees []`.
- **`cancelled`:** `organizer {email:'dave@external.test', name:''}`, `attendees [{email:'owner@fixture.test', name:'', partstat:'accepted', cutype:'individual', role:'req-participant'}]`.
- **`series`:** summaries `'Standup'`, `'Standup (moved)'`, `'Standup'`.
- **`long-description`:** `description === 'x'.repeat(32767)`, length 32767.

### Expected `--summary` for the fixture
```
payattention-helper summary (counts only)
protocol 1
sources 4 ok 3 failed 1 with-owner-address 1
source-errors connect-failed 1
occurrences 10 recurring 3 all-day 1 cancelled 2 tentative 1 with-attendees 2 with-organizer 2 with-conference-uri 2 with-location 1 with-description 2 transparent 2
next-24h <9 or 10>
attendees 9 individual 5 group 1 resource 1 room 1 unknown 1
```
- The test compares lines 1–5 and 7 exactly.
- Line 6 must match `/^next-24h (9|10)$/`. Whether the all-day event starts before `generatedAt + 24 h` depends on the time of day.

## Steps

All steps are **feature** steps; nothing exists to repair. For each step:
1. write the test;
2. run it and see it fail for the stated reason;
3. implement;
4. run `npm run lint`, `npm test` and `npm run test:helper` (green);
5. commit.

One commit per step. Follow PG-1a's conventions in every file:
- named exports only, camelCase file names;
- 4-space indentation, single quotes, semicolons;
- JSDoc on each export;
- tests use `import {test, describe} from 'node:test'` and `import assert from 'node:assert/strict'`, with test names that state the behaviour.

### Step 0 — Preconditions (no code)
- PG-1a is merged:
  - `npm run lint` and `npm test` pass;
  - `extension/core/protocol.js` exports `PROTOCOL_VERSION`, `MAX_DESCRIPTION_LENGTH`, `formatHelperMessage`, `parseHelperLine` and `parseShellLine` with the signatures in `docs/plans/PG-1a.md`;
  - `.gitignore` contains `.test-home/`;
  - `package.json` has the failing `test:helper` placeholder.
- If any of these is missing, stop (see below).

### Step 1 — Test tooling and the helper's import allowlist  [feature]
- **Test first:** add these rows to PG-1a's `tests/unit/boundaries.test.js` table.
  - `extension/helper/probe.js` · `import GioUnix from 'gi://GioUnix'; export {GioUnix};` · ok.
  - `extension/helper/probe.js` · `import System from 'system'; export {System};` · ok.
  - `tests/helper/probe.test.js` · `export const e = process.env;` · ok (Node globals).
  - `tests/helper/gjs/probe.js` · `print(1);` · ok (gjs globals).
  - Run `npm test`. The first row fails: `no-restricted-imports`, because GioUnix is not on the allowlist. The third fails with `no-undef`.
- **Then:**
  - In `eslint.config.js`:
    1. In the helper block, change the allowlist regex to `^gi://(?!(ECal|EDataServer|ICalGLib|Gio|GioUnix|GLib)(\?|$))` and the message to "helper may use only ECal, EDataServer, ICalGLib, Gio, GioUnix, GLib".
    2. Add `'tests/helper/gjs/**/*.js'` to the gjs block's `files`.
    3. Add `'tests/helper/**/*.js'` to the Node block's `files`, and `'tests/helper/gjs/**'` to its `ignores`.
  - In `package.json`, set `"test:helper": "node --test \"tests/helper/**/*.test.js\""`.
  - Create `tests/helper/range.test.js` with one trivial passing test for now (it is filled in at Step 2). That way `npm run test:helper` runs.
- **Why here:**
  - GioUnix is GLib's own home for the Unix stream classes that were in Gio before GLib 2.80 (fact 13). This is recorded for the architect in `docs/inbox.md`.
  - `system` is gjs's built-in module and not a `gi://` import, so no rule is needed. The test pins that down.
- **Behaviour change:** `npm run test:helper` exists and runs.

### Step 2 — `range.js` and `text.js`  [feature]
- **Test first:** `tests/helper/range.test.js` and `tests/helper/text.test.js`. They fail with "module not found".
  - `snapshotRange(T)` is `{rangeStart: T − 3_600_000, rangeEnd: T + 129_600_000}`.
  - `overlapsRange(10, 20, 20, 30)` is false; `(19, 21, 20, 30)` is true; `(30, 40, 20, 30)` is false; `(29, 31, 20, 30)` is true.
  - For zero-length occurrences: `(20, 20, 20, 30)` is true; `(30, 30, 20, 30)` is false; `(19, 19, 20, 30)` is false.
  - `normaliseAddress(' MAILTO:Bob@X.Test ')` is `'bob@x.test'`. `normaliseAddress(null)` is `''`. `normaliseAddress('urn:uuid:ABC')` is `'urn:uuid:abc'`.
  - `truncateDescription('a')` is `'a'`. `truncateDescription(null)` is `''`. `'x'.repeat(32768)` comes back unchanged. `'x'.repeat(32769)` gives length 32768.
  - `'x'.repeat(32767) + '😀' + 'y'` gives `'x'.repeat(32767)`. `'x'.repeat(32766) + '😀' + 'y'` gives length 32768 and ends with `'😀'`.
- **Then:** `extension/helper/range.js` and `extension/helper/text.js`, as in Seams.
- **Why here:** pure rules of the transcription, kept out of the GI code so that they are testable.
- **Behaviour change:** new.

### Step 3 — `messages.js` and `summary.js`  [feature]
- **Test first:** `tests/helper/messages.test.js` and `tests/helper/summary.test.js`. Every built message must pass core's `validateHelperMessage` (`ok: true`).
  - `helloMessage()` deep-equals `{type:'hello', protocol:1}`.
  - **`snapshotMessage` ordering.** Build DTOs inline with a local `dto(over)` helper whose defaults are a valid OccurrenceDTO.
    - The sources `[{uid:'b'…},{uid:'a'…}]` come out as `a, b`.
    - Events with (start, sourceUid, uid, recurrenceId) of `(2,'s','u',null)`, `(1,'t','u',null)`, `(1,'s','v',null)`, `(1,'s','u',5)` and `(1,'s','u',null)` come out as `(1,s,u,null)`, `(1,s,u,5)`, `(1,s,v,null)`, `(1,t,u,null)`, `(2,s,u,null)`.
    - The input arrays are unchanged: deep-frozen inputs do not throw.
  - `statusMessage('warn','bad-command')` works. `statusMessage('info','bad-command')` and `statusMessage('warn','Tokyo sync')` throw `TypeError`.
  - **`formatSummary` on a synthetic 2-source, 3-event snapshot** gives the exact 7-line text:
    - Sources: one `ok` with an owner address, one `ok:false` with `connect-timeout`.
    - Events:
      - a recurring meeting with 1 room and 2 individuals;
      - an all-day transparent event;
      - a cancelled event with a description and a location.
    - Pass `generatedAt` so that exactly 2 events fall in `next-24h`.
    - Assert also that the output contains none of the synthetic titles, addresses, places or the source name.
- **Then:** `extension/helper/messages.js` and `extension/helper/summary.js`.
- **Why here:** one place builds protocol objects, and one place decides what a counts-only report may say.
- **Behaviour change:** new.

### Step 4 — Isolated EDS harness, then `--once` with correct sources  [feature]
- **Test first:**
  - Write `tests/helper/isolatedEds.js` as specified. It is support, not a test.
  - Write `tests/helper/helper.test.js` with `describe('helper against the fixture calendar', …)`:
    - A `before` hook takes `H`, then `createIsolatedEds('read', H)`, then `runHelper(env, ['--once'])` once. The result is shared.
    - An `after` hook calls `stop()`.
  - First tests:
    - exit `code 0, signal null`;
    - exactly 2 stdout lines, both `parseHelperLine(...).ok`, the first being hello;
    - `rangeStart`/`rangeEnd` as expected;
    - `sources` exactly as in "Expected snapshot" (this includes the isolation proof).
  - It fails because `extension/helper/main.js` does not exist.
- **Then:**
  - `stdio.js`: `Stdout` and `reportDiagnostic` (`watchStdin` waits until Step 9).
  - `calendarReader.js`: `openCalendarReader`, and `read()` steps 1–4 and 6, plus the owner-email part of step 5. **Do not call `generate_instances_sync` yet**, so `events` is `[]`.
  - `snapshotService.js`: `takeSnapshot` only.
  - `main.js`: `once` mode and `exitSoon`.
- **Why here:** everything after this depends on a real, isolated, validated read.
- **Behaviour change:** new. `gjs -m extension/helper/main.js --once` prints hello and a snapshot with correct sources and no events.

### Step 5 — Instances: times, zones, recurrence and range  [feature]
- **Test first:** in the same `describe`, add these tests. They fail because `events` is `[]`.
  - the event multiset, with `uid`, `recurrenceId`, `recurring`, `start`, `end` and `allDay` exactly as in the table;
  - `too-late`, `too-early` and the H+21h instance absent;
  - events sorted by start;
  - every event has `sourceUid 'fixture-cal'`.
- **Then:**
  - The `generate_instances_sync` part of `read()` step 5, with the overlap filter.
  - `transcribe.js` with `toEpochMs` exactly as specified, and the fields `sourceUid`, `uid`, `recurrenceId`, `recurring`, `start`, `end` and `allDay`.
  - Every other DTO field gets a protocol-valid placeholder for now: `summary/location/description ''`, `conferenceUris []`, `status 'none'`, `transparency 'unknown'`, `organizer null`, `attendees []`. Steps 6 and 7 replace them test-first.
  - Do not use `as_timet()` anywhere (fact 6).
- **Why here:** transcription of time is the helper's first job. Every alert depends on it.
- **Behaviour change:** occurrences appear, with correct UTC times for TZID, UTC, date and floating values.

### Step 6 — People, status and free/busy  [feature]
- **Test first:** `organizer` and `attendees` for `tz-convert` and `cancelled` exactly as listed; `status` and `transparency` for every event as in the table.
- **Then:** the organiser, attendee and enum mapping in `transcribe.js`.
- **Why here:** these are the raw facts the verdict rules (PRD §1, D-009, D-011) read. The room must arrive as `cutype:'room'`.
- **Behaviour change:** new fields filled.

### Step 7 — Text fields and links  [feature]
- **Test first:** `summary`, `location` and `description` for every event as listed (including the escaped comma, the real newline and the 32767-character truncation). `conferenceUris` for `tz-convert`, `zoom-description` and `conference-and-url` as listed.
- **Then:** those fields in `transcribe.js`, using name-based property matching. Never call `isa()`.
- **Why here:** PRD §2 (online vs in person) reads these. The helper only copies them; core detects the links.
- **Behaviour change:** new fields filled.

### Step 8 — `--summary` and privacy of output  [feature]
- **Test first:** in the same `describe`, add `runHelper(env, ['--summary'])`:
  - exit 0;
  - stdout lines as in "Expected `--summary`";
  - stdout **and** stderr of this run and of the `--once` run contain none of these strings: `Tokyo sync`, `Alice`, `owner@fixture.test`, `Rivoli`, `zoom.us`, `meet.google.com`, `Standup`, `Holiday`, `Erin`.
  - `Fixture` is not checked in `--once` stdout, because the source name is protocol data. It **is** checked in the summary and in stderr.
- **Then:** `main.js` `summary` mode.
- **Why here:** the Done-when real run is reported with `--summary`, so it must be proven to carry counts only.
- **Behaviour change:** `--summary` works.

### Step 9 — Serve mode: hello, snapshot, refresh, bad input, clean exit on EOF  [feature]
- **Test first:** in the same `describe` (same EDS), add two tests.
  1. `startHelper(env)`:
     - `nextMessage(15000)` is hello;
     - the next message is a snapshot whose event count is 10;
     - `send('{"type":"refresh","reason":"manual"}\n')`, then the next message within 5000 ms is a snapshot with `generatedAt >=` the first one's;
     - `send('garbage\n')`, then the next message is `{type:'status', level:'warn', code:'bad-command'}`;
     - `closeStdin()`, then `exited(10000)` deep-equals `{code:0, signal:null}`;
     - stderr contains no fixture strings.
     - The local sources support no refresh, so no `sync-failed` appears. If one does, the test fails.
  2. **Exit during startup:** `startHelper(env)`, wait for hello, `closeStdin()` at once, then `exited(10000)` is `{code:0, signal:null}`.
  - These fail because serve mode does not exist.
- **Then:** `watchStdin`; `SnapshotService` complete (timers, debounce, one read at a time, remote sync, `handleLine`); `main.js` serve mode.
- **Why here:** this is the interface to the calendar feed (PG-1c). It covers the Done-when items "exits cleanly when its input closes" and "resyncs after resume": the shell's resume refresh takes the same path as `manual`.
- **Behaviour change:** new.

### Step 10 — Calendar changes produce a new snapshot  [feature]
- **Test first:** a second `describe('helper follows calendar changes', …)` with its **own** `createIsolatedEds('live', H)`, so the read-only block stays exact.
  - `startHelper`, then read hello and the first snapshot.
  - `addFixtureEvent(env, 'BEGIN:VEVENT\r\nUID:added@fixture.test\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:{u(H+12h)}\r\nDTEND:{u(H+13h)}\r\nSUMMARY:Added\r\nEND:VEVENT\r\n')`.
  - Within 6000 ms, a snapshot arrives whose events include `added@fixture.test` with `start === H+12h`.
  - `closeStdin()`, then exit 0 with no signal.
  - Write `tests/helper/gjs/addEvent.js` here.
  - This fails if the views or the debounce are not wired.
- **Then:** fix whatever the test shows. The design in Seams already includes views and debounce.
- **Why here:** ADR-0001 "watches for changes with client views and the source registry"; constraints.md "≤ 3 s".
- **Behaviour change:** none beyond Step 9, if it was built to the Seams.

### Step 11 — Real calendars, read-only, counts only (manual; report in the hand-off)
- `gjs -m extension/helper/main.js --summary`, then paste the output. The summary includes `next-24h`, which is the Done-when figure. Expect about 9 sources, 7 with an owner address, `failed 0`, and an exit of 0.
- Run it 3 times. It must never hang and never exit 139 (`echo $?`).
- **Periodic check (serve mode, 11 minutes):**
  ```
  sleep 660 | gjs -m extension/helper/main.js | node -e "require('readline').createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);console.log(new Date().toISOString(),m.type,m.code??'',m.events?.length??'')})"
  ```
  - Expect hello, then a snapshot at 0 s, roughly every 300 s, and 2 s after each remote sync (at 0 s and 600 s).
  - The process must exit 0 when `sleep` ends (stdin EOF).
  - This prints types and counts only.
- Never paste `--once` output from the real calendars anywhere.

### Validation (run in order and report the real output)
```
npm run lint
npm test
npm run test:helper
gjs -m extension/helper/main.js --summary ; echo "exit=$?"
```
- `npm run build` and `npm run smoke` belong to PG-1c. If they already exist, they must still pass.

## Callers to update

- **`extension/core/protocol.js`** (PG-1a) is consumed, not changed.
- **`HELPER_ENTRY` in PG-1c's composition (`extension.js`):** the value is `'main.js'`. PG-1c's plan already leaves it as "PG-1b's entry file name". The PG-1c engineer sets it. This plan does not edit PG-1c files.
- **`eslint.config.js` and `tests/unit/boundaries.test.js`** (PG-1a's files) change in Step 1, as listed. No other rule changes.
- **`package.json`:** only the `test:helper` script.
- **Nothing outside this repository** calls the helper.

## Out of scope

- Anything in `extension/core/`, `extension/shell/`, `extension/ui/` or `extension.js`. Also the build and smoke scripts.
- Deciding anything about meaning: owner detection, guests, links, merging duplicates across calendars. Duplicates are transcribed once per calendar, as they are.
- Extra owner addresses (mail identities, aliases). The protocol carries `cal-email-address` per source only. This is raised in `docs/inbox.md`.
- Watching logind for resume inside the helper. The shell sends `refresh` on resume (`interfaces.md`).
- Any EDS call not in the allowed list, and any write, even to "fix" data.
- Logging exceptions, source names or counts to stderr beyond the listed codes.
- Editing architecture docs, `BACKLOG.md` or product docs.

## Stop and escalate if

- `extension/core/protocol.js` is missing, or its exports differ from Step 0.
- `formatHelperMessage` rejects a DTO shape that this plan prescribes (for example, it disagrees on an enum value or a null). Do not change core, and do not bend the DTO. Report the field path.
- Any run exits with 139 or hangs at exit. Do **not** add `loop.quit()`, `imports.system.gc()` or dispose calls. Report which exit path and how often.
- `System.exit` would be needed anywhere except `exitSoon` in `main.js`.
- The fixture expectations disagree with EDS behaviour (a different default, a missing RECURRENCE-ID, a different order of attendees). Report the actual value; do not adjust the expectation to match without asking.
- The isolated run lists any source other than `birthdays`, `broken-cal`, `fixture-cal` and `system-calendar`. The environment may have leaked to the real bus. Stop at once and delete nothing.
- The real `--summary` shows `failed` above 0 or 0 occurrences while the clock menu shows meetings. Report the counts only.
- Lint rejects `gi://GioUnix` after Step 1, or the architect overrules it (`docs/inbox.md`). Wait for the decision; do not switch to deprecated `Gio.Unix*` streams on your own.
