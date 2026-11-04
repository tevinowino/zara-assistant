# ADR 0003: The assistant uses Gemma through OpenRouter

Status: superseded by [ADR 0004](0004-bring-your-own-ai-service.md), 2026-11-01

## Decision

Zara's model is **Google Gemma 4 31B** (`google/gemma-4-31b-it`), reached through
**OpenRouter**'s OpenAI-compatible chat-completions API. It replaces the Gemini
REST API the first build used.

- **Why this model:** the owner asked for Gemma. It is inexpensive, has a 262k
  token context and accepts images, so "look at my screen" keeps working. The
  `:free` variants of the same model are rate-limited too hard for daily use.
- **Where the key lives:** Windows Credential Manager, account
  `openrouter-api-key`. The old `gemini-api-key` entry is ignored on purpose: a
  Google key must never be sent to OpenRouter.
- **Voice input is removed.** Gemma reads text, images and video, not audio, so
  the microphone button, the recorder, the WAV encoder and the `ai_transcribe`
  command were deleted in the design pass (`docs/design-pass.md`) rather than
  left as a switched-off feature. They are in the git history (commit before
  "design pass") if an audio-capable model is ever chosen.
- **Replies:** only `message.content` is read. `message.reasoning` is the model's
  scratch work and is ignored. An `error` object inside an HTTP 200 (an upstream
  provider failing after OpenRouter accepted the request) is handled like the
  matching HTTP error and retried when transient.

## Consequences

- Zara's persona changed with the model: answers lead with the answer and no
  longer follow the Electron original's "problem statement, context, reasoning,
  next steps" template (see `docs/design-pass.md`).
- The model is still a constant. Choosing a model in Settings is not built.
- Requests go through a third party. OpenRouter forwards them to a hosting
  provider for Gemma, so the privacy statement now names `openrouter.ai`; see
  `docs/privacy.md`.
- Cost is per token on the owner's OpenRouter account. An empty balance shows as
  "out of credits" (HTTP 402), not as a rejected key.
