// ═══════════════════════════════════════════════
// MAIN — entry point, wires everything together
// ═══════════════════════════════════════════════
import { S }                  from './state.js';
import { db, dbLoad, dbLoadAnnCounts, dbCreateBookmark, dbDelBookmark, dbLoadLinks, dbSaveLinks, dbGetSetting } from './db.js';
import { initDriveBar }       from './drive.js';
import { renderLibrary, initLibraryModals, initLibrarySelection, initContextMenu } from './library.js';
import { renderColorDots, initColors } from './colors.js';
import { setMode }            from './viewer.js';
import { initAnnPanel }       from './annotate.js';
import { initSearch, openSearch, closeSearch } from './search.js';
import { initDrawControls, initPinchZoom } from './draw.js';
import {
  initModals, initSidebar, initZoom, initNavButtons,
  initKeyboard, exportAnnotations, toast, syncErr,
  openModal, closeModal, autosave, updateAppTitle, openGoogleCompanion
} from './ui.js';
import { initNotepad } from './notepad.js';
import { initTableContextMenu, initTableLightbox } from './tablepicker.js';
import { initDualView } from './dualview.js';
import { initRealtimeSync } from './sync.js';
import { initOutbox } from './outbox.js';
import { initDiagramStudio } from './diagram.js';
import { initGlobalPdfLinks } from './pdflink.js';
import { initStorageManager, safeStorageSet, safeStorageGet, safeStorageRemove } from './storage.js';

