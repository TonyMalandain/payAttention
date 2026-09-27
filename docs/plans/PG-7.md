# Plan — PG-7: play the owner's GNOME alert sound, not a fixed alarm

Spec: `BACKLOG.md` PG-7. Architecture: ADR-0004 ("the sound is played through the shell's sound player, not a notification"), `overview.md` ("Sound is not in the Plan; the controller plays it on a (occurrence, step ≥ 3) edge").

## What changes, and for whom

At the insist step (3) and the takeover step (4), the owner hears the **alert sound they chose in GNOME Settings → Sound → Alert Sound** (Click, String, Swing or Hum), not the freedesktop `alarm-clock-elapsed` sound.
- A new choice in Settings takes effect on the next alert, with no reinstall.
- If the chosen sound file is missing, the standard freedesktop `bell` sound plays.
- The payAttention sound switch and the once-per-step rule are unchanged.

## How GNOME 50 stores and plays the alert sound (measured 2026-09-27)

Sources: gnome-control-center 50.4 `panels/sound/cc-alert-chooser-page.c`, mutter 50.5 `src/core/meta-sound-player.c` and `src/core/bell.c`, libcanberra 0.30 `src/sound-theme-spec.c` and `src/cache.c`. Machine: Fedora 44, gnome-shell 50.5.

1. **How Settings stores the choice.** It does not store a sound name in GSettings. Choosing Click/String/Swing/Hum does three things:
   - it writes a user sound theme `~/.local/share/sounds/__custom/`: an `index.theme` with `Inherits=freedesktop`, and two symlinks, `bell-terminal.ogg` and `bell-window-system.ogg`, pointing to `/usr/share/sounds/gnome/default/alerts/<name>.ogg`;
   - it touches `~/.local/share/sounds` and the theme directory, so canberra's lookup cache and gnome-settings-daemon's sample cache are refreshed;
   - it sets `org.gnome.desktop.sound event-sounds=true` and `theme-name='__custom'`.

   This machine has exactly that: `theme-name '__custom'`, and both links point to `click.ogg`.
2. **Choosing "None"** sets `event-sounds=false` and changes nothing else.
3. **Mutter plays the alert sound by one event id.** Mutter's own bell (`bell.c`) calls `meta_sound_player_play_from_theme(player, "bell-window-system", …)`, so `bell-window-system` *is* the owner's alert sound.
4. **The player follows Settings changes live.** `MetaSoundPlayer`, which the shell reaches as `global.display.get_sound_player()`, reads `org.gnome.desktop.sound` at creation and connects to `changed`. It pushes `theme-name` into `CA_PROP_CANBERRA_XDG_THEME_NAME` and `event-sounds` into `CA_PROP_CANBERRA_ENABLE`. Because we pass an event id rather than a file, every play resolves the *current* choice.
5. **Canberra falls back to a standard sound when the chosen one is missing.** Its lookup order is:
   - the theme itself;
   - the `freedesktop` theme when the theme is missing;
   - name stripping at each `-` (`bell-window-system` → `bell-window` → `bell`);
   - unthemed files.

   Probed with GSound (the same libcanberra) in a throwaway `XDG_DATA_HOME` **and a throwaway `XDG_CACHE_HOME`**:
   - `__custom` with a valid link → found;
   - a theme whose `bell-window-system.ogg` is a **dangling** link → found (freedesktop `bell.oga`);
   - a theme name that does not exist → found (freedesktop `bell.oga`);
   - with only `freedesktop/stereo/bell.oga` present, both broken cases still resolve.

   On Fedora 44, `libcanberra` requires `sound-theme-freedesktop`, which ships `bell.oga`. So whenever the shell's sound player can play at all, `bell-window-system` resolves to *something*.
6. **The shell cannot see a failure.** `play_from_theme` returns `void`, and mutter's `finish_cb` drops errors. A fallback written in our code could never know when to fire. The fallback therefore *is* canberra's lookup, which point 5 proves.
7. **Caching.** Mutter plays `bell-window-system` with `canberra.cache-control=permanent` (its `cache_allow_list`). The sound server then keeps the sample, and gnome-settings-daemon flushes it when the theme directories change. This is the same path that makes the system bell follow Settings, and it is why Settings touches the directories.

**Warning for anyone probing this by hand:** canberra keeps a lookup cache at `~/.cache/event-sound-cache.tdb.*`. Negative entries are only invalidated when a top-level `sounds/` directory's mtime changes. A probe with a fake `XDG_DATA_DIRS` but the real cache writes "not found" entries that silence the real `__custom` sounds. Always set a throwaway `XDG_CACHE_HOME`.

While writing this plan, the senior engineer's first probes did exactly that. It was repaired by `touch ~/.local/share/sounds`: the mtime bump makes every older entry stale. This is recorded here so the owner knows.

## The component

- **Responsible for:** `extension/ui/` draws the display model and makes the alert sound. It decides nothing (ADR-0004, `boundaries.md`: "ui/ … sound"). One level down, `Ui.playAlertSound()` produces the alert sound through the shell's sound player.
- **Has drifted by:** no drift.
- **This change belongs here because:** which sound the player is asked for is purely part of "make the alert sound". The *when* stays where it is:
  - `shell/soundCue.js` `shouldPlaySound` decides once per step;
  - `shell/controller.js` gates it on `soundEnabled`.

  Neither changes. No setting, no core logic, no new import.

