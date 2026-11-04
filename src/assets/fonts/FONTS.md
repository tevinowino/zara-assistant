# Fonts

| Font | Role | Licence | Source |
| --- | --- | --- | --- |
| Manrope | Headings, titles, large numerals | SIL Open Font License 1.1 | `@fontsource-variable/manrope` (npm) |
| General Sans | Body and interface text | Indian Type Foundry Free Font License | https://www.fontshare.com/fonts/general-sans |

Manrope is loaded from its npm package. The four General Sans weights here (400, 500,
600, 700) are the woff2 files Fontshare serves for web embedding. `src/fonts.css` loads both
and defines the `--font-body` and `--font-display` tokens the stylesheets use.
