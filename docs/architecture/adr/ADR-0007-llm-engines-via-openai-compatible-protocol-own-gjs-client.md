# ADR-0007 — LLM engines are reached through the OpenAI-compatible protocol, with our own small gjs client, not a bundled abstraction library
- **Date:** 2026-09-26
- **Kind:** reversible (behind the AI helper protocol in `interfaces.md` §6)

## Context

Product decision D-017 adds an optional AI second opinion on the verdicts the
rules are unsure of (R-18), and lets the owner choose whether the engine runs on
their own machine or network, or in a cloud service (R-19). The owner's words:
"you should use a llm abstraction library, so that the user can decide to use a
cloud-hosted or internally hosted llm engine". The aim behind the request is
clear: the owner can choose any engine, local or cloud, and switch between them.
A library is one way to get there.

Forces, measured on the owner's machine on 2026-09-26 unless marked:

1. **The runtime is gjs.** The shell, the calendar helper and `prefs.js` all
   run on gjs 1.88. gjs has no `fetch` and no `AbortController`: `typeof fetch`
   gives `undefined` (measured). It does have libsoup 3.6 (`gi://Soup?version=3.0`)
   and libsecret 0.21.8 (`gi://Secret`). Both import from gjs (measured).
2. **Node is not part of the product.** Node 24 exists only through nvm in the
   owner's interactive shell (`~/.nvm/versions/node/v24.11.1/bin`). It is not
   on the PATH of a GNOME session, and it is a dev dependency only (`stack.md`).
3. **Python 3.14 is present. LiteLLM is not.** It would need a `pip install`
   into a venv, with about 100 MB of dependencies (assumed: openai, pydantic,
   aiohttp, tiktoken, tokenizers and others).
4. **The GNOME review rules** (gjs.guide, fetched 2026-09-26) say: "Use of
   external scripts and binaries is strongly discouraged." Scripts should be
   in GJS unless absolutely necessary. Python modules and other dependencies
   "MUST require explicit user action". JavaScript "must not be minified or
   obfuscated". Submissions with "large amounts of unnecessary code" are
   rejected.
