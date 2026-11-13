# Gemini Web Studio Case Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Gemini Web Studio** (`gemini.google.com`) Case Digest workflow alongside the existing Perplexity Case Digest across Legal Annotator Web and Desktop, featuring per-Subject Notebook URL mapping and configurable Model + Thinking Level (defaulting to `4 Hydrogen` + `High`).

**Architecture:** Extract shared PDF text extraction and provider-aware monitor/batch state in `src/smart-copy.js`, wire UI buttons/menus/Settings across `index.html`, `src/style.css`, `src/library.js`, `src/notepad.js`, and `src/ui.js`, extend `desktop-bridge.js`, and implement a dedicated `src-tauri/src/gemini_studio.rs` WebView2 automation module registered in `src-tauri/src/main.rs`. After all edits pass syntax and Rust checks, mirror web UI changes to desktop `ui/` (excluding `desktop-bridge.js`), bump `version.json`, build `Legal Annotator.exe`, pass `git-secret-shield`, and push both repos.

**Tech Stack:** Vanilla ES Modules (HTML/CSS/JS), PDF.js, Supabase (`app_settings`), Tauri v2 (Rust + WebView2).

**Spec:** `D:\Code\legal-annotator\docs\superpowers\specs\2026-11-13-gemini-web-studio-digest-design.md`

