# Legal Annotator — Feature-Preservation & Dual-Skin UI Overhaul Plan

> **For agentic workers (Argon Handover · Created 2026-11-12):** User approved waiting for Gemini 4 Argon (High) reset before touching production code. Do NOT modify app logic until user gives go-ahead; follow superpowers:subagent-driven-development or /swarm + Dual-Repo Parity rules in D:\Code\GEMINI.md.

## 1. Header & Architectural Overview

- **Goal:** Upgrade the live Legal Annotator web app (`D:\Code\legal-annotator`) and its Tauri 2 desktop wrapper (`D:\Code\legal-annotator-desktop`) with the Round 3 approved **Dual-Skin Editorial Architecture** (**Chancery & Folio** Day + **Darkroom Casebook** Night), native CSS/WAAPI/View-Transition motion, live Perplexity Case Digest monitoring, and editable Highlight Color Meanings — while preserving **100% of existing features**, DOM IDs, PDF.js canvas rendering & scroll math, context menus, sidebars, resizers, sync channels, and desktop native integrations.
- **Architecture:**
  - **Shared Single DOM + Tokenized Dual Skins:** All markup remains in a single shared DOM (`index.html`), switched cleanly via `html[data-skin="folio"|"casebook"]` (plus backwards-compatible fallback for `'classic'` mapped to `body.theme-classic` / `data-skin` selector if user chooses Classic Navy). Shared structural rules stay purely tokenized (`src/style.css` base layer derived from `design/mockups/base.css` with zero literal colors/radii/shadows/durations), while skin tokens and chrome treatments live strictly scoped under `:root[data-skin="folio"]` / `[data-skin="folio"]` and `:root[data-skin="casebook"]` / `[data-skin="casebook"]`.
  - **Scope 2 Overhaul:** Reskin and reorganize chrome (Study Desk `#welcome` / `#welcome-calendar`, left Library rail `#lib-side`, Reader `.casebar` & compact floating `.capsule`, Inspector `#ann-panel` / Notepad `#notepad-panel`, `Ctrl+K` Command Palette, Context Menus, and Modal Dialogs) **without touching PDF.js A4 rendering mechanics, Supabase schema invariants, or Desktop Rust/PDFium/SQLite core paths**.
  - **Native Motion:** Prefer CSS `@supports (transition-timing-function: linear(0, 1))`, `@supports (interpolate-size: allow-keywords)` + `::details-content`, `@starting-style` on `<dialog>` / `.modal-ov`, `@supports (timeline-scope: --reader-scroll)`, and `document.startViewTransition` (feature-detected), honoring `prefers-reduced-motion: reduce`.
  - **Live Perplexity & Custom Color Meanings:** Preserve immediate real popup opening on both Web and Desktop Studio while adding live status monitoring, Focus/Reopen, Stop, and forwarded Studio error banners in the main window; extend `color_categories` from create-only to full create/rename/recolor/delete without mutating historical `annotations.hex_color`.
- **Tech Stack:**
  - **Web App (`D:\Code\legal-annotator`):** Vanilla ES Modules (`src/*.js`), CSS (`src/style.css`), PDF.js `<canvas>` renderer (`viewer.js`), IndexedDB (`offline.js`), Supabase JS + Postgres Realtime (`db.js`, `sync.js`), Google Drive backup/sync (`drive.js`, `backup.js`), Service Worker (`sw.js`).
  - **Desktop App (`D:\Code\legal-annotator-desktop`):** Tauri 2 + WebView2 (Windows), `ui/src/` full web mirror + desktop-only `ui/src/desktop-bridge.js`, Rust backend `src-tauri/src/main.rs` (PDFium cache/OCR, SQLite offline mirror, loopback Google OAuth, `perplexity-studio` WebviewWindow IPC, auto-updater via `version.json`).
- **Spec / Approved Visual Prototypes (Round 3 Verified `PASS_FOR_SCOPE` in board `#39`):**
  - `D:\Code\legal-annotator\design\mockups\index.html`
  - `D:\Code\legal-annotator\design\mockups\compare.html`
  - `D:\Code\legal-annotator\design\mockups\base.css`
  - `D:\Code\legal-annotator\design\mockups\motion.js`
  - `D:\Code\legal-annotator\design\mockups\skins\folio.css`
  - `D:\Code\legal-annotator\design\mockups\skins\casebook.css`

---

## 2. Global Constraints & Non-Negotiable User Requirements

1. **Toggleable Dual Skins + Zero Fake Digest Buttons:**
   - Both **Chancery & Folio** (Day) and **Darkroom Casebook** (Night) MUST be toggleable at runtime (and keep/migrate `goodnotes-ui.js:10` `'app_ui_theme'` cleanly).
   - **NO** simulated or fake `"Run digest"` button anywhere (`progress.ring`, `.digest-run`, `#runDigestBtn`, fake 4s steppers were scrubbed in Round 3 and must never enter production).
2. **Real A4 PDF.js Rendering Strictly Preserved:**
   - Both Web and Desktop render PDFs via PDF.js `<canvas>` (`src/viewer.js:602,992`). Note: `window.__DESKTOP_PDFIUM__.openPdf` (`viewer.js:595-598`) only caches PDF bytes for OCR/Studio; `desktop-bridge.js:235-259` `renderPageToCanvas` has `0` callers in `src/`.
   - Keep pixel-locked `.pg-wrap` inline CSS px sizing (`vp = page.getViewport({ scale: S.scale })`, `S.scale = 1.5` = `100%`) and the exact 5 stacked layers (`<canvas>`, `.ann-ov` `z-index:3`, `.draw-canvas` `z-index:4`/`6`, `.srch-ov` `z-index:5`, `.txt-layer` exact `tx[4]` / `tx[5] - fh*0.82` spans).
   - Keep `#canvas-scroll` (`style.css:309-327`): `overflow-y: scroll; overflow-x: auto; display: flex; flex-direction: column; align-items: center; padding: 28px 20px; gap: 24px; overflow-anchor: none`. Never use CSS `--page-scale` scaling or `transform: scale()` on `.pg-wrap`, never omit `overflow-x: auto`, and never change `28px` / `24px` math without updating `viewer.js:692-693,896-897` and `ui.js:889-896`. Keep page eviction (`EVICT_PAGE_DISTANCE = 22` when `totalPages > 50 && _renderedPages.size > 30`, `viewer.js:275-312`) and all 3 zoom inputs (Toolbar/Pill buttons, Ctrl+Wheel `desktopWheelZoom`, Pinch).
   - **Casebook Night & PDFs:** Never apply `filter: invert(...)` or `.page__para:hover` CSS filters on PDF.js `<canvas>` or `.pg-wrap` (it breaks embedded legal figures/highlights and cannot target raster PDF canvas pixels). Use subtle warm dark desk well framing (`--cb-paper-well` / `--bg`) around `.pg-wrap` plus optional subtle brightness/frame border preference if desired.
3. **Real Perplexity Case Digest Popup Always Opens:**
   - Clicking `#btn-perplexity-digest`, `#ctx-perplexity-digest`, or `#ctx-folder-perplexity-digest` MUST ALWAYS immediately open the real Perplexity window so the user can see and troubleshoot login, model selection, or pinned Space issues:
     - **Desktop:** invokes `desktop_open_perplexity_studio` (`smart-copy.js:1100-1116`, `main.rs:2816-2936`).
     - **Web:** MUST call `window.open('about:blank', '_blank')` synchronously BEFORE async multi-page PDF text/OCR extraction (`smart-copy.js:987-992`) to survive browser popup blockers, then redirect `preOpenedWebWin.location.href` (`smart-copy.js:1120-1122`).
   - Enhance the main window with a real live monitor (`#pplxMonitorStrip` / enhanced `#la-batch-pplx-banner`): Focus/Reopen Perplexity window, Stop current/batch digest, and receive forwarded Studio errors from `perplexity-studio` -> `main`.
4. **Preserve ALL Existing Features, Sidebars, Splitters, Context Menus & Integrations:**
   - Left `#lib-side` auto-hide (`#app.sidebar-autohide`, 14px `#lib-hover-zone`, `#btn-pin-sidebar`, `280ms` leave delay, `'sidebar_autohide'`, `#lib-resize-handle` `'lib_sidebar_width'`), Right `#notepad-panel` (`#np-resize-handle` `'notepad_width'`), Right `#ann-panel` (`#ap-resize-handle` `'ann_panel_width'`), Dual-View (`#dual-divider`, `#pane-a`/`#pane-b`), `#tags-panel`, Search (`#search-panel`, `#panel-find-bar`), all Folder right-click (8) & Multi-Folder right-click (6) items, all PDF right-click (13) items, all Table right-click (10) items, Hover inline actions (`.li-acts`), Study Desk + Class Schedule + Syllabus import, OCR & OCR Studio, Diagram builder + Diagram/Table Lightboxes, IndexedDB / Supabase / Outbox / Drive Backup / Desktop SQLite, Desktop Engine Bar / Gmail OAuth / Auto-Updater UI.
5. **Keep Floating Capsule Compact vs `#floating-zoom-ctrl` (and `#desktop-engine-bar`):**
   - At `1024px–1280px` viewport widths (especially when sidebars are open or pinned), `.capsule` collides with `#floating-zoom-ctrl` if it carries wide text buttons. Note that mockup `base.css:3022-3027` only hides `.capsule .manage-colors-btn__label` below `960px`.
   - **Mandatory rule for production:** `#btn-manage-colors` inside `.capsule` MUST remain **icon-only at ALL viewport widths** (hide `.manage-colors-btn__label` inside `.capsule` unconditionally, keeping `title` + `aria-label` tooltip), while `#btn-panel-manage-colors` inside `#ann-panel` / Notes keeps its full text label (`"Customize colors"`). Respect `#floating-zoom-ctrl`'s `bottom: 40px` shift when `body:has(#desktop-engine-bar)` (`style.css:2267-2269`) and `#pane-a:has(#welcome)` hide rule (`style.css:2270-2272`).
