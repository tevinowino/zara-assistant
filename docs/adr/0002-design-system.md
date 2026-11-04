# ADR 0002: The assistant UI uses the notch's design language

Status: accepted, 2026-10-31

## Decision

All new notch and Settings UI follows the notch's existing look, not the styling of
the old Electron Zara.

- **Colour and surfaces:** the CSS custom properties that `src/theme.ts` writes
  at runtime: `--zara-bg`, `--zara-bg-expanded`, `--zara-text`,
  `--zara-text-muted`, `--zara-border`, `--zara-accent`, `--zara-group-bg` and
  `--zara-scrollbar-thumb`. No hard-coded colours, so the user's theme, accent
  and opacity settings apply to the assistant too.
- **Motion:** `framer-motion` springs matching the notch. The most common are
  stiffness 400 / damping 30 (panels), 1000 / 40 (snappy toggles), 600 / 30 and
  400 / 25. Reduced motion is honoured.
- **Styling mechanism:** hand-written CSS next to the component, like the rest of
  the notch. Zara's Tailwind 3 utility classes are not carried over.
- **Components:** new code lives in `src/ai/` and is mounted into the notch and
  Settings with small hook-in edits; `App.tsx` does not grow.

## Consequences

- Notes colours, markdown, charts and the avatar are restyled when ported
  instead of copied.
- Component tests assert on roles and text (Testing Library), never on class
  names.
