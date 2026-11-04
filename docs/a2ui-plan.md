# Plan: A2UI (Agent-to-User Interface) in Zara's assistant

Date: 2026-11-01. Status: **Phases 1 to 3 are built, tested and wired into the notch; Phase 0 and Phase 4 are not done.** See 'What was built' at the end.

## What A2UI is

An open protocol from Google (Apache 2.0, github.com/a2ui-project/a2ui, site a2ui.org) that lets an AI agent describe an interface as **data**, which the client draws with its own native components. The agent never sends code. It can only use components from a **catalog** the client has approved, which is its defence against UI injection.

Current production spec is **v0.9.1**; a **v1.0 candidate** exists (adds `actionResponse` and action IDs, renames `theme`). The npm packages are versioned separately (`@a2ui/react` 0.14.0). The v1.0 timeline I found in a third-party guide (Q4 2026) is unverified.

### The protocol in five lines

| Concept | v0.9 detail |
|---|---|
| Messages | One JSON object per line (JSONL), each with `"version":"v0.9"` and exactly one of `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface` |
| Surface | A named UI region. `createSurface` fixes its `surfaceId` and `catalogId` for life |
| Components | A **flat list** with ids, `{"id","component":"Column","children":["a","b"]}`, one of them `root`. Containers reference children by id (adjacency list), so a model can stream them out of order and the client buffers until `root` exists |
| Data model | Separate JSON document, addressed by JSON Pointer (`/order/id`). Components bind with `{"path":"/order/id"}`, or `formatString` with `${/order/id}`. Layout and data update independently |
| Interaction | Buttons carry an `action`: **`event`** (sent back to the agent as `{name, surfaceId, sourceComponentId, timestamp, context}`) or **`functionCall`** (a named, catalog-defined function run locally, e.g. `openUrl`). Inputs (TextField, CheckBox, ChoicePicker, Slider, DateTimeInput) bind two-way to the data model and only reach the agent when an action fires |

The basic catalog has: Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs, Divider, Modal, Button, CheckBox, TextField, DateTimeInput, ChoicePicker, Slider; and functions `formatString/Number/Currency/Date`, `pluralize`, validators (`required`, `regex`, `length`, `numeric`, `email`), `and/or/not`, `openUrl`. Custom catalogs are first-class.

## Zara already has the seed of this

`src/ai/protocol` is a small A2UI-like system:

