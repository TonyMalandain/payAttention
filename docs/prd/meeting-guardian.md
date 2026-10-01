# Meeting guardian — the first complete build

## Problem

From `problem.md`: *"A reminder for a client call looks the same as a reminder for a lunch placeholder … The one reminder that mattered disappears with the rest."* Also: *"It shows once and then goes away"*, and *"The right moment to warn someone depends on whether they must travel."*

The calendar owner feels this. It covers every requirement from R-1 to R-16 in `solution.md`.

## What changes

After installing the extension, the calendar owner gets the following.

### 1. A verdict for every meeting in the next 24 hours (R-4, R-5, R-7)

Check the signals in this order. The first rule that fires decides, and its reason is the one shown.

1. **Override** — the owner's own override for this occurrence, then for the series. Reason: "you marked this must-attend" or "you marked this ignore".
2. **Ignorable, and certain:**
   - The meeting is cancelled. Reason: "cancelled".
   - The owner declined it. Reason: "you declined".
   - It has guests, and none of the owner's addresses appear as organiser or guest. This happens with someone else's calendar that the owner displays. Reason: "not invited: someone else's meeting". The owner's addresses are every address of the calendar accounts connected to the desktop, plus any extra addresses entered in settings.
   - It is an all-day event, or it has no start time. Reason: "all-day event".
   - It is marked "free" / "show as available". Reason: "marked as free time".
   - The title matches an ignore word. Reason: "placeholder: '<word>'". The built-in ignore words are: hold, placeholder, block, blocked, focus, focus time, deep work, lunch, break, commute, travel, ooo, out of office, busy, tentative hold, do not book, dnb, reminder, gym. Match whole words, and ignore letter case.
3. **Must-attend, and strong:**
   - The title matches an important word. Reason: "important: '<word>'". The built-in important words are: interview, client, customer, board, investor, candidate, exec, review with, demo, pitch, contract, legal, offsite, 1:1, 1-1, one on one. The owner can add more in settings.
   - The owner organised it, and there is at least 1 other guest. Reason: "you organised it, N guests".
   - A guest's email domain is different from the owner's domain (an external guest), and the owner accepted or has not answered. Reason: "external guests".
4. **Ignorable, and weaker:**
   - There are no guests other than the owner. Reason: "no other guests: personal block".
   - There are more than 15 guests, the owner did not organise it, and nothing above matched. Reason: "large meeting (N guests): absence unlikely noticed".
5. **Default:** there are 1 to 15 guests, and the owner accepted or has not answered. The verdict is must-attend. Reason: "small meeting (N guests): absence noticed". If the owner answered "maybe" (tentative), the verdict is ignorable, with the reason "you answered maybe".

**Guests** means people other than the owner. Meeting rooms and equipment are never counted (D-011).

