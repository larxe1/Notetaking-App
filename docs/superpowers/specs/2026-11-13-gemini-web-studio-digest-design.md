# Gemini Web Studio Case Digest — Design Spec

**Date:** 2026-11-13
**Status:** Approved by user
**Repos:** `D:\Code\legal-annotator` (Web UI source of truth), `D:\Code\legal-annotator-desktop` (Tauri Desktop wrapper + WebView2 Studio)

## Intent & Why
Keep the existing **Perplexity Case Digest** ("Law" Project) working unchanged while adding a parallel **Gemini Web Studio** option (`gemini.google.com`) so the user can generate Case Digests using their existing Gemini Pro web subscription, per-subject Gemini Notebooks (`https://gemini.google.com/notebook/<uuid>`), custom Notebook skills/instructions, and configurable model + thinking level (defaulting to **4 Hydrogen** / **High**).

## Goals
1. Add **Case Digest (Gemini)** alongside **Case Digest (Perplexity)** in:
   - Top case toolbar (`#btn-gemini-digest`)
   - Command Palette (`gemini-digest`)
   - Library single-PDF right-click menu (`#ctx-gemini-digest`)
   - Library folder / multi-folder right-click batch menu (`#ctx-folder-gemini-digest`)
2. Store **one pinned Gemini Notebook URL per Legal Annotator Subject** (`gemini_subject_notebooks` map `{ [subjectId]: url }`), persisted in `localStorage`, synced cross-device via Supabase `app_settings`, and persisted in Desktop `gemini_studio_prefs.json`.
3. Support configurable **Model label** (default `4 Hydrogen`) and **Thinking level** (default `High`; supports `Low`, `Medium`, `High`, or `None`) — editable both inside the Gemini Studio top bar and in Legal Annotator **Settings**.
4. Mirror Perplexity Studio's full Desktop WebView2 automation (`gemini-studio` window) + Web popup fallback:
   - Resolve the active PDF's Subject, open its pinned Gemini Notebook URL (or `https://gemini.google.com/notebooks` with smart Subject-name matching when unpinned).
   - Ensure the bottom `"Ask Gemini"` model pill matches the configured model + thinking level (`Hydrogen High` by default), clicking the model pill -> model option -> `Thinking level` -> level option when needed.
   - Paste extracted PDF text + Subfolder Instruction (`buildFullCopyInstruction`), auto-submit if enabled, wait for generation to complete (excluding thinking-trace accordions and UI chrome), and auto-send into the **Case Digest** tab (`importDigestIntoCaseDigestTab(..., 'Gemini')`) without touching the **Notes** tab.
   - Support single PDFs and Batch Folder Digest using the shared monitor strip and floating progress banner.

## Non-Goals
- Do NOT modify or break any existing Perplexity Case Digest flow, `perplexity_studio_prefs.json`, or `pplx_*` keys.
- Do NOT call the paid Gemini API (`src/ai.js`) for Case Digest generation.
- Do NOT overwrite `D:\Code\legal-annotator-desktop\ui\src\desktop-bridge.js` during web-to-desktop mirroring.

## Approaches Considered
1. **Built-in Gemini API (`src/ai.js`)** — Rejected because user relies on Gemini Pro web subscription and custom Notebook skills (`gemini.google.com/notebook/<uuid>`), not paid API tokens.
2. **Gemini Web Studio (`gemini.google.com`) — Selected** — Dedicated `gemini-studio` Tauri module (`src-tauri/src/gemini_studio.rs`) + Desktop bridge + shared `smart-copy.js` extraction/monitor pipeline + Web popup fallback. Mirrors the proven Perplexity Studio architecture while keeping Perplexity and Gemini isolated on separate loopback bridge ports (`19876` vs `19877`) and separate WebView windows (`perplexity-studio` vs `gemini-studio`).

## Key Design Decisions
- **Separate Rust module (`src-tauri/src/gemini_studio.rs`)**: Keeps `main.rs` clean; exposes `desktop_get_gemini_prefs`, `desktop_save_gemini_prefs`, `desktop_open_gemini_studio`, and `desktop_focus_gemini_studio`.
- **Configurable Model & Thinking Level**: Stored as `gemini_model_label` (default `'4 Hydrogen'`) and `gemini_thinking_level` (default `'High'`). Fast-paths when the bottom pill already reads `Hydrogen High` (matches both tokens).
- **Per-Subject Notebook URL Normalization**: URLs like `https://gemini.google.com/notebook/<uuid>/...` normalize to `https://gemini.google.com/notebook/<uuid>` so returning home after a digest always lands on a fresh chat composer inside that Subject's Notebook.
- **Floating FAB Clearance**: In Gemini Studio, position the floating `Send to Case Digest` pill at `bottom: 88px; right: 20px;` so it never collides with Gemini's fixed bottom `"Ask Gemini"` bar.
