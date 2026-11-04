# Plan: an Ask Zara bar and a liquid-light notch for the desktop

Date: 2026-11-01. Status: **Part A is built, mounted and tested.** Part B is not started. Two parts: **Part A** adds an Ask Zara input to the notch's home panel (from a hand sketch); **Part B** is the liquid-light look. A ships first and is independent; B hooks into A's focus and submit events. Part B's inspiration: the Siri screens (a black card at the top of the display, with soft, flowing multi-colour light that wraps its edges and spills onto the UI behind it).

## Part A: the Ask Zara bar

### The sketch, mapped onto what exists

The sketch is the current calendar and timer panel (480 px wide, the presets are already 5m / 15m / 25m / 50m) with one new row:

| Sketch | Already in the app | New |
|---|---|---|
| 16°C, clock with arrows, 96% | The 36 px status row (weather, clock, battery) and panel arrows | no |
| Calendar on the left, timer with START and presets on the right | `calendar-timer-content split-view` in `App.tsx` | no |
| **Ask Zara pill and a circular send arrow** | The assistant's own compose box lives only inside the AI panel | **yes** |

### Behaviour

Type a question in the bar, press Enter or the arrow: the notch grows into the assistant panel and the question is sent, with the answer appearing below it once the model replies (replies arrive whole today, not token by token). The panel's own compose box takes over from there. The user never has to know the global shortcut or switch panels first.

### Design

- **`src/ai/AskBar.tsx`** (new, deep): owns the draft text and the pill. Interface is two callbacks: `onSubmit(text)` and `onFocusChange(focused)`, plus a `busy` prop. Everything else (trimming, Enter handling, IME composition, Escape to blur) is inside.
- **Mount:** inside the calendar panel, above the two columns. `.split-view` becomes a column holding the bar and a new `.split-body` row. The calendar panel height grows by one 30 px row plus a 12 px gap (`ASK_BAR_ROW_HEIGHT` = 42): 273 to 315 px, and 305 to 347 px for six-week months (`getDynamicHeight` in `App.tsx`).
- **Submit:** `App.tsx` calls `openNotch("ai")` then `aiSession.send(text)`. The session state lives in `App.tsx` already, so sending before the lazy `AiPanel` has mounted is safe. A missing API key already surfaces as the key card plus Retry in `AiPanel`, so the bar needs no key logic.
- **Keyboard focus:** the notch window is deliberately non-activating, so typing in the bar needs the same focus hand-off the AI panel uses (`ai_take_focus` / `ai_release_focus`, `src-tauri/src/ai/focus.rs`). Today that is keyed to `zaraMode === "ai"`. It becomes one derived rule, `wantsKeyboardFocus(mode, isOpen, askBarFocused)`, a pure function in `src/lib` that also decides pinning. No Rust change.
- **While an answer is pending** (`phase === "sending"`): the bar shows "Thinking…", ignores typing, and clicking it opens the panel to watch. `send` already drops overlapping requests, so this just makes that visible.
- **Look:** follows the design pass. Outlined pill and outlined circle, tints of `--zara-text`; the send circle fills with the text colour once there is something to send, like `.zai-send`. No accent colour.
- **Accessibility** (the "make it accessible" part, both senses): the bar is a labelled form field ("Ask Zara"), reachable by Tab, with a visible focus ring, Enter to send, Escape to leave, and a named send button. It is the first thing a keyboard user reaches in the panel.

### Phases

**A1: pure rule and bar.** `wantsKeyboardFocus` plus `AskBar` and its CSS, not yet mounted. Tests (Vitest, Testing Library): typing then Enter calls `onSubmit` with trimmed text and clears the field; Enter on empty or whitespace does nothing; Enter during IME composition does nothing; the send button is disabled when empty; `busy` shows "Thinking…" and blocks input; Escape blurs; focus changes are reported. The focus rule gets a table test.

**A2: mount in the calendar panel and wire submit.** Layout change, height change, focus hand-off, submit to the assistant. Test in `App.test.tsx`: typing a question in the calendar panel and pressing Enter opens the assistant and the question appears as the user message (network mocked at the Tauri invoke seam, as the existing tests do).

### Open design questions for Part A

1. **Which panels get the bar?** The sketch only shows the calendar panel. I recommend that panel only; putting it in every panel would crowd the media and controls panels.
2. **How do users reach this panel?** The default panel setting is currently the assistant itself, so the sketch's panel is reached by clicking the clock. If this is meant to be the notch's "home", it should become the default and the assistant the thing the bar opens. That is a behaviour change, so it is your call.

---

## Part B: the liquid-light look

### What the reference actually does

Reading the two reference images, "liquid gradient" is three separate things:

1. **A rim of light.** The card's edge carries a blurred multi-colour gradient that drifts slowly, so the edge looks lit from inside.
2. **A glow.** The same light leaks outward past the card and tints whatever is behind it. This is what makes the card look like part of the screen rather than a sticker on it.
3. **State.** The light only exists while Siri is active. Idle, the surface is plain. It is a status indicator as much as decoration.

Phones wrap the whole display in it. A desktop is 1920 px wide and the notch is about 460 px of it, so wrapping the screen would be absurd. The desktop version is: rim on the notch, glow beneath it, and an optional soft "horizon" wash along the top edge of the screen on either side.

### Where Zara is today (the constraints that shape this)

| Fact | Where | Consequence |
|---|---|---|
| The notch is a 1920x420 transparent window clipped with `SetWindowRgn` to a few rectangles | `src-tauri/src/window_region.rs`, `src/windowRegion.ts` | The region limits **drawing and clicks**. Any glow outside the pill is invisible unless its rectangle is added to the region, and that rectangle then also swallows clicks meant for the app underneath. The glow must stay small (about 32 px) or move to its own window (phase 4) |
| The pill and its concave flares are one painted layer | `src/components/EdgeSurface.tsx/.css` | The "grows out of the screen edge" shape is already done. The glow must follow the same silhouette, flares included |
| `backdrop-filter` only sees the web view's own pixels | WebView2 transparent window | We cannot blur the wallpaper through the notch with CSS. Real blur-behind needs DWM acrylic (`window-vibrancy` is already a dependency, used for Mica on Settings), which is rectangular and conflicts with the region clip. Treated as a spike, not part of the plan |
| `.notch-ambient-glow` already exists for album art, with a comment about "buggy WebView2 mask-image" | `src/App.css` ~1375 | Precedent for a glow layer, and a warning to test masks on WebView2 early |
| The AI session lives in `App.tsx` (`useAiSession`), with `phase: idle / sending / error` | `src/ai/sessionReducer.ts` | The notch already knows when Zara is thinking. No new plumbing to the backend |
| ADR 0002: new UI goes in its own folder, `App.tsx` does not grow | `docs/adr/0002-design-system.md` | The feature is a self-contained `src/glow/` module with one mount line |
| **The design pass made the notch strictly black and white on purpose** | `docs/design-pass.md` | This plan reintroduces hue. See "The colour decision" below. It is the one thing to settle before building |

### The colour decision (needs your call)

The last design pass removed every accent from the notch. Liquid light puts colour back. These can both be true if colour is **earned by state**: the notch is black and white at rest, and lit only while Zara is working. I recommend that, with a Glow setting so the old look is one click away:

| Setting | Look |
|---|---|
| Off | Today's notch exactly |
| Mono | White light only (tints of `--zara-text`). Keeps the design-pass rule |
| Accent | Hues derived from `--zara-accent` (follows Windows accent in Adaptive theme) |
| Aurora | Fixed Siri-style multi-hue palette |

Default: **Aurora**, because it is the effect you asked for. Light theme needs its own tuned palette (light on a white pill is invisible); the design pass noted light theme was never looked at, so it is verified here.

### Design

One deep module, `src/glow/`, with a tiny interface:

```tsx
<GlowSurface state={glowState} palette={glowPalette} />   // aria-hidden, decorative
```

Rendered as a sibling of `<EdgeSurface>` inside `.zara`. Internals hidden behind it:

