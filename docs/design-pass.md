# Design pass: back to black and white

Date: 2026-11-01. Scope: the whole app's look and motion, the assistant panel, Settings, the brand mark and the icons, plus a clean-up of features that did not earn their place.

## The short version

- **The notch is strictly black and white.** Its stylesheet for the notch (`src/App.css`) uses the accent colour zero times. The accent appears only in Settings, on switches and selections. The assistant panel I built broke that: blue user bubbles, a blue send button, a blue cloud avatar, blue focus rings, coloured code, coloured charts, green and red trend arrows.
- **That is fixed.** Every surface in the assistant is now a tint of the notch's own text colour, so it is white on black in the dark theme and black on white in the light theme, and it never adds a hue.
- **Three real layout bugs were found by looking at the running app**, not by reading code. Answers were clipped and ran sideways, native Windows scroll arrows appeared, and the input floated mid-panel instead of resting on the bottom edge. All three had precise causes and are fixed at the cause.
- **The brand mark is black and white now.** It used to be a blue cloud. It is a white cloud with cut-out eyes, and the app icon is a black tile with the white cloud.
- **Features removed:** voice input (Gemma cannot hear audio), the animated avatar with its 1.8 MB GIF, and the code behind both.
- **One behaviour change you should know about:** Zara's answers are now brief and direct. The Electron original told the model to write a problem statement, context, reasoning and next steps for every message.

![Before and after: empty panel](images/design-pass/before-panel-empty.png)
![After](images/design-pass/after-panel-empty.png)

## How I checked

1. Read the notch's original stylesheets to establish what "the original design" actually is.
2. Ran the real app with its web view's debug port open and took screenshots of the notch (collapsed, panel open, a real question and a real answer) and of every Settings tab. The notch window is transparent, so on a white screenshot background it shows as grey; on a desktop it is black.
3. Probed the live page for facts instead of guessing (computed styles, element widths, the flex chain).
4. Applied the **impeccable** and **apple-design** skills: its critique and distill passes, its craft-floor checks, and its mechanical detector (see "Cross-check" below).
5. Took one confirming screenshot round after the fixes.

## What was wrong, and why

| # | Finding | Evidence | Cause | Fixed |
|---|---|---|---|---|
| 1 | The assistant was not black and white | Blue bubble, button, avatar, focus ring, links; green/yellow/blue/red chart series; green/red trends; a green-on-black code theme | I used the accent colour and a stock "dracula" code theme | Yes |
| 2 | Answers ran off the right edge and a horizontal scrollbar appeared | Paragraphs 1,667 px wide inside a 398 px box (probed) | The notch sets `white-space: nowrap` on its container and my panel inherited it | Yes, one reset |
| 3 | Native Windows scroll arrows appeared | Up/down and left/right arrow buttons in the screenshots | I set `scrollbar-color`, which makes Chromium ignore the themed `::-webkit-scrollbar` styling. The stylesheet has a comment warning about exactly this | Yes |
| 4 | The input floated in the middle of a tall, empty panel while "Thinking…" showed | Compose box at 195 px in a 360 px panel | The panel's container did not grow to the height the notch gave it | Yes, one property |
| 5 | The mark and app icon were a blue cloud | About page, window icon, installer | Carried over from the Electron app | Yes |
| 6 | Primary buttons in Settings were accent blue | "Save", "Change", "Import" | Mine. The accent was never used for buttons | Yes |
| 7 | Every answer was a report | "Problem Statement / Context / Reasoning / Next Steps" on a one-line question, and the model even narrated "I used the zara:table widget" | The Electron persona demanded it | Yes |
| 8 | Settings > Assistant looked fused | The API key row and the Test/Remove rows were separate groups with no gap | Two groups where one was meant | Yes |
| 9 | The privacy note repeated the row above it | Same sentence twice | Copy | Yes, shortened to the limits only |

![Before: clipped answer, native arrows, blue](images/design-pass/before-panel-answer.png)
![After: wrapped, monochrome, themed scrollbar](images/design-pass/after-panel-answer.png)

## What changed

### Colour (the black-and-white rule)

One rule: **ink is `--zara-text`, surfaces are tints of it over the notch.** That is how the other notch panels work, and it makes the light theme work for free.

| Element | Before | After |
|---|---|---|
| User bubble | accent blue at 26% | text colour at 14% |
| Send button | accent blue, white arrow | text colour fill, notch-colour arrow (white on black, black on white) |
| Input focus | blue border | text colour at 38% |
| Links | blue | text colour, underlined |
| Errors | red tint | stronger neutral edge and full-strength text |
| Code blocks | black 28% fill, green and cyan tokens | text colour at 8% fill; tokens differ by strength and weight only (`monochromeCodeTheme.ts`) |
| Charts | blue, green, yellow, red, or whatever colours the model asked for | text-colour tints at 100, 60, 38 and 22% (`chartPalette.ts`); model-chosen colours are ignored |
| Trend arrows | green and red | text colour; the arrow carries the direction |
| Diagrams | blue-grey | neutral greys |
| Settings buttons | accent blue | text colour on notch colour; hover and press feedback |
| Text selection and caret | browser defaults | themed to the text colour |

### Layout and scrolling

- One reset (`white-space: normal`) on the panel fixes the clipped, sideways-running answers.
- Scrollbars now use the same thin themed style as the shelf: 5 px, tinted from the text colour, no arrow buttons.
- The assistant view now grows to the height the notch gives it, so the input rests on the bottom edge from the first moment.
- Tables use tabular numerals.

### Brand mark and icons

- `public/zara.png`: white cloud, transparent eyes. The CSS already inverts the logo in the light theme; the same rule applies to the mark.
- `src-tauri/icons/*` (every size, `.ico`, `.icns`): a black rounded tile with the white cloud, so it is visible on any taskbar. A white-on-transparent icon disappears on a light taskbar.