When calendar data is missing (for example, the owner's own address is unknown, so the product cannot tell whether they are invited), the verdict is must-attend with the reason "not enough information: treated as must-attend". When unsure, the product warns rather than stays silent.

### 2. Online or in person (R-10)

- **Online:** the location, description, or conference field holds a video-call link (Google Meet, Zoom, Microsoft Teams, Webex, Whereby, Jitsi, GoTo, Slack huddle, or any https link to one of those services).
- **In person:** there is no link, and the location is not empty and is not a word or phrase that means "no physical place": online, virtual, remote, TBD, TBA, n/a, none, phone, phone call, call, video call, zoom, zoom meeting, teams, teams meeting, microsoft teams, microsoft teams meeting, google meet, meet, webex, hangout, google hangouts, whereby, jitsi, goto meeting, gotomeeting, slack, slack huddle, huddle.
- **Unknown:** there is no link and no location. Treat it as online (short lead time).
- Both a link and a place: online (D-007). The owner can switch it in the menu.

### 3. The escalation ladder (R-8, R-9, R-11, R-13)

The **deadline** is the start time for an online meeting. For an in-person meeting it is the leave-by time: the start time minus the travel time. All times below count to the deadline and are defaults, and each one can be changed in settings.

| Step | When | What the owner sees |
|---|---|---|
| Step | Online: time before the start | In person: time before the leave-by time | What the owner sees |
|---|---|---|---|
| 1. Heads-up | 30 min | 10 min | A distinct card in a corner of the screen, with the title, the time left, the reason, and the actions. It goes away on its own after 15 seconds. The top-bar countdown becomes highlighted. |
| 2. Nudge | 10 min | 5 min | A larger card that stays until the owner acts, with a colour stronger than step 1. If the owner snoozes it, it comes back after the snooze. |
| 3. Insist | 3 min | 2 min | A large card in the middle of the screen, with a pulsing border. It stays on screen, a sound plays once if sound is on, and the top-bar indicator flashes. |
| 4. Takeover | 1 min, then again every minute until 10 min after the start | at the leave-by time, then again every minute until 10 min after the start | A full-screen overlay on every monitor, with the title, a big countdown, the reason, and the actions. It does not go away until the owner picks an action. A sound plays if sound is on. |

The steps are always in this order (D-008).

Actions shown at every step:
- **Join** (online meetings with a link only). Opens the link and acknowledges the meeting.
- **I'm on it.** Acknowledges the meeting. No more alerts for this occurrence.
- **Snooze.** The card hides for 2 min (1 min at step 4). A snooze never goes past the next step's time, except at step 4.
- **Skip this one.** Acknowledges the meeting and records that the owner chose not to attend.
- **Not important.** Overrides this occurrence as ignorable. It is offered with a "whole series" option when the meeting repeats.

Behaviour:
- An override to must-attend, or back again, works the same from the top-bar menu.
- Only one card is on screen per meeting. It shows the highest step that has been reached. Steps that were passed are never replayed one by one.
- If the computer was asleep, locked, or idle when a step fired, the owner sees the step that fits the current time as soon as they return (R-13).
- If two must-attend meetings overlap, the one with the earlier deadline takes the card. The other shows below it as "also: <title> at <time>".
- 10 min after the start, a meeting that was not acknowledged stops alerting.
- Cards and takeovers appear even in Do Not Disturb mode (R-12). They do not use the normal notification list at all.

### 4. Travel time (R-11)

- The default travel time is 30 min (D-006).
- The heads-up and nudge cards for an in-person meeting show the line "Travel: 30 min (default)", and next to it a "Change time" link. It reads as a link (link colour, underlined), is small, and never looks like one of the card's action buttons.
- "Change time" shows one compact row of small boxes holding only the numbers 10, 15, 20, 30, 45, 60 and 90, with the unit "min" said once before the row. The row fits on one line of every card, and every number is readable in full. The current value is marked. Picking one saves it, the line shows the new value, and the alert times move to the new leave-by time at once. Picking a travel time is not an acknowledgement: the escalation goes on.
- While the boxes are shown, the heads-up card does not go away on its own. This never holds back another meeting: when another meeting reaches its nudge or a later step, it takes the card exactly as it would with the boxes closed.
- The value is remembered for that place. The same place text, compared without letter case and extra spaces, uses the stored value from then on.
- The top-bar menu shows the travel time for each in-person meeting. Its travel choices look like one list: every line has the same kind of mark in the same column, and the mark on the current value is filled.

### 5. Top bar (R-14)

- An indicator shows the time left to the next must-attend deadline, for example "Client sync · 24m". When no must-attend meeting is in the next 12 h, it shows only a quiet icon.
- The menu lists today's remaining meetings. Each one shows its time, title, verdict (must-attend or ignorable), reason, and online/in-person mark. It has a toggle to override the verdict, and for in-person meetings a travel-time chooser.

### 6. Settings (R-15)

The lead time for online meetings, the in-person margin, the default travel time, the step times, the heads-up display time, extra important words, extra ignore words, the large-meeting size, sound on/off the owner's email domain(s) (detected automatically, and can be edited), and extra owner addresses.

### 7. When the calendar cannot be read (R-16)

If the product has not received fresh calendar data for 15 minutes, the top-bar icon shows a warning mark. The menu says "Calendar not updating since <time>. Alerts may be missing." It never shows "no meetings" in that state (D-010). The warning clears on its own when fresh data arrives.

A meeting added on the calendar website can take up to about 10 minutes to reach the desktop. If it is booked just before its heads-up time, its first alert can come at a later step. This is accepted (see `solution.md`).

## Who it lands on

- **Calendar owner:** helps. They get fewer alerts overall and one that cannot be missed. Cost: they must click "I'm on it" once per must-attend meeting, including meetings they would have attended anyway. We accept this (D-004).
- **Installer:** helps. There is no login and no setup. Cost: the extension must be enabled once, and after a GNOME update it may need a compatibility bump.
- Nobody else is touched. When the owner shares their screen, others on the call may see a takeover. We accept this as the price of "cannot ignore".

## Already exists?

Nothing in `solution.md` is `real` yet. In the wild, In Your Face (Mac/Windows) has a takeover but no importance judgment. Calendar Reminders, Chronome, and Next Meeting on GNOME give only ordinary notifications or countdowns. See D-002.

## Out of scope

- Editing, accepting, or declining calendar events.
- Live traffic and map routing (see `solution.md`).
- Detecting that the owner joined a call.
- Any network call, AI service, or data leaving the machine.
- Alerts over the lock screen, and alerts on a phone.
- Filtering other applications' notifications.
- Desktops other than GNOME, and GNOME versions older than the one installed (50).

## Smallest useful version

This whole spec is the smallest useful version. Verdicts without escalation would be one more quiet reminder. Escalation without verdicts would be one more source of noise. Travel timing is the smallest part and could be dropped last if needed.

## Done when

- The extension installs on the author's GNOME 50 Wayland session and enables with no errors in the shell log.
- The top bar shows the next must-attend meeting from the author's real connected calendars.
- A developer run with "Test alert" (D-037; never in a normal install) runs through all four steps, and the takeover cannot be dismissed without choosing an action.
- The top bar shows a warning when calendar data is stale.
- Automated tests cover the verdict rules (every reason listed above), online/in-person detection, deadline and step timing (online, in person, hybrid, overrides, snooze limits, return after being away, overlapping meetings, and the 10-minutes-after cutoff).

## Open questions

None open. All were closed by assumption in D-003 to D-011 because the run is unattended.

## Addendum 2026-09-26 — Uninstall (R-17, D-016)

The owner pointed out that nothing removes the extension.

- **What changes:** one command removes payAttention.
  - If the extension is running in the current session, it stops at once. No card, takeover or input grab is left on screen, and no background calendar reader keeps running.
  - The extension no longer loads at the next login.
  - Its files are removed.
  - The output says what was removed and what was kept.
- **Default:** saved overrides, travel times and settings are kept (D-016). An erase option also removes them.
- **Safe to run twice:** running it when nothing is installed succeeds and says so.
- **Never:** it never touches the calendars, other extensions, or other GNOME settings.
- **Done when:**
  - A test in an isolated home proves that install, then uninstall, leaves no extension files and no enabled entry.
  - The same test proves that saved settings remain after a plain uninstall and are gone after the erase option.
  - A second uninstall succeeds.
  - If the extension was running, it is stopped and leaves nothing on screen.
  - The README documents the command.

## Addendum 2026-09-27 — AI mode (R-18, R-19, D-019, D-020, D-021)

This replaces the "AI second opinion" addendum of 2026-09-26. The owner chose a whole-mode switch instead of AI for "unsure" meetings only, because that line had no score behind it.

**Problem:** from `problem.md`: "A reminder for a client call looks the same as a reminder for a lunch placeholder." Fixed rules still misjudge some meetings. On the owner's real week, a child pick-up was silenced, and a family event counted as "you organised it".

**What changes:**
- **Settings, "Verdicts" section:**
  - **Mode:** Rules (the default) or AI.
  - **AI engine:** endpoint (address), model name, API key, and a "Test connection" button that gives a clear yes or no.
  - A plain warning: "In AI mode the whole invite is sent to this engine. With a cloud engine it leaves your computer. Passcodes and dial-in numbers are removed first, on a best-effort basis." (D-030)
  - The key is kept in the desktop's password store, never in plain settings.
- **In AI mode:**
  - Every meeting's whole invite goes to the engine: title, time, description, place, video link, organiser, and guests with their names, email addresses and responses (D-020).
  - The engine answers must-attend or ignorable with a one-line reason. The menu and alerts show it as "AI: <reason>".
  - The owner's overrides always win, and they are not sent to be judged.
  - Cancelled meetings, meetings the owner declined, and all-day events stay silent and are not sent (D-023).
  - The calendar's name is sent with the invite (D-024). Passcodes are removed from video links (D-022), and from text such as "Passcode: 123456" in the description and place, up to the end of the line (D-025, D-027).
  - A meeting is asked once, and again only when its invite changes.
  - What the engine returns is data, never instructions. A meeting's text cannot make the product do anything except pick a verdict.
- **When the engine cannot be reached** (slow, erroring, offline, out of quota, or a bad key):
  - the rules decide that meeting;
  - the menu says "AI unavailable — using rules";
  - an alert is never delayed while waiting for the AI.
- **Rules mode** behaves exactly as today, and nothing is sent anywhere.
- **Uninstall:**
  - A plain uninstall keeps the API key and the stored AI answers, and says so (D-016).
  - `--purge` erases both.

**Who it lands on:**
- **Calendar owner:** helps, with smarter verdicts. Cost: the AI can silence a meeting the rules would have alerted (accepted in D-019). The shown reason and the one-click override are the remedy.
- **Installer:** cost. Setup is needed for AI mode, but nothing is needed for rules mode.

**Out of scope:**
- The AI changing alert timing or travel time.
- Bundling or installing an engine for the owner.
- A bundled AI library (D-021).
- Engines that do not speak the standard connection, unless the owner runs a gateway.

**Done when:**
- In rules mode the product behaves exactly as before, and nothing is sent anywhere.
- In AI mode with a local engine, meetings get "AI:" verdicts. The same holds with a cloud engine, checked by hand with the owner's key.
- Tests prove that:
  - the whole invite is sent, and overrides are not;
  - an unreachable engine falls back to the rules without delaying any alert;
  - hostile text in an invite cannot change anything except the verdict;
  - the key never appears in settings, logs, or the pipe to the shell.

**Open questions:** none for product. Which cloud service to check by hand depends on which key the owner has; a local engine alone is enough to accept the build.
