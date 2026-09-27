# Stack

Every technology in use and why. Build-vs-adopt calls are at the bottom.

| Technology | Used for | Why this one |
|---|---|---|
| GNOME Shell 50 extension API (ESM) | The product (R-1) | The product is a GNOME extension by definition; ESM is the only form GNOME 45+ loads. |
| St, Clutter, Meta, Shell (in-shell) | Indicator, cards, takeover, idle monitor, modal grab | The only way to draw above windows on Wayland from an extension. |
| evolution-data-server 3.60 via GI: `ECal-2.0`, `EDataServer-1.2`, `ICalGLib-3.0` | Calendar data, in the helper only | The same service the clock menu reads, so "every calendar shown in the clock menu" (R-2) holds with no login. The only local source with attendees, participation, organiser, transparency and conference data (ADR-0001). |
| `gjs -m` subprocess + NDJSON over stdio | Helper transport | Isolates EDS from the shell with no bus name, no D-Bus XML, and a lifetime tied to a pipe (ADR-0001). |
| GSettings (dconf) | All durable state | Atomic writes, change signals, shared with prefs, visible to `dconf dump` (ADR-0003). |
| GTK 4 + libadwaita | `prefs.js` | What the shell's preferences host provides. |
| `Gio.AppInfo.launch_default_for_uri_async` | "Join" | Opens the owner's default browser or meeting app; no network code of ours. |
| libsoup 3.6 (`gi://Soup?version=3.0`), in the AI helper only | HTTP to the AI engine (R-18) | Part of GNOME; async; honours the desktop's proxy settings, except that loopback endpoints are always reached directly (`interfaces.md` §6.7); verifies TLS. Imports from gjs (measured 2026-09-26). gjs has no `fetch` (measured) (ADR-0007). |
| OpenAI Chat Completions protocol | The one wire format to every AI engine | Served by Ollama, llama.cpp, vLLM, LM Studio, OpenAI, OpenRouter, Groq, Mistral, Gemini (compat path), Anthropic (compat endpoint), and LiteLLM Proxy (ADR-0007). |
| libsecret 0.21.8 (`gi://Secret`) + gnome-keyring | AI engine keys (R-19) | Encrypted, unlocked at login, already running (`org.freedesktop.secrets`, measured). Written by prefs, read by the AI helper (ADR-0009). |
| Node 24, `node:test`, `node:assert` | Unit tests of `core/` (dev only) | Present on the machine; zero dependencies; runs the ESM core unchanged (ADR-0002). |
| ESLint (flat config) + `globals` | Lint, and enforcing import boundaries (dev only) | The GNOME project lints gjs with ESLint; `no-restricted-imports` makes boundaries mechanical. Installed from npm into `node_modules/`, never packed. |
| `gnome-extensions pack` / `install` | Build and local install | Official tool. `install` compiles the schemas into the install directory (verified). |
| `gnome-shell --headless --virtual-monitor … --automation-script` | Smoke tests in an isolated shell | Verified working on this machine, including two virtual monitors. No devkit package needed. |

## Build, adopt, or extend

- **Calendar access — adopt EDS.** Alternatives: Google/Microsoft APIs directly
  (network code, a second login, breaks R-2 and the spirit of R-3); parsing EDS's
  on-disk cache (private, unversioned format); the shell's `CalendarServer`
  (too few fields — see ADR-0001). EDS is the maintained system service that
  already holds exactly this data.
- **Verdicts, ladder, UI — build.** This is the product's differentiating logic.
  No GNOME extension found does importance judgment plus escalation (product
  decision D-002). Existing reminder extensions (Calendar Reminders, Next Meeting,
  Chronome) use the notification tray, which we must avoid for R-12.
- **iCalendar parsing — adopt libical through EDS.** Recurrence expansion and time
  zones are handled by `ECal.Client.generate_instances_sync`; we write none of it.
- **Test runner — adopt Node's built-in runner.** No gjs test framework is needed
  because core has no GNOME imports. Jasmine-gjs was not needed.
- **LLM access: build a thin client, do not adopt a library (ADR-0007).**
  Candidates weighed: the Vercel AI SDK and LangChain.js, which need Node (not
  in the GNOME session) or a gjs port with `fetch` and web-stream polyfills; and
  LiteLLM, which needs a pip-installed Python venv of about 100 MB (assumed),
  with explicit user action required by review, and a March 2026 PyPI
  compromise that stole API keys. The engines already share one protocol, and
  we need one request per meeting. An owner who wants a library's provider
  range runs LiteLLM Proxy themselves and enters its address as the endpoint.
  The owner accepted this as D-021 (2026-09-27).
- **AI engines verified first** (research only; nothing installed on
  2026-09-26):
  - Local: **Ollama** at `http://127.0.0.1:11434/v1`. It is installable
    without root: the official tarball into a user directory, or the
    `docker.io/ollama/ollama` image under rootless podman (podman and
    `nvidia-container-toolkit` 1.20.1 are present). It honours `response_format`
    `json_schema` on its OpenAI path (Ollama docs). The second local engine is
    llama.cpp `llama-server`, which speaks the same protocol. Model: an 8B-class
    instruct model at 4-bit, for example Qwen3 8B or Llama 3.1 8B (assumed to
    fit in 16 GB of VRAM, and to answer on CPU in about 5–20 s, not measured).
  - Cloud: **OpenAI**, whose protocol this is, with `json_schema` enforced; and
    **OpenRouter**, where one key reaches Anthropic, Google and others through
    the same protocol. Anthropic direct (the `https://api.anthropic.com/v1/`
    compat endpoint) works as an endpoint, but best effort: it ignores
    `response_format` and Anthropic calls it a testing aid. Core's reply
    validator makes it safe, not guaranteed.