5. **Supply chain.** LiteLLM 1.82.7 and 1.82.8 on PyPI were compromised on
   2026-03-24. The payload stole credentials, including LLM API keys, and ran on
   every Python start in the affected environment
   (https://docs.litellm.ai/blog/security-update-march-2026, GitHub
   BerriAI/litellm#24518). The official LiteLLM Proxy container, which pins its
   dependencies, was not affected. A process that holds the owner's API key is
   exactly what such a payload targets.
6. **One wire protocol covers almost every engine.** The OpenAI Chat
   Completions protocol (`POST <base>/chat/completions`) is served by Ollama,
   llama.cpp `llama-server`, vLLM and LM Studio on the local side. On the cloud
   side it is served by OpenAI, OpenRouter, Groq, Mistral, Google Gemini (at
   its OpenAI-compatible path) and Anthropic (at its OpenAI SDK compatibility
   endpoint). It is also served by LiteLLM Proxy, the abstraction library the
   owner had in mind, run as a gateway. Two known gaps: Anthropic's compatibility
   endpoint ignores `response_format` and is described as intended for testing
   (Claude docs, "OpenAI SDK compatibility"). Some local servers accept
   `response_format` without enforcing it (Ollama issue #10001).
7. **What we need from an engine is tiny.** It is one request with about 10
   short facts, and one reply holding a verdict and a line of text. There is no
   streaming, no tools, no conversation, no embeddings and no images. An
   abstraction library's value (streaming, tool calls, many native wire formats,
   retries, cost tracking) goes almost entirely unused.

## Options

1. **A JS library (Vercel AI SDK, LangChain.js) running in Node.** Forever
   cost: a Node runtime the session does not have (force 2). We would either
   ship Node, which is a binary and is forbidden, or require it, which means
   explicit user action and one more thing to install. Hundreds of files from
   `node_modules` would have to go into the zip or be fetched at install time.
   The reviewers flag "large amounts of unnecessary code".
2. **The same JS library bundled to run under gjs.** Forever cost: polyfills for
   `fetch`, web streams, `AbortController` and `TextDecoderStream` on top of
   Soup. We would be porting a library to a runtime it does not support, and a
   bundle must stay readable (force 4). Every library upgrade could break it.
3. **A Python library (LiteLLM, or `any-llm`) in a separate process.**
   Forever cost: a venv created by an explicit install step (force 4), about
   100 MB of dependencies, a second language with its own test tooling, a
   Python 3.14 compatibility risk, startup cost, and supply-chain exposure in
   the very process that holds the API key (force 5). The "install one
   extension, nothing else" promise (R-1) breaks for AI users.
4. **Speak the OpenAI-compatible protocol directly, with our own small client
   in a gjs subprocess over libsoup 3.** Forever cost: we own about one
   request builder and one reply parser. Engines that do not speak the
   protocol, or speak it badly, need either a gateway or an adapter of ours.
5. **Option 4, plus native adapters (Anthropic Messages, Gemini) from day
   one.** Forever cost: two or three wire formats to keep current before
   anyone needs them.

## Decision

**Option 4.** The AI helper (ADR-0008) holds one small client for the OpenAI
Chat Completions protocol, written in gjs on libsoup 3. The owner configures a
base URL and a model name. Prefs offers presets that fill in the base URL for
known engines. The deciding reason: **no LLM abstraction library can run in
the runtime GNOME gives us without shipping or installing a second language
runtime. The protocol those libraries translate to is already the common
interface of the engines the owner named.** A library would add a runtime, a
large dependency tree and supply-chain risk next to the API key, and it would
buy almost nothing for one request.

**This is not what the owner literally asked for, and the report says so.**
The owner's goal (cloud or internal, their choice, switchable) is met by
configuration: any base URL, any model. The literal request (a library) is met
at the owner's option, not ours. An owner who wants LiteLLM's 100+ providers
runs LiteLLM Proxy (its pinned container image) and enters its address as a
"custom" engine. That keeps the library outside the extension, where installing
it is the owner's explicit action (force 4).

Rules that come with it:

- **The reply is never trusted to follow the schema.** The request asks for
  JSON, with `response_format` of type `json_schema` where the engine honours
  it, and the prompt says the same. Every reply is then parsed and validated by
  core's reply validator (`interfaces.md` §6), whatever the engine promised.
  This is what makes engines that ignore `response_format` (force 6) safe to
  use.
- **The seam for a second wire format is the helper's client, not the
  protocol.** If a native adapter is ever needed (Anthropic Messages, for
  example), it goes inside the AI helper, chosen by a preset. The shell,
  `judge` and the stored data do not change.

## Consequences

- Easier: nothing to install for AI beyond the engine itself. The zip stays
  pure, readable gjs. The same client serves the local and the cloud case. The
  key never enters a third-party package. Tests need only a fake HTTP server
  that speaks one protocol (`testing-and-build.md`).
- Harder: we own the request shape, error mapping (HTTP status to short codes)
  and timeouts. Anthropic direct runs on a compatibility endpoint that Anthropic
  itself calls a testing aid. OpenRouter or LiteLLM Proxy are the stable routes
  to Claude until a native adapter exists.
- We can no longer claim "uses an LLM abstraction library". The owner is told
  so, and can overrule this by a new decision (see Revisit).

## Revisit when

- The owner requires an engine that neither speaks the OpenAI-compatible
  protocol nor is reachable through a gateway, or
- the owner explicitly accepts a Python or Node runtime as an installed
  prerequisite for AI (then option 3, in its own process, under ADR-0008's
  protocol, replaces only the client), or
- gjs gains `fetch` and web streams, so a JS library could run unmodified.
