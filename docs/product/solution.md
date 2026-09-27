# The solution

## In one sentence

payAttention stays silent about meetings that do not matter, and makes the ones that do impossible to miss, warning you at the right moment for how you will get there.

## What we are building

payAttention lives in the GNOME desktop that the calendar owner already uses. It reads the calendars that are already connected to that desktop. For every upcoming meeting, it gives a verdict: must-attend or ignorable. It bases the verdict on what the calendar already says: who else is invited, whether you accepted, whether you organised it, how many people are there, whether it blocks your time, and what the title suggests. Every verdict has a one-line reason that you can read, so you can trust it or correct it. A correction takes one click and can cover the whole recurring series.

Ignorable meetings make no noise at all. That is half the product. The fewer alerts it sends, the more each one is worth.

Must-attend meetings get an alert that escalates. The first warning appears at a sensible lead time. It is clearly different from an ordinary notification, and then it goes away. If you do nothing, it comes back stronger. It gets larger, it stays on screen, and it repeats. At the end it takes over the whole screen and stays until you choose what to do. One action, "I'm on it", stops everything for that meeting. For an online meeting, joining from the alert also counts. The product does not try to read your mind. Until you acknowledge, it assumes you are about to miss the meeting.

The lead time depends on how you will attend. An online meeting needs only a short warning, so the countdown runs to the start time. An in-person meeting needs time to travel, so the countdown runs to the time you must leave. You can set the travel time for a place once, and the product remembers it for that place.

A small countdown in the top bar always shows the next must-attend meeting. You can glance at what is coming without opening anything.

## Requirements

Environment requirements come first.

### R-1 — Runs inside the GNOME desktop the user already has
- **Serves:** the calendar owner works on a GNOME desktop and needs the warning where they already look.
- **Who it serves:** Installer.
- **What they get:** install one extension. There is nothing else to start and no separate app to keep open.
- **State:** real
- **Evidence:** demoed

### R-2 — Uses the calendars already connected to the desktop
- **Serves:** "install once and do almost no setup". The meetings are already on the calendar the owner uses.
- **Who it serves:** Installer.
- **What they get:** no second login and no copying of calendars. Every calendar shown in the desktop clock menu is covered.
- **State:** real
- **Evidence:** demoed

### R-3 — Calendar contents never leave the machine unless the owner chooses a cloud AI engine
- **Serves:** calendars hold sensitive business information. The warning must also work when the network is unreliable.
- **Who it serves:** Calendar owner.
- **What they get:** verdicts and alerts work offline. Nothing about their meetings is sent anywhere, unless they turn on a cloud AI engine. Then the whole invite is sent to the engine they chose (D-020).
- **State:** real
- **Evidence:** verified in code

### R-4 — Every upcoming meeting gets a verdict without the user tagging anything
- **Serves:** "a reminder for a client call looks the same as a reminder for a lunch placeholder". The owner has to filter by hand today.
- **Who it serves:** Calendar owner.
- **What they get:** must-attend meetings are picked out for them. Placeholders, personal blocks, declined or "free" meetings, all-day events, and large broadcasts are recognised as ignorable.
- **State:** real
- **Evidence:** verified in code

### R-5 — Every verdict explains itself in one line
- **Serves:** a wrong verdict is the thing that makes the owner give up. They must be able to see why before they can trust or correct it.
- **Who it serves:** Calendar owner.
- **What they get:** a reason such as "you organised it, 3 guests" or "no other guests: personal block".
- **State:** real
- **Evidence:** verified in code

### R-6 — The user can override a verdict for one meeting or its whole series
- **Serves:** the owner can "carefully craft" a reminder today. Some judgment must stay with them, but it should take one action, not a crafted reminder.
- **Who it serves:** Calendar owner.
- **What they get:** from the top-bar menu or from an alert, mark a meeting "must-attend" or "ignore", for this one or for every meeting in the series. The choice is remembered.
- **State:** real
- **Evidence:** verified in code

### R-7 — Ignorable meetings produce no alert at all
- **Serves:** "fewer and stronger" warnings. Placeholders "should make no noise at all".
- **Who it serves:** Calendar owner.
- **What they get:** silence for everything that does not matter.
- **State:** real
- **Evidence:** verified in code

### R-8 — Must-attend alerts escalate until acknowledged, ending in a full-screen takeover
- **Serves:** a normal reminder "shows once and then goes away". The warning must get "harder to ignore, until they cannot ignore it".
- **Who it serves:** Calendar owner.
- **What they get:** a brief heads-up first, then a banner that stays on screen and repeats, then a full-screen takeover that stays until they choose an action. The takeover comes back if the meeting starts and they still have not acted.
- **State:** real
- **Evidence:** verified in code

### R-9 — One action stops the escalation
- **Serves:** the product assumes you will miss the meeting until you show you will not. Showing it must cost almost nothing.
- **Who it serves:** Calendar owner.
- **What they get:** "I'm on it" silences that meeting. "Join" opens an online meeting's link and also silences it. A short snooze is available at every step. "Skip this one" is also available, for a meeting they chose to miss on purpose.
- **State:** real
- **Evidence:** verified in code

### R-10 — Online and in-person meetings are told apart
- **Serves:** one lead time "is too early for a video call and too late for a meeting across town".
- **Who it serves:** Calendar owner.
- **What they get:** a meeting with a video-call link is online. A meeting with only a physical place is in-person. A meeting with both is treated as online, and the user can switch it.
- **State:** real
- **Evidence:** verified in code