- **State** (`glowState.ts`, pure): `rest | listening | working | settled | error`, derived from the panel being open, `aiSession.phase`, and whether the Ask Zara bar has focus (Part A).
  - `rest`: no layers mounted, zero animation cost.
  - `listening`: rim fades in at low intensity (the assistant panel just opened, or the Ask Zara bar is focused; in the bar's case a thin rim around the pill itself).
  - `working`: full liquid flow, faster drift (Zara is thinking).
  - `settled`: slow flow at low intensity while the answer is on screen, then fades out after a few seconds.
  - `error`: light drains to Mono. Colour is never used to signal failure.
- **Palette** (`glowPalettes.ts`, pure): setting + theme mode + accent → 4 colour stops as CSS variables.
- **Liquid** (`glow.css`): 3 to 4 large blurred radial blobs, each animated by `transform` only so it runs on the compositor and the blur is rasterised once. Blobs are clipped to the pill silhouette by the same mask approach EdgeSurface uses. The rim is a ring cut with a mask, filled with a conic gradient whose angle is a registered `@property`.
- **Glow**: the same blobs, unclipped and heavily blurred, extending about 32 px below and beside the pill, at low opacity.
- **Horizon wash** (optional, phase 3): a wide, very faint ellipse along the top screen edge centred on the notch, about 24 px tall.
- **Why not canvas, WebGL, or SVG `feTurbulence`:** they give truer fluid motion but cost continuous GPU time in a window that must sit idle on battery. CSS blobs look fluid at this scale and cost nothing at rest. If the look falls short, a canvas layer can replace the internals without touching the interface.
- **Reduced motion:** static gradient, no drift.
- **Visibility:** animations pause when the window is hidden or a fullscreen app has focus (the notch already tracks visibility).

### Phases (each one PR under 200 changed lines, mergeable on its own)

**Phase 0: Spike and measure** (no merge). Prototype the rim and one blob in the real app with the debug port open, as in the design pass. Answer three questions with numbers: does the mask render correctly on WebView2 at fractional DPI, what is GPU and CPU use while `working`, and does 32 px of glow region visibly eat clicks. Also screenshot the light theme. **Exit criterion:** CPU under 3% and GPU under 5% while animating on the dev machine, or the design drops to a static gradient.

**Phase 1: The rim.** (Ship after Part A, so `askBarFocused` already exists.) `glowState.ts`, `glowPalettes.ts`, `GlowSurface` with rim only, mounted in `App.tsx`, driven by the AI panel. Setting `zara-notch-glow` (Off / Mono / Accent / Aurora) in the Notch settings tab.
- Tests (Vitest): `glowState` maps every phase and panel combination; palettes return distinct stops per theme and never emit hue for Mono; settings row persists the choice and defaults to Aurora.

**Phase 2: Liquid body and glow.** Blobs inside the pill, plus glow outside it, with the region padding added through `measureElements` using a per-selector pad (the mechanism already exists). Verify the AI panel's text stays readable over the light (contrast check on the three palettes).
- Tests: `windowRegion` gains a case for the glow pad; component test that `GlowSurface` renders nothing at `rest` and honours reduced motion.

**Phase 3: Desktop polish.** Horizon wash along the top edge; smoother state transitions with the notch's springs (400/30) instead of fixed fades; settle-then-fade timing; hover state for an idle notch is **not** lit (keeps rest honest).

**Phase 4 (only if you want it): screen-edge glow window.** A separate click-through window (the `overlay` window is already 1920x1080 and already transparent) draws a Siri-style glow around the whole screen edge while Zara is working, so there is no click-eating region. Gated by its own setting and off by default. Needs `WS_EX_TRANSPARENT` handling, multi-monitor placement, and fullscreen-app suppression, so it is the largest and riskiest piece.

### Risks

| Risk | Mitigation |
|---|---|
| Animated blur burns GPU on a laptop | Transform-only animation, rest mounts nothing, phase 0 gate, Off setting |
| Glow region blocks clicks beneath the notch | 32 px cap, only while lit, phase 4 as the click-through alternative |
| Colour clashes with the monochrome identity | Earned by state, Mono and Off options, default reviewed with you |
| Light theme looks washed out | Dedicated palette plus a screenshot pass |
| Mask or blur glitches on WebView2 | Phase 0 checks it before any code is merged |
| Text readability over the glow | Glow stays behind the content layer at low opacity; contrast checked per palette |

### Open questions for Part B

1. **Default look:** Aurora (Siri-like colour) or Mono (white light, keeps the black-and-white rule)?
2. **Phase 4:** do you want the screen-edge glow at all, or is the notch-local glow enough?
3. **Rest state:** should the idle notch stay perfectly flat, or carry a very faint always-on sheen so it feels alive? I recommend flat; an always-on animation is the main battery cost.

## Status of Part A (2026-11-01)

Built, mounted and tested. `src/ai/AskBar.tsx` and `AskBar.css` (8 tests), `src/notch/keyboardFocus.ts` (5 tests), and three tests in `src/App.test.tsx`: Enter opens the assistant and sends the question, the notch takes and gives back keyboard focus, and a timer button in an answer starts the notch's timer. The bar is mounted by `CalendarTimerPanel` (new optional `ask` prop), and `App.tsx` supplies the submit handler, the focus rule, the taller panel and the wheel exclusion. Not checked by eye: no one has run the real app (`bun run tauri dev`) to see the bar's layout or to confirm that clicking into the bar really pulls keyboard focus in the non-activating window. That is the first thing to look at.

## Clarification from the user (2026-11-01): the bottom fade is the point

After trying the notch, the user pointed out that the Siri reference is a card whose **bottom edge fades to transparent**, so the panel dissolves into the screen instead of ending in a hard edge. That is the main thing Part B has to deliver; the rim and glow described above are secondary. Revised first step for Part B:

- Fade only the notch's **background** layer (the `EdgeSurface` mask), over roughly its bottom 40 px, by combining a vertical gradient mask with the existing alpha mask. Content (text, input, buttons) stays fully opaque and is never masked.
- Keep the fade out of the collapsed pill and the top flares; it applies to expanded panels only.
- Open points: which panels get it (assistant only, or every expanded panel), how tall the fade is, and whether the light that shows through the fade is coloured or just the notch's own tint.
- Risk: the window region clips drawing, so a faded edge needs the region padded to include it, and WebView2 mask rendering must be checked at fractional DPI (the original phase-0 spike).