// Global Error Boundary to prevent tab-freezing crashes
function setupGlobalErrorBoundary() {
  let errorCount = 0;
  window.addEventListener('error', (event) => {
    console.error('[Global Crash Boundary caught error]', event.error || event.message);
    errorCount++;
    if (errorCount <= 3) {
      document.querySelectorAll('#ann-panel, #notepad-panel, #search-panel')
        .forEach(el => el.classList.remove('open'));
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[Global Crash Boundary caught unhandled promise]', event.reason);
  });
}

async function init() {
  // 0. Storage health check (prevent quota exceeded crashes & prune old cache)
  try { initStorageManager(); } catch (e) { console.warn('[Init] StorageManager error:', e); }

  // 1. Setup crash boundary and pre-flight reset
  setupGlobalErrorBoundary();
  document.querySelectorAll('#ann-panel, #notepad-panel, #search-panel')
    .forEach(el => el.classList.remove('open'));

  // 2. Init Google Drive bar (guarded)
  try { initDriveBar(); } catch (e) { console.error('[Init] DriveBar error:', e); }

  // 3. Load data from Supabase (guarded)
  try {
    await dbLoad();
    await dbLoadAnnCounts();
  } catch (err) {
    console.error('[Init] Database load error:', err);
  }

  // 4. Render library (guarded)
  try { renderLibrary(); } catch (e) { console.error('[Init] Library render error:', e); }

  // 5. Active color (guarded)
  try {
    if (S.colorCats.length) S.activeColor = S.colorCats[0].hex_color;
    renderColorDots();
  } catch (e) { console.error('[Init] Colors render error:', e); }

  // 6. Wire all UI independently (a failure in one module never breaks the others)
  const safeInit = (fn, name) => {
    try { fn(); } catch (err) { console.error(`[Init] ${name} error:`, err); }
  };

  safeInit(initModals, 'Modals');
  
  const welcomeHTML = document.getElementById('canvas-scroll')?.innerHTML;
  document.getElementById('app-title')?.addEventListener('click', async () => {
    try {
      const { flushNotepadSave, notepadOnPDFChange } = await import('./notepad.js');
      await flushNotepadSave();
      await notepadOnPDFChange(null);
    } catch {}

    S.curPDF = null;
    const scroll = document.getElementById('canvas-scroll');
    if (scroll && welcomeHTML) scroll.innerHTML = welcomeHTML;
    
    // Reset view to Welcome (content-area visible, folder-doc hidden)
    try {
      const { flushFolderDoc } = await import('./viewer.js');
      await flushFolderDoc();
    } catch {}
    document.getElementById('folder-doc-viewer').style.display = 'none';
    document.getElementById('content-area').style.display = 'flex';
    const { closeOtherPanels } = await import('./ui.js');
    closeOtherPanels();

    try {
      const { updateActivePDF } = await import('./viewer.js');
      updateActivePDF();
    } catch {}
  });

  safeInit(initSidebar, 'Sidebar');
  safeInit(initLibraryModals, 'LibraryModals');
  safeInit(initLibrarySelection, 'LibrarySelection');
  safeInit(initColors, 'Colors');
  safeInit(initAnnPanel, 'AnnPanel');
  safeInit(initSearch, 'Search');
  safeInit(initDrawControls, 'DrawControls');
  safeInit(initPinchZoom, 'PinchZoom');
  safeInit(initZoom, 'Zoom');
  safeInit(initNavButtons, 'NavButtons');
  safeInit(initNotepad, 'Notepad');
  safeInit(initTableContextMenu, 'TableContextMenu');
  safeInit(initTableLightbox, 'TableLightbox');
  safeInit(initDualView, 'DualView');
  safeInit(initContextMenu, 'ContextMenu');
  safeInit(initCalendar, 'Calendar');
  safeInit(initLinks, 'Links');
  safeInit(initRealtimeSync, 'RealtimeSync');
  safeInit(() => initOutbox(db), 'OutboxSync');
  safeInit(updateAppTitle, 'AppTitle');
  safeInit(initDiagramStudio, 'DiagramStudio');
  safeInit(initGlobalPdfLinks, 'GlobalPdfLinks');

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  );

  // Google Law Companion button
  document.getElementById('btn-google')?.addEventListener('click', () => {
    openGoogleCompanion();
  });


  // Add custom bookmark
  document.getElementById('btn-add-bm').addEventListener('click', async () => {
    if (!S.curPDF || !S.curPage) return;
    const inp = document.getElementById('bm-title');
    const title = inp.value.trim() || `Page ${S.curPage}`;
    
    try {
      autosave('saving');
      const trueId = S.curPDF.linked_pdf_id || S.curPDF.id;
      await dbCreateBookmark(trueId, S.curPage, title);
      S.bookmarks.push({ pdf_id: trueId, page: S.curPage, title });
      S.bookmarks.sort((a, b) => a.page - b.page);
      inp.value = '';
      // Re-render TOC
      document.getElementById('btn-toc').click();
    } catch (e) {
      console.error('Bookmark Error:', e);
      alert('Supabase Error: ' + (e.message || JSON.stringify(e)));
      toast('Failed to add bookmark.');
    }
  });

  document.getElementById('bm-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-add-bm').click();
  });

  // Table of Contents
  document.getElementById('btn-toc').addEventListener('click', async () => {
    if (!S.pdfDoc) return;
    openModal('mo-toc');
    const list = document.getElementById('toc-list');
    list.innerHTML = '<div style="color:#888;font-style:italic;padding:10px">Loading contents...</div>';

    try {
      const outline = await S.pdfDoc.getOutline();
      list.innerHTML = '';

      // ── 1. Custom bookmarks (always shown first) ──
      if (S.bookmarks && S.bookmarks.length > 0) {
        const custHeader = document.createElement('div');
        custHeader.style.cssText = 'padding:10px 10px 4px; color:var(--gold); font-size:11px; text-transform:uppercase; font-weight:bold;';
        custHeader.textContent = 'Custom Bookmarks';
        list.appendChild(custHeader);

        S.bookmarks.forEach(bm => {
          const div = document.createElement('div');
          div.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 10px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05);';

          const label = document.createElement('div');
          label.textContent = `[Pg ${bm.page}] ${bm.title}`;
          label.style.cssText = 'font-size:14px; flex:1;';
          label.addEventListener('click', () => {
            closeModal('mo-toc');
            import('./ui.js').then(m => m.jumpToPage(bm.page));
          });

          const del = document.createElement('div');
          del.textContent = '✕';
          del.style.cssText = 'color:#888; font-size:12px; padding:0 4px; cursor:pointer;';
          del.addEventListener('click', async (e) => {
            e.stopPropagation();
            await dbDelBookmark(bm.id);
            document.getElementById('btn-toc').click();
          });

          div.appendChild(label);
          div.appendChild(del);
          list.appendChild(div);
        });
      }

      // ── 2. Native PDF outline (if present) ──
      if (outline && outline.length > 0) {
        const natHeader = document.createElement('div');
        natHeader.style.cssText = 'padding:16px 10px 4px; color:#888; font-size:11px; text-transform:uppercase; font-weight:bold;';
        natHeader.textContent = 'PDF Bookmarks';
        list.appendChild(natHeader);

        const renderToc = (items, depth = 0) => {
          items.forEach(item => {
            const div = document.createElement('div');
            div.style.cssText = `padding-left:${10 + depth * 16}px; padding-top:8px; padding-bottom:8px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); font-size:14px;`;
            div.textContent = item.title;

            div.addEventListener('mouseover', () => div.style.color = 'var(--gold)');
            div.addEventListener('mouseout', () => div.style.color = '');
            div.addEventListener('click', async (e) => {
              e.stopPropagation();
              const doc = S.pdfDoc;
              if (!doc) return;
              try {
                let dest = item.dest;
                if (!dest && item.action?.dest) dest = item.action.dest;
                if (typeof dest === 'string') dest = await doc.getDestination(dest);
                if (!Array.isArray(dest)) { closeModal('mo-toc'); return; }

                let pageIdx = -1;
                const ref = dest[0];
                if (typeof ref === 'object' && ref !== null) {
                  pageIdx = await doc.getPageIndex(ref);
                } else if (Number.isInteger(ref)) {
                  pageIdx = ref;
                }
                const page = pageIdx + 1;
                if (pageIdx >= 0 && page <= S.totalPages) {
                  closeModal('mo-toc');
                  import('./ui.js').then(m => m.jumpToPage(page));
                } else {
                  closeModal('mo-toc');
                }
              } catch (err) {
                console.warn('Failed to resolve PDF bookmark destination:', err);
                closeModal('mo-toc');
              }
            });

            list.appendChild(div);
            if (item.items && item.items.length) renderToc(item.items, depth + 1);
          });
        };
        renderToc(outline);

      } else {
        // ── 3. No native outline → heuristic heading detection ──
        renderTocHeuristicSection(list);
      }

    } catch (e) {
      list.innerHTML = '<div style="color:red;padding:10px">Failed to load contents.</div>';
      console.error(e);
    }
  });

  // ── Heuristic ToC detection + AI generation ──
  function renderTocHeuristicSection(list) {
    // Run heuristic scan across already-indexed text items (first 20 pages, free)
    const detected = detectHeadingsHeuristic(20);

    const detectedHeader = document.createElement('div');
    detectedHeader.style.cssText = 'padding:16px 10px 4px; color:#888; font-size:11px; text-transform:uppercase; font-weight:bold;';
    detectedHeader.textContent = detected.length >= 3 ? '📋 Detected Headings' : '📋 Auto-Detect';
    list.appendChild(detectedHeader);

    const detectedContainer = document.createElement('div');
    detectedContainer.id = 'toc-detected-results';
    list.appendChild(detectedContainer);

    if (detected.length >= 3) {
      renderDetectedEntries(detectedContainer, detected);
    } else {
      detectedContainer.innerHTML = '<div style="color:#888; font-size:13px; padding:8px 10px;">No headings detected automatically.</div>';
    }

    // AI Generation button (always shown when no native outline)
    const aiRow = document.createElement('div');
    aiRow.style.cssText = 'padding:12px 10px 4px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;';

    const aiBtn = document.createElement('button');
    aiBtn.className = 'btn-gold';
    aiBtn.style.cssText = 'font-size:12px; padding:6px 12px;';
    aiBtn.textContent = '✨ Generate with AI';
    aiBtn.addEventListener('click', () => runAiTocGeneration(detectedContainer));

    aiRow.appendChild(aiBtn);
    list.appendChild(aiRow);
  }

  function detectHeadingsHeuristic(maxPages) {
    const entries = [];
    const limit = Math.min(maxPages, S.totalPages);

    // Collect all font heights across sampled pages to compute median body size
    const allHeights = [];
    for (let p = 1; p <= limit; p++) {
      const items = S.pages[p]?.textItems || [];
      for (const item of items) {
        if (item.h > 2 && item.h < 200) allHeights.push(item.h);
      }
    }
    if (allHeights.length === 0) return entries;
    allHeights.sort((a, b) => a - b);
    const medianH = allHeights[Math.floor(allHeights.length / 2)];
    const headingThreshold = medianH * 1.35; // 35% bigger than body text = heading

    const seenTitles = new Set();

    for (let p = 1; p <= limit; p++) {
      const items = S.pages[p]?.textItems || [];
      for (const item of items) {
        const text = item.str.trim();
        if (!text || text.length < 3 || text.length > 120) continue;

        // Heuristic checks:
        // A) Font significantly larger than body text
        const isBigFont = item.h >= headingThreshold;
        // B) Looks like a numbered section: "Article 1", "Section 2", "Chapter III", "1.", "I."
        const isNumbered = /^(article|section|chapter|part|title|rule|book)\s+\d+/i.test(text) ||
                           /^(art\.|sec\.|ch\.)\s*\d+/i.test(text) ||
                           /^\d+\.\s+[A-Z]/.test(text) ||
                           /^[IVXLC]+\.\s+[A-Z]/.test(text);
        // C) Short line ending with a page number (classic ToC row): "Introduction ......... 1"
        const hasDotLeader = /\.{3,}\s*\d+\s*$/.test(text) || /\s{3,}\d+\s*$/.test(text);

        if ((isBigFont || isNumbered || hasDotLeader) && !seenTitles.has(text.toLowerCase())) {
          let title = text;
          let page = p;

          // For dot-leader rows, extract the page number from the text itself
          if (hasDotLeader) {
            const m = text.match(/(\d+)\s*$/);
            if (m) {
              page = parseInt(m[1]);
              title = text.replace(/[\.\s]+\d+\s*$/, '').trim();
              if (!title || page < 1 || page > S.totalPages) continue;
            }
          }

          seenTitles.add(text.toLowerCase());
          entries.push({ title, page });
        }
      }
    }
    return entries;
  }

  function renderDetectedEntries(container, entries) {
    container.innerHTML = '';

    entries.forEach(entry => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:7px 10px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.04); font-size:13px;';

      const lbl = document.createElement('span');
      lbl.textContent = entry.title;
      lbl.style.flex = '1';
      lbl.addEventListener('click', () => {
        closeModal('mo-toc');
        import('./ui.js').then(m => m.jumpToPage(entry.page));
      });
      lbl.addEventListener('mouseover', () => lbl.style.color = 'var(--gold)');
      lbl.addEventListener('mouseout', () => lbl.style.color = '');

      const pg = document.createElement('span');
      pg.textContent = `p.${entry.page}`;
      pg.style.cssText = 'color:#888; font-size:11px; margin-left:8px; flex-shrink:0;';

      row.appendChild(lbl);
      row.appendChild(pg);
      container.appendChild(row);
    });

    // Save as Bookmarks button
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-sec';
    saveBtn.style.cssText = 'margin:10px; font-size:12px; padding:6px 12px;';
    saveBtn.textContent = '💾 Save all as Bookmarks';
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const trueId = S.curPDF?.linked_pdf_id || S.curPDF?.id;
        if (!trueId) return;
        for (const entry of entries) {
          // Skip if already bookmarked on this page
          if (!S.bookmarks.some(b => b.page === entry.page && b.title === entry.title)) {
            await dbCreateBookmark(trueId, entry.page, entry.title);
          }
        }
        saveBtn.textContent = '✓ Saved!';
        setTimeout(() => document.getElementById('btn-toc').click(), 600);
      } catch (e) {
        saveBtn.textContent = '✗ Error';
        console.error(e);
      }
    });
    container.appendChild(saveBtn);
  }

  async function runAiTocGeneration(detectedContainer) {
    // Resolve key: localStorage first, then Supabase
    let key = safeStorageGet('gemini_api_key');
    if (!key) {
      try { key = await dbGetSetting('gemini_api_key'); } catch { /* ignore */ }
      if (key) safeStorageSet('gemini_api_key', key);
    }
    if (!key) {
      detectedContainer.innerHTML = `<div style="color:#888; font-size:13px; padding:10px;">
        No Gemini API key found. Open <strong>✨ Quiz Me</strong> in the toolbar to enter your key — it will sync here automatically.
      </div>`;
      return;
    }

    detectedContainer.innerHTML = '<div style="color:var(--gold); padding:10px; font-size:13px;">✨ AI is reading the document… (first 25 pages)</div>';

    try {
      // Extract text from first 25 pages
      const { extractPageText } = await import('./search.js');
      let textChunks = [];
      const limit = Math.min(25, S.totalPages);
      for (let p = 1; p <= limit; p++) {
        const items = await extractPageText(S.pdfDoc, p);
        const pageText = items.map(i => i.str).join(' ');
        textChunks.push(`--- Page ${p} ---\n${pageText}`);
      }
      const fullText = textChunks.join('\n').substring(0, 60000);

      const { callGemini } = await import('./ai.js');
      const schema = {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Section or chapter heading title' },
            page:  { type: 'INTEGER', description: 'Page number where this heading appears' }
          },
          required: ['title', 'page']
        }
      };
      const sys = `You are a legal document analyst. Extract the table of contents from the given text.
Return ONLY the top-level and second-level sections/chapters/articles/parts as a JSON array.
Each entry must have: title (the heading text, cleaned up) and page (integer page number).
Do not include sub-sections deeper than level 2. Do not include front matter like cover pages.
If a ToC page is present, use its page numbers. Otherwise infer from where headings appear in the text.`;

      const result = await callGemini(key, sys, `DOCUMENT TEXT:\n${fullText}`, schema);

      // Filter to valid page numbers
      const valid = (result || []).filter(e => e.title && e.page >= 1 && e.page <= S.totalPages);

      if (valid.length === 0) {
        detectedContainer.innerHTML = '<div style="color:#888; font-size:13px; padding:10px;">AI could not find a clear table of contents in the first 25 pages.</div>';
      } else {
        renderDetectedEntries(detectedContainer, valid);
      }
    } catch (e) {
      console.error('[AI ToC]', e);
      detectedContainer.innerHTML = `<div style="color:#e44; font-size:13px; padding:10px;">AI Error: ${e.message}</div>`;
    }
  }

  // Settings & Storage Manager
  async function refreshCacheStats() {
    try {
      const { getCacheStorageStats } = await import('./pdfcache.js');
      const stats = await getCacheStorageStats();
      const lbl = document.getElementById('cache-stats-lbl');
      if (lbl) {
        lbl.textContent = `${stats.count} PDF${stats.count === 1 ? '' : 's'} (${stats.formattedSize})`;
      }

      const dirNameEl = document.getElementById('cache-dir-name');
      const resetBtn = document.getElementById('btn-reset-folder');
      const chooseBtn = document.getElementById('btn-choose-folder');

      if (!stats.isCustomSupported && chooseBtn) {
        chooseBtn.style.display = 'none';
      }

      if (stats.customDir) {
        if (dirNameEl) dirNameEl.textContent = stats.customDir;
        if (resetBtn) resetBtn.style.display = 'inline-block';
      } else {
        if (dirNameEl) dirNameEl.textContent = 'Default Browser Storage';
        if (resetBtn) resetBtn.style.display = 'none';
      }
    } catch {}
  }

  document.getElementById('btn-settings')?.addEventListener('click', () => {
    openModal('mo-settings');
    refreshCacheStats();
  });
  document.getElementById('btn-export-settings')?.addEventListener('click', () => {
    closeModal('mo-settings');
    exportAnnotations();
  });
  document.getElementById('btn-open-keys')?.addEventListener('click', () => {
    closeModal('mo-settings');
    openModal('mo-keys');
  });

  // Custom Cache Folder Picker (File System Access API)
  document.getElementById('btn-choose-folder')?.addEventListener('click', async () => {
    try {
      const { chooseCustomDirectory } = await import('./pdfcache.js');
      const dirName = await chooseCustomDirectory();
      if (dirName) {
        await refreshCacheStats();
        toast(`📁 Storage folder set to: ${dirName}`);
      }
    } catch (e) {
      console.error(e);
      toast('Failed to set storage folder.');
    }
  });

  // Reset to Default Sandbox Storage
  document.getElementById('btn-reset-folder')?.addEventListener('click', async () => {
    try {
      const { resetToDefaultStorage } = await import('./pdfcache.js');
      await resetToDefaultStorage();
      await refreshCacheStats();
      toast('Reset to default browser storage.');
    } catch (e) {
      console.error(e);
    }
  });

  document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
    if (!confirm('Clear all offline-cached PDFs from this device? (Your annotations and cloud files in Google Drive will remain safe)')) return;
    try {
      const { clearAllCachedPDFs } = await import('./pdfcache.js');
      await clearAllCachedPDFs();
      S.pdfCache = {};
      await refreshCacheStats();
      toast('Offline PDF cache cleared.');
    } catch (e) {
      console.error(e);
      toast('Failed to clear cache.');
    }
  });
  document.getElementById('btn-export')?.addEventListener('click', exportAnnotations);

  // Request persistent storage in background so OS never purges our PDF cache
  import('./pdfcache.js').then(m => m.requestPersistentStorage?.()).catch(()=>{});

  // Keyboard shortcuts (with deps injected)
  initKeyboard({
    setMode,
    openSearch,
    closeSearch,
    closeAnnPanel: () => import('./annotate.js').then(m => m.closeAnnPanel()),
  });

  // Hide recent wrap initially (no recents yet)
  document.getElementById('recent-wrap').style.display = 'none';
}