### Motion

I kept the notch's existing motion rather than inventing new motion.

- The assistant view enters and exits exactly like the Command Center: a spring (stiffness 400, damping 30; critically damped, no overshoot) fading in, and a 100 ms fade with a 4 px blur out.
- The notch grows and shrinks with its own size springs.
- **Added, small:** buttons respond on press (a 0.94 scale in 100 ms) so feedback starts on pointer-down, as the Apple guidance asks. All of it is disabled under `prefers-reduced-motion`.
- **Removed:** the avatar's looping animation (a 1.8 MB GIF) and the recording pulse.

### Features removed (the "debloat")

| Removed | Why |
|---|---|
| Voice input: the microphone button, `micRecorder`, `wavEncoder`, the `ai_transcribe` command, the audio capability flag, their tests | Gemma cannot hear audio, so it was a feature that could never work. In git history if an audio model is ever chosen |
| The animated Zara avatar, its SVG and its 1.8 MB GIF | Coloured, heavy, and redundant next to the "Thinking…" line |
| `ai_get_config` and its type | Nothing used it once voice was gone |
| "say 'what's on my screen?'" in the hint | It implied voice. Now "Ask anything, or try…" |
| Problem-statement / reasoning / next-steps answer template | See "Behaviour change" |
| Duplicate privacy sentence in Settings > Assistant | Said twice |

### Behaviour change: brief answers

`SYSTEM_PERSONA` (in `src-tauri/src/ai/protocol.rs`) now asks for direct, brief answers, forbids the report headings, and tells the model never to mention tags or widgets. A test pins that intent. This departs from the Electron original on purpose; the notch is a few hundred pixels wide. If you want the old, expansive style back, that constant is the one place to change.

## Cross-check with the two design skills

**Impeccable** (refinement mode, incumbent system preserved):

- Critique and distill passes produced the findings above. Its craft floor drove several of them: themed selection, caret and scrollbars ("browser surfaces you did not draw"), tabular numerals, states and press feedback, and "declare elevation once".
- Its mechanical detector, run once on every changed UI file, reported **no findings** on the assistant, Settings tab and new modules. On `Settings.css` it flagged one **gradient text** on the About title. That is the original wordmark treatment (a white-to-grey fade), part of the identity you asked me to match, so it stays. It is the only exception.
- Impeccable bans eyebrow labels. The small uppercase group labels in Settings are part of the original design and are kept.

**Apple design** (translated to this app):

- *Springs, not fixed animations, and interruptible:* the panel already uses the notch's springs. No new gesture-driven motion was added, so there was no velocity hand-off to build.
- *Respond on press:* added the press scale above.
- *Spatial consistency:* the assistant enters and leaves the way the other panels do, from the notch's own edge.
- *Materials and restraint:* the notch's translucency is unchanged. I added no new blur or shadow. Surfaces are tints, so a light surface never sits on another light surface.
- *Reduced motion:* every new transition is switched off under `prefers-reduced-motion`.
- *Typography:* the panel keeps the notch's compact sizes; numerals in tables are tabular; no letter-spacing was invented.
- *Simplicity, not minimalism:* the cuts above were things that could not work (voice) or repeated something (avatar, duplicate note), not features people use.

## Deliberately left alone

- The accent colour (blue) on Settings focus outlines and selected cards. It is used there.
- The green switches in Settings and the red of destructive rows ("Remove key", "Reset to Defaults"). I reused that same red for problem messages in Settings so errors match.
- The gradient wordmark on the About page, and the uppercase group labels.
- Every other panel (media, command center, calendar, shelf, devices, battery). They were not changed.

## Verified, and not

**Verified:** build; 167 frontend tests (new: chart palette and code theme; the voice tests went with the voice feature); 53 script tests including the branding guard; clippy with warnings denied; 233 Rust tests; the real app, before and after, for the empty panel, typing, "Thinking…", a real answer with a table, bullets and code, and all seven Settings tabs; the live DOM for the width and flex bugs.

**Not verified visually (be aware):**

- The **light theme**. The colours are theme-driven and the chart palette has a light-theme unit test, but I did not look at the app in light mode.
- **Charts, stat cards, carousels and diagrams** rendered by a real model reply. My test question produced a table, bullets and code, not a chart. The chart palette is unit tested only.
- The installer. It was built before this pass; it needs a rebuild (`bun run tauri build`) to pick up the new icon, mark and persona.
- The new icon at small sizes on a real taskbar and tray.

## Files

- Assistant UI: `src/ai/ai.css`, `src/ai/AiPanel.tsx`, `src/ai/api.ts`, `src/ai/chat/monochromeCodeTheme.ts` (new), `src/ai/chat/blocks/chartPalette.ts` (new), `ChartBlock.tsx`, `loaders.ts`, `ChatCodeBlock.tsx`
- Settings: `src/Settings.css`, `src/settings/AssistantTab.tsx`
- Brand: `public/zara.png`, `src-tauri/icons/*`
- Backend: `src-tauri/src/ai/llm.rs`, `mod.rs`, `protocol.rs`, `src-tauri/src/main.rs`
- Removed: `src/ai/lib/micRecorder*`, `src/ai/lib/wavEncoder*`, `src/ai/ZaraAvatar.tsx`, `src/ai/assets/*`
- Docs: this file, ADR 0003, parity, README, release checklist, privacy

## Open questions for you

1. **Charts and widgets.** They are the Electron original's features and are kept, now in black and white. Mermaid in particular is a large dependency for a notch. Say the word if you want the widget set trimmed.
2. **The persona.** Brief by default now. Want a middle ground?
3. **App icon.** Black tile with a white cloud, or a bare white glyph?
