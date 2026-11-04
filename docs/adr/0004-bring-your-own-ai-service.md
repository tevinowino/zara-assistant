# ADR 0004: The user chooses the AI service and model

Status: accepted, 2026-11-01. Supersedes [ADR 0003](0003-gemma-through-openrouter.md).

## Decision

Zara no longer has one built-in AI provider. In Settings > Assistant the user picks
a service, a model and an optional fallback model, and gives their own API key.

- **Services:** OpenRouter (still the default, with Gemma 4 31B as its default model),
  OpenAI, Anthropic, Google (Gemini API), NVIDIA, Groq, Mistral, xAI, DeepSeek,
  Ollama on this PC, and a custom OpenAI-compatible address. The list lives in
  `src-tauri/src/ai/providers.rs`.
- **Two clients, not eleven:** nearly every service speaks the OpenAI "chat
  completions" dialect, so one client (`ChatCompletionsClient`) covers them, with a
  different address and key each. Google is reached through its OpenAI-compatible
  endpoint. Anthropic's Messages API is a different format and has its own client
  (`anthropic.rs`). Both share one transport (retries, idle timeout, streaming).
- **Per service, not global:** each service has its own key (its own Credential
  Manager account, so a key is only ever sent to the service it belongs to), its own
  model, its own fallback model and, for custom and local servers, its own address.
  Switching service and back loses nothing. The OpenRouter key keeps the account the
  first build used, so an existing key still works.
- **Fallback model:** when the main model fails in a way another model might get
  past (overloaded, rate limited, unavailable, declined, empty reply, timeout), the
  same request goes to the fallback model, which may be on another service (with that
  service's own key; without one it is left out rather than failing the main model). A rejected key or an
  empty balance is reported as it is. A streamed reply that already showed text never
  switches model, which would append a second answer.
- **Model lists:** "Load available models" asks the service for its list
  (`GET {base}/models`) to fill the picker's suggestions. Anything can still be typed.
- **Web search works with OpenRouter and Google.** OpenRouter does it through its
  `web` plugin; Google through Grounding with Google Search, the `google_search` tool
  of the Gemini API, whose answers end with the pages it drew on. Other services have
  their own search tools in different shapes, so for them the switch is off with a
  reason, and the model is never told it can search.
- **Google has its own client.** The compatible endpoint has no way to switch Google
  Search on for chat, so Google is spoken to through `generateContent` (system text as
  `systemInstruction`, images as `inline_data`, the key in `x-goog-api-key`). Gemini
  and Gemma models use the same client.
- **Model settings are one table.** `tuning.rs` describes each setting once (name, the
  values each model accepts, and where it goes in that service's request: OpenRouter's
  `reasoning.effort`, Claude's `output_config.effort` and `thinking`, Gemini's
  `generationConfig.thinkingConfig`, Groq's `reasoning_effort` and `reasoning_format`,
  and so on). The settings screen and the request are both built from it, so they
  cannot disagree. Settings are kept per model, nothing is sent unless it was chosen,
  and an "extra request fields" JSON box covers anything the table does not list.
- **The chat can switch model and thinking.** Beside the send button, a model chip
  (any ready service, searchable) and a thinking chip (the model's main effort or
  level, plus a Fast preset) write the same settings as Settings, so nobody has to
  leave the conversation to change them. A question that just failed is asked again
  of the model chosen.
- **Custom and local addresses** must be `https://`, or `http://` only to this
  computer, and may not carry a password. A key is only sent to the address the user
  typed.

## Why not Gemma directly from Google

Looked at before this decision, 2026-11-01. Gemma 4 (`gemma-4-31b-it`,
`gemma-4-26b-a4b-it`) is on the Gemini API with system instructions, image input and
function calling. Two things made it a poor *only* choice:

- Google's pricing page lists Grounding with Google Search as not available for Gemma
  on either tier, while the Gemma-on-Gemini-API page lists Google Search grounding as
  supported. Zara sends the tool for Gemma as for Gemini; if Google refuses it for a
  Gemma model, the search step reports the error instead of answering without it.
- The free tier's content "may be used to improve Google's products", and its terms say
  not to submit sensitive or personal information. Paid Gemma is not offered.

Google stays available as one option among many, for users who want it.

## Consequences

- Error messages no longer name OpenRouter; they say "the AI service".
- Each service's behaviour with images, long replies and system prompts differs. A
  model that cannot read images fails the "look at my screen" step with the service's
  own error.
- Suggested model ids are starting points and will go stale; the model list loader and
  free typing are the real mechanism.
- Cost, rate limits and data handling now depend on which service the user picks.