let curSubj = null;
function initCalendar() {
  document.addEventListener('click', e => {
    const item = e.target.closest('.cal-item');
    if (!item) return;
    const strong = item.querySelector('strong');
    if (!strong) return;
    
    curSubj = strong.textContent.trim();
    document.getElementById('mo-subj-notes-title').textContent = curSubj + ' Notes';
    const notes = safeStorageGet('subj_notes_' + curSubj, '') || '';
    document.getElementById('subj-notes-ta').value = notes;
    openModal('mo-subj-notes');
  });

  // Dynamically set title on hover to show notes
  document.addEventListener('mouseover', e => {
    const item = e.target.closest('.cal-item');
    if (!item) return;
    const strong = item.querySelector('strong');
    if (!strong) return;
    const subj = strong.textContent.trim();
    const notes = safeStorageGet('subj_notes_' + subj);
    if (notes) {
      // Limit notes preview length and escape quotes if needed, but native title handles raw strings fine
      item.title = notes.length > 500 ? notes.substring(0, 500) + '...' : notes;
    } else {
      item.title = 'Click to add notes';
    }
  });

  document.getElementById('save-subj-notes')?.addEventListener('click', () => {
    if (!curSubj) return;
    const notes = document.getElementById('subj-notes-ta').value;
    safeStorageSet('subj_notes_' + curSubj, notes);
    closeModal('mo-subj-notes');
  });
}

