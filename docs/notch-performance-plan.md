# Plan: a faster, snappier notch

Date: 2026-11-03. Status: **plan only, nothing changed yet.** Everything below comes from reading the code, not from profiling. Phase 0 exists to turn the suspects into measured numbers before anything is "fixed".

## Status (2026-11-03)

Built and tested, not yet committed:

| Phase | Done |
|---|---|
| B.1 | AI panel code is preloaded (3 s after start-up when idle, and when the pointer reaches the notch): `src/ai/loadAiPanel.ts` |
| B.3 | Keyboard focus is taken 150 ms after the assistant opens, not in the first frame (`useDeferredKeyboardFocus`), and the cross-process activation in `ai_take_focus` / `ai_release_focus` now runs on a blocking-pool thread |
| B.5 | The AI view no longer blurs on exit |
| B.7 | The conversation lives in a store (`aiSessionStore.tsx`); only the panel re-renders while an answer streams in (pinned by `App.streaming.test.tsx`) |
| A.1 | Every assistant command that touches the disk or the Credential Manager is `async` on a blocking-pool thread (`on_blocking_thread`) |
| A.2, A.3 | One `get_system_metrics` call replaces four, runs off the UI thread, and stops while the notch is hidden |
| A.4 | `scripts/synchronousCommands.test.ts` fails if a new plain `fn` command is added |
| 0 | `ZARA_STALL_PROBE=1` logs `ui_stall` lines; `localStorage["zara-frame-probe"]="1"` logs `frame_gap` and `long_task` lines (both to `diagnostics.log`) |

Not done yet: B.2 (warming panel data), B.4 and B.5's mask (animate the clip, not the layout; needs the probe's numbers and a visual check), B.6, and phases 1 to 7. The remaining plain `fn` commands listed under `stillToReview` in the guard test have not been checked.

## The goal

**No hangs.** The app never freezes, the notch animation never drops frames, and a busy moment elsewhere in the app (a poll, a save, a device scan) never shows up as lag in the notch. Raw reveal speed is secondary: the hover delay (`zara-notch-edge-delay`, default 200 ms) is a user setting and **stays exactly as it is**.

The symptom that started this: moving the cursor to the top of the screen sometimes stutters, and the reveal is slower than it should be.

The one idea behind most of the plan: Zara has a single thread that runs the UI (the Tauri event loop, which is also the WebView2 UI thread). Anything that blocks it, or makes it wait for a reply, freezes the animation. The plan is to keep that thread free during an animation.

## How a hover travels today

```
 mouse move ─► WH_MOUSE_LL hook ─► cursor worker (throttled to one run per 32 ms)
                                        │
 40 ms watchdog thread ────────────────►├─► update_main_interaction()
 (runs forever, even when idle)         │      • dwell gate (default 200 ms)
                                        │      • hit-test against NOTCH_RECT
                                        │      • flip WS_EX_TRANSPARENT (click-through)
                                        ▼
                         emit "notch-edge-hover"  (Rust ─► webview IPC)
                                        │
        App.tsx: setIsEdgeHovered ─► render ─► effect ─► setInteractionState ─► render
                                        │
        isHidden flips ─► pillTargetY / width / height change
                                        │
        framer-motion springs on width, height, y, 4 border radii (main thread)
                                        │
        ResizeObserver fires every frame ─► invoke("update_notch_rect") + region recompute
```

Files: `src-tauri/src/services.rs` (hook, worker, watchdog, `update_main_interaction`), `src-tauri/src/window_region.rs`, `src/App.tsx` (state, spring transition, region sender), `src/windowRegion.ts`, `src/components/EdgeSurface.css`.

## Where the time goes

### 0. Toggling AI mode (the reported case: the open animation turns shaky)

Opening the assistant is the heaviest thing the notch does, and several expensive jobs land in the same few frames as the pill's spring. In the order they happen:

