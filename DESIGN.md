# Legal Annotator — Design System Specification

## 1. Dual-Skin Editorial Architecture
All UI markup shares a single DOM (`index.html`), themed via `html[data-skin="folio"|"casebook"]` (with `'classic'` legacy fallback for returning users).

### Skin 1: Chancery & Folio (`data-skin="folio"`, Day — Default)
- **World:** Bound court reporter and daylight library carrel on cool bone paper.
- **Color Scheme:** `light`
- **Core Tokens (`:root[data-skin="folio"]`):**
  - Surfaces: `--bg: #E7E9E5`, `--surface: #F4F5F2`, `--surface-2: #E1E4DD`, `--surface-paper: #FAFAF7`, `--surface-pressed: #D6DBD1`
  - Ink & Rules: `--ink: #111822`, `--ink-muted: #4A5563`, `--rule: #C7CDC4`, `--rule-strong: #A6B0A3`
  - Accents: `--accent: #164A38`, `--accent-hover: #113C2D`, `--accent-ink: #F7F8F5`, `--judicial-ink: #1D3557`, `--danger: #8F2622`, `--focus: #164A38`, `--gilt: #C7A455`, `--gilt-ink: #F6E7B8`
  - Geometry & Elevation: `--radius-s: 4px`, `--radius-m: 7px`, `--shadow-lift: 0 2px 5px rgba(17, 24, 34, 0.08), 0 1px 2px rgba(17, 24, 34, 0.06)`, `--icon-stroke: 1.65`
  - Motion: `--dur-fast: 120ms`, `--dur-med: 180ms`, `--dur-slow: 240ms`, `--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`, `--ease-spring` (`linear(...)` via `@supports`)
  - Subject Spines: `--subj-1: #6E2326`, `--subj-2: #1F3A56`, `--subj-3: #1F5440`, `--subj-4: #6E4919`, `--subj-5: #3B4D5E`, `--subj-6: #55324E`
  - Archival Highlight Inks: `--ink-yellow: #F2DF8D`, `--ink-green: #C6E2CA`, `--ink-blue: #C4DCF0`, `--ink-pink: #EFC7CD`

### Skin 2: Darkroom Casebook (`data-skin="casebook"`, Night)
- **World:** Photographic darkroom / 1 a.m. study under a single reading lamp.
- **Color Scheme:** `dark`
- **Core Tokens (`:root[data-skin="casebook"]`):**
  - Surfaces: `--bg: #151311`, `--surface: #1c1916`, `--surface-2: #25211d`
  - Ink & Rules: `--ink: #e6dfd4`, `--ink-muted: #a89d8e`, `--rule: #332d27`
  - Accents: `--accent: #dd6c45`, `--accent-ink: #14110f`, `--danger: #d16b5e`, `--focus: #e2855e`
  - Internal Casebook Palette: `--cb-sage`, `--cb-sage-text`, `--cb-sage-tint`, `--cb-sage-rule`, `--cb-accent-tint`, `--cb-accent-rule`, `--cb-danger-tint`, `--cb-rule-strong`, `--cb-hover`, `--cb-active`, `--cb-paper`, `--cb-paper-well`, `--cb-paper-ink`, `--cb-paper-dim`, `--cb-paper-lit`, `--cb-paper-muted`, `--cb-lamp-pool`, `--cb-lamp-bar`, `--cb-capsule-bg`, `--cb-receded-bg`, `--cb-receded-surface-2`, `--cb-receded-ink`, `--cb-receded-muted`, `--cb-receded-rule`, `--cb-judicial`, `--cb-amber-text`, `--cb-accent-text`, `--cb-danger-text`, `--cb-paper-lead`
  - Geometry & Elevation: `--radius-s: 5px`, `--radius-m: 9px`, `--shadow-lift: 0 16px 38px rgba(5, 4, 3, 0.62), 0 3px 10px rgba(5, 4, 3, 0.42)`, `--icon-stroke: 1.65`
  - Motion: `--dur-fast: 160ms`, `--dur-med: 240ms`, `--dur-slow: 320ms`, `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`, `--ease-spring` (`linear(...)` via `@supports`)
  - Subject Spines: `--subj-1: #c97b68`, `--subj-2: #7e9bb3`, `--subj-3: #84a387`, `--subj-4: #c2a36d`, `--subj-5: #ab8aa8`, `--subj-6: #7da19d`
  - Highlight Wash Inks: `--ink-yellow: rgba(188, 146, 68, 0.28)`, `--ink-green: rgba(108, 152, 118, 0.28)`, `--ink-blue: rgba(104, 138, 168, 0.30)`, `--ink-pink: rgba(176, 102, 108, 0.28)`

