# ADR-0014 — A meeting's travel time has one target, named by core: its place, or its series key in a separate settings key
- **Date:** 2026-10-02
- **Kind:** one-way door for the stored format (a new GSettings key,
  `meeting-travel-times`, keyed by `series:<uid>`). Reversible in code.

## Context

PG-14 (D-038, D-039, refining R-10 and R-11). A place now means in person,
and every in-person meeting can get a travel time, with or without a place.
With a place, the time is remembered for the place, as before (`travel-times`,
place key → minutes). With no place, product asks that it be remembered "for
the whole series, or for that one meeting when it does not repeat".

Before PG-14, the travel time was keyed only by place, and `app/view.js`
offered no choices when the place key was null, because there was nowhere to
store a value. The `setTravel` action carried a `placeKey` built from the
judged meeting.

Forces:

- The value the owner sees and the value a pick overwrites must be the same
  entry, or a pick can appear to do nothing.
- A one-off meeting's occurrence key (`occ:<uid>|<start>`) changes when the
  meeting is moved (`data.md`). For travel that is not the safe direction: a
  60-minute travel time silently becoming the 30-minute default makes the
  leave-by time later than the owner needs.
- Place keys are free text. Any key family that shares a map with them can
  collide with a location that happens to read like one of its keys.
- ADR-0003: all durable state in GSettings, keyed by UID; key formats are the
  stored format.

## Options

1. **A separate key, `meeting-travel-times` (`a{si}`), keyed by
   `series:<uid>` for every placeless in-person meeting, recurring or not; core
   names one travel target per meeting; no fallback between the two maps.**
   Forever cost: two settings keys for one owner concept (prefs clears both),
   and entries for one-off meetings are never pruned, because the key holds
   no time.
2. **Same `travel-times` map, with `series:` / `occ:` keys beside place
   keys.** One key, but two key families with different lifetimes in one map,
   pruning that has to tell them apart, and a collision with a location that
   reads `series:…` or `occ:…`.
3. **Option 1, but a one-off meeting keyed by its occurrence key**, as verdict
   and mode overrides are. Prunable after 7 days, but the value is lost when
   the meeting is moved, which is the unsafe direction for a travel time.
4. **A meeting entry as a fallback for a meeting with a place** (place entry,
   else meeting entry, else default). This would keep a value set before a
   place was added. But then the value shown can come from one entry while a
   pick writes the other.

## Decision

Option 1. What decided it: **one meeting, one entry, the same one for reading
and for writing, chosen in one place (core).**

- `judge` produces `travelTarget`: `{kind: 'place', key}` for an in-person
  meeting with a place, `{kind: 'meeting', key: series:<uid>}` for one with no
  place, `null` for an online meeting. `travelMinutes` comes from that entry
  only, else the default.
- The UI and `app/` carry the target untouched. `setTravel {target, minutes}`
  replaces `setTravel {placeKey, minutes}`. The store writer maps `kind` to the
  settings key and refuses any other kind.
- For a one-off meeting, `series:<uid>` names that one meeting (its UID is its
  own), and it survives the meeting being moved. To the owner, this is "that
  one meeting when it does not repeat" (D-039).
- The mode rule (a place means in person, D-038) and the travel target use
  the same place text, from `core/attendance.js`, so the two can never
  disagree about whether a meeting has a place.

## Consequences

- Easier: every in-person meeting gets travel choices; a moved one-off
  meeting keeps its travel time; place and series keys can never collide.
- Harder: a meeting that gains a place after the owner set a series travel
  time switches to the place entry (or the default). The series entry stays,
  unused, until the place goes away again or the owner clears travel times.
  Accepted by D-039 ("two places a travel time can be remembered").
- We can no longer rename or retype `meeting-travel-times`, or change its
  key from `series:<uid>`, without losing stored values (`interfaces.md` §5).
- `meeting-travel-times` grows by one entry per placeless meeting the owner
  ever sets a travel time for, and is not pruned.

## Revisit when

- `meeting-travel-times` approaches the ADR-0003 64 KiB trigger, or
- product asks for a travel time for one occurrence of a series only (which
  would need an `occ:` scope and the override-style lookup order), or
- product asks that a series value carry over when a place is added, or
- product settles travel time from where the owner starts that day (open
  product question, 2026-10-01). That would be a new target kind (start and
  end), which this shape takes without changing the action or the UI.