6. **Zero Emoji UI Chrome + Banned Font Policy:**
   - Replace all UI chrome emojis (`📌`, `⚡`, `📋`, `📁`, `⚖️`, `📝`, `💾`, `🖍️`, `☀`, `🌙`, `🔍`, `🗑`, `⬇`, `🔗`, `⏳`, `⏹`, `🎉`, etc.) in HTML/JS chrome strings (buttons, tabs, headers, context menus, status pills) with crisp `<svg class="icon"><use href="#i-..."/></svg>` sprite symbols from `design/mockups/index.html:30-155` (plus any new clean stroke icons needed).
   - Preserve user-created content cleanly: do NOT strip emojis stored inside existing user-created note HTML, highlighted text, PDF filenames, or existing subject emoji fields in Supabase/localStorage (migrating `#mo-subj` emoji swatch display gracefully).
   - **Banned Fonts:** Zero use of any banned font family (`Inter`, `Space Grotesk`, `Clash Display`, `Plus Jakarta Sans`, `Syne`, `DM Sans`, `Fraunces`, `Playfair Display` / `Playfair`, `Cormorant`, `Lora`, `Crimson Pro` / `Crimson`, `Newsreader`, `Space Mono`, `IBM Plex`, `DM Serif`, `Outfit`, `Instrument Sans`). Remove the live `Inter` + `Libre Baskerville` Google Fonts `<link>` / `@import` and inline/CSS `font-family` declarations (`index.html:20`, `src/style.css:1`, and JS inline styles), replacing them with the verified skin font stacks (`Literata` + `Public Sans` for Folio; `Source Serif 4` + `Manrope` + `JetBrains Mono` for Casebook, with safe system serif/sans/mono fallbacks if offline). Note: `backdrop-filter` stays strictly confined to `[data-skin="casebook"] .capsule` (never scatter frosted glass across panels/cards).
7. **Desktop Parity & Single Atomic Release (`D:\Code\GEMINI.md`):**
   - Author UI changes in `D:\Code\legal-annotator\src\` (and `index.html`) first; mirror modified/added files from `D:\Code\legal-annotator\src\` -> `D:\Code\legal-annotator-desktop\ui\src\` (and root `index.html` -> `ui/index.html`) **NEVER overwriting `ui/src/desktop-bridge.js`** unless desktop IPC itself is intentionally edited. Verify byte-for-byte parity with `Get-FileHash`.
   - Single Atomic Release sequence run once after all tasks finish: verify `git diff --name-only`, run `node --check` on all JS files, bump `build` (+1 from `41` -> `42`) and `version` in `D:\Code\legal-annotator-desktop\version.json` saved as **UTF-8 without BOM** (verify no `EF BB BF`), run Git Secret Shield on both repos, build with `cargo build --release --manifest-path D:\Code\legal-annotator-desktop\src-tauri\Cargo.toml`, copy compiled binary to `D:\Code\legal-annotator-desktop\Legal Annotator.exe`, commit and `git push` both repos (`main`), report new `version` and `build`.

---

## 3. Review Focus (High-Risk Failure Modes to Pin Tests Against)

Every PR / task review and automated Playwright/WebView2 regression check MUST explicitly assert against these 7 failure modes identified in `#22`, `#33`, and `#34`:

1. **PDF.js Canvas & Layer Coordinate Desync / Scroll Jump (`viewer.js:636-698,895-1025`, `style.css:309-372`, `ui.js:889-896`):**
   - *Failure mode:* Applying mockup `.page` rules (`max-width: 44rem`, `--page-scale`, CSS transform, missing `overflow-x: auto`, or changed `28px`/`24px` padding/gap, or dropping `overflow-anchor: none`) causes `.txt-layer` text selection boxes, `.ann-ov` highlight rects, and `.draw-canvas` pen strokes to drift off text, breaks horizontal panning when zoomed past container width, and breaks `viewer.js:692-693,896-897` algebraic scroll-resume offsets & lazy eviction.
   - *Pin test:* Open a multi-page PDF at `100%`, zoom to `150%` (`S.scale = 2.25`), verify `.pg-wrap` inline px dimensions equal `<canvas>` CSS width/height, `canvas-scroll` allows horizontal + vertical scroll, selecting text places highlight rect directly over text bounds, and bookmark resume lands on exact page + ratio without bounce.
2. **Perplexity Popup Blocker & Studio->Main Silent Stall (`smart-copy.js:780-1144`, `main.rs:1638-3019`):**
   - *Failure mode:* Calling `await extractPdfText()` before `window.open('about:blank', '_blank')` gets blocked by browser popup blockers on Web; moving Perplexity trigger behind a delayed modal or hiding Desktop Studio behind main window causes silent 6-minute hangs when logged out / missing Space / prompt box missing (`#la-pplx-status` error never reaches main window).
   - *Pin test:* On Web, verify `window.open('about:blank', '_blank')` fires synchronously inside click stack before batch extraction starts, and updates `.location.href` afterward (or closes safely on empty-OCR error). On Desktop/mock IPC, simulate `studio_error` and `studio_status` navigation messages (`__pplx_msg`), verifying `#pplxMonitorStrip` shows actionable alert + Focus Studio + Stop cancels pending batch promise immediately.
3. **Bottom Dock Collision at 1024px–1280px (`style.css:2255-2272`, `design/mockups/base.css:1324-1483,3022-3027`, `desktop-bridge.js:667-708`):**
   - *Failure mode:* Expanding `.capsule` with `"Customize colors"` label + full tool labels overlaps `#floating-zoom-ctrl` (and `#desktop-engine-bar` at `bottom: 40px`) when `#lib-side` (`272px`) and a right panel (`340px–380px`) are open simultaneously at `1024px` or `1280px`.
   - *Pin test:* Compute `getBoundingClientRect()` of `.capsule`, `#floating-zoom-ctrl`, and `#desktop-engine-bar` at `1440x900`, `1280x800`, and `1024x768` (with sidebar pinned AND with `#notepad-panel` / `#ann-panel` open) — assert zero overlap (`rectA.right < rectB.left` or separated vertically) and `#btn-manage-colors .manage-colors-btn__label` hidden inside `.capsule`.
4. **Sidebar Auto-Hide Hover Trap During Context Menu / Resizing (`ui.js:247-426`, `library.js:403-644`):**
   - *Failure mode:* When `#app.sidebar-autohide` is active (`#lib-side` has `.hover-open`), right-clicking an item opens `#lib-ctx-menu` (`position: fixed` outside `#lib-side`). Moving cursor onto `#lib-ctx-menu` fires `mouseleave` on `#lib-side`, shutting the sidebar after `280ms` while the menu stays open — OR dragging `#lib-resize-handle` triggers mouse-leave collapse mid-drag.
   - *Pin test:* Enable Auto-Hide, hover left edge to open `#lib-side.hover-open`, right-click `.li-pdf` to open `#lib-ctx-menu`, hover over `#lib-ctx-menu` items for `>400ms` — assert `#lib-side` stays open while `#lib-ctx-menu` is visible and while `.is-resizing` / `isResizing` is active.
5. **Context Menu & Modal Visibility Mismatch (`style.display` vs `[hidden]` vs `<dialog>.showModal()`):**
   - *Failure mode:* Mixing mockup `.ctx-menu[hidden]` / `<dialog class="modal-dialog">` patterns with live `library.js` / `tablepicker.js` / `ui.js` callers that toggle `el.style.display = 'block'|'none'` or `.modal-ov.open` leaves menus invisible or unclosable (CSS `[hidden]` vs inline `style.display`, or static backdrop click vs native `<dialog>`).
   - *Pin test:* Open and close `#lib-ctx-menu` (single PDF, single Folder, 2+ multi-selected Folders), `#table-ctx-menu` (editable vs read-only table), `#mo-copy-instructions`, `#export-opts-modal`, `#mo-color` / `#mo-color-categories`, and `#commandPalette`; assert single-action clicks execute and close via button, backdrop, and `Escape`.
6. **Legacy `annotations.hex_color` Data Loss & Broken Swatch Highlighting (`annotate.js:247-274`, `db.js:493-506`, `tablepicker.js:1294`):**
   - *Failure mode:* Renaming or recoloring a category in `#mo-color-categories` either deletes/corrupts existing `annotations.hex_color` rows or displays blank labels for legacy highlights whose hex is no longer in `S.colorCats` (e.g., `#c9a84c` or deleted custom hex). Separately, `tablepicker.js:1294` compares `x.style.background === c` which fails (`rgb(...) !== '#rrggbb'`) because `.cdot` lacked `data-color`.
   - *Pin test:* Pre-seed an annotation with deleted hex `#c9a84c` and one matching renamed category `#eab308` -> `"Ratio"`, assert old highlight renders visually on canvas with `#c9a84c`, shows fallback label `Custom (#c9a84c)` without crashing, `rgbToHex` normalization matches `.cdot[data-color]` in lowercase `#rrggbb`, and `backup.js` exports updated categories + settings.
7. **Desktop Mirror Clobber, `version.json` BOM, & Casebook Raster Inversion (`D:\Code\GEMINI.md`, `goodnotes-ui.js:72-107`):**
   - *Failure mode:* Mirroring `web/src/*` over `desktop/ui/src/*` overwrites `desktop-bridge.js`; PowerShell `Set-Content` writes UTF-8 BOM (`EF BB BF`) to `version.json` causing Tauri JSON parse failure; applying `filter: invert()` in Darkroom Casebook turns embedded PDF figures/images negative; forgetting `app_ui_theme` mapping breaks returning users who had `'paper' | 'slate' | 'classic'`.
   - *Pin test:* Run `Get-FileHash` parity check + verify `desktop-bridge.js` untouched; inspect first 3 bytes of `version.json` (`!= 0xEF 0xBB 0xBF`); verify `html[data-skin="casebook"] .pg-wrap canvas` computed `filter === 'none'`; test `localStorage.app_ui_theme = 'paper'` / `'slate'` / `'classic'` on boot.

---

## 4. Complete Data Inventory / Preservation Matrix

> **Note:** Line numbers below reflect the verified pre-overhaul codebase state as of **2026-11-12**. Always confirm target symbol names when editing after earlier tasks shift line offsets.

### 4.1 Sidebars, Splitters, Auto-Hide, Pin & Layout Storage Keys

