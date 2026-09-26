# Alternatives

Found by web search on 2026-09-26, after the build. The first search (D-002) looked only at GNOME extensions. This one also looked at tools outside GNOME.

## oh-shit-meeting (open source, Linux daemon)
- **What it does well:** a very large flashing red alert page with a looping sound that plays until you acknowledge. It reads Google Calendar.
- **Why you might pick this instead:** it runs on any Linux desktop, not only GNOME.
- **Why you might pick payAttention:** that tool does not judge importance, does not escalate step by step, and does not time for travel. It needs a Google sign-in and works only with Google Calendar. Its README calls it a quick hack.

## Calendar Alarm (Chrome extension)
- **What it does well:** it turns Google Calendar's own reminders into a maximised, chiming window that stays until you respond. No login needed.
- **Why you might pick this instead:** it works wherever Chrome runs, and there is nothing to maintain.
- **Why you might pick payAttention:** it needs a Calendar tab open in the browser, and it only fires on reminders you create by hand. That hand-crafting is the chore that started this project.

## gcalcli with a script
- **What it does well:** it can run any program before an event, so you can build any alert you like.
- **Why you might pick this instead:** it works on any desktop, and you get total control.
- **Why you might pick payAttention:** you would have to write the importance judgment and the escalation yourself.

## In Your Face, meeting-reminder, MeetingBar (macOS or Windows only)
- **What they do well:** a full-screen takeover. meeting-reminder also escalates step by step.
- **Why not:** they do not run on Linux.

## Calendar.AI, ClickUp meeting agent, Reclaim.ai (cloud AI services)
- **What they do well:** "leave by" alerts from live traffic (Calendar.AI, ClickUp), some ranking of meetings (ClickUp), and travel time blocked out on the calendar (Reclaim).
- **Why you might pick these instead:** live traffic, and smarter judgment from AI.
- **Why you might pick payAttention:** they send your calendar data to a third party (D-003 ruled this out). They alert on the phone or in the browser, not with a desktop takeover, and none of them escalates until you act.