function initLinks() {
  const btnLinks = document.getElementById('btn-links');
  if (!btnLinks) return;
  
  // 1. Prime cache immediately from localStorage (instant 0ms response)
  try {
    S.links = JSON.parse(safeStorageGet('local_sys_links') || safeStorageGet('law_school_links') || '[]');
  } catch {
    S.links = [];
  }

  // 2. Synchronous click handler — opens modal instantly!
  btnLinks.addEventListener('click', () => {
    renderLinks();
    openModal('mo-links');
    setTimeout(() => document.getElementById('new-link-title')?.focus(), 50);
  });

  // 3. Add link handlers
  const addBtn = document.getElementById('btn-add-link');
  const titleInp = document.getElementById('new-link-title');
  const urlInp = document.getElementById('new-link-url');

  const doAddLink = async () => {
    const title = titleInp?.value.trim();
    let url = urlInp?.value.trim();
    if (!title || !url) return;

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    const newLink = { id: 'link_' + Date.now(), title, url, created_at: Date.now() };
    S.links.push(newLink);
    renderLinks();
    if (titleInp) titleInp.value = '';
    if (urlInp) urlInp.value = '';

    try {
      await dbSaveLinks(S.links);
      toast('Link saved!');
    } catch {
      toast('Saved locally (offline)');
    }
  };

  addBtn?.addEventListener('click', doAddLink);
  titleInp?.addEventListener('keydown', e => { if (e.key === 'Enter') urlInp?.focus(); });
  urlInp?.addEventListener('keydown', e => { if (e.key === 'Enter') doAddLink(); });

  // 4. Background non-blocking sync with database
  (async () => {
    try {
      let links = await dbLoadLinks();
      const localLinks = JSON.parse(safeStorageGet('law_school_links', '[]') || '[]');
      
      if (localLinks.length > 0) {
        const existingUrls = new Set(links.map(l => l.url));
        let added = false;
        for (const l of localLinks) {
          if (!existingUrls.has(l.url)) {
            links.push(l);
            added = true;
          }
        }
        if (added) await dbSaveLinks(links);
        safeStorageRemove('law_school_links');
      }
      
      if (links && links.length > 0) {
        S.links = links;
        if (document.getElementById('mo-links')?.classList.contains('open')) {
          renderLinks();
        }
      }
    } catch (err) {
      console.warn('[initLinks background sync]', err);
    }
  })();
}

function renderLinks() {
  const list = document.getElementById('links-list');
  if (!list) return;
  list.innerHTML = '';
  if (!S.links || S.links.length === 0) {
    list.innerHTML = '<div style="color:var(--muted); font-size:12px; text-align:center; padding:10px">No links added yet.</div>';
    return;
  }
  S.links.forEach(l => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--navy); padding:8px 10px; border:1px solid rgba(255,255,255,0.05); border-radius:6px';
    d.innerHTML = `
      <a href="${l.url}" target="_blank" style="color:var(--gold); text-decoration:none; font-size:13px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1" title="${l.url}">${l.title}</a>
      <button class="btn-sec btn-del-link" data-id="${l.id}" style="padding:4px 8px; font-size:11px; margin-left:8px; flex-shrink:0">×</button>
    `;
    list.appendChild(d);
  });
  list.querySelectorAll('.btn-del-link').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      S.links = S.links.filter(x => x.id !== id);
      await dbSaveLinks(S.links);
      renderLinks();
    });
  });
}

init();