| Surface / Mechanic | Preserved DOM IDs & Classes | CSS / Dimensions / Behavior | JS Handlers & Triggers | Storage / Sync Keys | Baseline `path:line` |
|---|---|---|---|---|---|
| **Left Library Sidebar** | `#app` (`.sidebar-autohide` when unpinned), `#lib-hover-zone`, `#lib-backdrop`, `#lib-side` (`.open`, `.hover-open`), `#btn-pin-sidebar`, `#lib-close`, `#mob-menu-btn`, `#lib-resize-handle.panel-resizer-right` | `:root { --lib-w: 272px }`; resizer clamps `200px .. Math.floor(innerWidth * 0.6)`; `#lib-hover-zone` `14px` fixed left edge (`display:none` -> `block` in `.sidebar-autohide`); `<=1024px` fixed `320px / 85vw` drawer; hover leave timer `280ms` (`clientX <= 12` safety net) | `isSidebarAutoHide()`, `setSidebarAutoHide()`, `openSidebar()`, `closeSidebar()`, `toggleSidebar()`, `initSidebar()`, `initSidebarResizer()`; auto-closes on PDF/Ref/FolderDoc/Digest open (`library.js:413,425,434,1082,1337`), window resize `<=1024px`, and `[` / `Ctrl/Cmd+B` | `'sidebar_autohide'` (`'true'|'false'`), `'lib_sidebar_width'` (px string) | `index.html:51-95,108`; `style.css:17,34-84,579-603,729-738`; `ui.js:247-426,982-988` |
| **Right Panel 1: PDF Notepad** | `#notepad-panel` (`.open`), `#np-resize-handle.panel-resizer-left`, `#np-close`, `#nptab-notes`, `#nptab-digest`, `#np-editor`, `#np-digest-editor`, `#np-toolbar`, `#np-local-lbl`, `#np-save-lbl`, `#np-save-now-btn`, `#np-history-btn`, `#np-history-modal`, `#np-save-error-banner` (`#np-serr-view-log`, `#np-serr-dismiss`) | `width: 340px; min-width: 260px; max-width: 85vw; transform: translateX(100%)`; `.open` `z-index: 30`; resizer clamps `260px .. Math.floor(innerWidth * 0.85)`; `<=1024px` becomes `60vh` bottom sheet. *No pin/auto-hide.* | `initNotepadResizer()`, `switchNotepadTab()`, `closeNotepad()`, `flushNotepadSave()`, `#btn-notepad`; closes on `#np-close`, `Escape`, `closeOtherPanels()` | `'notepad_width'`, `local_digest_<id>`, `local_digest_map`, `pdf_notes`, IDB, SQLite `upsertPdfNote`/`saveNotepadHistory` | `index.html:397-494,1334`; `style.css:531-639,662-671`; `notepad.js:209-275,1049-1133,2363,2546,2608-2663` |
| **Right Panel 2: Annotation Inspector** | `#ann-panel` (`.open`), `#ap-resize-handle.panel-resizer-left`, `#ap-ex`, `#ap-close`, `#ap-colors`, `#aptab-general` (`#badge-general`), `#aptab-case` (`#badge-case`), `#ann-notes`, `#note-editor`, `#btn-del-hi`, `#btn-add-note`, `#ap-tags-container` | `:root { --ann-w: 330px }`, `#ann-panel { width: var(--ann-w, 380px); min-width: 280px; max-width: 90vw }`; resizer clamps `260px .. Math.floor(innerWidth * 0.85)`; `<=1024px` overridden to `height: 68vh`. *No pin/auto-hide.* | `initAnnPanelResizer()`, `openAnnPanel()`, `closeAnnPanel()`, `renderAnnColors()`, `dbUpdateAnnColor()`, tooltip `.ann-hover-tip` (`annotate.js:192`) | `'ann_panel_width'`, Supabase `annotations` & `annotation_notes` | `index.html:499-525,1355-1359`; `style.css:18,396-424,739-740`; `annotate.js:61-100,247-358,608-663` |
| **Right Panel 3: Topic Coverage & Tags** | `#tags-panel.slide-panel` (`#tp-close-btn`, `#tp-new-topic-input`, `#tp-btn-create-topic`, `.tp-chip`, `#tp-btn-open-workspace`, `#tp-step-prev`, `#tp-step-next`), `#topic-notes-modal` | Injected into `#viewer-wrap`: `position: fixed; top: 44px; right: 0; width: 380px; max-width: 95vw; z-index: 120` (duplicated in `style.css:2029` and `#tags-dynamic-styles` `tags.js:1013`). *No resize/pin/auto-hide.* | Opened by `#btn-tags` (`main.js:137`, `tags.js:583`), closed by `#tp-close-btn` (`tags.js:606-608`), calls `closeOtherPanels('tags-panel')` (`tags.js:582`) | `'pdf_tags_v1_<id>'` (`app_settings` + Realtime `sync.js:175`) | `style.css:2029-2046`; `tags.js:355-430,582-608,1013,1849-1900` |
| **Dual-View Split** | `#pane-a` (`#pane-a-header`, `#pane-a-name`), `#dual-divider`, `#pane-b` (`#pane-b-header`, `#pane-b-name`, `#btn-close-pane-b`, `#canvas-scroll-b`) | `col-resize` drag splits `#pane-a`/`#pane-b`, min `200px` each; hidden `<=1024px` (`style.css:742-743`). Pane B renders read-only at `S.scale` | `dualview.js:51-56,162-198`, `#btn-swap-panes` (`index.html:214`) | Unpersisted split width | `index.html:214,282-390`; `style.css:742-770`; `dualview.js:51-56,162-198` |
| **Top Search & In-Panel Find** | `#search-panel` (`.stab[data-stab="pdf"|"ann"]`, `#search-input`, `#search-count`, `#sprev`, `#snext`, `#search-close-btn`, `#search-ann-results`), `#panel-find-bar` (`#pf-input`, `#pf-count`, `#pf-prev`, `#pf-next`, `#pf-close`) | Top slide-down bar `#search-panel`; fixed find strip `#panel-find-bar` inside `#notepad-panel`/`#ann-panel` | `#btn-search` / `Ctrl+F`, `openSearch()`, `closeSearch()`, `runAnnSearch()`, `panel-find.js:39-61` | In-memory | `index.html:223-238`; `style.css:283-303`; `search.js:313-346`; `panel-find.js:34-61` |
| **Desktop Floating Engine Offset** | `#desktop-engine-bar` (`#desktop-engine-lbl`, `#desktop-ram-lbl`) | `MutationObserver` on `#ann-panel` & `#notepad-panel` sets `right: panelWidth + 14px` (or `bottom: panelHeight + 12px` at `<=1024px`); `body:has(#desktop-engine-bar) #floating-zoom-ctrl { bottom: 40px }` | `updateDesktopEngineBarPosition()` in `desktop-bridge.js:667-708` | N/A | `desktop-bridge.js:650-708`; `style.css:2267-2269` |

### 4.2 Complete Context Menus, Popovers & Hover Actions

1. **Library Context Menu `#lib-ctx-menu`** (`index.html:1398-1413`, `src/library.js:38-289,403-644,1064-1068`) — right-click on `.li-pdf` and `.li-fold-hd` (Note: `.li-subj-hd` has NO right-click menu; `library.js` currently toggles `style.display` and uses viewport-flip positioning):
   - **PDF / Case (`!isFolder`, 13 exact items in visible order):**
     1. `#lib-ctx-open` — `"📖 Open"` (`index.html:1399`)
     2. `#lib-ctx-reference` — `"📑 Open as Reference"` (`index.html:1400`)
     3. `#lib-ctx-set-page` — `"📌 Set Default Opening Page…"` (`index.html:1401`)
     4. `#lib-ctx-link` — `"🔗 Create Shortcut…"` (`index.html:1404`)
     5. `#ctx-move-folder` — `"📂 Move to Folder…"` (`index.html:1403` / `library.js:42-52`)
     6. `#ctx-set-syllabus` — `"📌 Set as Subject Syllabus"` (`index.html:1402` / `library.js:53-64`)
     7. `#ctx-ocr-studio` — `"🗜️ OCR & Compress PDF (Studio)…"` (`library.js:65-76`)
     8. `#ctx-perplexity-digest` — `"⚡ Perplexity Digest (Auto Case Digest)"` (`library.js:77-97`, `smart-copy.js:837-845`)
     9. `#lib-ctx-offline` — `"💾 Save for Offline"` (`index.html:1405`)
     10. `#ctx-pdf-offline-remove` — `"🗑 Remove Offline Copy"` (`library.js:120-141`)
     11. `#lib-ctx-download` — `"⬇ Download to PC"` (`index.html:1406`)
     12. `#lib-ctx-force-sync` — `"☁️ Force Sync PDF to Cloud"` (static `"☁️ Force Sync to Cloud"` `index.html:1410`, rewritten `library.js:211`)
     13. Divider + `#lib-ctx-gdrive` — `"☁ Open in Google Drive"` (`index.html:1411-1412`)
   - **Single Folder (`isFolder`, 8 exact items in visible order):**
     1. `#ctx-move-folder` — `"📂 Move to Folder…"` (`index.html:1403`, `library.js:227`)
     2. `#lib-ctx-syllabus` — `"📋 Import / Order from Syllabus…"` (`index.html:1407`, `library.js:265`)
     3. `#ctx-folder-perplexity-digest` — `"⚡ Perplexity Digest All PDFs in Folder"` (`library.js:98-118,239`, `smart-copy.js:853-960`)
     4. `#lib-ctx-export-pdf` — `"📥 Export Notes to PDF"` (`index.html:1408`, `library.js:201,206`)
     5. `#lib-ctx-export-tables-pdf` — `"📊 Export Summary Tables Only"` (`index.html:1409`, `library.js:202,207`)
     6. `#ctx-folder-offline-save` — `"📥 Make Folder Available Offline"` or `"🔄 Refresh Folder Offline Copy"` when `isFolderOfflineReady(item.id)` (`library.js:142-159,250-253`)
     7. `#ctx-folder-offline-remove` — `"🗑 Remove Folder Offline Copy"` (`library.js:160-177,260`)
     8. `#lib-ctx-force-sync` — `"☁️ Force Sync Folder & PDFs"` (`library.js:203,210`)
   - **Multi-Folder Selection (`S.selectedIds.size > 1 && S.selectedIds.has(item.id)`, 6 visible items, `library.js:190-200,226-268`):**
     - Hides `#ctx-move-folder` and `#lib-ctx-syllabus`; dynamically rewrites the 6 remaining labels with `${N}`:
       1. `#ctx-folder-perplexity-digest` (`"⚡ Perplexity Digest All PDFs (${N} Folders)"`)
       2. `#lib-ctx-export-pdf` (`"📥 Export ${N} Folders to PDF"`)
       3. `#lib-ctx-export-tables-pdf` (`"📊 Export ${N} Folders (Tables Only)"`)
       4. `#ctx-folder-offline-save` (`"📥 Make ${N} Folders Available Offline"`)
       5. `#ctx-folder-offline-remove` (`"🗑 Remove Offline Copy (${N} Folders)"`)
       6. `#lib-ctx-force-sync` (`"☁️ Force Sync ${N} Folders & PDFs"`)