## Global Constraints
- Preserve existing Perplexity Case Digest behavior (`#btn-perplexity-digest`, `pplx_*`, `perplexity-studio`) untouched.
- Never overwrite `D:\Code\legal-annotator-desktop\ui\src\desktop-bridge.js` during web-to-desktop mirroring.
- Default Gemini Web model: `'4 Hydrogen'`, default thinking level: `'High'` (both configurable in Settings and inside Gemini Studio bar).
- Per-Subject Gemini Notebook URLs stored under `gemini_subject_notebooks` (`localStorage` + Supabase `app_settings` + Desktop `gemini_studio_prefs.json`), normalized to `https://gemini.google.com/notebook/<uuid>` when matching `/notebook/<uuid>`.
- Separate bridge URL `http://127.0.0.1:19877/__gemini_msg?d=` in `gemini_studio.rs` (distinct from Perplexity's `19876/__pplx_msg`).
- Always save `version.json` as UTF-8 without BOM (`EF BB BF`).

## Review Focus
1. **Unpinned Subject / URL Normalization:** Opening a PDF whose Subject has no pinned Notebook URL opens `https://gemini.google.com/notebooks` (attempting a sidebar/card match on `subjectName`), never overwrites another Subject's URL, and normalizes `/notebook/<uuid>/...` sub-chat URLs back to `/notebook/<uuid>`.
2. **Two-Step Model + Thinking Level Picker:** In `gemini.google.com`, if the bottom `"Ask Gemini"` model pill already matches configured `modelLabel` + `thinkingLevel` (e.g. `Hydrogen High`), skip clicking; otherwise click the bottom pill -> select `modelLabel` row -> open `Thinking level` submenu -> select `thinkingLevel` row (`Low`/`Medium`/`High`), without clicking sidebar/nav links.
3. **Thinking Trace Stripping:** Gemini Thinking (`High`) renders expandable thought/reasoning DOM nodes above the answer; `getLatestGeminiAnswerSnapshot()` must clone and strip thought/reasoning containers (`model-thoughts`, `.thoughts-container`, `[data-test-id*="thought"]`, feedback/copy bars) before sending HTML/text to `importDigestIntoCaseDigestTab`.
4. **Fixed Bottom Chatbox Clearance:** Gemini's `"Ask Gemini"` bar stays anchored at the bottom center of the viewport; `#la-gemini-fab-send` must sit at `bottom: 88px; right: 20px;` so it never overlaps the prompt box, model pill, or mic/send buttons.
5. **Concurrent Digest & Stop Safety:** Starting a Gemini or Perplexity digest while the other is active is blocked cleanly with a toast; `stopActiveGeminiDigest()` cancels both single and batch Gemini runs and resets monitor state cleanly.

---

### Task 1: Web UI Markup, Styles, Notepad Toast & Command/Library Menus

**Files:**
- Modify: `D:\Code\legal-annotator\index.html:388-394`, `D:\Code\legal-annotator\index.html:1484-1502`, `D:\Code\legal-annotator\index.html:1825-1832`
- Modify: `D:\Code\legal-annotator\src\style.css:545-547`, `D:\Code\legal-annotator\src\style.css:2943-2959`
- Modify: `D:\Code\legal-annotator\src\notepad.js:1049`, `D:\Code\legal-annotator\src\notepad.js:1123-1128`
- Modify: `D:\Code\legal-annotator\src\ui.js:1105-1114`
- Modify: `D:\Code\legal-annotator\src\library.js:95-136`, `D:\Code\legal-annotator\src\library.js:276-288`

**Interfaces:**
- Produces DOM IDs: `#btn-gemini-digest`, `#ctx-gemini-digest`, `#ctx-folder-gemini-digest`, `#settings-gemini-digest-card`, `#settings-gemini-model`, `#settings-gemini-thinking`, `#settings-gemini-notebooks-list`, `#settings-btn-save-gemini-digest`
- Produces Command Palette item: `[data-cmd="gemini-digest"]`
- Modifies signature in `src/notepad.js`:
  `export async function importDigestIntoCaseDigestTab(pdfId, rawHtml = '', rawText = '', mode = 'append', sourceLabel = 'Perplexity')`
- Consumes from `src/smart-copy.js` (Task 2):
  `runGeminiDigestForPdf(pdf)`, `runBatchGeminiDigestForFolders(folderTarget)`

- [ ] **Step 1: Add toolbar button, Settings card, and Command Palette item in `index.html`**
  - At `index.html:388-391`, keep `#btn-perplexity-digest` intact and insert immediately after it:
    ```html
    <button class="tb-btn casebar__btn casebar__btn--gemini" id="btn-gemini-digest" title="Extract PDF text + Subfolder Instruction and auto-digest in your Subject's Gemini Notebook">
      <svg class="icon" aria-hidden="true"><use href="#i-spark"/></svg><span>Case Digest (Gemini)</span>
    </button>
    ```
  - At `index.html:1494` (right after the Gemini AI API Key card), add `#settings-gemini-digest-card` containing:
    - Model label text input (`#settings-gemini-model`, placeholder `4 Hydrogen`) + Thinking level `<select>` (`#settings-gemini-thinking` with options `High`, `Medium`, `Low`, `None`) + Save button (`#settings-btn-save-gemini-digest`).
    - Container `#settings-gemini-notebooks-list` dynamically populated with each Subject in `S.subjects`, allowing the user to view, paste/edit, or clear that Subject's `https://gemini.google.com/notebook/...` URL.
  - At `index.html:1825-1828`, add Command Palette option `data-cmd="gemini-digest"` (`Case Digest (Gemini)`, hint `Gemini`).

- [ ] **Step 2: Style `#btn-gemini-digest` and Settings rows in `src/style.css`**
  - Around `src/style.css:545-547` and `2943-2959`, style `#btn-gemini-digest` / `#toolbar.casebar #btn-gemini-digest.casebar__btn--gemini` with a distinct Gemini sapphire/indigo accent (`#60a5fa` / theme-aware contrast on both Darkroom Casebook & Chancery Folio day theme via `body.theme-paper` rule) and disabled wait state matching `#btn-perplexity-digest:disabled`.
  - Add `.pplx-monitor[data-provider="gemini"]` / `.pplx-floating-banner[data-provider="gemini"]` subtle accent override if desired.

- [ ] **Step 3: Parameterize toast label in `src/notepad.js` and wire command in `src/ui.js`**
  - In `src/notepad.js:1049`, update `importDigestIntoCaseDigestTab(pdfId, rawHtml = '', rawText = '', mode = 'append', sourceLabel = 'Perplexity')` and use `const providerLabel = (sourceLabel && String(sourceLabel).trim()) || 'Case';` in the toast at L1123-1127.
  - In `src/ui.js:1105-1107`, add `else if (cmd === 'gemini-digest') { document.getElementById('btn-gemini-digest')?.click(); }`.

- [ ] **Step 4: Add Gemini context menu items in `src/library.js`**
  - After `#ctx-perplexity-digest` (`src/library.js:95-115`), add `#ctx-gemini-digest` (`Gemini Digest (Auto Case Digest)`) calling `runGeminiDigestForPdf(pdf)` from `./smart-copy.js`.
  - After `#ctx-folder-perplexity-digest` (`src/library.js:116-136`), add `#ctx-folder-gemini-digest` (`Gemini Digest All PDFs in Folder`) calling `runBatchGeminiDigestForFolders(folderTarget)` from `./smart-copy.js`.
  - Update `showLibCtxMenu` (`src/library.js:276-288`) to toggle visibility of `#ctx-gemini-digest` and `#ctx-folder-gemini-digest` (with folder count label) identically to the Perplexity items.

- [ ] **Step 5: Verify syntax**
  Run: `node --check D:\Code\legal-annotator\src\notepad.js && node --check D:\Code\legal-annotator\src\ui.js && node --check D:\Code\legal-annotator\src\library.js`
  Expected: Exit code 0 with zero errors.

---

### Task 2: Web Gemini Digest Engine, Subject Notebook Sync & Monitor State (`src/smart-copy.js` + `src/main.js`)

**Files:**
- Modify: `D:\Code\legal-annotator\src\smart-copy.js:775-1770`
- Modify: `D:\Code\legal-annotator\src\main.js:720-815` (if Settings refresh hook calls `refreshGeminiDigestSettingsUI` when opening Settings, or wire directly in `initSmartCopy()` / `main.js` Settings listener)

**Interfaces:**
- Consumes from `src/notepad.js`: `importDigestIntoCaseDigestTab(pdfId, html, text, mode, sourceLabel)`
- Consumes from `desktop-bridge.js` (Task 3):
  - `window.desktopOpenGeminiStudio(payload)`
  - `window.desktopFocusGeminiStudio()`
  - `window.desktopSaveGeminiPrefs(prefs)`
  - `window.desktopGetGeminiPrefs()`
- Produces exports & `window.*` globals in `src/smart-copy.js`:
  - `getSubjectInfoForFolder(folderId)` -> `{ subjectId, subjectName }`
  - `getPinnedGeminiNotebookForSubject(subjectId)` -> `Promise<string>`
  - `setPinnedGeminiNotebookForSubject(subjectId, url)` -> `Promise<void>`
  - `getGeminiModelPrefs()` / `saveGeminiModelPrefs({ modelLabel, thinkingLevel })`
  - `openGeminiDigestForCurrentPdf(opts = {})`
  - `runGeminiDigestForPdf(pdfItem)`
  - `runBatchGeminiDigestForFolders(foldersOrFolder)`
  - `focusOrReopenGeminiStudio()`
  - `stopActiveGeminiDigest()`
  - `refreshGeminiDigestSettingsCard()`
  - `window.__onGeminiStudioStatus(payload)`
  - `window.__onGeminiPrefsUpdated(prefs)`
  - `window.__onGeminiDigestReceived(msg)`

- [ ] **Step 1: Factor shared PDF text extraction & subject resolution in `src/smart-copy.js`**
  - Add `getSubjectInfoForFolder(folderId)` walking `S.folders` to `subject_id` -> `S.subjects`.
  - Add `normalizeGeminiNotebookUrl(url)` normalizing `https://gemini.google.com/notebook/<uuid>/...` -> `https://gemini.google.com/notebook/<uuid>`.
  - Add `extractPdfDigestPromptPayload({ doc, total, pdfObj, countLabel, provider, onProgressStatus })` sharing the 10-page batch PDF.js + OCR fallback + `stripPageNumbersAndFooters` + `buildFullCopyInstruction` logic so Perplexity and Gemini use one shared code path.

- [ ] **Step 2: Add per-Subject Notebook & Model/Thinking preferences persistence**
  - Keys in `localStorage` & Supabase `app_settings` (`dbGetSetting` / `dbSetSetting`):
    - `gemini_subject_notebooks`: JSON object `{ [subjectId]: url }`
    - `gemini_model_label`: default `'4 Hydrogen'`
    - `gemini_thinking_level`: default `'High'`
    - `gemini_auto_submit`, `gemini_auto_send`, `gemini_digest_mode`
  - On `save_prefs` from Studio (`window.__onGeminiPrefsUpdated`), merge `{ subjectId, pinnedNotebookUrl }` into `gemini_subject_notebooks`, update model/thinking/toggle keys, and sync to Supabase (`dbSetSetting`).
  - Wire `#settings-btn-save-gemini-digest` and `#settings-gemini-notebooks-list` (refreshing whenever Settings modal opens in `src/main.js:791` or via click listener on `#btn-settings` / `refreshGeminiDigestSettingsCard()`).

- [ ] **Step 3: Implement provider-aware Monitor Strip, Floating Banner, Web Fallback & Gemini Studio Dispatch**
  - Add `provider: 'perplexity' | 'gemini'` to `_pplxMonitorState` and `_batchDigestState`.
  - When `_pplxMonitorState.provider === 'gemini'`, `renderPplxMonitorStrip()` and `renderFloatingMonitorBanner()` route Focus to `focusOrReopenGeminiStudio()` and Stop to `stopActiveGeminiDigest()`, and set `strip.dataset.provider = 'gemini'` / `banner.dataset.provider = 'gemini'`.
  - Implement `preOpenGeminiWebWindow()`, `focusOrReopenGeminiStudio()`, `stopActiveGeminiDigest()`, `openGeminiDigestForCurrentPdf(opts)`, `runGeminiDigestForPdf(pdfItem)`, `runBatchGeminiDigestForFolders(foldersOrFolder)`.
  - Prevent starting Gemini Digest while Perplexity Digest is running (and vice versa) with a clear toast.
  - Wire `#btn-gemini-digest` in `initSmartCopy()`, register `window.__onGeminiStudioStatus`, `window.__onGeminiPrefsUpdated`, and `window.__onGeminiDigestReceived` (passing `'Gemini'` as 5th argument to `importDigestIntoCaseDigestTab`).

- [ ] **Step 4: Verify syntax**
  Run: `node --check D:\Code\legal-annotator\src\smart-copy.js && node --check D:\Code\legal-annotator\src\main.js`
  Expected: Exit code 0.

---

### Task 3: Desktop Tauri Gemini Studio Module & Bridge (`gemini_studio.rs`, `main.rs`, `desktop-bridge.js`)

**Files:**
- Create: `D:\Code\legal-annotator-desktop\src-tauri\src\gemini_studio.rs`
- Modify: `D:\Code\legal-annotator-desktop\src-tauri\src\main.rs:1-40` (declare `mod gemini_studio;`), `983` / `3294` / `3330` / `3332` (`pub(crate)` on `now_ms`, `perform_native_os_mouse_click`, `percent_decode_str`), `4813-4817` (register 4 Tauri commands in `generate_handler!`)
- Modify: `D:\Code\legal-annotator-desktop\ui\src\desktop-bridge.js:130-156`

**Interfaces:**
- Rust commands exposed to frontend:
  - `desktop_get_gemini_prefs() -> Result<serde_json::Value, String>`
  - `desktop_save_gemini_prefs(prefs: serde_json::Value) -> Result<bool, String>`
  - `desktop_focus_gemini_studio(app: tauri::AppHandle) -> Result<bool, String>`
  - `desktop_open_gemini_studio(app, pdf_id, pdf_name, subject_id, subject_name, subfolder_name, instruction_text, pdf_text, full_prompt_text, pinned_notebook_url, model_label, thinking_level, auto_submit, digest_mode, auto_send_digest) -> Result<bool, String>`
- Bridge methods in `desktop-bridge.js`:
  - `window.desktopGetGeminiPrefs`, `window.desktopSaveGeminiPrefs`, `window.desktopOpenGeminiStudio`, `window.desktopFocusGeminiStudio`, `window.__desktopForwardGeminiStatus`

- [ ] **Step 1: Add Gemini bridge methods in `desktop-bridge.js`**
  - Mirror lines 87-155 for Gemini commands (`desktop_get_gemini_prefs`, `desktop_save_gemini_prefs`, `desktop_open_gemini_studio`, `desktop_focus_gemini_studio`) and `window.__desktopForwardGeminiStatus` calling `window.__onGeminiStudioStatus(payload)`.
  - Run `node --check D:\Code\legal-annotator-desktop\ui\src\desktop-bridge.js`.

- [ ] **Step 2: Create `src-tauri/src/gemini_studio.rs` with Tauri commands & `GEMINI_INIT_SCRIPT`**
  - Persist prefs at `crate::resolve_data_dir().join("gemini_studio_prefs.json")` storing `subjectNotebooks` (map `{ subjectId: url }`), `modelLabel` (default `"4 Hydrogen"`), `thinkingLevel` (default `"High"`), `autoSubmit` (true), `digestMode` (`"append"`), `autoSendDigest` (true).
  - Window `"gemini-studio"` (`1120x840`) loads `pinnedNotebookUrl` if valid `https://gemini.google.com/...`, otherwise `https://gemini.google.com/notebooks`.
  - Intercept `http://127.0.0.1:19877/__gemini_msg?d=` in `on_navigation` for `save_prefs`, `send_digest`, `native_click`, `studio_status`, `studio_error`.
  - Implement `GEMINI_INIT_SCRIPT` (pure ES5-compatible IIFE like `PERPLEXITY_INIT_SCRIPT`):
    - Top bar `#la-gemini-studio-bar` (`Gemini Digest Studio`, Subject + PDF badge, `Pin for <Subject>`, clickable configurable Model/Thinking pill e.g. `4 Hydrogen · High` with inline config popover/inputs + presets `4 Hydrogen`, `3.5 Flash-Lite`, `3.1 Pro`, `4 Argon`, `4 Carbon` & Thinking `High`/`Medium`/`Low`/`None`, `Auto-Submit`, `Auto-Send`, `Digest: Append/Replace`, `Paste Case`, status text, gold `Send to Case Digest`), plus floating FAB `#la-gemini-fab-send` at `bottom: 88px; right: 20px;`.
    - Notebook routing: if on `https://gemini.google.com/notebooks` without a pinned URL for `subjectId`, scan links/cards for a title matching `subjectName` (case-insensitive) and open + pin it; if no match, ask user to open the Subject's Notebook and click Pin. After `send_digest` ACK, return to the normalized `https://gemini.google.com/notebook/<uuid>` home after 900ms for batch/next case readiness.
    - Two-step Model & Thinking selection (`ensureGeminiModelSelected`):
      1. Locate bottom composer `"Ask Gemini"` input (`findGeminiPromptInput`) and adjacent model selector pill (`findGeminiModelPill`).
      2. If pill text already matches configured `modelLabel` core token (e.g. `hydrogen`) AND configured `thinkingLevel` (e.g. `high`), skip menu clicks.
      3. Otherwise click bottom model pill (`realPointerClick` + `native_click` fallback), locate floating overlay menu row matching `modelLabel` (ignoring sidebar/prose), click it; then if `thinkingLevel` is set (`High`/`Medium`/`Low`), locate `Thinking level` menu item (re-opening the bottom pill if the model click closed the menu), click/hover it to reveal the submenu, and click the `thinkingLevel` row.
    - Input injection (`setGeminiInputText`) supporting `rich-textarea` / `.ql-editor` / `[contenteditable="true"]` / `textarea`, submit button click (`triggerGeminiSubmit`), generation check (`isGeminiStillGenerating`), and response extraction (`getLatestGeminiAnswerSnapshot`) that explicitly strips thinking/CoT accordions (`model-thoughts`, `.thoughts-container`, `[data-test-id*="thought"]`, `.thinking-block`) and action toolbars before auto-sending after 4.5s stability (>= 55 words).

- [ ] **Step 3: Wire `mod gemini_studio;` and command handlers in `src-tauri/src/main.rs`**
  - Add `mod gemini_studio;`, mark `now_ms`, `perform_native_os_mouse_click` (both `cfg` branches), and `percent_decode_str` as `pub(crate)`, and register `gemini_studio::desktop_get_gemini_prefs`, `gemini_studio::desktop_save_gemini_prefs`, `gemini_studio::desktop_open_gemini_studio`, `gemini_studio::desktop_focus_gemini_studio` in `tauri::generate_handler!`.

- [ ] **Step 4: Compile-check Rust**
  Run: `cargo check --manifest-path D:\Code\legal-annotator-desktop\src-tauri\Cargo.toml`
  Expected: Compiles with zero errors.

---

### Task 4: Verification, Parity Mirroring, Build, Secret Shield & Release (`verifier`)

**Files:**
- Mirror modified `D:\Code\legal-annotator\*` UI files (`index.html`, `src/style.css`, `src/notepad.js`, `src/ui.js`, `src/library.js`, `src/smart-copy.js`, `src/main.js`) to `D:\Code\legal-annotator-desktop\ui\*` (NEVER `ui/src/desktop-bridge.js`)
- Modify: `D:\Code\legal-annotator-desktop\version.json` (bump minor version + increment `build` by 1, UTF-8 without BOM)
- Rebuild: `D:\Code\legal-annotator-desktop\Legal Annotator.exe`

- [ ] **Step 1: Verify `git diff --name-only` & `node --check` on all modified JS files in both repos**
- [ ] **Step 2: Run deterministic UI mirroring (`Copy-Item` excluding `desktop-bridge.js`) & `Get-FileHash` parity verification**
- [ ] **Step 3: Run headless verification script checking index.html + JS exports + CSS rules + `version.json` no-BOM**
- [ ] **Step 4: Update `version.json` (UTF-8 without BOM) and run `cargo build --release --manifest-path D:\Code\legal-annotator-desktop\src-tauri\Cargo.toml`, then copy `target\release\*.exe` to `D:\Code\legal-annotator-desktop\Legal Annotator.exe`**
- [ ] **Step 5: Run `git-secret-shield` across both repos, commit, and `git push` both repos to GitHub**
