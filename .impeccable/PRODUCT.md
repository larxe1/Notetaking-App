# Legal Annotator — Product Context

## Identity & Purpose
**Legal Annotator** is a cloud-synced Philippine law school case-law PDF workspace combining a fast multi-case library, A4 PDF annotation & freehand pen studio, case digest notepad, Perplexity AI digest orchestration, and Study Desk class scheduler across Web (PWA) and Desktop (Tauri 2 + WebView2).

## Surface Modes
- **Operate:** Primary workspace chrome — Subject/Folder library tree (`#lib-side`), floating annotation toolset, custom highlight color categories, PDF Notepad & Case Digest editor (`#notepad-panel`), Annotation Inspector (`#ann-panel`), Topic Coverage (`#tags-panel`), Search, Command Palette (`Ctrl+K`), Context Menus, OCR Studio, and Print Studio.
- **Read:** Long-form court opinion & statutory PDF reading (`#canvas-scroll` + Dual-View `#pane-a`/`#pane-b`) and Study Desk (`#welcome` / `#welcome-calendar`) class & recit preparation overview.

## Target Users & Scene
- Law students preparing case digests, recitations, and bar review materials in both **daylight library carrel** conditions (*Chancery & Folio* Day skin) and **late-night reading lamp** study sessions (*Darkroom Casebook* Night skin).

## Non-Negotiable Technical & Feature Invariants
1. **Real A4 PDF.js Rendering:** PDFs render exclusively through PDF.js `<canvas>` with pixel-locked `.pg-wrap` dimensions and 5 stacked layers (`<canvas>`, `.ann-ov`, `.draw-canvas`, `.srch-ov`, `.txt-layer`). `#canvas-scroll` retains `overflow-y: scroll; overflow-x: auto; padding: 28px 20px; gap: 24px; overflow-anchor: none` and zero `filter: invert()` on PDF canvases.
2. **Real Perplexity Case Digest Popup:** Triggering Perplexity Digest always opens the real Perplexity window (synchronous `window.open('about:blank', '_blank')` on Web; `desktop_open_perplexity_studio` on Desktop). Never ship simulated or fake `"Run digest"` buttons.
3. **Full Workspace Feature Parity:** Preserve `#lib-side` auto-hide/pin/resize (`#app.sidebar-autohide`, `#lib-hover-zone`), `#notepad-panel`, `#ann-panel`, `#tags-panel`, Dual-View `#dual-divider`, all context menus (`#lib-ctx-menu`, `#table-ctx-menu`), hover actions, Google Drive / Supabase / Outbox / Desktop SQLite sync, and `#desktop-engine-bar` (`bottom: 40px` offset on `#floating-zoom-ctrl`).
4. **User Data Preservation:** Never strip or mutate user-created notes, highlight `annotations.hex_color`, PDF filenames, or stored subject metadata.