2. **Sidebar Row Hover Inline Actions & Status Pills** (`library.js:928-932,1022-1044,1298-1339`, `goodnotes-ui.js`):
   - Note: *Delete, Rename, Add Folder, Add Subfolder, Upload PDF, and Syllabus button triggers on tree rows live here in `.li-acts`, NOT inside `#lib-ctx-menu`*: `add-fold`, `syllabus`, `subfolder`, `upload`, `move`, `link`, `rename`, `del`.
   - Inline badges/triggers: `.subj-count-pill`, `.fold-prog-badge` (`✅ X/Y` / `⚖️ X/Y`), `.fold-offline-badge`, `.case-status-btn` (`⚖️`/`📄` -> `openCaseDigestForPdf(pdf)`), `.def-page-badge`, `.ann-badge`.
3. **Table Context Menu `#table-ctx-menu`** (`index.html:1381-1395`, `src/tablepicker.js:444-522`) — right-click on any `<table>` outside `#table-lb-viewport`:
   - **Always visible (3 items):** `#ctx-copy-table` (`"📋 Copy Formatted Table"`), `#ctx-expand-table` (`"🔍 Expand Table"`), `#ctx-export-csv` (`"💾 Export CSV"`).
   - **Editable tables only (`table.closest('[contenteditable="true"]')`, 7 items):** `#ctx-row-above`, `#ctx-row-below`, `#ctx-col-left`, `#ctx-col-right`, `#ctx-del-row`, `#ctx-del-col`, `#ctx-del-table`.
   - **Companion hover pill (`tablepicker.js:527-668`):** `#table-hover-copy-btn` (`"📋 Copy Summary Table"` / `"📋 Copy Table"`).
4. **Selection / Highlight Popover `#sel-menu`** (`index.html:531-535`, `annotate.js:569-603`, `notepad.js:2514-2542`, `smart-copy.js:1163-1185`, `tags.js:1974-2014`):
   - `#sel-confirm` (`"✓ Highlight"`), `#sel-copy` (`"📋 Copy Text"`), `#sel-tag-btn` / `#sel-tag-text` (`"🏷️ Tag"`), `#sel-cancel` (`"✗ Cancel"`), PLUS in Task 3–4 optional inline color category quick-swatches (`#selmenuSwatches` pattern from mockup `index.html:643-648`) without removing `#sel-confirm`/`#sel-copy`/`#sel-tag-btn`/`#sel-cancel`.
5. **Refresh Hard-Reload & Pen Suppression**:
   - `#refresh-btn` right-click (`library.js:2874-2879`), Shift+Click, or 650ms touch long-press (`library.js:2841-2847`) triggers `forceHardReload()`.
   - `#canvas-scroll` suppresses `contextmenu` during active Pencil or finger-highlight stroke (`pen.js:207`).

### 4.3 Complete Toolbar, Modal, Panel, Shortcut & Desktop-Bridge ID Checklist

All IDs below MUST remain intact (verbatim ID or aliased in-place with zero broken selectors in any `.js` module):

- **Sidebar Header & Tree (`index.html:54-95`, `desktop-bridge.js:710-748`):** `#btn-pin-sidebar`, `#btn-desktop-update` (Desktop), `#btn-install-sidebar`, `#btn-settings`, `#lib-close`, `#sync-bar` (`#sdot`, `#stxt`, `#autosave-lbl`), `#drive-bar` (`#drive-user`, `#drive-sign-btn`), `#btn-desktop-gmail-login` (Desktop), `#recent-wrap`, `#recent-list`, `#new-subj-btn`, `#undo-btn`, `#refresh-btn`, `#lib-tree`, `#lib-resize-handle`.
- **Document Tab Strip (`index.html:104`, `goodnotes-ui.js:383-428`):** `#gn-doc-tabs`, `.gn-tab-home`, `.gn-tab`, `.gn-tab-status`, `.gn-tab-close` (`'gn_open_tabs_v1'`, `'gn_recent_reads_v3'`, `'auto_close_tabs_10m'`).
- **Reader / Top Toolbar (`index.html:107-220`, `pen.js:156-165`, `ocr-studio.js:58-80`):** `#mob-menu-btn`, `#mode-tog` (`.mode-btn[data-mode="text"|"box"|"draw"]`), `#pen-toggle` (injected after `#mode-tog`), `#color-dots`, `#add-color-btn` (plus new `#btn-manage-colors` icon-only in `.capsule`), `#draw-ctrls`, `#pen-sizes` (`.dw-btn[data-w="2|4|8"]`), `#erase-sizes` (`.er-btn[data-ew="12|24|48"]`), `#btn-erase`, `#btn-undo`, `#btn-clear`, `#btn-toc`, `#btn-search`, `#btn-links`, `#btn-tags`, `#btn-diagram`, `#btn-ocr-pdf`, `#ocr-status-pill`, `#btn-copy-pdf-text`, `#btn-copy-pdf-instr`, `#btn-perplexity-digest`, `#pg-info` (`#btn-prev`, `#pg-input`, `#pg-total`, `#btn-next`), `#btn-notepad`, `#btn-theme-toggle` (`'app_ui_theme'`), `#btn-swap-panes`.
- **Folder Document Editor (`index.html:243-279`):** `#folder-doc-viewer`, `#folder-doc-title`, `#folder-doc-save-lbl`, `#folder-doc-toolbar` (`.folder-fmt-btn`, `#folder-doc-highlight`, `#folder-copy-summary-table`, `#folder-doc-link-pdf`, `#folder-doc-link-url`), `#folder-doc-editor`.
- **Reader Viewport & Study Desk Home (`index.html:282-395`, `goodnotes-ui.js:588-697`, `schedule.js:670-755`, `viewer.js:798-836`):** `#viewer-wrap`, `#pane-a`, `#pane-a-header`, `#pane-a-name`, `#floating-zoom-ctrl` (`#btn-zout`, `#zoom-lbl`, `#btn-zin`), `#canvas-scroll`, `#dual-divider`, `#pane-b`, `#pane-b-header`, `#pane-b-name`, `#btn-close-pane-b`, `#canvas-scroll-b`, `#welcome`, `#welcome-calendar`, `#gn-study-shelf` (`.gn-shelf-clear`, `.gn-notebook-card`, `.gn-nb-dismiss`, `.gn-desk-stat`, `.gn-nb-status`), `#btn-edit-schedule`, `#btn-add-class`, `.cal-item`, `.cal-edit-btn`, `.gn-cal-open-syllabus`, `.gn-cal-note-btn`, `#btn-retry-load`.
- **Static Modals (`index.html:545-1502`):**
  - `#mo-subj` (`#subj-name`, `#subj-emojis`, `#subj-color`, `.subj-cpre`, `#save-subj`)
  - `#mo-fold` (`#fold-name`, `.ftype-btn`, `#save-fold`)
  - `#mo-subfold` (`#subfold-name`, `#save-subfold`)
  - `#mo-toc` (`#bm-title`, `#btn-add-bm`, `#toc-list`)
  - `#mo-color` (`#cat-name`, `#cat-color`, `#save-color`) — expand/pair cleanly with `#mo-color-categories`
  - `#mo-edit-note` (`#btn-edit-table`, `#btn-edit-copy-table`, `#btn-edit-pdflink`, `#btn-edit-weblink`, `#edit-note-ed`, `#save-edit-note`)
  - `#mo-pdf-link` (`#pdf-link-search`, `#pdf-link-list`)
  - `#mo-subj-notes` (`#subj-notes-ta`, `#save-subj-notes`)
  - `#mo-edit-schedule` (`#sched-entry-id`, `#sched-input-day`, `#sched-input-time`, `#sched-input-subject`, `#sched-select-subject-quick`, `#sched-input-prof`, `#sched-select-syllabus`, `#sched-btn-clear-syllabus`, `#sched-btn-delete`, `#sched-btn-cancel-form`, `#sched-btn-save-entry`, `#sched-count`, `#sched-btn-new-class`, `#sched-btn-reset-default`, `#sched-list-container`)
  - `#mo-choose-syllabus` (`#choose-syl-search`, `#choose-syl-list`)
  - `#mo-link-pdf` (`#link-folder-search`, `#link-folder-tree`, `#link-target-path-preview`, `#confirm-link-pdf`)
  - `#mo-default-page` (`#inp-default-page-num`, `#btn-use-cur-page`, `#btn-clear-default-page`, `#btn-save-default-page`)
  - `#mo-dup-upload` (`#dup-btn-shortcut`, `#dup-btn-copy`, `#dup-btn-cancel`)
  - `#mo-links` (`#new-link-title`, `#new-link-url`, `#btn-add-link`, `#links-list`)
  - `#mo-diagram` (`#diag-template-select`, `#btn-diag-zout`, `#btn-diag-zin`, `#btn-diag-zreset`, `#diag-editor`, `#diag-preview-canvas`, `#btn-diag-export-jpg`, `#btn-diag-export-png`, `#btn-diag-export-svg`, `#btn-diag-insert-notes`)
  - `#mo-diagram-lightbox` (`#btn-lb-download-jpg`, `#btn-lb-download-png`, `#btn-lb-download-svg`, `#btn-lb-zout`, `#btn-lb-zin`, `#btn-lb-zreset`, `#btn-lb-fit`, `#lb-canvas`)
  - `#mo-table-lightbox` (`#table-lb-search`, `#btn-table-copy-md`, `#btn-table-copy-html`, `#btn-table-export-csv`, `#table-lb-viewport`)
  - `#mo-settings` (`#btn-pwa-install`, `#backup-dl-btn`, `#backup-drive-btn`, `#btn-export-settings`, `#btn-offline-all-notes`, `#btn-clear-offline-notes`, `#offline-folders-wrap`/`#offline-folders-list`, `#btn-choose-folder`, `#btn-reset-folder`, `#btn-clear-cache`, `#btn-choose-dl-folder`, `#btn-clear-dl-folder`, `#settings-btn-force-sync`, `#settings-btn-organize-drive`, `window.openSyncDiagnostics()`, `#btn-pen-setting`, `#btn-finger-setting` (`pen.js:126-138`), `pen-debug.html`, `#btn-auto-close-tabs-setting`, `#settings-gemini-key`, `#settings-btn-save-gemini`, `#settings-btn-clear-gemini`, `#btn-open-keys`)
  - `#mo-sync-diag` (`#diag-net-status`, `#diag-queue-count`, `#diag-err-time`, `#diag-err-code`, `#diag-err-msg`, `#diag-err-details-wrap`, `#diag-err-details`, `#diag-btn-force-sync`, `#diag-btn-clear-queue`, `#diag-btn-copy`)
  - `#mo-keys`, `#mo-copy-instructions` (`#copy-instr-auto-preview`, `#copy-instr-textarea`, `#btn-copy-instr-clear`, `#btn-copy-instr-save`), `#export-opts-modal` (`export-content-mode`: `#export-opt-mode-all`/`#export-opt-mode-tables`, `export-orientation`, `#export-opts-cancel`, `#export-opts-go`)