### R-11 — In-person meetings count down to the leave-by time
- **Serves:** "the right moment to warn someone depends on whether they must travel".
- **Who it serves:** Calendar owner.
- **What they get:** alerts timed to when they must leave. The travel time comes from what they set for that place, or from a default travel time. They can set it from the alert and it is remembered for that place.
- **State:** real
- **Evidence:** verified in code

### R-12 — Must-attend alerts break through Do Not Disturb
- **Serves:** the owner silences noise to cope with overload. The one warning that matters must still get through.
- **Who it serves:** Calendar owner.
- **What they get:** Do Not Disturb keeps everything else quiet but never hides a must-attend alert.
- **State:** real
- **Evidence:** demoed

### R-13 — Alerts missed while away are shown on return
- **Serves:** a reminder that arrives "while you are away from the desk" is lost today.
- **Who it serves:** Calendar owner.
- **What they get:** when they come back, they see the escalation step that fits the current time, not a stale heads-up and not nothing.
- **State:** real
- **Evidence:** verified in code

### R-14 — The next must-attend meeting is always visible at a glance
- **Serves:** the owner needs to trust that the product is watching. It also replaces checking the calendar "just in case".
- **Who it serves:** Calendar owner.
- **What they get:** a small top-bar countdown to the next must-attend meeting, and a menu listing today's meetings with their verdicts and reasons.
- **State:** real
- **Evidence:** demoed

### R-15 — A few settings, with defaults that work out of the box
- **Serves:** "install once and do almost no setup", while still letting the owner tune timing to their habits.
- **Who it serves:** Installer.
- **What they get:** a default lead time, a default travel time, escalation timings, extra words that mark a meeting important or ignorable, and a sound on or off switch. Everything works without opening settings.
- **State:** real
- **Evidence:** demoed

### R-16 — The product says when it cannot see the calendar
- **Serves:** the owner misses meetings that matter. A product that silently loses the calendar would let that happen while looking calm.
- **Who it serves:** Calendar owner.
- **What they get:** a visible warning and the time of the last good update whenever calendar data is stale. It never shows "no meetings" in that state.
- **State:** real
- **Evidence:** verified in code

### R-17 — The installer can remove it completely with one command
- **Serves:** "install once and do almost no setup" (users.md, Installer). A tool that is easy to add but hard to remove is not low-effort, and an extension that takes over the screen must be easy to get rid of.
- **Who it serves:** Installer.
- **What they get:** one command stops the extension and removes it. It no longer loads at the next login. By default, their saved choices (overrides, travel times, settings) are kept, so a reinstall picks up where they left off. One option also erases those choices. Their calendars are never touched.
- **State:** real
- **Evidence:** verified in code

### R-18 — In AI mode, an AI engine judges every meeting
- **Serves:** the author asked for a system "smart enough to understand meetings on my calendar I cannot afford to miss and meeting that are just placeholder". Fixed rules miss cases like a personal task that matters, and the owner "has to carefully craft" corrections by hand today.
- **Who it serves:** Calendar owner.
- **What they get:** a choice of two modes. Rules mode works as before. In AI mode every meeting is judged by the AI from the whole invite, with a one-line reason marked "AI:". Their own overrides always win. If the engine cannot be reached, the rules decide and the menu says so. An alert never waits for the AI.
- **State:** real
- **Evidence:** verified in code

### R-19 — The owner connects the AI engine of their choice
- **Serves:** calendars hold sensitive business information (R-3). Only the owner can weigh smarter verdicts against sending meetings off the machine.
- **Who it serves:** Installer.
- **What they get:** rules mode until they switch. They then enter an endpoint, a model and an API key for any engine, on their own machine or in the cloud, test the connection, and can switch at any time. Settings say plainly that the whole invite is sent, and that with a cloud engine it leaves the computer. The key is kept in the desktop's password store.
- **State:** real
- **Evidence:** verified in code

### R-20 — The owner can see what payAttention would decide, without logging out
- **Serves:** a wrong verdict is what makes the owner give up (users.md), and the owner "has to carefully craft" reminders today. Before trusting the verdicts, or an AI engine, they need to see them. On Wayland, trying the extension itself means logging out.
- **Who it serves:** Calendar owner, Installer.
- **What they get:** one command in a terminal lists their upcoming meetings with the verdict and reason payAttention would give, from the rules or from their AI engine. It uses exactly the same judgment and the same calendar access as the extension, not a copy.
- **State:** real
- **Evidence:** demoed

## What the solution is not

- **Not a calendar.** It never creates, edits, or accepts meetings. The owner's calendar stays the one source of truth.
- **Not a general notification filter.** It does nothing to other apps' notifications. Its job is to be the one alert that is worth reading, not to clean up the rest.
- **No AI unless the owner turns it on.** Out of the box, verdicts come from the rules alone. The AI never overrides an owner's choice (D-019).
- **No live traffic or map routing.** Travel time is what the owner sets per place, or the default. This would be reconsidered if fixed travel times led to late arrivals in practice.
- **Does not detect presence in a meeting.** It does not watch the camera, microphone, or call apps to decide that you joined. Acknowledging is the only signal, because it is reliable and costs one click.
- **Nothing over the lock screen, and no phone.** If the desktop is locked or the owner is away from the computer, the alert waits for their return.
- **GNOME only.** Other desktops are out of scope. One tested desktop is what keeps the product small enough to trust.
- **No instant view of meetings booked moments ago.** A meeting added on the calendar provider's website can take about 10 minutes to reach the desktop, so a meeting booked just before its heads-up time may first alert at a later step. This would be reconsidered if such late bookings led to a missed meeting.
- **Only meetings the owner is invited to.** Meetings on calendars of others that the owner displays, with no invitation to the owner, never alert.
