# Meeting guardian — the first complete build

## Problem

From `problem.md`: *"A reminder for a client call looks the same as a reminder for a lunch placeholder … The one reminder that mattered disappears with the rest."* Also: *"It shows once and then goes away"*, and *"The right moment to warn someone depends on whether they must travel."*

The calendar owner feels this. It covers every requirement from R-1 to R-15 in `solution.md`.

## What changes

After installing the extension, the calendar owner gets the following.

### 1. A verdict for every meeting in the next 24 hours (R-4, R-5, R-7)

Check the signals in this order. The first rule that fires decides, and its reason is the one shown.

1. **Override** — the owner's own override for this occurrence, then for the series. Reason: "you marked this must-attend" or "you marked this ignore".
2. **Ignorable, and certain:**
   - The owner declined it. Reason: "you declined".
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
5. **Default:** there are 2 to 15 guests, and the owner accepted or has not answered. The verdict is must-attend. Reason: "small meeting (N guests): absence noticed". If the owner answered "maybe" (tentative), the verdict is ignorable, with the reason "you answered maybe".

When calendar data is missing (for example, no guest list), the verdict is must-attend with the reason "not enough information: treated as must-attend". When unsure, the product warns rather than stays silent.

### 2. Online or in person (R-10)

- **Online:** the location, description, or conference field holds a video-call link (Google Meet, Zoom, Microsoft Teams, Webex, Whereby, Jitsi, GoTo, Slack huddle, or any https link to one of those services).
- **In person:** there is no link, and the location is not empty and is not a word like "online", "virtual", "remote", or "TBD".
- **Unknown:** there is no link and no location. Treat it as online (short lead time).
- Both a link and a place: online (D-007). The owner can switch it in the menu.

### 3. The escalation ladder (R-8, R-9, R-11, R-13)

The **deadline** is the start time for an online meeting. For an in-person meeting it is the leave-by time: the start time minus the travel time. All times below count to the deadline and are defaults, and each one can be changed in settings.

| Step | When | What the owner sees |
|---|---|---|
| 1. Heads-up | 30 min before the start (online). 10 min before the leave-by time (in person). | A distinct card in a corner of the screen, with the title, the time left, the reason, and the actions. It goes away on its own after 15 seconds. The top-bar countdown becomes highlighted. |
| 2. Nudge | 10 min before the deadline (in person: 5 min before the leave-by time) | A larger card that stays until the owner acts, with a colour stronger than step 1. If the owner snoozes it, it comes back after the snooze. |
| 3. Insist | 3 min before the deadline (in person: at the leave-by time) | A large card in the middle of the screen, with a pulsing border. It stays on screen, a sound plays once if sound is on, and the top-bar indicator flashes. |
| 4. Takeover | 1 min before the deadline, and every minute after that until 10 min past the start | A full-screen overlay on every monitor, with the title, a big countdown, the reason, and the actions. It does not go away until the owner picks an action. A sound plays if sound is on. |

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
- The heads-up and nudge cards for an in-person meeting show "Travel: 30 min (default) · change". "Change" offers 10, 15, 20, 30, 45, 60, or 90 min. The value is remembered for that place. The same place text, compared without letter case and extra spaces, uses the stored value from then on.
- The top-bar menu shows the travel time for each in-person meeting.

### 5. Top bar (R-14)

- An indicator shows the time left to the next must-attend deadline, for example "Client sync · 24m". When no must-attend meeting is in the next 12 h, it shows only a quiet icon.
- The menu lists today's remaining meetings. Each one shows its time, title, verdict (must-attend or ignorable), reason, and online/in-person mark. It has a toggle to override the verdict, and for in-person meetings a travel-time chooser. A "Test alert" item runs through the whole ladder in about 30 seconds, so the owner can see the alerts without a real meeting.

### 6. Settings (R-15)

The lead time for online meetings, the in-person margin, the default travel time, the step times, the heads-up display time, extra important words, extra ignore words, the large-meeting size, sound on/off, and the owner's email domain(s) (detected automatically, and can be edited).

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
- A built-in "Test alert" runs through all four steps, and the takeover cannot be dismissed without choosing an action.
- Automated tests cover the verdict rules (every reason listed above), online/in-person detection, deadline and step timing (online, in person, hybrid, overrides, snooze limits, return after being away, overlapping meetings, and the 10-minutes-after cutoff).

## Open questions

None open. All were closed by assumption in D-003 to D-007 because the run is unattended.