- **Dynamic Modals, Floating UI & Desktop Bridge (`desktop-bridge.js:650-1112`):**
  - `#mo-move-to-folder` (`library.js:2341`), `#mo-syllabus` (`syllabus.js:376`), `#mo-ocr-tool` (`ocr.js:1049`), `#ocr-studio-app` & `#ocr-completion-banner` (`ocr-studio.js:163,418`), `#table-picker` (`tablepicker.js:8`), `#editor-hi-dropdown` (`tablepicker.js:1302`), `#la-batch-pplx-banner` (`smart-copy.js:780-815`), `#np-save-error-banner` (`notepad.js:214`), `#drive-warn-banner` (`drive.js:232`), `#desktop-export-preview-modal` / `#export-print-frame` (`export.js:832-840`).
  - **Desktop-only IDs (`desktop-bridge.js:654-1100`):** `#desktop-engine-bar` (`#desktop-engine-lbl`, `#desktop-ram-lbl`), `#btn-desktop-update`, `#btn-desktop-gmail-login`, `#desktop-update-pill` (`#desktop-update-dismiss`), `#desktop-status-modal` (`#dsm-close`, `#dsm-ok`, `#dsm-gmail-login`, `#dsm-check-update`, `#dsm-update-status`), `#settings-version-card` (`#svc-check`, `#svc-local`, `#svc-remote`, `#svc-status`, `#svc-toggle-auto`, `#svc-install`).
- **Global Keyboard Shortcuts (`ui.js:944-1006`, `notepad.js:2386`, `index.html:1266-1284`):**
  - `T` (text highlight), `B` (box), `D` (draw), `?` (`#mo-keys`), `Esc` (close panels/modals), `[` / `Ctrl+B` (toggle sidebar), `Ctrl+F` (search), `Ctrl+Z` (undo stroke in draw mode), `Ctrl+S` (save notepad), `Ctrl+Enter` (add note), `PageUp`/`PageDown`/`ArrowUp`/`ArrowDown` scroll, PLUS new `Ctrl/Cmd+K` Command Palette (`dialog#commandPalette`).

### 4.4 Case Digest & Perplexity IPC Contract

| Layer | Triggers / IDs / Channels | Exact Behavior & Payload Contract | Baseline `path:line` |
|---|---|---|---|
| **Toolbar & Context Triggers** | `#btn-copy-pdf-text`, `#btn-copy-pdf-instr` (`.has-instr` + `"📝 Instruction ✓"`), `#btn-perplexity-digest` (shows preparing state while extracting), `#ctx-perplexity-digest` (PDF), `#ctx-folder-perplexity-digest` (Folder / N-Folder) | `copyEntirePdfTextSmart()`, `#mo-copy-instructions` (`copy_instr_<folderId>` in `localStorage` + `app_settings`), `openPerplexityDigestForCurrentPdf()`, `runPerplexityDigestForPdf(pdf)`, `runBatchPerplexityDigestForFolders()` | `index.html:181-190,1287-1307`; `smart-copy.js:52-157,639-1144,1237-1306`; `library.js:77-118` |
| **Web Fallback Window** | `preOpenedWebWin` (`about:blank`) -> `pinnedProjectUrl \|\| 'https://www.perplexity.ai/spaces'` | MUST pre-open `window.open('about:blank', '_blank')` BEFORE async 10-page batch text/OCR extraction so browser popup blocker allows navigation afterward (`smart-copy.js:990` -> `1120-1122`). Closes cleanly if extraction fails/no text (`1051-1053,1132-1134`). Desktop `desktop-bridge.js:124-130` overrides `window.open` for `http(s)` to `desktop_open_url`. | `smart-copy.js:987-992,1050-1056,1118-1134`; `desktop-bridge.js:123-130` |
| **Desktop Tauri Studio IPC (Main -> Studio)** | `desktop_open_perplexity_studio` / `window.desktopOpenPerplexityStudio` | Opens/reuses Tauri `WebviewWindow` `"perplexity-studio"` (`1120x840`, `WebviewUrl::External`) with `{ pdfId, pdfName, subfolderName, instructionText, pdfText, fullPromptText, pinnedProjectUrl, autoSubmit, digestMode, autoSendDigest }`. Injects `PERPLEXITY_INIT_SCRIPT` (or `eval(__PPLX_STUDIO_RECEIVE_JOB)`); injects `#la-pplx-studio-bar`, `#la-pplx-model-btn`, `#la-pplx-status`, `#la-pplx-fab-send`; triggers OS mouse click via `native_click` -> `perform_native_os_mouse_click`; `checkAutoSendProgress` polls `800ms` until `>=55` words + `!isPerplexityStillGenerating()` + `4.5s` stability. | `desktop-bridge.js:87-121`; `smart-copy.js:1087-1116`; `main.rs:1638-1730,2055-2105,2478-2523,2736-2936` |
| **Studio -> Main Return IPC** | `on_navigation` intercepts `http://127.0.0.1:19876/__pplx_msg?d=<b64>` | Actions currently handled in `main.rs:2945-3019`: `"save_prefs"` -> `window.__onPerplexityPrefsUpdated` (`pplx_pinned_project_url`, `pplx_auto_submit`, `pplx_digest_mode`, `pplx_auto_send`), `"send_digest"` -> `window.__onPerplexityDigestReceived(msg)` -> `importDigestIntoCaseDigestTab()` + ack `window.__onPerplexityDigestSentAck(true)`, `"native_click"` -> OS click. | `main.rs:2937-3025`; `smart-copy.js:1319-1352`; `notepad.js:1049-1133` |
| **Main Window Digest Editor & Badges** | `#notepad-panel` (`#nptab-notes`, `#nptab-digest`, `#np-digest-editor`), `#la-batch-pplx-banner` (`#la-batch-pplx-msg`, `#la-batch-pplx-stop`), `.case-status-btn`, `.fold-prog-badge`, `.gn-tab-status`, `.gn-desk-stat`, `.gn-nb-status` | Imported digest goes ONLY to `#np-digest-editor` / `pdf_notes.digest` + `local_digest_<id>` + SQLite `upsertPdfNote`, keeping user Notes intact. **Important distinction:** `#ann-panel`'s `#aptab-case` (`Case Summaries`) is separate (stores `<div data-note-type="case">` inside `annotation_notes.note_html`). `export.js:159-250` handles `#lib-ctx-export-pdf` & `#lib-ctx-export-tables-pdf` via `#export-opts-modal`. | `notepad.js:1049-1133`; `smart-copy.js:780-815,905-920`; `annotate.js:61-100,286-358`; `export.js:159-250`; `goodnotes-ui.js:149-189` |
| **Monitoring Gaps to Upgrade (Task 4)** | New `#pplxMonitorStrip` + Focus/Stop/Error forwarding | Currently single-PDF only disables `#btn-perplexity-digest` (`⏳ Preparing…`), Studio errors stay trapped inside `#la-pplx-status` (`main.rs:2033,2535,2642,2700,2731`), and neither single nor `#la-batch-pplx-banner` can Focus/Reopen `"perplexity-studio"` or cancel an in-flight Studio wait on main window. | `smart-copy.js:780-815,905-920,977-1000`; `main.rs:2033,2535,2642,2700,2731` |

### 4.5 Highlight Color Categories Schema & Upgrade Plan

- **Current Schema & Call Sites:**
  - **Supabase `color_categories`:** `{ id, name, hex_color }` (`id: 'cc_' + Date.now()`), loaded into `S.colorCats` (`state.js:10`) via `dbLoad` (`db.js:37,55`), cached in `local_lib_snapshot.colorCats` (`db.js:81,114`), backed up in `backup.js:84,99`.
  - **Supabase `annotations` (`db.js:493-506`, `annotate.js:31-41`):** `{ id, pdf_file_id, page, rects, highlighted_text, hex_color, highlight_mode }`. **NO `color_category_id`, `category`, or `label` column exists.** Old highlights, `drawings.strokes` (`{ points, color, width }`, `draw.js:66`), and rich-text HTML `background-color` spans persist raw `hex_color` strings directly.
  - **UI Renderers:** Top toolbar `#color-dots` + `#add-color-btn` -> `#mo-color` (`colors.js:8-36`, `index.html:128-130,637-647`), `#ap-colors` `.apc-dot` -> `dbUpdateAnnColor()` (`annotate.js:247-274`), rich-text `#editor-hi-dropdown` (`tablepicker.js:1266-1422` using `S.colorCats || DEFAULT_COLORS`). Fallback hex: `'#c9a84c'` (`state.js:38`, `main.js:87`).
- **Known Gaps & Bugs to Fix Together (Task 4):**
  1. `dbDelColorCat(id)` (`db.js:623-627`) is imported at `colors.js:6` but never called; **no `dbUpdateColorCat` exists**, so rename/recolor/delete UI does not exist.
  2. `tablepicker.js:1294` checks `x.style.background === c` (computed `rgb(...)` vs hex), and `.cdot` lacks `data-color` (`colors.js:11-21`). Normalize `rgb()` / `#hex` to lowercase `#rrggbb` + set `data-color` on `.cdot`, `.apc-dot`, and `#selmenuSwatches`.
  3. `sync.js:127-180` has **no Realtime listener on `color_categories`** (add `.on('postgres_changes', { event: '*', schema: 'public', table: 'color_categories' }, ...)`).
  4. `backup.js:68-107` `_collectData()` exports `color_categories`, **but omits `app_settings`** (add `app_settings` to `_collectData()` if any color meanings/hotkeys metadata or settings rely on it, plus Desktop `desktop-bridge.js` SQLite snapshot parity).
  5. **Backward Compatibility Rule:** NEVER rewrite historical `annotations.hex_color`, `drawings.strokes`, or notepad HTML spans when editing a category name or changing a swatch color (unless an explicit opt-in "Recolor matching highlights" toggle is ever added later). Render orphan/legacy hexes cleanly (`Custom (#rrggbb)`) in `#ap-colors`, `#ann-notes` badges, `search.js:runAnnSearch`, and `ui.js:exportAnnotations` / `export.js`!

### 4.6 Pre-Existing Quirks & Safe Cleanups (`#34` §5 + `#33` §2)

