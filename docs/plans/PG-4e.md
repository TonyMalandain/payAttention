# Plan — PG-4e: `uninstall --purge` also erases the AI engine keys and the stored AI answers; a plain uninstall keeps them and says so

Spec: `docs/prd/meeting-guardian.md`, "Addendum 2026-09-27 — AI mode", **Uninstall**: "A plain uninstall keeps the API key and the stored AI answers, and says so (D-016). `--purge` erases both." Product decision D-016 (keep the owner's saved choices unless asked to erase them). Architecture: ADR-0009 ("`--purge` also clears every item with this schema, and only those, without touching any other keyring item"), `data.md` (`ai-verdicts`; the keyring schema), `testing-and-build.md` ("Remove"). It builds on PG-3 (`docs/plans/PG-3.md`, `scripts/uninstall.sh`, `tests/smoke/uninstall-check.sh`).

**Sensitive: this deletes secrets from the owner's keyring.** The script may remove only items whose libsecret schema is `org.gnome.shell.extensions.payattention.EngineKey`, and nothing else in the keyring. It never reads, prints or logs a secret. The tests never reach the owner's keyring, bus, dconf or home: they run inside PG-3's `env -i` throwaway home under `dbus-run-session`, with a throwaway keyring started *before* any Secret call (PG-4b fact 3: a private bus alone would D-Bus-activate a keyring daemon on whatever `HOME` it is given).

## Depends on

- PG-4b merged: `tests/ai/gjs/keyring.js` (the test-only keyring writer, `store` and `lock`) and `ENGINE_KEY_SCHEMA_NAME` in `core/aiEngine.js`.
- PG-4d is **not** needed: the check seeds keys the way the helper's tests do.

## What changes, and for whom

The installer (the owner) runs:
- **`npm run uninstall:local`:** as today, and the output now says that the stored AI answers and any AI engine keys in the keyring were kept, and how to erase them. It does not touch the keyring at all.
- **`npm run uninstall:local -- --purge`:** as today, and it also erases every payAttention AI engine key from the keyring. The AI answers (`ai-verdicts`) are already inside the erased settings path; the output now names them.

If the keyring is locked or cannot be reached, `--purge` stops with a clear message *before* erasing the settings. Unlocking and running it again finishes the job.

## The component

- **Responsible for:** `scripts/uninstall.sh` takes payAttention out of the owner's session: it stops it, removes its files and list entries, and on request erases what it stored.
- **Has drifted by:** no drift. "What it stored" now has a second place, the keyring (ADR-0009), and the script's header comment and output lines only know about dconf. That is what this ticket adds.
- **This change belongs here because:** erasing the owner's stored data on request is exactly what `--purge` is for (D-016, PG-3), and `boundaries.md` already lists "`scripts/uninstall.sh --purge` clears" as the keyring items' only other writer. Nothing under `extension/` changes.

### Facts measured for this plan (2026-09-27, gjs 1.88.1, libsecret, gnome-keyring 50.0)

All were run in `/tmp` probes, outside the repository, under `env -i` with a throwaway `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR` (0700), inside `dbus-run-session`. The keyring was started with `printf '<phrase>' | gnome-keyring-daemon --unlock --components=secrets --daemonize`, as in PG-4b.

1. **A legacy `gjs -c` script can clear by schema.** The measured program is the one in Step 2:
   - `Secret.password_clear_sync(schema, {}, null)` with our schema and **empty** attributes removed both of our items (two different `endpoint` values);
   - it left an item of another schema (`org.example.Other`) that has the same `endpoint` attribute and value;
   - `service.search_sync(schema, {}, Secret.SearchFlags.ALL, null).length` was then 0, and the program printed `cleared`, exit 0.
2. **A locked keyring is not cleared, and says nothing.** After `service.lock_sync(service.get_collections(), null)`, `password_clear_sync` returned `false` with no error, and both items stayed (`get_locked() === true`). The same program printed `locked`, exit 0. So the script must search again after clearing; the clear's own answer proves nothing.
3. **An unreachable Secret Service throws.** With `DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent`, the program printed nothing and exited 1.
4. **No keyring set up at all is fine.** On a fresh private bus with no daemon started, the first Secret call D-Bus-activated `gnome-keyring-daemon` (on the throwaway home). Clear returned `false`, the search found 0 items, and nothing prompted. So `--purge` on a machine where AI was never used succeeds and prints `cleared`.
5. **`gnome-keyring-daemon --unlock … --daemonize` prints environment lines on stdout.** Send them to `/dev/null`.

## Decisions made in this plan (reasoned; nobody could be asked mid-run)

1. **The plain uninstall never calls the keyring.** It prints a fixed "Kept" line for the keys. Looking them up would add a failure path (a locked or absent keyring), or a desktop unlock prompt, to a command that only keeps things. The line says "if you saved any", so it is true either way.
2. **`--purge` clears the keys first, then the settings.** The keyring is the step that can fail for a reason the owner can fix (it is locked). Failing before the settings are erased leaves one clear state, "keys and settings both still there", and one instruction: unlock and run again. The other order would leave settings gone and keys still there, and the owner would have to know that the second run only has keys left to do.
3. **The keys are cleared by schema, never by listing endpoints.** The script cannot know which addresses the owner used. Empty attributes with our schema match every item of our schema, and only those (fact 1).
4. **Success is "none of our items is left", checked by a second search in the same process** (fact 2). A locked item is reported as locked, not as erased.
5. **The schema name is written once more, in the script,** as `KEY_SCHEMA=org.gnome.shell.extensions.payattention.EngineKey`, with a comment naming `ENGINE_KEY_SCHEMA_NAME` in `extension/core/aiEngine.js`. A shell script cannot import it, and the install directory (the only other copy of core on the machine) has already been removed by then. The uninstall check guards the duplicate: it seeds items through `tests/ai/gjs/keyring.js`, which uses core's constant, and fails if the script does not clear them.
6. **Only tools already required are used:** `gjs` with `gi://Secret` (libsecret is already needed by prefs and the AI helper). Not `secret-tool`, which is a separate package on some distributions.
7. **An unreachable keyring fails `--purge`.** The script cannot tell "no keyring on this machine" from "a keyring it cannot reach right now". Saying "erased" when it does not know would break D-016's promise. On GNOME the Secret Service is always there (ADR-0009), and fact 4 shows a fresh one needs no setup.

## Seams

### `scripts/uninstall.sh` — the command-line contract, changed

Arguments, exit codes and the order of the existing steps are unchanged (PG-3). What changes:

**Stdout lines.** Only the settings part (step e) changes. It is printed after `Nothing to remove…` (if printed), and before `Calendars and other extensions were not touched.`:

Without `--purge`, exactly these two lines, in this order:
```
Kept: saved settings and AI answers (/org/gnome/shell/extensions/payattention/). To erase them: npm run uninstall:local -- --purge
Kept: AI engine keys in your keyring, if you saved any (Passwords and Keys). To erase them: npm run uninstall:local -- --purge
```

With `--purge`, on success, exactly these two lines, in this order:
```
Erased: AI engine keys from your keyring.
Erased: saved settings and AI answers (/org/gnome/shell/extensions/payattention/).
```

**New stderr failures** (exit 1, one line each, printed through the existing `die`):
```
uninstall: could not erase the AI engine keys: your keyring is locked. Unlock it (for example in Passwords and Keys), then run this again. Saved settings were not erased.
uninstall: could not reach your keyring to erase the AI engine keys. Run this from a terminal inside your GNOME session. Saved settings were not erased.
```

The existing "could not erase /org/gnome/shell/extensions/payattention/…" failure is unchanged. It can now come after `Erased: AI engine keys from your keyring.` was printed, which is true at that point.

**Misuse designed out:**
- The keyring program gets the schema name from a constant in the script, never from input, and passes empty attributes. It cannot clear another schema.
- It never passes `LOAD_SECRETS` and never prints anything but one word. No secret can reach the output.
- The `GSETTINGS_BACKEND` guard of PG-3 still runs during argument parsing, before anything changes. So a refused `--purge` also leaves the keyring untouched.

### `tests/ai/gjs/keyring.js` — two new commands (test support, PG-4b's file)

```
gjs -m tests/ai/gjs/keyring.js store-other <endpoint> <key>
    stores an item under schema 'org.example.payattention-test.Other' with the same one
    attribute 'endpoint' = <endpoint>; prints 'KEYRING OK'
gjs -m tests/ai/gjs/keyring.js count
    prints 'KEYRING COUNT <ours> <other>': the number of items of ENGINE_KEY_SCHEMA and of the
    Other schema, from Service.search_sync(schema, {}, Secret.SearchFlags.ALL) (locked items
    included, secrets never loaded)
```

Existing `store` and `lock` are unchanged. The exit behaviour is the same as the file's existing commands.

## Steps

Every step is a feature step. There is no repair: the script and its check have no drift, and PG-3's checks already pin today's behaviour. Land Step 1 and Step 2 as separate commits.

### Step 1 — A throwaway keyring in the uninstall check, and the plain uninstall says what it keeps  [feature]

- **Test first,** in `tests/smoke/uninstall-check.sh` (inner part):
  - **Right after the isolation assertions** (before `# 2.`):
    ```bash
    # 0. A throwaway keyring, unlocked, before anything can D-Bus-activate one (PG-4b fact 3).
    command -v gnome-keyring-daemon >/dev/null || fail 0-keyring "gnome-keyring-daemon is not installed"
    printf '%s' payattention-test-unlock | gnome-keyring-daemon --unlock --components=secrets --daemonize >/dev/null \
        || fail 0-keyring "could not start a throwaway keyring"
    KEYRING="$ROOT/tests/ai/gjs/keyring.js"
    KEY1="pa-test-key-$RANDOM$RANDOM$RANDOM"
    KEY2="pa-test-key-$RANDOM$RANDOM$RANDOM"
    KEY3="pa-test-key-$RANDOM$RANDOM$RANDOM"
    # keys <ours> <other>: the keyring holds exactly that many of our items and of the other schema.
    keys() { [ "$(gjs -m "$KEYRING" count)" = "KEYRING COUNT $1 $2" ]; }
    ```
    The phrase is the same non-secret constant as PG-4b's `UNLOCK_PHRASE`. The keys are throwaway values, never real.
    - A missing daemon **fails** the check rather than skipping it. A skipped purge check would be a false green on the one machine where it matters.
    - Keep the existing `fail` label style.
  - **In `2-install`,** after the existing `dconf write` seeds:
    - `dconf write "$KEYS/ai-verdicts" "'{\"v\":1,\"items\":{}}'"`;
    - `gjs -m "$KEYRING" store https://engine.example.test/v1 "$KEY1"`;
    - `gjs -m "$KEYRING" store http://127.0.0.1:11434/v1 "$KEY2"`;
    - `gjs -m "$KEYRING" store-other https://engine.example.test/v1 "$KEY3"`;
    - each `|| fail 2-install "could not seed …"`;
    - then `keys 2 1 || fail 2-install "keyring seed count is wrong"`;
    - and `[ -d "$XDG_DATA_HOME/keyrings" ] || fail 0-keyring "the keyring is not in the throwaway home"`. This proves isolation.
  - **In `2-uninstall`,** add:
    - `keys 2 1 || fail 2-uninstall "a plain uninstall changed the keyring"`;
    - `[ -n "$(dconf read "$KEYS/ai-verdicts")" ] || fail 2-uninstall "ai-verdicts was not kept"`;
    - `contains "Kept: saved settings and AI answers" || fail 2-uninstall "no 'Kept: saved settings and AI answers' line"`;
    - `contains "Kept: AI engine keys in your keyring" || fail 2-uninstall "no 'Kept: AI engine keys' line"`.
  - **Everywhere `$out` is checked, add one guard** in a helper `no_keys_in_output() { ! contains "$KEY1" && ! contains "$KEY2" && ! contains "$KEY3"; }`. Call it after every `uninstall` / `uninstall_stubbed` call in the file, as `no_keys_in_output || fail <that case's label> "a key appeared in the output"`.

  It fails first on the two new `contains` lines.
- **Then, in `scripts/uninstall.sh`,** step e, without `--purge`: replace the one `Kept:` line with the two lines of the Seams section. Update the header comment: "Saved settings (including the stored AI answers) and any AI engine keys in the keyring are kept unless --purge is given, which erases /org/gnome/shell/extensions/payattention/ and the keyring items of payAttention's own key schema, and nothing else."
- **Why here:** D-016 and the spec both require the plain uninstall to *say* it kept them.
- **Behaviour change:** a plain uninstall prints one changed line and one new line. Nothing else changes.

### Step 2 — `--purge` erases the keys (first), then the settings  [feature]

- **Test first,** in `tests/ai/gjs/keyring.js`: add `store-other` and `count` as the Seams section says. Then, in `tests/smoke/uninstall-check.sh`:
  - **`3-purge-refused`:** add `keys 2 1 || fail 3-purge-refused "the keyring changed"`.
  - **`3-purge`:** add:
    - `keys 0 1 || fail 3-purge "our keys were not all erased, or another schema's item was"`;
    - `contains "Erased: AI engine keys from your keyring." || fail 3-purge "no 'Erased: AI engine keys' line"`;
    - `contains "Erased: saved settings and AI answers" || fail 3-purge "no 'Erased: saved settings and AI answers' line"`;
    - check the order: the line number of `Erased: AI engine keys` is lower than that of `Erased: saved settings` (`grep -nF`), or `fail 3-purge "keys must be erased before settings"`.

    The existing `dconf dump` emptiness check already proves `ai-verdicts` is gone.
  - **`3-purge-again`:** add `contains "Erased: AI engine keys from your keyring."` and `keys 0 1`.
  - **`4-purge-failed`** (the existing dconf-reset stub): the keyring step now runs first and succeeds. So change its `! contains "Erased:"` to `! contains "Erased: saved settings"`, and add `contains "Erased: AI engine keys from your keyring."`. Everything else in that case is unchanged.
  - **New case `4-keyring-unreachable`,** after `4-purge-failed`:
    ```bash
    reinstall 4-keyring-unreachable
    gjs -m "$KEYRING" store https://engine.example.test/v1 "$KEY1" >/dev/null || fail 4-keyring-unreachable "could not seed"
    REAL_GJS="$(command -v gjs)"
    stub keyring-unreachable gjs "case \"\$*\" in *Secret*) exit 1 ;; esac; exec '$REAL_GJS' \"\$@\""
    uninstall_stubbed keyring-unreachable --purge
    ```
    Then:
    - `[ "$status" -eq 1 ]`;
    - `contains "could not reach your keyring to erase the AI engine keys"`;
    - `contains "Saved settings were not erased."`;
    - `[ "$(dconf read "$KEYS/snooze-minutes")" = 5 ]` (the settings are kept);
    - `! contains "Erased:"`;
    - `keys 1 1`.

    The stub fails only the gjs run whose program mentions `Secret`, so the list step (also gjs) still works. This is the same technique as the existing `dconf` stub.
  - **New case `4-keyring-locked`,** the **last** case in the file (the keyring stays locked afterwards):
    - `reinstall 4-keyring-locked`;
    - store `KEY1` again, so our count is 1 before the lock (the previous case left 1; store is a replace, so it stays 1);
    - `gjs -m "$KEYRING" lock`, then `uninstall --purge`.

    Then:
    - `[ "$status" -eq 1 ]`;
    - `contains "your keyring is locked"` and `contains "Saved settings were not erased."`;
    - snooze-minutes is still 5;
    - `! contains "Erased:"`;
    - `keys 1 1`.

    This case runs with no stub at all: it proves fact 2 through the real script.

  Before the change, `3-purge` fails on `keys 0 1`.
- **Then, in `scripts/uninstall.sh`:**
  - Next to `SETTINGS_PATH`, add:
    ```bash
    # The libsecret schema of the AI engine keys: ENGINE_KEY_SCHEMA_NAME in extension/core/aiEngine.js (ADR-0009).
    # A shell script cannot import it; tests/smoke/uninstall-check.sh proves the two agree.
    KEY_SCHEMA=org.gnome.shell.extensions.payattention.EngineKey
    ```
  - In step e, with `--purge`, **before** the existing `dconf reset` block:
    ```bash
    keyring="$(gjs -c "imports.gi.versions.Secret = '1'; const {Secret} = imports.gi;
      const schema = new Secret.Schema('$KEY_SCHEMA', Secret.SchemaFlags.NONE, {endpoint: Secret.SchemaAttributeType.STRING});
      const service = Secret.Service.get_sync(Secret.ServiceFlags.NONE, null);
      Secret.password_clear_sync(schema, {}, null);
      print(service.search_sync(schema, {}, Secret.SearchFlags.ALL, null).length === 0 ? 'cleared' : 'locked');" 2>/dev/null)" \
        || keyring=''
    case "$keyring" in
        cleared) echo "Erased: AI engine keys from your keyring." ;;
        locked) die "could not erase the AI engine keys: your keyring is locked. Unlock it (for example in Passwords and Keys), then run this again. Saved settings were not erased." ;;
        *) die "could not reach your keyring to erase the AI engine keys. Run this from a terminal inside your GNOME session. Saved settings were not erased." ;;
    esac
    ```
    - This is exactly the measured program (facts 1 to 3). Do not add `LOAD_SECRETS` or `UNLOCK`, and do not print anything else.
    - `2>/dev/null` hides libsecret's own messages. They carry no secret, but the output contract is one line per outcome.
    - In a real session, `password_clear_sync` on a locked keyring may show the desktop's unlock prompt. The owner ran the command, so that prompt is expected. Whatever the owner answers, the second search decides the outcome.
  - Then change the settings success line to `Erased: saved settings and AI answers ($SETTINGS_PATH).`. The `dconf reset` and its check are otherwise unchanged.
- **Why here:** the same one command erases everything the extension stored (D-016). The order is Decision 2.
- **Behaviour change:** `--purge` also erases our keyring items, and only those. It fails, without erasing settings, when the keyring is locked or cannot be reached.

### Step 3 — README  [feature, docs]

In `README.md`, `## Uninstall`:
- The code block's second comment becomes `# also erase overrides, travel times, settings, AI answers and AI keys`.
- Add, after the paragraph that begins "If payAttention is running":
  - "A plain uninstall keeps your stored AI answers, and any AI engine keys in your keyring, and says so. `--purge` erases both, and only payAttention's own keys: nothing else in your keyring is touched."
  - "If your keyring is locked, `--purge` stops before erasing anything else, and asks you to unlock it and run it again."

**Behaviour change:** documentation only.

### Step 4 — Findings for the architect  [docs]

Append to `docs/inbox.md` (do not edit `docs/architecture/`):

```
## 2026-09-27 — for-architecture — PG-4e uninstall --purge and the keyring
- Measured: Secret.password_clear on a locked collection returns false with no error and removes nothing. uninstall.sh therefore searches again after clearing and fails (exit 1, "your keyring is locked … Saved settings were not erased.") when any item of the schema remains.
- --purge clears keys first, then settings, so a locked keyring leaves both in place. An unreachable Secret Service also fails --purge (the script cannot tell "none" from "unreachable").
- The plain uninstall never calls the keyring; it prints a fixed "Kept: AI engine keys in your keyring, if you saved any" line.
- The key schema name is repeated in scripts/uninstall.sh (a shell script cannot import core). tests/smoke/uninstall-check.sh seeds items with core's constant (tests/ai/gjs/keyring.js), so a drift fails the smoke. testing-and-build.md's uninstall check paragraph could mention the throwaway keyring it now starts.
```

## Validation

In order: `npm run lint`, `npm test`, `npm run build`, `npm run test:helper`, `npm run smoke`. The smoke must print `PAYATTENTION-UNINSTALL PASS` and `PAYATTENTION-SMOKE PASS`. Report the real output.

**Never run `npm run uninstall:local` or `scripts/uninstall.sh`, with or without `--purge`, outside the test environment.** A `--purge` on the real session would erase the owner's real keys and settings.

## Callers to update

- **`scripts/uninstall.sh` output lines** (a contract read by tests and by the owner):
  - `tests/smoke/uninstall-check.sh` checks `Kept: saved settings` and `Erased: saved settings` as substrings; they still match, and the checks above add the new lines;
  - `tests/smoke/alert-ladder.js` step 9 checks only `Stopped: payAttention in the running session.` and exit 0. It runs a plain uninstall, which makes no keyring call, so it is unaffected;
  - `README.md` (Step 3).
- **Exit codes:** unchanged meanings. Exit 1 gains two causes, both "a step failed".
- **`tests/ai/gjs/keyring.js`:** two new commands. Its existing callers (`tests/ai/session.js`, PG-4b) use only `store` and `lock`, which are unchanged.
- **Nothing under `extension/` changes.** No external callers.

## Out of scope

- Anything under `extension/`, including prefs' key handling (PG-4d) and the helper's key reading (PG-4b).
- Clearing keys stored under any other schema, or by endpoint. Listing, counting or printing keys in the output.
- A keyring step in a plain uninstall.
- Unlocking the keyring from the script (beyond the desktop's own prompt), and retrying.
- Changing the order of steps a to d, the `GSETTINGS_BACKEND` guard, or the list handling from PG-3.
- `docs/architecture/`, `docs/product/`, `BACKLOG.md`: findings go through `docs/inbox.md` only.

## Stop and escalate if

- `password_clear_sync(schema, {}, null)` removes any item of another schema, or fails to remove an unlocked item of ours, in the check (facts 1 and 4 say it does neither).
- Any test step would need the owner's real bus, `HOME`, `XDG_DATA_HOME` or keyring. Also stop if `$XDG_DATA_HOME/keyrings` is not under the throwaway home after seeding.
- `gnome-keyring-daemon --unlock … --daemonize` inside the uninstall check does not give an unlocked default collection, or the first `store` shows a prompt or hangs.
- A key value appears in any uninstall output.
- Making the check pass seems to need `secret-tool` or any tool beyond `gjs`, `gsettings`, `dconf`, `gnome-extensions` and, for the test only, `gnome-keyring-daemon`.
- PG-4b's `tests/ai/gjs/keyring.js` does not exist, or does not import its schema from core, since the drift guard of Decision 5 depends on it.