| Zara today | A2UI equivalent |
|---|---|
| Model writes a ```` ```zara:table ```` fence with JSON | An agent emits a surface |
| `BLOCK_CONTRACTS` (Zod schema + prompt doc per widget) | A catalog |
| `buildBlockCatalog()` feeds the system prompt, with a drift test | Catalog advertised to the agent |
| `BLOCK_REGISTRY` renderers, total mapped type | Client renderer |
| `BlockErrorBoundary` + `BlockFallback` | Graceful degradation |
| Restraint gate: "most replies have zero blocks" | (Zara's own, and worth keeping) |

What is missing is exactly what A2UI adds:

1. **Composition.** Five fixed widgets, no layout. A2UI gives Row, Column, Card, List and Tabs, so the model can build a result card instead of choosing one of five shapes.
2. **Interaction.** Every block is display-only. A2UI has buttons and inputs.
3. **Data separate from layout**, so a surface can be updated without re-sending it.
4. **A standard envelope**, instead of a private format.

## The idea that matters for a desktop notch

A2UI's `functionCall` actions let a reply contain **buttons that act on the notch itself**, with no model round trip: "Start 25 min timer", "Open calendar", "Copy", "Open link", "Save as note". The model proposes; Zara's catalog decides what is allowed to run, and only on a user click. That is the real payoff here. Rendering prettier cards is secondary.

## Decision: A2UI-shaped, not the A2UI packages

| Option | Verdict |
|---|---|
| **A. Adopt `@a2ui/react` wholesale** | **No.** `@a2ui/react` pulls `@a2ui/web_core`, which is 7.7 MB unpacked and drags in Lit and signals libraries; the notch is a 460 px panel that currently lazy-loads even Mermaid. The packages are pre-1.0 and the protocol has a 1.0 candidate, so churn is likely. Its components would also need restyling to the notch's black and white. We would rewrite the renderer anyway |
| **B. Speak the A2UI v0.9 envelope, own catalog and renderer** | **Recommended.** Keep our fence mechanism, validate with Zod (already a dependency, `^3.25.76`, the same range A2UI's packages want), render with our own monochrome components. We keep the standard's concepts and message shapes without its weight, and can swap in `@a2ui/react` later if it matures |
| **C. Leave as is** | Cheapest, but gives up interaction, which is the actual win |

Phase 0 still checks whether `web_core` has a small reusable data-model piece worth borrowing. I expect not; the pieces we need (JSON Pointer read and write, `formatString`) are about 150 lines.

## Design

### Where it sits (C4 level 3, inside the notch window)

```
Rust backend (src-tauri/src/ai)
   protocol.rs  -- system prompt: persona + format rules + catalog doc
   chat.rs / llm.rs -- unchanged transport: whole reply as text
        |  reply text (markdown + ```a2ui fences, JSONL inside)
        v
src/ai/a2ui/   (new)
   envelope.ts     Zod schemas for the four v0.9 messages (the subset we support)
   surface.ts      pure: apply messages -> { components, dataModel }, buffer until root
   binding.ts      pure: JSON Pointer get/set, {path} and formatString resolution
   catalog/        Zara catalog: component contracts (Zod + prompt doc), same pattern as blocks
   actions.ts      NotchActions interface + allow-listed function table
   A2uiSurface.tsx renderer, one component per catalog entry, monochrome
        ^
src/ai/protocol/parse.ts   gains a "surface" segment kind
src/App.tsx                provides NotchActions (timer, panel switch) via React context
```

Dependency inversion: the renderer depends on a `NotchActions` interface, never on `App.tsx`. Tests inject a fake.

### Catalog v1 (`zara:notch/v1`)

- **Layout:** Column, Row, Card, List, Divider, Tabs.
- **Display:** Text (with the existing safe markdown), Icon (our icon set, a fixed name list).
- **Data:** the five existing widgets as **custom catalog components**: Stat, Chart, Table, Carousel, Diagram (Mermaid). A2UI supports this directly. `zara:table` fences keep working: the parser turns a legacy fence into a one-component surface, so old saved conversations render unchanged and there is one renderer, not two.
- **Interactive (phase 3):** Button, TextField, ChoicePicker, CheckBox.
- **Not included:** Image and Video (the app's CSP blocks remote images and media on purpose), AudioPlayer, Modal (no room in a notch), Slider and DateTimeInput until a use appears.
- **Colour:** A2UI `theme.primaryColor` is ignored. Everything is ink tints, per the design pass.

### Actions (the part that needs care)

| Kind | Examples | Handling |
|---|---|---|
| `event` | "Compare these two", "Yes, book it" | Becomes a new user turn carrying `{name, context}`; the model answers as usual. Shown as a short chip in the transcript so the user sees what they sent |
| `functionCall`, safe | `startTimer(seconds)`, `openPanel(name)`, `copyText(text)` | Runs immediately on click through `NotchActions` |
| `functionCall`, outward | `openUrl(url)`, `saveNote(text)` | `openUrl` only through the existing `isSafeExternalUrl` check and shows the host name on the button. Anything that writes data asks for a second click |

Prompt injection is the central risk: the model can be steered by a web page it saw on screen. So the model never executes anything. A button only fires on a user click, the function must be in the allow-list, arguments are Zod-validated (a timer is 1 to 180 minutes), and the button always shows what it will do.

### Handling a small model

Zara's model is Gemma through OpenRouter with no function calling and no structured-output mode (`build_chat_body` sends only model and messages). Strict nested JSON is its weak spot. Mitigations, in order of importance:

1. **A compact catalog in the prompt**, generated from the Zod contracts like `block_catalog.txt` is today, not the full A2UI schema (which is large and cost the ADK sample a `remove_strict_validation` workaround).
2. **A repair loop**: if a surface fails validation, send the model one message with the A2UI-style error (`{"code":"VALIDATION_FAILED","path":"/components/2/text","message":"..."}`) and retry once. If it still fails, show the prose with the fallback card, as today.
3. **Hard limits**: at most 2 surfaces per reply, 30 components, depth 5, size cap, so a runaway reply cannot lock the panel.
4. **The restraint gate stays**: most replies have no surface.

### Notch constraints

Surfaces are variable height, unlike today's fixed-height blocks (that rule exists for Recharts). The renderer gives a surface its natural height up to a cap (about 280 px) and scrolls inside it beyond that. The panel is 460 px wide, so Row wraps, never scrolls sideways. Surface ids are namespaced per message (`<messageId>:<surfaceId>`) because A2UI requires uniqueness for the renderer's lifetime. Replies arrive whole today, so there is no progressive rendering; the buffer-until-root logic still matters for out-of-order components.

## Phases (each a PR under 200 changed lines)

**Phase 0: Spike and measure (no merge).** Build a 20-prompt eval: the same questions answered once with the current blocks and once with a prototype A2UI catalog prompt. Measure valid-JSON rate and schema-valid rate, with and without one repair retry. **Exit criterion: at least 90% schema-valid after one repair on Gemma.** If it falls short, interaction ships as a much smaller catalog (Button plus Text only) rather than the full tree. Also read `web_core` for anything worth reusing.

**Phase 1: Core, no UI.** `envelope.ts`, `binding.ts`, `surface.ts`. Pure Vitest tests: each message type, out-of-order components buffering until `root`, JSON Pointer upsert and removal, relative paths inside list templates, `formatString` escaping, malformed input rejected with a path-bearing error.

**Phase 2: Catalog and read-only renderer.** Layout and display components, the five legacy widgets wrapped as catalog components, `parse.ts` surface segment, legacy-fence adapter, prompt update (`protocol.rs`, regenerated catalog text, drift test extended). Tests: every catalog doc example validates against its schema (the invariant `index.test.ts` already enforces for blocks); old `zara:table` conversations render identically; component tests via Testing Library by role and text.

**Phase 3: Interaction.** Button with `event` and `functionCall`, `NotchActions` context from `App.tsx`, first functions (`startTimer`, `openPanel`, `copyText`, `openUrl`), inputs with two-way binding and `checks`. Tests: a click on "Start 25 min timer" calls `startTimer(1500)` exactly once; a disabled button with a failing check does not fire; `openUrl("javascript:...")` is refused; an `event` becomes a user turn.

**Phase 4: Repair loop and hardening.** One validation-error retry in `useAiSession`, component and depth limits, injection tests (a surface asking for an unlisted function renders as an inert button), error boundary per surface.

**Phase 5 (optional).** Streaming replies from OpenRouter for progressive render; Ask Zara bar quick-action surfaces; a surface pinned to a panel (for example a timer card the model creates).

## Risks

| Risk | Mitigation |
|---|---|
| Gemma emits invalid or incomplete trees | Phase 0 gate, compact prompt, repair loop, prose fallback |
| Prompt injection through screen contents | Allow-list, schema-validated arguments, user-click only, visible action labels, safe-URL check |
| Spec churn (v0.9 to v1.0) | Own renderer behind our own contracts; only the envelope follows the spec; `version` is checked and unknown versions fall back to prose |
| Prompt cost grows with catalog size | Compact generated catalog; interactive components added only if Phase 0 shows headroom |
| Two render paths for old and new blocks | Legacy fences adapt into the new renderer |
| Panel crowding | Height cap with inner scroll; 2-surface limit |

## Open questions

1. **Interaction first, or look first?** Part B of the liquid-notch plan is the visual track. A2UI Phase 3 (buttons that start timers and open panels) is the feature people will notice most. I would do Phases 0 to 3 before the glow work.
2. **Which local actions do you want first?** I proposed start timer, open a panel, copy, open link, save as note. Anything the assistant should be able to trigger beyond those (calendar events, shelf items)?
3. **Confirmation policy:** two clicks for anything that writes data, as proposed, or one click everywhere?

## Sources

- A2UI project: https://a2ui.org and https://github.com/a2ui-project/a2ui
- v0.9 message reference: https://a2ui.org/specification/v0.9-a2ui/
- ADK walk-through (prompting, validation, gotchas): https://atamel.dev/posts/2026/03-30_a2ui_with_adk/
- npm package sizes and dependencies checked with `npm view` on 2026-11-01

## What was built (2026-11-01)

Code is in `src/ai/a2ui/` (new), with small edits to `parse.ts`, `BlockHost.tsx`, `chatHistory.ts`, `AiPanel.tsx`, `ai.css` and the Rust prompt (`protocol.rs`, `chat.rs`, new `a2ui_catalog.txt`). Nothing is committed.

| Phase | State | Notes |
|---|---|---|
| 0: Gemma eval | **Not done** | Needs an OpenRouter key, which the session that built this did not have. The 90% schema-valid-after-repair gate is still unmeasured, so treat the catalog as unproven on Gemma |
| 1: core | Done | `envelope.ts`, `binding.ts`, `functions.ts`, `surface.ts` (49 tests) |
| 2: catalog and read-only renderer | Done | `catalog.ts`, `A2uiSurface.tsx`, an `a2ui` fence in `parse.ts`, prompt in Rust. The five legacy widgets are catalog components that reuse the existing renderers. Legacy `zara:` fences are **not** converted into surfaces (the plan's adapter was dropped, since both paths share the same renderers) |
| 3: interaction | Done | Button (`event` and `functionCall`), TextField, CheckBox, ChoicePicker, checks, two-click confirmation for writes, and the `actions.ts` allow-list (copyText, openUrl, saveNote, startTimer, openPanel) |
| 4: repair loop | **Not done** | An invalid surface shows the fallback card naming the first problem. Sending the error back to the model for one retry is still to do |
| 5: streaming etc. | Not started | |

Deviations from the plan above:

- **No height cap.** Surfaces use natural height and the chat scroller handles overflow.
- **Prompt:** `build_system_prompt` is pinned to the Electron original by a golden test, so surfaces are added by a new `build_assistant_prompt` that appends the rules and catalog. The prompt tells the model to use a single `zara:` block when one widget is enough, and a surface only to combine elements.
- **Event buttons** send their label as the user's next message, plus `(name: {context})` when there is context. The user sees that text in their own bubble.
- **`startTimer` and `openPanel` are enabled only when the notch passes them in.** `AiPanel` takes an optional `notchActions` prop, and `App.tsx` supplies both (timer start, and opening an available panel).
- No `regex` validation function, no Image or Video, no Modal or Tabs.

Still to do: Phase 0 with a real key, and the repair loop. Not yet checked by eye in the running app.

## Streaming and colour (2026-11-01, later)

**Streaming.** Replies now stream from OpenRouter (server-sent events) instead of arriving whole.
- Rust: `LlmClient::chat_streaming` (default falls back to `chat`, so every existing fake still works), `OpenRouterClient` reads the event stream with a byte-level line buffer (safe across split multi-byte characters), retries only before any text has been shown, and uses an idle timeout per chunk plus a 5 minute cap. `ChatSession::run_streaming` reports the visible answer through `ai-chat-delta` events.
- `visible_so_far` (protocol.rs) hides finished tags and request tokens and holds back an unfinished `[[...`, so a note tag, memory tag or the screen token never flashes on screen. The final reply is still the authoritative text.
- Frontend: `streamingText` in the session state, a `streamingMessage` that shares its id with the final reply (so nothing is replaced when the last words land), widgets that are half written show as a placeholder, and the notch grows in 24 px steps while the answer is written.
- **Not verified against the live service.** The tests use a mock server. Nobody has run it against OpenRouter with a key.

**Colour.** This reverses the "strictly black and white" rule of `docs/design-pass.md` for generative UI only; the notch itself and the rest of the panel stay monochrome.
- A named palette in `src/ai/protocol/accent.ts` (blue, green, amber, red, purple, teal, pink, slate). Models name a colour; they do not write one. Charts and carousel cards also accept a hex.
- Charts use the palette (or the colours the model chose); stat trends are green and red.
- New surface components: Badge, Callout, Progress, Ring, KeyValue, Timeline, Checklist; Text, Icon and Card take an optional colour.
- Mermaid: themed from the notch's colours, flowchart nodes can use `A:::green` and the other accent names, rounded nodes, text drawn as SVG (the old setting would have had its HTML labels stripped by the sanitiser), and the height follows the diagram's shape instead of a fixed 200 px.
- Unmeasured: whether Gemma uses the new components well. That is still the Phase 0 eval that needs an API key.