## Seams

- `Ui.playAlertSound(): void` is unchanged. The controller's `UiPort` typedef (`controller.js` line 41) and its fake in `tests/unit/controller.test.js` are untouched.
- There is one new module-private constant in `extension/ui/ui.js`, above the class:
  ```js
  // GNOME Settings > Sound > Alert Sound sets this event in the user's sound theme
  // (mutter's own bell plays it). The shell's sound player follows theme changes, and
  // canberra falls back to the freedesktop "bell" when the chosen file is missing.
  const ALERT_SOUND_EVENT = 'bell-window-system';
  ```
  `playAlertSound()` becomes `global.display.get_sound_player().play_from_theme(ALERT_SOUND_EVENT, 'payAttention alert', null);`.
- **Misuse designed out:**
  - the event id is not a setting, so it cannot be set to something that does not follow the owner's choice;
  - no file path is resolved in our code, so a stale path cannot be cached or held.

## Steps

### Step 1 — the smoke test proves which sound the ladder plays  [feature, test first]
- **Test first:** in `tests/smoke/alert-ladder.js`:
  1. Add `import Meta from 'gi://Meta';`.
  2. Just before `ext.stateObj.runTestAlert();` in check 3, install a recorder:
     ```js
     const soundCalls = [];
     const realPlay = Meta.SoundPlayer.prototype.play_from_theme;
     Meta.SoundPlayer.prototype.play_from_theme = function (name, description) { soundCalls.push({ name, description }); };
     ```
     It records only: it does not call through, because the headless shell has no audio.
  3. Restore `realPlay` in a `finally` that wraps the rest of the script from that point. It must be restored whatever check fails.
  4. Right after the existing `check(seen.has(1) && …, '3-ladder', …)`, add a check named `'3-sound'`:
     - `soundCalls.length === 2` (step 3 and step 4, once each);
     - every `name === 'bell-window-system'`;
     - every `description === 'payAttention alert'`.

     On failure it prints the recorded calls.
  5. Run `npm run build && npm run smoke`. It must fail at `3-sound`, showing `alarm-clock-elapsed`. That proves the recorder is hit and the test measures the right thing.
- **If the prototype replacement is not hit** (`soundCalls` stays empty while the ladder runs): replace the method on the instance instead. Take `const player = global.display.get_sound_player()` before the ladder, and set and restore `player.play_from_theme` in the same way. That is the only allowed alternative. If neither is hit, stop (see below).
- **Why here:** the smoke is the only layer where the real `Ui` runs. `ui.js` imports `resource://` modules, so Node unit tests cannot load it (`testing-and-build.md`).

### Step 2 — ask the player for the owner's alert sound  [feature]
- **Then:** in `extension/ui/ui.js`, add `ALERT_SOUND_EVENT` as shown in Seams and use it in `playAlertSound()`. Nothing else in the file changes.
- **Proof:** `npm run lint`, `npm test` (the controller sound tests 8 and 9 still pass unchanged), `npm run build`, `npm run test:helper`, `npm run smoke` (`3-sound` now passes).
- **Behaviour change:** which sound plays. When, and whether, are unchanged.

### Step 3 — tell the owner  [docs]
- **`README.md`,** section "The alert ladder": add one sentence after the table.

  > The sound at Insist and Takeover is the alert sound you chose in GNOME Settings → Sound → Alert Sound. If that sound file is missing, the standard bell plays. If you chose **None** there, GNOME silences it for payAttention too; the sound switch in payAttention's Settings turns it off on its own.

### Step 4 — the hand check in the real session (the ticket's "checked by hand")
Record the result in the handover:
1. Run `npm run install:local`, then log out and back in.
2. GNOME Settings → Sound → Alert Sound → **Swing**. Run **Test alert** from the menu: Swing plays once at Insist and once at Takeover.
3. Without reinstalling or logging out, switch to **Hum** and run Test alert again: Hum plays.
4. In payAttention Settings, turn "Sound at insist and takeover" off and run Test alert: nothing plays. Turn it back on.
5. Put Alert Sound back to the owner's own choice (today **Click**).
6. Do **not** break the owner's `__custom` links to test the fallback. The fallback is proven by the isolated probe in the section above. If a reviewer wants it repeated, use a throwaway `XDG_DATA_HOME` **and** a throwaway `XDG_CACHE_HOME` with `gjs` and `gi://GSound`.

## Callers to update

`Ui.playAlertSound()` keeps its signature. Its only caller is `shell/controller.js`, which is unchanged. No settings key, schema or protocol changes.

## Out of scope

- `shell/soundCue.js`, `controller.js`, the `sound-enabled` key and prefs: unchanged.
- Our own playback path (GSound, GStreamer, `play_from_file`). This would be a new `gi://` import in `ui/`, which is a boundary decision for the architect. It is not needed, by point 5.
- Choosing a different sound in payAttention's own settings.
- Volume. The "System Sounds" volume slider and a muted output are the owner's settings.

## Stop and escalate if

- `3-sound` records nothing with either recorder, or records a count other than 2 while the ladder passes. The sound path is not what `controller.js` lines 243–245 show; stop, do not adjust the expected count.
- In the hand check, the new Alert Sound choice is only heard after re-login. That would contradict point 4; report it with the journal lines.
- In the hand check, nothing plays at all while GNOME's own alert sound works (for example, a Tab-completion bell in a terminal).