1. **A 727 KB chunk loads and runs on first open.** `AiPanel` is lazy (`App.tsx:37`), which is right for startup, but the download, parse and evaluation of the panel and its libraries (react-markdown, remark/rehype, KaTeX, the A2UI components) happen **after** the click, on the same thread as the animation. `<Suspense fallback={null}>` shows nothing meanwhile, then a large tree mounts in one go. Expect the worst shake on the first open after launch and a smaller one after.
2. **`ai_take_focus` runs on the main thread at the moment the animation starts** (effect at `App.tsx:839`). It calls `set_focusable(true)` (which makes tao rebuild the window's extended style; `main.rs` notes this can drop click-through/layered state), then `AttachThreadInput` + `SetForegroundWindow`. Attaching input to the foreground app's thread and activating a window both send messages to the other process and wait for it. If the app you came from is busy (a browser mid-page-load, an IDE), Zara's UI thread waits too. The comment on `re_assert_topmost` also records that activation makes the WebView compositor blank the window briefly.
3. **The panel's content re-lays-out on every frame of the spring.** The pill animates `width` and `height` (580 x up to 636 px) and the AI view lives inside it as normal flow content, so each frame the browser re-lays-out the whole chat subtree (history list, markdown, thinking section, composer) at the new size.
4. **A very large element is repainted each frame with a mask.** `.zara.fade-bottom` animates registered `@property` percentages that drive `mask-image` on the full-size `.edge-surface`. Animating a mask on a 580 x 600 layer is a full repaint per frame. Closing also applies `filter: blur(4px)` to the whole AI view.
5. **Panel start-up work runs inside the animation:** `aiGetSettings`, `aiHasApiKey`, conversation list/load IPCs, the history/welcome views and the model chooser all mount and fetch while the pill is still growing.
6. **Streaming re-renders the entire notch.** `useAiSession` lives in `App`, and the answer is redrawn every 60 ms (`STREAM_DRAW_INTERVAL_MS`). Each draw re-renders all of `App` (1,880 lines, every widget, the pill's motion props), and the height grows in 24 px steps (`GROWTH_STEP`) that each trigger a fresh spring plus a window-region update. That makes the animation shaky *while an answer is arriving*, not just on open.
7. **The window is as tall as the panel at all times** (640 px, clipped by `SetWindowRgn`), so every region change makes DWM re-composite a large layered surface.

Items 1 and 2 are the most likely cause of "hangs"; 3, 4 and 6 the most likely cause of "shaky".

### 1. Waiting around the hover delay (minor; the delay itself is left alone)

| Source | Cost | Where |
|---|---|---|
| Hover-intent dwell | 200 ms by default, user-adjustable. **Not changing.** | `TOP_EDGE_DWELL_MS`, `top_edge_armed_for` |
| Cursor worker throttle | up to 32 ms, added after the event arrives (`thread::sleep(remaining)`) | `setup_mouse_hook` |
| Watchdog cadence | the dwell completes on a 40 ms poll, so it lands up to 40 ms after the configured delay | `TOP_EDGE_POLL_MS` |
| Windows timer granularity | `thread::sleep` rounds up to about 15.6 ms unless the timer resolution is raised | both loops |

These make the notch arrive later than the delay the user chose, but they are not hangs. They are kept as one small, low-risk phase.

### 1b. Synchronous commands run on the UI thread (new: the likeliest source of real hangs)

In Tauri, a command declared as a plain `fn` (not `async fn`) runs on the main thread. About 70 of Zara's commands are plain `fn`. Most are trivial, but these do real work there:

| Command | Why it can stall | Called |
|---|---|---|
| `get_network_speed` | `GetIfTable2` walks every network adapter; with VPN, Hyper-V or WSL virtual adapters this can take tens of milliseconds | every 3 s, from `useSystemStats` |
| `get_cpu_usage`, `get_ram_usage`, `get_disk_space` | cheap individually, but they land as four back-to-back main-thread jobs on the same tick as the network call | every 3 s |
| `conv_save`, `conv_load`, `conv_list`, `note_*`, `memory_*` | disk I/O in the conversation, notes and memory stores (to be confirmed: file-backed or database) on every message | per chat message / panel open |
| `jack_list_devices`, `usb_list_devices` | device enumeration (they sleep to gather results, `GATHER` in `jack.rs`/`usb.rs`) | when the devices panel opens |
| `load_settings`, `stealth_*`, `open_settings_window`, `set_window_height` | file reads, window creation and per-window style rewrites | on demand |

Compare `get_battery_saver_state`, `get_wifi_status` and `get_volume_state`, which already use `spawn_blocking`. That is the pattern to apply everywhere.

Separately, the **Rust hover path** (section 2) makes blocking round trips *to* this thread from background threads. So the thread is blocked from two directions.

### 2. Work done on every cursor move, anywhere on screen

`process_mouse_position` has no early exit. A mouse move in the middle of the screen still:

- calls `update_main_interaction`, which calls `get_webview_window`, `is_visible()`, `scale_factor()`, `hwnd()` and reads three settings (each one takes the settings mutex and clones a `String`);
- calls `primary_monitor()` up to five more times for the left-edge card, the right-edge card and the overlay;
- calls `set_click_through` on both windows ("applied on every update").

**Suspect, to confirm in Phase 0:** Tauri's window getters (`is_visible`, `scale_factor`, `hwnd`, `primary_monitor`) are not plain reads. From a non-UI thread they are a blocking round trip to the event-loop thread, which on Windows is also the WebView2 UI thread. That means the cursor worker (up to 30 Hz while moving) and the watchdog (25 Hz **all the time**, even with the mouse still) keep poking the one thread that has to run the animation. That fits "sometimes lags": it happens when the hover animation and a burst of these round trips collide.

The two paths also overlap: `set_notch_hovered` (called from React on every hover change) runs `refresh_main_interaction`, a third caller of the same function.

### 3. The animation itself runs on the main thread and animates layout

- The pill springs `width`, `height`, `y` and four `border-radius` values with framer-motion. Width and height are layout properties, so every frame is JS, style write, layout and paint, inside a **1920x640 transparent layered window** that carries a `SetWindowRgn` region. Only `y` could ride the compositor.
- The pill's `animate` always carries `filter: blur(0px)` (and `blur(8px)` when hidden), which gives it a filter effect layer even at rest.
- `.edge-surface` uses a two-layer `mask-image` with composite, plus `@property` variables that animate; the colour uses relative-colour syntax. Expensive to repaint every frame of a width/height change.
- `.notch-ambient-glow img` is `blur(52px)` on an image scaled 1.8x. Fine while idle, costly if it repaints during a transition (music open).
- `zoom: scale` on the wrapper means layout is scaled, not just painted.

### 4. Per-frame bookkeeping during the animation

- `ResizeObserver` watches the pill. While width/height spring, it fires **every frame**, and each time `updateRect` does `getBoundingClientRect` on three elements and an `invoke("update_notch_rect")` IPC, plus `updateNotchRegion`.
- `useEffect(() => updateNotchRegion())` has no dependency list, so it runs after **every render**, and `measureElements` does three `querySelectorAll` + `getBoundingClientRect` passes (forced layout).
- `pillTargetRef` reads `window.innerWidth` during render (another layout read).

None of this is large alone; together it is a steady tax on the frames that matter most.

### 5. The React render chain

`App.tsx` is one 1,880-line component holding almost all notch state. A hover currently causes several full renders:

1. `notch-edge-hover` ─► `setIsEdgeHovered` ─► render
2. effect on `isAnyInteraction` ─► `setInteractionState("active")` ─► **second render** (this is the one that actually un-hides the pill, because `isHidden` reads `interactionState`)
3. DOM `onMouseEnter` ─► `setIsNotchHovered` ─► render, then effect ─► `set_notch_hovered` IPC
4. framer `onHoverStart` ─► `setIsHovered` ─► render

Meanwhile the whole component also re-renders on a 1 s clock tick, on every `useSystemStats` poll (4 invokes, 5 setStates, every 3 s), and on media/battery/weather events. A tick that lands mid-animation is a dropped frame.

### 6. Launch

Separate from hover, but you asked for fast launch too:

- A second **full-screen 1920x1080 WebView2** (the overlay) is created and shown/hidden at startup. It exists for the left/right volume and brightness cards and the splash.
- Startup waits on the overlay's `splash-done` (6 s safety timer), polls `isVisible()` over IPC every 100 ms, then waits 240 ms before expanding, and the system-settings sync has its own 400 ms start timer.
- The AI session (`useAiSession`) is created eagerly; the heavy panel (`AiPanel`, 727 KB, plus mermaid/cytoscape) is already lazy, which is good.

## The plan

Eight phases, each small enough to be its own PR (under 200 changed lines), each with a test. Priority is hang-removal: phases 0, A, 2, 3 and 4 do most of it. Phase 1 is the small timing cleanup. Phase 7 is launch.

### Phase 0: measure first, with a hang detector (no behaviour change)

Without numbers, the ranking above is a guess, and "sometimes lags" is the hardest kind of bug to chase by eye. Add instruments that catch the hang itself:

- **UI-thread stall detector (debug builds):** a background thread asks the main thread to run a no-op every 100 ms (`run_on_main_thread`) and records any reply that takes more than 50 ms, together with the name of the command or event that was running (a thread-local "current job" tag set by a small wrapper on the suspect commands). Output goes through `diagnostics::record`. This names the culprit for each stall.
- **Frame-gap detector (frontend, debug builds):** a `PerformanceObserver` for `longtask` entries plus a `requestAnimationFrame` loop that logs gaps over 24 ms while the pill is animating, tagged with what else ran (render of `App`, IPC event, region update).
- **Backend timing:** a span around `update_main_interaction` and each Tauri window getter, and a call-per-second counter at idle and while moving the mouse. This confirms or kills the section 2 suspect.
- **Baseline table** in this file: stalls per minute and worst stall (ms) at idle, with music playing, with the AI panel open, and during 30 s of mouse movement; dropped frames per reveal/open. Every later phase quotes its before/after.

Test: the probes compile to no-ops in release builds; unit test the stall-recorder's threshold and ring buffer.

### Phase B: make opening the AI panel smooth (your reported case; do this right after Phase 0)

Principle: by the time the pill starts moving, everything expensive has already happened, and during the spring the only work left is moving a finished layer.

1. **Preload the panel before it is asked for.** Start `import("./ai/AiPanel")` when the notch is idle after startup (`requestIdleCallback`), and again on the earliest signal of intent (pointer enters the notch, Ask bar gets focus, the AI shortcut's key-down). Loading, parsing and evaluating then never overlaps the animation. Keep the chunk lazy so startup stays light, and also split the markdown stack (`ChatMarkdown`, KaTeX, rehype) so it loads on the first rendered answer, not for the welcome screen.
2. **Warm the data too.** On the same intent signal, fetch `aiGetSettings`, `aiHasApiKey` and `convList` into the session, so the panel mounts with data and issues no IPC while animating.
3. **Move focus off the animation's critical path.** Take keyboard focus after the open spring settles (the pill's `onAnimationComplete`, or a fixed ~250 ms), not in the first frame. Make `ai_take_focus` do the `AttachThreadInput`/`SetForegroundWindow` part on a worker thread so the UI thread never waits on another process; only the tao calls (`set_focusable`, `set_focus`) stay on the main thread. Add a cap so a hung foreground app cannot block it indefinitely.
4. **Don't re-layout the panel during the spring.** Give `.ai-view` its final size and `position: absolute` with `contain: layout paint`, and let the pill's growing size clip it (the pill already has the rounded clip). The panel lays out once; the animation only changes the clip. Combined with Phase 5's "animate the clip, not the layout", this removes the per-frame subtree layout.
5. **Remove expensive effects from the transition.** Change `fade-bottom` only before the open starts or after it ends, not during; swap the `@property` mask animation for a fixed gradient overlay whose `opacity` fades; drop `filter: blur(4px)` from the AI view's exit and use opacity only.
6. **Mount the heavy parts after the first frame.** Render the panel shell (composer and header) immediately and mount the history list and model chooser inside `startTransition` / after the first spring frame, so they never share a frame with the start of the animation.
7. **Stop streaming from re-rendering the notch.** Move the session into a small store read with `useSyncExternalStore`: `AiPanel` subscribes to the full state, while `App` subscribes only to the few values it needs (phase, whether the panel is open, desired height). A 60 ms stream draw then re-renders the panel's message list, not all of `App`. Raise `GROWTH_STEP` hysteresis (grow in bigger steps and only on settle) so a long answer causes a few height changes, not dozens.

Tests:
- Vitest: opening the AI mode with the chunk already preloaded renders the panel in the same commit (no `Suspense` fallback); the preload is triggered on pointer-enter and on idle, and only once.
- Vitest: a streamed token update does not re-render `App` (render-count spy around a stub child), while the message list does update.
- Vitest: `ai_take_focus` is not invoked until the open animation completes (fake timers).
- Rust: `force_foreground` runs off the calling thread and returns within a bounded time when the target thread does not respond (use a stub for the Win32 calls behind a trait).
- Playwright (screenshot): collapsed, mid-open and open states look identical before and after the CSS changes.

### Phase A: keep the UI thread free (backend; the main fix for freezes)

1. **Make every command that can block `async` + `spawn_blocking`**, using the existing pattern from `get_battery_saver_state`: `get_network_speed`, `get_cpu_usage`/`get_ram_usage`/`get_disk_space`, `conv_*`, `note_*`, `memory_*`, `jack_list_devices`, `usb_list_devices`, `load_settings`, `stealth_*`. Return types and the frontend calls do not change (`invoke` is already promise-based).
2. **One metrics call instead of four.** Merge the four status-widget polls into a single `get_system_metrics` command that samples everything in one blocking job and returns one object. That is one IPC and one `setState` per tick instead of four and five.
3. **Stop polling what hasn't changed.** The metrics poll only needs to run while the status widgets are visible (collapsed pill with widgets on, or the relevant panel open). When the notch is hidden (smart/peek, no interaction), pause it.
4. **Audit rule, enforced by a test:** a Rust test that scans `src-tauri/src` for `#[tauri::command]` followed by a non-async `pub fn` and fails unless the command is on a short allow-list of provably trivial ones (atomic loads, channel sends). New blocking commands cannot slip in.

Tests: the allow-list test above; per command, a unit test that the work function runs off the calling thread (e.g. assert it is not the thread that invoked it); a Vitest test that `useSystemStats` makes one `invoke` per tick and pauses when told the notch is hidden.

### Phase 1: tidy the waiting around the delay (backend, low risk; the delay itself is untouched)

1. **Raise the timer resolution** (`timeBeginPeriod(1)`, or use a waitable timer) for the cursor worker and watchdog so sleeps mean what they say.
2. **Remove the 32 ms trailing throttle for the top band.** Throttle only work that is not time-critical. If the cursor is in or near the top band, process immediately; keep the throttle for the rest of the screen.
3. **Complete the dwell on time, not on a poll.** When the cursor enters the band, schedule one wake-up at `enter + dwell` (a timeout on the worker's existing `recv_timeout`) instead of relying on the 40 ms loop. The notch then appears at the configured delay, not up to 40 ms after it.

Tests (Rust, in-process, no windows): a pure `EdgeDwell` state machine extracted from `top_edge_armed_for`, driven with `(cursor, now)` samples: arms exactly at the configured dwell, disarms on leaving the band, `0` still means instant, a fullscreen foreground app drops a pending dwell. The dwell default and the setting are unchanged and covered by a test that pins `200`.

### Phase 2: make the hover path cheap (backend)

1. **Early exit.** If the cursor is nowhere near the top band, the notch's hit area, an edge card or the open mixer, and no hover/dwell state is live, return after a few integer comparisons. This removes nearly all work for normal mouse use.
2. **Cache what the getters return.** Scale factor, monitor rect, window visibility, HWNDs and the three settings are read once, then refreshed on the events that already exist (`ScaleFactorChanged`, display change monitor, settings watcher, `visibility-change`). `update_main_interaction` becomes lock-free reads of atomics plus arithmetic. This also fixes the duplicate `primary_monitor()` calls.
3. **One driver, not three.** The hook worker, the watchdog and `refresh_main_interaction` all call the same function. Make the watchdog run only while something is pending (dwell in progress, mixer open, button held, hover state live), and sleep on a condvar otherwise. Idle cost goes from 25 wake-ups a second to zero.
4. **Deep module:** wrap all of this in one `CursorTracker` (cached geometry in, `HoverDecision` out, side effects applied in one place). It replaces the 13 loose `static MH_*` atomics in `services.rs` and removes the pure logic from the Win32 and Tauri calls, which is what makes it testable.

Tests (Rust): table tests for `CursorTracker::decide` (cursor positions around the band, notch rect, edge cards; hysteresis; fullscreen; capture UI); a test that a stationary idle tracker reports "nothing pending" (so the watchdog sleeps).

### Phase 3: collapse the React render chain (frontend)

1. **Derive, don't mirror.** `isHidden` should read `isAnyInteraction` directly for the "active" case and use `interactionState` only for the 800 ms grace period. That removes the extra render in step 2 of section 5 and puts the reveal one frame sooner.
2. **Pull the hover state into its own small hook** (`useNotchHover`) that owns `isHovered`, `isNotchHovered`, `isEdgeHovered`, the grace timer and the `set_notch_hovered` IPC, and returns a single `isInteracting`. `App.tsx` stops juggling four booleans and one effect chain.
3. **Stop App re-rendering for leaf data.** The clock and `useSystemStats` values are only drawn in small widgets. Move them into leaf components (`<StatusClock/>`, `<StatsStrip/>`) that subscribe on their own, so a clock tick or a stats poll re-renders a few DOM nodes, not the 1,880-line tree. Same treatment for the audio visualizer's state (already memoised) and battery pulses where practical.
4. **Skip no-op hover IPC.** `set_notch_hovered` fires on `isNotchHovered` changes that the backend already knows about (it just emitted the event). Send only genuine changes.

Tests (Vitest + Testing Library): `useNotchHover` as a hook: edge-hover event shows the pill in one render; leaving starts the 800 ms grace; re-entering cancels it; fake timers. Render-count test on `App` showing a clock tick and a stats update do not re-render the notch shell.

### Phase 4: stop doing bookkeeping every frame (frontend)

1. **Report the rect once per transition, not per frame.** The pill's *target* box is already computed (`pillTargetRef`); send that to `update_notch_rect` when the target changes. Drop the `ResizeObserver` for the notch rect (keep it for bubbles that size themselves) or debounce it to the end of the spring. The backend note "NOTCH_RECT lags the animation" goes away as a side effect.
2. **Region only when its inputs change.** Give the `updateNotchRegion` effect a real dependency list (target box, bubble/tooltip visibility) and cache the `measureElements` results, invalidating on the bubbles' own mount/unmount.
3. **Read `window.innerWidth` once** per resize, not per render.

Tests: with a mocked `invoke`, a hover that animates for N frames makes exactly one `update_notch_rect` and at most two `set_window_region` calls; a render with unchanged inputs makes none.

### Phase 5: make the animation cheap to paint (frontend + CSS)

Do these one at a time and keep each only if Phase 0's frame numbers improve.

1. **Animate the clip, not the layout.** Keep the pill at its *final* size and animate `clip-path: inset(...)` / `transform: scale` (compositor-friendly), or at minimum animate only `height` and `width` and nothing else. Border radii animate on one shared value instead of four springs.
2. **Remove `filter: blur(0px)` from the rest state.** Only apply a filter while actually fading out, and drop it entirely if the opacity-and-slide alone reads fine.
3. **Replace the edge-surface mask composite** with an SVG/`clip-path` shape (the shape is static; only its size changes). Keep the single-layer, single-edge-geometry rule from `EdgeSurface.css`.
4. **Pre-blur the ambient glow.** Render the album art once to a small canvas, blur it there, and show that bitmap; do not run a 52 px CSS blur on a 1.8x image each time the panel repaints.
5. **Right-size the transparent window.** The 640 px tall layered window only needs to be tall while the AI panel is open. Keep it short (the status/idle height) and grow it when a tall panel opens. This directly shrinks what DWM composites and what `SetWindowRgn` has to clip.
6. **Tune the spring** after the above: a slightly stiffer, better-damped spring settles sooner without overshoot. Last, because it is a feel change.

Tests: Vitest checks the pill's `animate` props contain no `filter` at rest; a screenshot comparison (Playwright) of collapsed, hovered and open states to prove the paint changes are visually identical.

### Phase 6: guard the main thread during animation

- Pause non-visible work while the pill is mid-transition: the clock tick can skip a beat; `audio-visualization` events can be coalesced to one `setState` per animation frame (`requestAnimationFrame` batching) so 31 Hz bursts never queue up behind a transition. (The metrics poll is already off the UI thread and paused when hidden after Phase A.)
- Don't call `re_assert_topmost` (a synchronous `SetWindowPos` + style write) at the moment of the click-through flip when a transition is about to start; defer it to just after the first frame.

Tests: unit test for the coalescer (many events in a frame ⇒ one state update); Rust test that the topmost re-assert is skipped while a transition flag is set.

### Phase 7: launch

1. **Don't gate the notch on the splash unless a splash will play.** Today the main window mirrors the overlay's splash decision and waits on `splash-done` with a 6 s fallback. Have the backend decide once and emit one `startup-plan` event, so a normal launch starts immediately.
2. **Replace the 100 ms `isVisible()` polling** with the existing `visibility-change` event.
3. **Create the overlay window lazily:** only when the volume/brightness cards are enabled or a splash must play, and not as a full-screen WebView2 at every launch. Saves a process and its memory, and removes the show/hide dance in `setup`.
4. **Start the AI session on first use** (hover over the Ask bar or open the panel) instead of at mount; resume-last-chat is only needed once the panel opens.

Tests: Playwright/Vitest timing test that a normal launch reaches "pill expanded" without waiting on a timer; Rust test that the overlay is not created when both edge cards are off.

## Order and expectations

| Order | Phase | Expected effect | Risk |
|---|---|---|---|
| 1 | 0 Measure + stall detector | none (names each hang's cause; includes a trace of the AI open) | none |
| 2 | B Smooth AI open | removes the shake on toggling AI mode and while answers stream | low to medium (screenshot tests guard the visuals) |
| 3 | A Keep the UI thread free | removes periodic freezes (every-3 s network/metrics hitch, save/scan stalls) | low |
| 4 | 2 Cheap hover path | removes stutter caused by background threads waiting on the UI thread | medium (hit-testing is subtle; heavy tests first) |
| 5 | 3 Render chain, 4 Per-frame bookkeeping | fewer renders per hover; smoother expand/collapse | low |
| 6 | 5 Paint cost | smoother, lower GPU/CPU for every panel | medium |
| 7 | 1, 6, 7 | timing tidy-up, animation guard, launch time | low |

### Making the app lighter

The same work is also what makes the app lighter, not just smoother:

- **Memory and processes:** the overlay is a second full-screen WebView2 created at every launch (Phase 7.3 makes it lazy). Each WebView2 is several processes.
- **Idle CPU:** the 25 Hz watchdog, the 3 s metrics poll (four calls), the 1 s clock re-rendering all of `App`, and the 100 ms startup poll all run when nothing is happening. Phases A, 2, 3 and 7 take idle wake-ups to near zero.
- **Startup JS:** the entry bundle is about 635 KB + 377 KB + 205 KB. Splitting the markdown stack (Phase B.1) and keeping all AI code out of the entry chunk cuts what must be parsed before the notch shows.
- **Paint area:** a smaller transparent window, a static (not animated) mask and no standing filters shrink what the compositor redraws every frame.

Phase 2 touches the code with the most hard-won edge cases (drag-and-drop through OLE, fullscreen, Snipping Tool, hysteresis comments in `update_main_interaction`). Every one of those comments becomes a named test case before the refactor, so behaviour is preserved.

## Out of scope

- Changing what the notch looks like.
- Replacing WebView2 or moving the notch to native rendering. If Phase 5 still can't hold 60 fps on the animation, that is the next conversation, with the Phase 0 trace as evidence.

## Decided

- The hover delay (`zara-notch-edge-delay`, default 200 ms) is unchanged. It is a user setting.

## Open questions

1. **First open vs. later opens.** Is the AI toggle shakiest the *first* time after launching Zara and smoother afterwards, or equally shaky every time? First-only points at the chunk load (B.1); every time points at focus, layout and paint (B.3 to B.5). Also: does it shake when the answer is streaming in, or only when the panel opens or closes?
2. **Lazy overlay window (Phase 7.3).** Are the left/right volume and brightness cards something you want enabled by default? If so the overlay stays, and only the startup polling changes.