1. **Dead Selector in `schedule.js:778-794`:** Targets non-existent `#lib-ctx-set-syllabus` instead of actual `#ctx-set-syllabus` (`index.html:1402`, `library.js:56`). (`main.js` wires `window.__setSubjectSyllabusPdf`, but `schedule.js`'s own direct listener was dead — fix selector cleanly).
2. **Phantom Button in `ui.js:174,180`:** Wires `#btn-force-sync-all` which has no DOM element in `index.html` or JS injectors — either map it cleanly or remove dead reference after confirming zero other callers.
3. **Panel Exclusivity & `Escape` Gaps (`ui.js:108,974`, `index.html:1334,1356`):** `closeOtherPanels()` & `Escape` omit `#tags-panel` (though `tags.js:582` calls `closeOtherPanels('tags-panel')`); `Escape` also misses `#topic-notes-modal`, `#mo-syllabus`, `#mo-move-to-folder`, `#mo-ocr-tool`. Unify panel closure and `Escape` handling cleanly.
4. **CSS Width / Duplicate Style Discrepancies (`style.css:18,112-122,398-399,665,739-740,2029` vs `annotate.js:642`, `tags.js:1013`, `ui.js:854` vs `desktop-bridge.js:809`):**
   - `:root { --ann-w: 330px }` (`18`) vs `380px`/`min-width: 280px` (`398-399`) vs `annotate.js:642` `minW = 260`; `<=1024px` sets `60vh` (`665`) overridden to `68vh` (`739`); orphaned `#backup-bar` CSS (`112-122`); duplicated `#tags-panel` styles (`style.css:2029` & `tags.js:1013`); keep `dataset.desktopWheelZoom` guard intact so `ui.js` and `desktop-bridge.js` never double-handle `Ctrl+Wheel`.
5. **Theme Migration & Tooltip Alignment:**
   - `goodnotes-ui.js:10,72-107` stores `'app_ui_theme'` as `'paper' | 'slate' | 'classic'`. Map `'paper'` -> `folio` and `'slate'` -> `casebook` on boot (keeping `'classic'` fallback cleanly or migrating explicitly with user toggle).
   - `index.html:112` toolbar tooltip says `Highlight Text (H)` while `ui.js:970` & `#mo-keys` bind `T` — align tooltip label to `(T)`.

---

## 5. Phased Argon Implementation Tasks

> **Subagent / Swarm Execution Rule (from `D:\Code\GEMINI.md`):** Execute via `/swarm` with workers pinned to `model:"gemini-3.8-flash-high"` (plus at most one standby `argon-coder` if needed), keeping edits strictly in `D:\Code\legal-annotator\` first, verifying every phase before advancing, and mirroring to `D:\Code\legal-annotator-desktop\` only in Task 5's single atomic pass.

### Task 0: `/impeccable` Initialization (`PRODUCT.md` + `DESIGN.md` Lock-In)

- **Files:** `D:\Code\legal-annotator\.impeccable\PRODUCT.md` (after brief user confirmation if needed) and `D:\Code\legal-annotator\DESIGN.md` (optional design token spec).
- **Steps:**
  1. Run `/impeccable` `init` check/confirm with user on `PRODUCT.md` identity ("Philippine Law School / Legal Annotator Case Reader & Digest Workspace") and confirm zero banned fonts/aesthetics.
  2. Lock exact CSS token names from `design/mockups/skins/folio.css` (`:root[data-skin="folio"]`) and `design/mockups/skins/casebook.css` (`:root[data-skin="casebook"]`) plus legacy theme alias variables (`--gold`, `--navy-b`, `--muted`, `--bg`, `--surface`, `--surface-2`, `--ink`, `--ink-muted`, `--rule`, `--accent`, `--accent-ink`, `--danger`, `--focus`) so dynamically injected JS components (`tags.js`, `ocr-studio.js`, `tablepicker.js`, `desktop-bridge.js`) automatically inherit active skin contrast without breaking during migration.
- **Verification:** Confirm no production `src/` JS/CSS logic has changed yet and `.impeccable` / `DESIGN.md` matches Round 3 tokens verbatim.

### Task 1: Dual-Skin Token Foundation, SVG Icon Sprite, Font Migration & Theme Toggle

- **Files:**
  - Modify: `D:\Code\legal-annotator\index.html` (remove line `20` `Libre Baskerville`/`Inter` Google Fonts `<link>`, migrate inline `'Inter'`/`'Libre Baskerville'` styles at `277,701,713,797,817,831,858,894,934,935,949,1012,1045,1068,1213,1298` to CSS classes / `var(--font-ui)` & `var(--font-display)`)
  - Modify: `D:\Code\legal-annotator\src\style.css` (remove line `1` `Libre Baskerville`/`Inter` `@import` and migrate all `font-family: 'Inter'` / `'Libre Baskerville'` declarations across `22–2139` to `var(--font-ui)` / `var(--font-display)`)
  - Modify: `D:\Code\legal-annotator\src\goodnotes-ui.js` (lines `10,72-107` theme functions)
  - Modify: `D:\Code\legal-annotator\src\diagram.js` (`184`), `src\drive.js` (`236,250`), `src\ocr.js` (`1055`), `src\ocr-studio.js` (`180,418,427,429`), `src\syllabus.js` (`295,380`), `src\tags.js` (`1024,1507,1786`), `src\viewer.js` (`306,647,878` `.pg-placeholder` font-family string ONLY — leave all PDF.js rendering/sizing/scroll logic untouched)
  - Modify (if needed for skin icon swap): `D:\Code\legal-annotator\src\main.js`
- **Interfaces & Changes:**
  1. Embed the shared hidden `<svg class="svg-sprite" aria-hidden="true" focusable="false">` from `design/mockups/index.html:30-155` at top of `<body>` in `index.html` (covering `#i-scale`, `#i-desk`, `#i-book`, `#i-chevron`, `#i-close`, `#i-sun`, `#i-moon`, `#i-cursor`, `#i-highlight`, `#i-box`, `#i-pen`, `#i-search`, `#i-plus`, `#i-minus`, `#i-note`, `#i-copy`, `#i-spark`, `#i-check`, `#i-arrow-right`, `#i-sync`, `#i-alert`, `#i-external`, `#i-stop`, `#i-pin`, `#i-sidebar`, `#i-palette`, `#i-clock`, `#i-table`, `#i-folder`, `#i-download`, `#i-trash`, `#i-dual`, `#i-list`, plus crisp symbols for OCR/Diagram/Tags/Offline/Drive/Settings/Delete/Undo).
  2. Add pre-paint inline boot `<script>` in `<head>` of `index.html` reading `localStorage.getItem('app_ui_theme')`: map `'paper'`/`'folio'` -> `html[data-skin="folio"]`, `'slate'`/`'casebook'` -> `html[data-skin="casebook"]`, `'classic'` -> fallback cleanly without flash of wrong skin.
  3. Port `:root[data-skin="folio"]` and `:root[data-skin="casebook"]` font `@import` + token blocks + skin-scoped rules into `src/style.css` (zero banned fonts: strip `'Inter'` and `'Libre Baskerville'` everywhere in favor of `var(--font-ui)` / `var(--font-display)` / `var(--font-num)`), removing duplicate `#tags-panel` rules (`style.css:2029`) and dead `#backup-bar` (`style.css:112-122`), and reconciling `--ann-w` (`330px` vs `380px`) cleanly. Bridge existing legacy CSS variables (`--navy`, `--navy-l`, `--navy-b`, `--gold`, `--muted`, `--parchment`) to active skin tokens so untouched modals/injectors stay crisp in both Folio Day and Casebook Night.
  4. Update `applyAppTheme(theme)` & `cycleAppTheme()` in `goodnotes-ui.js:76-107` to support View Transition cross-fade (`document.startViewTransition` guarded by `prefers-reduced-motion` + `html[data-transition="skin"]`), toggle `html[data-skin="folio"|"casebook"]` + `#btn-theme-toggle` SVG icon (zero emojis), and keep Classic fallback accessible (`cycle` Folio <-> Casebook cleanly or 3-way if Classic is retained in Settings).
- **Verification:**
  - `node --check src/goodnotes-ui.js` & `src/main.js` & touched JS files.
  - Grep `index.html`, `src/*.*`, and `D:\Code\legal-annotator-desktop\ui\src\desktop-bridge.js` (after Tasks 1–4) -> confirm `0` hits for `Inter`, `Libre Baskerville`, and every banned font family listed in §2.6.
  - Load app in headless browser: verify `html[data-skin="folio"]` on clean boot, `'slate'` -> `html[data-skin="casebook"]`, `'paper'` -> `html[data-skin="folio"]`, `#btn-theme-toggle` switches tokens cleanly, and **0** emojis remain in `#btn-theme-toggle` or SVG chrome.

### Task 2: Left Sidebar Auto-Hide/Pin/Resize, Right Panels, Context Menus & Study Desk Upgrade

- **Files:**
  - Modify: `D:\Code\legal-annotator\index.html`
  - Modify: `D:\Code\legal-annotator\src\style.css`
  - Modify: `D:\Code\legal-annotator\src\ui.js` (preserve all sidebar/resizer/hotkey logic; fix `#tags-panel` / modals in `closeOtherPanels` & `Escape`; clean up phantom `#btn-force-sync-all`)
  - Modify: `D:\Code\legal-annotator\src\library.js` (replace UI chrome emojis in `#lib-ctx-menu` / `.li-acts` / `.case-status-btn` / `.fold-prog-badge` with `<svg><use>` icons while preserving ALL 13 PDF + 8 Folder + 6 Multi-Folder handlers & IDs verbatim)
  - Modify: `D:\Code\legal-annotator\src\tablepicker.js` (replace table ctx/hover emojis with `<svg><use>` icons; preserve all 10 `#table-ctx-menu` IDs)
  - Modify: `D:\Code\legal-annotator\src\goodnotes-ui.js` (apply `.folios` / `.folio` editorial card aesthetic to Study Desk `#welcome` / `#welcome-calendar` / `#gn-doc-tabs` keeping `#gn-study-shelf`, `.gn-notebook-card`, `#btn-edit-schedule`, `#btn-add-class`, `.cal-edit-btn`, `.gn-cal-open-syllabus`, `.gn-cal-note-btn` working)
  - Modify: `D:\Code\legal-annotator\src\schedule.js` (fix dead `#lib-ctx-set-syllabus` -> `#ctx-set-syllabus` at line `778-794`)
- **Interfaces & Critical Fixes:**
  1. **Fix Auto-Hide Hover Trap During Context Menu / Resizing (`ui.js:325-348`):** In `handleHoverLeave()`, do NOT close `.hover-open` while `#lib-ctx-menu` is visible (`display !== 'none' && !hidden`) or while `.panel-resizer-right.resizing` is active! Clear timer cleanly when menu closes unless pointer has left `#lib-side` and `#lib-ctx-menu`. Also sync `#btn-pin-sidebar` `aria-pressed` alongside `#app.sidebar-autohide` + `[data-rail-autohide]` and use `#i-pin` SVG icon + text `"Pinned"` / `"Auto-Hide"` (no `📌`/`⚡` emojis).
  2. **Preserve Context Menu Visibility Semantics (`library.js`, `tablepicker.js`, `style.css`):** Support BOTH `[hidden]` and inline `style.display` toggles cleanly during transition, or standardize cleanly across `library.js` & `tablepicker.js` so `.ctx-menu` never fails to open or dismiss on outside click/`Escape`. Maintain exact item IDs & visible ordering (§4.2).
  3. **Fix Quirk Parity (`ui.js:103-122,974-981`, `schedule.js:778-794`):** Add `'tags-panel'` cleanup to `closeOtherPanels()`; add `#tags-panel`, `#topic-notes-modal`, `#mo-syllabus`, `#mo-move-to-folder`, `#mo-ocr-tool` to `Escape` handler (`ui.js:974`); fix `#ctx-set-syllabus` selector in `schedule.js`.
  4. **Zero-Emoji Sidebar & Study Desk Chrome:** Apply Chancery & Folio / Darkroom Casebook tree spine indicators (`--spine` using muted `--subj-1..6` tokens + custom folder color fallback), `.tree__hint` ("Right-click any folder or case"), tabular numbers (`font-variant-numeric: tabular-nums`), and SVG sprite icons across `.li-acts`, `#sync-bar`, `#drive-bar`, `#gn-doc-tabs`, and Study Desk `#welcome` cards. Preserve user-stored `.subj-emojis` data safely (render fallback SVG binder spine if subject has default emoji or clean badge).
- **Verification:**
  - Verify `lib_sidebar_width`, `notepad_width`, and `ann_panel_width` drag-resize bounds (`200px..60vw` left, `260px..85vw` right) and persistence across reload.
  - Right-click `.li-pdf` (count = 13 items), `.li-fold-hd` single (count = 8 items), `.li-fold-hd` 2+ selected (count = 6 dynamic-labeled items), editable `<table>` (count = 10 items), read-only `<table>` (count = 3 items).
  - Test Auto-Hide hover peek + right-click `#lib-ctx-menu` interaction: hover stays open while mouse is over context menu!
  - Test `Escape` and panel switching across `#notepad-panel`, `#ann-panel`, `#tags-panel`, `#search-panel`, and dynamic modals.

### Task 3: Case Reader Chrome, Compact Floating `.capsule`, `Ctrl+K` Command Palette & Native Motion Layer (PDF.js Core Untouched)

- **Files:**
  - Modify: `D:\Code\legal-annotator\index.html`
  - Modify: `D:\Code\legal-annotator\src\style.css`
  - Modify: `D:\Code\legal-annotator\src\ui.js` (palette wiring, `Ctrl+K` hotkey, align `Highlight Text (T)` tooltip, preserve all PDF zoom & scroll math)
  - Modify: `D:\Code\legal-annotator\src\pen.js` (ensure `#pen-toggle` injects seamlessly into upgraded toolbar/capsule + SVG icon replacement, keep `#btn-pen-setting` / `#btn-finger-setting` & contextmenu suppression)
  - Modify: `D:\Code\legal-annotator\src\ocr-studio.js` (ensure `#ocr-status-pill` mounts cleanly in `.casebar` / reader chrome with SVG icons)
  - **DO NOT ALTER CORE MATH IN:** `src/viewer.js` (`ensurePageRendered`, `vp`, `28px`/`24px` offset resume, eviction), `src/draw.js` (pinch/stroke coordinates), `src/dualview.js` (`#dual-divider` split logic), `src/ui.js:429-440,854-940` (`S.scale` zoom & `offsetTop` binary search).
- **Interfaces & Design Rules:**
  1. **Reader `.casebar`:** Add compact Case Reader header strip (`.casebar`) inside `#viewer-wrap` above `#canvas-scroll` (shown when PDF is active, hidden on `#welcome` / `#folder-doc-viewer`), hosting case title/citation/subject metadata alongside `#btn-copy-pdf-text`, `#btn-copy-pdf-instr`, `#btn-perplexity-digest`, and streamlined access to `#btn-toc`, `#btn-search`, `#btn-links`, `#btn-tags`, `#btn-diagram`, `#btn-ocr-pdf`, `#pg-info`, `#btn-notepad`, `#btn-swap-panes`. Preserve every exact button ID!
  2. **Floating `.capsule` + `#floating-zoom-ctrl` Collision Prevention:**
     - Upgrade `#mode-tog` / tool controls (`text`, `box`, `draw`, `#pen-toggle`, `#color-dots`, `#add-color-btn`, compact `#btn-manage-colors`, quick search / `⌘K` triggers) into the crisp centered `.capsule` above `#canvas-scroll`.
     - **Explicit real-app rule:** `#btn-manage-colors .manage-colors-btn__label` MUST have `display: none` inside `.capsule` at ALL viewport sizes so `#btn-manage-colors` renders as a compact icon button (`title="Customize highlight color meanings"` + `aria-label`), while `#btn-panel-manage-colors` inside `#ann-panel` / `#notepad-panel` keeps its full text label (`Customize colors`).
     - Keep `#floating-zoom-ctrl` styled with skin tokens bottom-right (`bottom: 14px`, shifting to `bottom: 40px` under `body:has(#desktop-engine-bar)` `style.css:2267-2269` and hiding on `#pane-a:has(#welcome)` `2270-2272`). At `<=1120px` (or when `.capsule` + `#floating-zoom-ctrl` come within `16px`), collapse `.capsule__tool span` labels automatically so `.capsule` NEVER touches `#floating-zoom-ctrl` or `#desktop-engine-bar`.
  3. **`#canvas-scroll` & Casebook Safe-Framing Rule:**
     - Retain exact `#canvas-scroll` flex/overflow/gap/padding geometry (`overflow-y: scroll; overflow-x: auto; padding: 28px 20px; gap: 24px; overflow-anchor: none`). Style surrounding desk well cleanly (`--bg` / `--cb-paper-well`), `.pg-wrap` shadow (`--shadow-lift`), subtle radius (`--radius-s`), crisp skin border (`--rule`).
     - In `[data-skin="casebook"]`, give `#canvas-scroll` the darkroom desk pool gradient (`--cb-lamp-pool`) framing `.pg-wrap`; apply **ZERO** `filter: invert()` or opacity fade on `.pg-wrap <canvas>` or `.ann-ov` / `.draw-canvas`.
  4. **`Ctrl/Cmd+K` Command Palette (`<dialog id="commandPalette">`) & Native Motion:**
     - Add progressive native motion from `design/mockups/base.css` (CSS `linear()` spring via `@supports`, `scroll-timeline` progress line above reader, `@starting-style` modal/dialog transitions, `interpolate-size: allow-keywords` + `::details-content`).
     - Wire `Ctrl/Cmd+K` to `<dialog class="palette" id="commandPalette">` indexing open subjects/cases (`S.pdfs`), actions (`Go to Study Desk`, `Perplexity Digest`, `Case Digest Tab`, `Customize Highlight Colors`, `Toggle Sidebar Pin / Auto-Hide`, `Switch Skin Folio / Casebook`, `Zoom In / Out`, `Toggle Dual View`), checking `document.activeElement` safely.
- **Verification:**
  - Verify bounding boxes of `.capsule`, `#floating-zoom-ctrl`, and `#desktop-engine-bar` never overlap at `1024x768`, `1280x800`, `1440x900` (with `#lib-side` open + `#notepad-panel` / `#ann-panel` open).
  - Verify `viewer.js` pixel-locked `.pg-wrap` width/height matches PDF.js `<canvas>` CSS px; test Text Highlight, Box Highlight, Freehand Draw, Pencil (`#pen-toggle`), Pinch, `Ctrl+Wheel` (`desktopWheelZoom`), Dual-Pane (`#dual-divider`), and `100+` page scroll eviction & bookmark resume.

### Task 4: Perplexity Live-Monitor Enhancements & Full Editable Highlight Color Meanings

- **Files:**
  - Modify (Web + Desktop UI):
    - `D:\Code\legal-annotator\index.html` (add `#pplxMonitorStrip` in `#notepad-panel` digest pane, `#mo-color-categories` + enhance `#mo-color`, `#btn-panel-manage-colors`)
    - `D:\Code\legal-annotator\src\smart-copy.js` (live monitor state machine, `window.__onPerplexityStudioStatus`, Focus/Reopen helpers, Stop signal for single & `#la-batch-pplx-banner`, migrate line `790` `font-family:Inter,...` -> `var(--font-ui)`, keeping pre-opened Web tab & Desktop `desktop_open_perplexity_studio` intact)
    - `D:\Code\legal-annotator\src\notepad.js` (sync digest editor save status `#np-save-lbl[data-state]`, toolbar SVG polish, `#np-history-btn` / drawer / modal polish, migrate line `40` `font-family:Inter,...` -> `var(--font-ui)`)
    - `D:\Code\legal-annotator\src\colors.js` (full CRUD modal `#mo-color-categories`: create, rename/update hex via `dbUpdateColorCat(id, name, hex_color)`, wire `dbDelColorCat`, normalized `#rrggbb` `data-color` attributes, export `normalizeHexColor(val)` & `getColorCategoryForHex(hex)`)
    - `D:\Code\legal-annotator\src\db.js` (add `dbUpdateColorCat(id, name, hex_color)` matching `dbCreateColorCat(name, hex_color)`, offline snapshot refresh on create/update/delete; verify `app_settings` fallback consistency)
    - `D:\Code\legal-annotator\src\annotate.js` (`.apc-dot` `data-color`, consume `getColorCategoryForHex(hex)` for custom category badge + `Custom (#rrggbb)` orphan fallback on notes/hover tooltips, live re-render when `S.colorCats` updates without touching `annotations.hex_color`)
    - `D:\Code\legal-annotator\src\tablepicker.js` (fix line `1294` swatch selection with normalized `normalizeHexColor(c)` + `data-color` matching; migrate lines `546,1338,1390` `font-family:Inter,...` -> `var(--font-ui)`; SVG icon cleanup)
    - `D:\Code\legal-annotator\src\search.js` & `D:\Code\legal-annotator\src\ui.js` (optional color category badge via `getColorCategoryForHex(ann.hex_color)` in `runAnnSearch` & `exportAnnotations`)
    - `D:\Code\legal-annotator\src\sync.js` (add Postgres Realtime `.on('postgres_changes', { event: '*', schema: 'public', table: 'color_categories' }, ...)` at lines `127-180`)
    - `D:\Code\legal-annotator\src\backup.js` (add `app_settings` to `_collectData()` at lines `68-107` alongside `color_categories`)
  - Modify (Desktop Native Rust + Bridge — keep isolated & clean):
    - `D:\Code\legal-annotator-desktop\src-tauri\src\main.rs` (add `desktop_focus_perplexity_studio` command, emit `action: "studio_status"` / `"studio_error"` over `127.0.0.1:19876/__pplx_msg` when Studio detects missing login / unpinned Space / missing composer / generation stalled -> `window.__onPerplexityStudioStatus` in `main`; add SQLite cache helpers for `color_categories` if offline desktop palette caching is desired)
    - `D:\Code\legal-annotator-desktop\ui\src\desktop-bridge.js` (add `window.desktopFocusPerplexityStudio`, migrate lines `862,958` `font-family:Inter,...` -> `var(--font-ui)`, style `#desktop-engine-bar` / `#btn-desktop-update` / `#btn-desktop-gmail-login` / `#desktop-status-modal` / `#settings-version-card` cleanly with skin tokens & SVG icons while keeping every ID and PDFium/OAuth/SQLite/Updater IPC contract verbatim)
- **Exact Interfaces & Contracts:**
  - `dbUpdateColorCat(id, name, hex_color) -> Promise<ColorCat>`: upserts `{ id, name, hex_color }` via `safeDbWrite(db, 'color_categories', 'upsert', ...)`, updates `S.colorCats`, refreshes `'local_lib_snapshot'`, calls `broadcastSync({ type: 'LIBRARY_CHANGED' })`, and refreshes `#color-dots`, `#ap-colors`, `#selmenuSwatches`, `#ann-notes`, `#editor-hi-dropdown` (if open) WITHOUT touching `annotations` rows.
  - `normalizeHexColor(val) -> string | null`: converts `rgb(r, g, b)` or `#rgb` / `#rrggbb` to lowercase `#rrggbb` for reliable `.cdot[data-color]`, `.apc-dot[data-color]`, and `tablepicker.js:1294` active dot checks.
  - `getColorCategoryForHex(hex) -> { id?, name, hex_color, isLegacy }`: finds matching `S.colorCats` entry by normalized hex, else returns `{ name: 'Custom (' + norm + ')', hex_color: norm, isLegacy: true }`. (Also optionally expose thin alias `getColorCategoryLabel(hex) => getColorCategoryForHex(hex).name` if callers need display text directly.)
  - `window.__onPerplexityStudioStatus(payload)`: `{ state: 'idle'|'extracting'|'submitted'|'streaming'|'done'|'error', stepLabel, message, pdfId, canRetry }`. Single & Batch banner (`#la-batch-pplx-banner` with `#la-batch-pplx-focus` + `#la-batch-pplx-stop`) plus `#pplxMonitorStrip` (`#focusPplxBtn`, `#stopDigestBtn`, `#pplxMonitorAlert`) update immediately from this hook; on Web fallback, show `"Opened Perplexity tab — Paste (Ctrl+V) & copy reply back to Case Digest"` with working Re-focus Web Window button (`preOpenedWebWin?.focus?.()`).
- **Verification:**
  - Add, rename, recolor, and delete a color category; reload page offline and online; verify legacy highlights retain their original `hex_color` visually and show `Custom (#rrggbb)` if deleted.
  - Verify `tablepicker.js` rich-text `#np-highlight-btn` highlights `.cdot.sel` accurately for `#c9a84c` / custom hexes.
  - Trigger `#btn-perplexity-digest` in Desktop Tauri AND Web browser mode: confirm live window ALWAYS opens, Focus button raises `"perplexity-studio"` (or Web tab), injected Studio error surfaces on `#pplxMonitorAlert` in main window, Stop cancels batch immediately without leaving dangling timers, and returned `send_digest` updates ONLY `#np-digest-editor` while preserving `#np-editor` Notes.
  - Run `cargo check --manifest-path D:\Code\legal-annotator-desktop\src-tauri\Cargo.toml` on Rust edits.

### Task 5: End-to-End Verification Matrix, Deterministic Desktop Mirror & Single Atomic Release

- **Step 5A — Automated & Manual Browser/WebView2 Verification Matrix:**
  - Verify zero console errors across `file://` / `http://localhost` / Tauri desktop runtimes.
  - Verify `1024x768`, `1280x800`, and `1440x900` viewports under BOTH `data-skin="folio"` and `data-skin="casebook"` (+ `'classic'` boot migration):
    - Left sidebar: Pin/Auto-Hide toggle, hover-edge reveal, resizer drag, `#lib-ctx-menu` hover-stability, all 13 PDF items, all 8 Folder items, 6 Multi-Folder items, hover `.li-acts` inline controls.
    - Right panels: `#notepad-panel` Notes vs Case Digest tabs, resizer, `#np-history-btn`, `#table-ctx-menu` (all 10 editable items + 3 read-only items), `#ann-panel` (`general` vs `case` tabs, `.apc-dot`, hover tip, resizer), `#tags-panel` + `Escape` closure, `#dual-divider` split + `#btn-swap-panes`.
    - PDF Reader: `<canvas>` + `.txt-layer` + `.ann-ov` + `.draw-canvas` zoom accuracy (`75%`, `100%`, `150%`), `#canvas-scroll` x+y scrolling, `.capsule` vs `#floating-zoom-ctrl` & `#desktop-engine-bar` zero collision, `#sel-menu`, `Ctrl+K` palette, `T`/`B`/`D`/`?`/`Ctrl+F`/`Ctrl+B`/`[`/`Esc`.
    - Study Desk, Schedule (`#mo-edit-schedule`), Syllabus (`#mo-syllabus` + fixed `#ctx-set-syllabus`), OCR Studio, Diagram & Table Lightboxes, Settings & Sync Diagnostics.
    - Asset Hygiene: confirm `0` `"Run digest"`, `0` UI chrome emojis (`>= U+2600` outside user note/subject-data fallbacks), `0` banned fonts, `backdrop-filter` restricted to Casebook `.capsule`.
- **Step 5B — Deterministic Web -> Desktop Mirror (`D:\Code\GEMINI.md`):**
  1. Check `git -C D:\Code\legal-annotator-desktop status --short ui/` to ensure no accidental desktop-only edits exist outside `ui/src/desktop-bridge.js`.
  2. Copy `D:\Code\legal-annotator\index.html` -> `D:\Code\legal-annotator-desktop\ui\index.html` and all modified/added files from `D:\Code\legal-annotator\src\` -> `D:\Code\legal-annotator-desktop\ui\src\` via PowerShell `Copy-Item`, **explicitly excluding `desktop-bridge.js`** (any `desktop-bridge.js` changes are reviewed and authored separately).
  3. Run `Get-FileHash` across every mirrored file in `legal-annotator/src` vs `legal-annotator-desktop/ui/src` (and `index.html`) to prove exact SHA-256 parity.
  4. Run `node --check` on every `.js` file in both repos.
- **Step 5C — Single Atomic Release (`verifier` / `flash-verifier`):**
  1. Verify `git diff --name-only` in both repos matches approved scope.
  2. Update `D:\Code\legal-annotator-desktop\version.json`: increment `build` (`41` -> `42`), bump `version` (`1.15.4` -> `1.16.0` minor for dual-skin UI overhaul + Perplexity monitoring + editable color meanings), set `updatedAt` to release date, write plain-English `notes`. Save as **UTF-8 without BOM** and verify leading bytes `!= EF BB BF`.
  3. Run **Git Secret Shield** checks across BOTH `D:\Code\legal-annotator` and `D:\Code\legal-annotator-desktop` (`config.js`, `.env`, `*.env`, `.env.*`, tokens, keys never tracked or staged).
  4. Build release binary:
     `cargo build --release --manifest-path D:\Code\legal-annotator-desktop\src-tauri\Cargo.toml`
  5. Copy compiled binary `D:\Code\legal-annotator-desktop\src-tauri\target\release\legal-annotator-desktop.exe` (`Cargo.toml:2` package `name = "legal-annotator-desktop"`) to `D:\Code\legal-annotator-desktop\Legal Annotator.exe`.
  6. Commit (`version.json`, `Legal Annotator.exe`, `ui/`, `src-tauri/`) and `git push` both repos (`D:\Code\legal-annotator` and `D:\Code\legal-annotator-desktop`) to `origin main`.
  7. Report final `version` and `build` numbers and confirm GitHub push succeeded so the user's auto-updater picks up the new build.

---

## 6. Self-Review Checklist

- [x] Plan references ONLY verified files, symbols, DOM IDs, storage keys, CSS selectors, Rust/IPC names, and baseline line ranges observed in `D:\Code\legal-annotator` and `D:\Code\legal-annotator-desktop` (`#22`, `#33`, `#34`, `#36`, `#39`, plus direct reads).
- [x] Header carries exact Argon Handover notice, Goal, Architecture, Tech Stack, and all 6 Round 3 mockup prototype paths.
- [x] All 7 global non-negotiable user requirements explicitly captured (toggleable Day/Night skins, zero fake `"Run digest"`, real A4 PDF.js canvas/layers/scroll/zoom untouched, real Perplexity popup always opens + monitoring upgrade, full existing feature/sidebar/context-menu preservation, icon-only `#btn-manage-colors` inside `.capsule` preventing zoom-pill collision at 1024–1280px, zero UI emojis & banned fonts, dual-repo parity + single atomic release).
- [x] Review Focus pins all 7 high-risk regressions identified by scouts (`#22`, `#33`, `#34`) to concrete test assertions.
- [x] Complete Preservation Matrix documents all sidebars/splitters/keys, 13 PDF + 8 Folder + 6 Multi-Folder + 10 Table context menu items + hover inline actions + `#sel-menu`, full toolbar/modal/panel/shortcut/desktop-bridge DOM ID checklist, Perplexity IPC & Digest contract, Highlight Color Categories upgrade plan, and all 5 pre-existing quirks + tooltip fix.
- [x] Zero production files (`src/`, `index.html`, `design/`, `D:\Code\legal-annotator-desktop\`) were modified while creating this handover plan.