### Classic Fallback & Storage Migration (`app_ui_theme`)
- Pre-paint `<head>` script reads `localStorage.getItem('app_ui_theme')`:
  - `'paper'` or `'folio'` or unset/empty -> `data-skin="folio"` (and `body.theme-paper` legacy bridge class until full skin rollout)
  - `'slate'` or `'casebook'` -> `data-skin="casebook"` (and `body.theme-slate` legacy bridge)
  - `'classic'` -> `data-skin="classic"` (retains Classic Navy `--navy` / `--gold` palette in `body.theme-classic`)

## 2. Typography & Asset Rules
- **Chancery & Folio Fonts:** `--font-display: "Literata", "Georgia", "Palatino Linotype", "Book Antiqua", serif`; `--font-ui` & `--font-num`: `"Public Sans", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`.
- **Darkroom Casebook Fonts:** `--font-display: "Source Serif 4", Georgia, "Times New Roman", serif`; `--font-ui: "Manrope", system-ui, -apple-system, "Segoe UI", sans-serif`; `--font-num: "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace`.
- **Tabular Figures:** Counts, citations, timestamps, and zoom percentages apply `font-variant-numeric: tabular-nums lining-nums`.
- **Banned Fonts:** Zero `Inter`, `Libre Baskerville`, `Space Grotesk`, `Clash Display`, `Plus Jakarta Sans`, `Syne`, `DM Sans`, `Fraunces`, `Playfair Display`, `Cormorant`, `Lora`, `Crimson Pro`, `Newsreader`, `Space Mono`, `IBM Plex`, `DM Serif`, `Outfit`, `Instrument Sans`.
- **Iconography:** All static UI chrome uses inline SVG symbols (`<svg class="icon"><use href="#i-..."/></svg>`) from the shared hidden `.svg-sprite` at the top of `<body>`. Zero UI chrome emojis.
- **Backdrop Blur:** `backdrop-filter` is strictly restricted to `[data-skin="casebook"] .capsule` only.

## 3. Legacy Variable Bridges
Both `:root[data-skin="folio"]` and `:root[data-skin="casebook"]` map legacy CSS variables (`--navy`, `--navy-l`, `--navy-m`, `--navy-b`, `--gold`, `--gold-l`, `--gold-bg`, `--gold-hov`, `--parchment`, `--cream`, `--text`, `--muted`, `--red`, `--green`, `--gn-desk-bg`, `--gn-tab-bar-bg`, `--gn-tab-inactive`, `--gn-tab-active`, `--gn-card-bg`, `--gn-ink`, `--gn-shadow`) to active skin tokens so dynamically injected modules inherit skin contrast seamlessly.

## 4. PDF Preservation & Layout Invariants
- **No Canvas Inversion:** Never apply `filter: invert(...)` on `.pg-wrap`, `<canvas>`, `.ann-ov`, `.draw-canvas`, or `.srch-ov` in Casebook Night. Use warm desk well framing (`--bg` / `--cb-paper-well`) around `.pg-wrap`.
- **Scroll & Layer Geometry:** Preserve `#canvas-scroll` (`overflow-y: scroll; overflow-x: auto; padding: 28px 20px; gap: 24px; overflow-anchor: none`).
- **Compact Capsule vs Zoom Control:** `#btn-manage-colors .manage-colors-btn__label` stays hidden inside `.capsule`; `#floating-zoom-ctrl` respects `body:has(#desktop-engine-bar)` (`bottom: 40px`) and `#pane-a:has(#welcome)` (`display: none`).
