---
paths:
  - "css/**/*.css"
  - "*.html"
  - "js/theme.js"
---

# Design rules

## Theme (light/dark) — follow this everywhere
- Light colors are the `:root` tokens; dark colors live in ONE block, `:root[data-theme="dark"]`. Never add a
  `@media (prefers-color-scheme)` block or a second dark block — `theme.js` already resolves System via `matchMedia`
- Every new color is a token defined in BOTH places (light `:root` + the dark block), incl. glows/tints/gradients
- `color-scheme` is set per theme so native controls (scrollbars, inputs) match
- Every page links `css/style.css` and loads `storage.js` + `theme.js` un-deferred in `<head>`; new pages must too.
  `theme.js` sets ONLY `<html data-theme="light|dark">`
- Check every UI change in Light, Dark and System (OS light + dark); tests emulate the OS with
  `Emulation.setEmulatedMedia` and assert `document.documentElement.dataset.theme`

## Colors
- Colors are CSS custom properties on `:root`, redefined in `:root[data-theme="dark"]` — never hard-code colors
  in rules. This includes glows, tints and gradients (`--gradient-brand`, `--gradient-text`, `--icon-tint`, `--btn-glow`, …)
- The only literal allowed outside the token blocks is `black` in the progress-ring `mask` (alpha, not a visible color)

## Look
- **Soft pastel dreamy**: lavender → pink → baby-blue gradient, large blurred drifting light blobs, twinkling
  four-point sparkles, a few falling sakura petals; dark theme = dusky violet
- Cards are frosted glass (`--glass`, `--glass-strong` + `backdrop-filter`); accents violet `--primary`, sakura pink
  `--sakura`; mode colors focus lavender / short mint / long sky; buttons use a violet → pink gradient
- The scene is one `<div class="scene" aria-hidden="true">` fixed behind `.app` (`pointer-events: none`);
  `index.html` and `blocked.html` contain the same scene markup — keep them in sync
- Timer is a **progress ring**: `#progressBar.ring-progress` is a conic-gradient masked into a ring, driven by the
  `--p` percentage that `app.js` sets; ring size is the `--ring` custom property on `.timer`
- All artwork is original CSS + inline SVG: **no images, web fonts, icon fonts or CDNs**; rounded system fonts only
  (`ui-rounded` / `Segoe UI Variable Display`; `Yu Gothic UI` / `Meiryo` for Japanese)

## Layout
- **One screen, no page scroll:** `body { overflow: hidden }`, `.app` is `100dvh` (top bar + `.stage`); timer and
  stats side by side, stacked below 860px; sizes use `clamp()`/`vh` so it fits from phone to desktop.
  Only windows shorter than 560px fall back to page scrolling. The settings card scrolls inside itself if needed
- Verify at 1280×760, 1366×640 and 390×844

## Motion and accessibility
- Animate only `transform`/`opacity`; `prefers-reduced-motion: reduce` stops every animation and hides petals
- Real `<button>` elements, visible focus styles, `aria-live` on the time display; decorative SVG is `aria-hidden`
