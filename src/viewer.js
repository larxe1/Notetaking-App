// ═══════════════════════════════════════════════
// VIEWER — PDF rendering + page management
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { syncOK, syncSpin, jumpToPage } from './ui.js';
import { dbLoadAnnotations, dbLoadDrawings, dbLoadBookmarks } from './db.js';
import { driveFetchPDF } from './drive.js';
import { renderColorDots } from './colors.js';
import { showTablePicker, handlePaste } from './tablepicker.js';
import { openPdfLinkModal, insertWebLink } from './pdflink.js';

// Guard set to prevent double listener registration (fixes bug #3)
const _boxDone  = new Set();
const _drawDone = new Set();
const _textDone = new Set();

let _currentFolderDocId = null;
let _folderDocDebounce = null;

export async function flushFolderDoc() {
  if (_currentFolderDocId) {
    const ed = document.getElementById('folder-doc-editor');
    if (ed) {
      const text = ed.innerHTML;
      const prevId = _currentFolderDocId;
      const f = S.folders.find(x => x.id === prevId);
      if (f) f.notes = text;
      
      if (_folderDocDebounce) {
        clearTimeout(_folderDocDebounce);
        _folderDocDebounce = null;
      }
      
      try {
        const { dbUpdateFolderNotes } = await import('./db.js');
        await dbUpdateFolderNotes(prevId, text);
      } catch {}
    }
  }
}

export async function openFolderDoc(fold) {
  // 1. Flush any pending notes from previously open folder first!
  await flushFolderDoc();

  S.curPDF = null;
  updateActivePDF();
  
  const { closeAnnPanel } = await import('./annotate.js');
  closeAnnPanel();
  const { clearSearchHighlights } = await import('./search.js');
  clearSearchHighlights();

  // 2. Look up fresh live folder from state
  const liveFold = S.folders.find(f => f.id === fold.id) || fold;

  // Switch to Folder Document Mode
  document.getElementById('content-area').style.display = 'none';
  document.getElementById('folder-doc-viewer').style.display = 'flex';
  const { closeOtherPanels } = await import('./ui.js');
  closeOtherPanels();

  document.getElementById('folder-doc-title').textContent = liveFold.name;
  const ed = document.getElementById('folder-doc-editor');
  ed.innerHTML = liveFold.notes || '';
  _currentFolderDocId = liveFold.id;

  // Add listener only once
  if (!ed.dataset.listener) {
    ed.dataset.listener = 'true';
    
    ed.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
      }
    });

    ed.addEventListener('input', async () => {
      const { autosave } = await import('./ui.js');
      autosave('saving');

      // Update in-memory state immediately so folder switching never loses keystrokes
      const currentId = _currentFolderDocId;
      const currentText = ed.innerHTML;
      const f = S.folders.find(x => x.id === currentId);
      if (f) f.notes = currentText;

      clearTimeout(_folderDocDebounce);
      _folderDocDebounce = setTimeout(async () => {
        if (!_currentFolderDocId || _currentFolderDocId !== currentId) return;
        const { dbUpdateFolderNotes } = await import('./db.js');
        try {
          await dbUpdateFolderNotes(currentId, currentText);
          autosave('saved');
        } catch {
          autosave('err');
        }
        _folderDocDebounce = null;
      }, 800);
    });

    ed.addEventListener('paste', handlePaste);

    // Bind toolbar commands
    document.getElementById('folder-doc-toolbar').addEventListener('mousedown', e => e.preventDefault());
    document.getElementById('folder-doc-toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('.folder-fmt-btn');
      if (!btn) return;
      
      e.stopPropagation();

      if (btn.id === 'folder-doc-link-pdf') {
        openPdfLinkModal(ed, () => ed.dispatchEvent(new Event('input')));
        return;
      }
      if (btn.id === 'folder-doc-link-url') {
        insertWebLink(ed, () => ed.dispatchEvent(new Event('input')));
        return;
      }


      const cmd = btn.dataset.cmd;
      let val = btn.dataset.val || null;
      
      // Some browsers require tags to be wrapped in brackets for formatBlock
      if (cmd === 'formatBlock' && val && !val.startsWith('<')) {
        val = `<${val}>`;
      }
      
      try {
        if (cmd === 'insertTable') {
          showTablePicker(btn, ed);
        } else if (cmd) {
          document.execCommand(cmd, false, val);
        }
      } catch (err) {
        console.error('execCommand failed:', err);
      } finally {
        ed.focus();
      }
    });
  }
}

// ── Virtualized Page Rendering Observer & Memory-Managed Document Renderer ──
let _pageObserver = null;
let _renderedPages = new Set();
let _bgRenderActive = false;
let _bgRenderDocId = null;
let _unrenderTimer = null;

// ── Canvas GPU/RAM Memory Recycling (Keeps Text Layer alive, frees heavy pixel bitmaps) ──
export function unrenderFarPages(curPage) {
  if (!S.pdfDoc || S.totalPages <= 45) return;
  const KEEP_RADIUS = 18; // 18 pages ahead & behind = 37 active rendered canvases maximum in RAM

  for (let p = 1; p <= S.totalPages; p++) {
    if (Math.abs(p - curPage) > KEEP_RADIUS) {
      const pg = S.pages?.[p];
      if (pg && pg.rendered && !pg.rendering) {
        // Free GPU/VRAM pixel canvas memory immediately
        if (pg.pdfCanvas) {
          pg.pdfCanvas.width = 1;
          pg.pdfCanvas.height = 1;
          pg.pdfCanvas = null;
        }
        if (pg.drawCanvas) {
          pg.drawCanvas.width = 1;
          pg.drawCanvas.height = 1;
          pg.drawCanvas = null;
        }
        if (pg.wrap) {
          pg.wrap.innerHTML = `<div class="pg-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:13px;font-family:'Inter',sans-serif;letter-spacing:.05em">Page ${p}</div>`;
        }
        pg.rendered = false;
        _renderedPages.delete(p);
        _boxDone.delete(p);
        _drawDone.delete(p);
        _textDone.delete(p);
      }
    }
  }
}

export function scheduleUnrenderFarPages() {
  clearTimeout(_unrenderTimer);
  _unrenderTimer = setTimeout(() => {
    unrenderFarPages(S.curPage || 1);
  }, 800);
}

export function startBackgroundDocRenderer(docId) {
  _bgRenderDocId = docId;
  if (_bgRenderActive) return;
  _bgRenderActive = true;

  const renderNextUnrendered = async () => {
    if (!S.pdfDoc || _bgRenderDocId !== docId) {
      _bgRenderActive = false;
      return;
    }

    const cur = S.curPage || 1;
    // On large PDFs (> 45 pages), only pre-render up to 10 pages around the active reading window
    const maxRadius = (S.totalPages > 45) ? 10 : S.totalPages;

    let nextP = null;
    let minDiff = Infinity;

    for (let p = 1; p <= S.totalPages; p++) {
      const diff = Math.abs(p - cur);
      if (diff <= maxRadius) {
        const pg = S.pages?.[p];
        if (pg && !pg.rendered && !pg.rendering) {
          if (diff < minDiff) {
            minDiff = diff;
            nextP = p;
          }
        }
      }
    }

    if (nextP !== null) {
      try {
        await ensurePageRendered(nextP);
      } catch (e) {
        console.warn(`[Background Render] Page ${nextP} error:`, e);
      }
      // Yield to main thread to guarantee smooth 60fps scrolling and UI responsiveness
      if (window.requestIdleCallback) {
        window.requestIdleCallback(() => renderNextUnrendered(), { timeout: 120 });
      } else {
        setTimeout(renderNextUnrendered, 20);
      }
    } else {
      _bgRenderActive = false;
    }
  };

  if (window.requestIdleCallback) {
    window.requestIdleCallback(() => renderNextUnrendered(), { timeout: 150 });
  } else {
    setTimeout(renderNextUnrendered, 30);
  }
}

// ── Smart Syllabus Pre-Fetching of Next PDF in Sequence ──
export async function scheduleNextPdfPrefetch(pdfFile) {
  if (!pdfFile || !S.pdfs?.length) return;

  // Find all sibling PDFs in the same folder, sorted in order
  const siblings = S.pdfs
    .filter(p => (p.folder_id || null) === (pdfFile.folder_id || null))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const idx = siblings.findIndex(p => p.id === pdfFile.id);
  const nextPdf = (idx !== -1 && idx < siblings.length - 1) ? siblings[idx + 1] : null;
  if (!nextPdf) return;

  const targetDriveId = nextPdf.drive_file_id || S.pdfs.find(p => p.id === nextPdf.linked_pdf_id)?.drive_file_id;
  if (!targetDriveId) return;

  // Check if already in RAM or IndexedDB
  if (S.pdfCache[targetDriveId]) return;

  try {
    const { isPDFCached } = await import('./pdfcache.js');
    const cached = await isPDFCached(targetDriveId);
    if (cached) return;

    // Silently pre-cache next syllabus PDF in background during idle time (after 3 seconds)
    setTimeout(async () => {
      if (S.curPDF?.id === pdfFile.id && navigator.onLine && S.driveToken) {
        console.log(`[Smart Prefetch] Silently caching next syllabus PDF: "${nextPdf.name}"`);
        const { driveFetchPDF } = await import('./drive.js');
        await driveFetchPDF(targetDriveId, null, nextPdf.name).catch(() => {});
      }
    }, 3000);
  } catch (err) {
    console.warn('[Smart Prefetch] Check failed:', err);
  }
}

// ── Open PDF from library ──
export async function openPDFFromLibrary(pdfFile, retries = 3) {
  try {
    const { flushNotepadSave } = await import('./notepad.js');
    await flushNotepadSave();
  } catch {}
  await flushFolderDoc();
  S.curPDF = pdfFile;
  updateActivePDF();

  const { closeOtherPanels } = await import('./ui.js');
  closeOtherPanels();

  const { clearSearchHighlights } = await import('./search.js');
  clearSearchHighlights();
  
  const trueId = pdfFile.linked_pdf_id || pdfFile.id;
  const { notepadOnPDFChange } = await import('./notepad.js');
  await notepadOnPDFChange(trueId);

  // Instantly clear memory of previous PDF's data so ghost highlights never bleed over
  S.annotations = [];
  S.drawData = {};
  S.bookmarks = [];

  // Prime immediately from local cache if present (instant 0ms restore)
  try {
    const cachedAnns = localStorage.getItem('local_anns_' + trueId);
    if (cachedAnns) S.annotations = JSON.parse(cachedAnns);
    const cachedDraws = localStorage.getItem('local_draws_' + trueId);
    if (cachedDraws) S.drawData = JSON.parse(cachedDraws);
    const cachedBms = localStorage.getItem('local_bms_' + trueId);
    if (cachedBms) S.bookmarks = JSON.parse(cachedBms);
  } catch {}

  // Switch to PDF mode
  document.getElementById('folder-doc-viewer').style.display = 'none';
  document.getElementById('content-area').style.display = 'flex';

  const scroll = document.getElementById('canvas-scroll');
  scroll.innerHTML = `<div class="spin-w"><div class="spinner"></div>${retries < 3 ? 'Retrying PDF...' : 'Loading PDF…'}</div>`;

  // Start PDF fetch and Supabase database queries in parallel
  const pdfFetchPromise = driveFetchPDF(pdfFile.drive_file_id, (pct, loadedMB, totalMB) => {
    if (scroll) {
      if (pct !== null) {
        scroll.innerHTML = `<div class="spin-w"><div class="spinner"></div>Loading PDF: ${pct}% (${loadedMB}/${totalMB} MB)</div>`;
      } else {
        scroll.innerHTML = `<div class="spin-w"><div class="spinner"></div>Loading PDF: ${loadedMB} MB…</div>`;
      }
    }
  }, pdfFile.name);
  const dbDataPromise = Promise.all([
    dbLoadBookmarks(trueId),
    dbLoadAnnotations(trueId),
    dbLoadDrawings(trueId),
  ]);

  try {
    const blob = await pdfFetchPromise;

    // Create a temporary object URL — PDF.js streams it internally, no ArrayBuffer copy needed
    const blobUrl = URL.createObjectURL(blob);
    S.pdfDoc = await pdfjsLib.getDocument({ url: blobUrl }).promise;
    URL.revokeObjectURL(blobUrl); // release the URL handle immediately (PDF.js already loaded it)
    S.totalPages = S.pdfDoc.numPages;
    document.getElementById('pg-total').textContent = S.totalPages;
    document.getElementById('pg-input').value = 1;
    document.getElementById('pg-input').max   = S.totalPages;

    scroll.innerHTML = '';
    S.pages = {};
    _boxDone.clear();
    _drawDone.clear();
    _textDone.clear();
    _renderedPages.clear();

    if (_pageObserver) {
      _pageObserver.disconnect();
      _pageObserver = null;
    }

    // Get page 1 viewport for default aspect ratio
    const p1 = await S.pdfDoc.getPage(1);
    const vp1 = p1.getViewport({ scale: S.scale });

    // Instantly create lightweight placeholders for all pages
    // Scrollbar and page navigation work immediately across all 700+ pages!
    for (let p = 1; p <= S.totalPages; p++) {
      const wrap = document.createElement('div');
      wrap.className = 'pg-wrap';
      wrap.dataset.page = p;
      wrap.style.width = vp1.width + 'px';
      wrap.style.height = vp1.height + 'px';
      wrap.innerHTML = `<div class="pg-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:13px;font-family:'Inter',sans-serif;letter-spacing:.05em">Page ${p}</div>`;
      scroll.appendChild(wrap);
      S.pages[p] = { wrap, rendered: false, rendering: false, viewport: vp1, textItems: [] };
    }

    // IntersectionObserver renders pages as they scroll into view (with 1500px pre-render margin)
    _pageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const pNum = parseInt(entry.target.dataset.page);
        if (entry.isIntersecting) {
          ensurePageRendered(pNum);
        }
      }
    }, {
      root: scroll,
      rootMargin: '1500px 0px 1500px 0px',
    });

    for (let p = 1; p <= S.totalPages; p++) {
      _pageObserver.observe(S.pages[p].wrap);
    }

    // Determine starting page (saved bookmark or page 1)
    const savedStart = localStorage.getItem('bookmark_' + pdfFile.id);
    const startPage = savedStart ? Math.min(S.totalPages, Math.max(1, parseInt(savedStart))) : 1;

    S.curPage = startPage;
    document.getElementById('pg-input').value = startPage;

    // Render starting page and accurately align via native scrollIntoView
    const { jumpToPage } = await import('./ui.js');
    await jumpToPage(startPage, false);

    // Await parallel DB data queries
    await dbDataPromise;

    // Redraw on any already rendered page
    const { redrawAllAnnotations } = await import('./annotate.js');
    const { redrawAllDrawings }    = await import('./draw.js');
    redrawAllAnnotations();
    redrawAllDrawings();
    renderColorDots();

    // Track recent PDFs
    pushRecent(pdfFile);

    // Start background progressive full-document renderer (ensures all pages are rendered without scrolling)
    startBackgroundDocRenderer(pdfFile.id);

    // Start background full-document text indexing across all 1000+ pages
    import('./search.js').then(m => m.indexAllPagesText(S.pdfDoc)).catch(() => {});

    // Smart syllabus pre-fetch: silently cache next PDF in folder for 0ms transition
    scheduleNextPdfPrefetch(pdfFile);

    syncOK('Ready');
  } catch (e) {
    if (retries > 0) {
      console.warn('PDF load failed, retrying...', e);
      await new Promise(r => setTimeout(r, 1500));
      return openPDFFromLibrary(pdfFile, retries - 1);
    }
    console.error(e);
    const { recordError } = await import('./ui.js');
    recordError(e, 'PDF Load');
    let errCode = e?.status || (e?.message?.includes('401') ? '401' : (e?.message?.includes('403') ? '403' : 'ERR'));
    let msg = 'Could not load PDF.';
    if (e.message?.includes('Drive') || e.message?.includes('signed') || errCode === '401') {
      msg = 'Google Drive session expired [401]. Please click "Sign in" on the Drive bar in the sidebar.';
    } else if (errCode === '403') {
      msg = 'Google Drive permission denied or quota exceeded [403].';
    } else if (e.message) {
      msg = `Could not load PDF [${errCode}]: ${e.message}`;
    }
    scroll.innerHTML = `<div style="color:var(--red);padding:20px;font-size:13px;max-width:380px;line-height:1.6"><strong>⚠️ Error loading PDF</strong><br>${msg}<br><br><button onclick="window.location.reload()" style="padding:6px 12px;background:var(--navy-l);border:1px solid var(--navy-b);color:var(--text);border-radius:6px;cursor:pointer">Reload App</button></div>`;
    const { syncErr } = await import('./ui.js');
    syncErr(`Load failed [${errCode}]`);
  }
}

// ── Re-render all pages (after zoom change) ──
export async function reRenderAll() {
  if (!S.pdfDoc) return;
  const p1 = await S.pdfDoc.getPage(1);
  const vp1 = p1.getViewport({ scale: S.scale });

  // Update sizes on all page wrappers
  for (let p = 1; p <= S.totalPages; p++) {
    const pg = S.pages[p];
    if (pg?.wrap) {
      pg.wrap.style.width = vp1.width + 'px';
      pg.wrap.style.height = vp1.height + 'px';
      if (pg.rendered) {
        pg.rendered = false;
        pg.wrap.innerHTML = `<div class="pg-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:13px;font-family:'Inter',sans-serif">Page ${p}</div>`;
      }
    }
  }

  _boxDone.clear();
  _drawDone.clear();
  _textDone.clear();
  _renderedPages.clear();

  // Re-render current page and visible pages
  await ensurePageRendered(S.curPage);
  if (S.curPDF) {
    startBackgroundDocRenderer(S.curPDF.id);
  }
}

// ── Render a single page on-demand ──
export async function ensurePageRendered(pageNum) {
  if (!S.pdfDoc || !S.pages[pageNum]) return;
  const pgState = S.pages[pageNum];
  if (pgState.rendered || pgState.rendering) return;
  pgState.rendering = true;

  try {
    const page = await S.pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: S.scale });
    pgState.viewport = vp;

    const wrap = pgState.wrap;
    wrap.style.width  = vp.width  + 'px';
    wrap.style.height = vp.height + 'px';
    wrap.innerHTML = ''; // remove placeholder

    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.width  = vp.width;
    pdfCanvas.height = vp.height;

    const drawCanvas = document.createElement('canvas');
    drawCanvas.width  = vp.width;
    drawCanvas.height = vp.height;
    drawCanvas.className   = 'draw-canvas' + (S.mode === 'draw' ? ' active' : '');
    drawCanvas.dataset.page = pageNum;

    const txtLayer = document.createElement('div');
    txtLayer.className = 'txt-layer' + (S.mode === 'text' ? ' sel' : '');
    txtLayer.style.width  = vp.width  + 'px';
    txtLayer.style.height = vp.height + 'px';

    const annOv = document.createElement('div');
    annOv.className       = 'ann-ov';
    annOv.dataset.page    = pageNum;
    annOv.style.width  = vp.width  + 'px';
    annOv.style.height = vp.height + 'px';

    const srchOv = document.createElement('div');
    srchOv.className    = 'srch-ov';
    srchOv.dataset.page = pageNum;
    srchOv.style.width  = vp.width  + 'px';
    srchOv.style.height = vp.height + 'px';

    wrap.append(pdfCanvas, annOv, srchOv, txtLayer, drawCanvas);

    // Render PDF page canvas
    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp }).promise;

    // Build text layer
    const tc = await page.getTextContent();
    const textItems = [];
    for (const item of tc.items) {
      if (!item.str || !item.transform) continue;
      const span = document.createElement('span');
      const tx   = pdfjsLib.Util.transform(vp.transform, item.transform);
      const fh   = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
      const angle = Math.atan2(tx[1], tx[0]);
      span.textContent = item.str;
      span.style.cssText = `left:${tx[4]}px;top:${tx[5] - fh}px;font-size:${fh}px;font-family:${item.fontName || 'sans-serif'}`;
      if (angle !== 0) span.style.transform = `rotate(${angle}rad)`;
      txtLayer.appendChild(span);
      textItems.push({
        str: item.str,
        x: item.transform[4] * S.scale,
        y: vp.height - item.transform[5] * S.scale,
        w: (item.width  || 0) * S.scale,
        h: (item.height || fh) * S.scale,
      });
    }

    pgState.pdfCanvas = pdfCanvas;
    pgState.drawCanvas = drawCanvas;
    pgState.txtLayer = txtLayer;
    pgState.annOv = annOv;
    pgState.srchOv = srchOv;
    pgState.textItems = textItems;
    pgState.rendered = true;

    // Setup listeners & visuals
    setupAllListeners(pageNum);
    applyModeVisuals(pageNum);

    // Redraw annotations on this page
    const { drawAnnotation } = await import('./annotate.js');
    for (const ann of S.annotations.filter(a => a.page === pageNum)) {
      drawAnnotation(ann);
    }

    // Redraw drawings on this page
    if (S.drawData[pageNum]) {
      const { renderCanvas } = await import('./draw.js');
      renderCanvas(drawCanvas, S.drawData[pageNum]);
    }

    // Redraw search highlights on this page
    const { drawSearchHL } = await import('./search.js');
    for (let i = 0; i < S.searchResults.length; i++) {
      const res = S.searchResults[i];
      if (res.page === pageNum) {
        drawSearchHL(res, S.searchIdx === i);
      }
    }

    _renderedPages.add(pageNum);
    scheduleUnrenderFarPages();
  } catch (err) {
    console.error(`Failed to render page ${pageNum}:`, err);
  } finally {
    pgState.rendering = false;
  }
}

// Backward compatibility alias
export const renderPage = ensurePageRendered;

// ── Render a single page into an arbitrary container (for dual-view pane B) ──
// Uses its own paneState object instead of global S so it doesn't clobber pane A.
export async function renderPageInto(pageNum, container, pdfDocObj, paneState) {
  const page = await pdfDocObj.getPage(pageNum);
  const scale = paneState.scale || S.scale;
  const vp = page.getViewport({ scale });

  const wrap = document.createElement('div');
  wrap.className = 'pg-wrap';
  wrap.dataset.page = pageNum;
  wrap.style.width  = vp.width  + 'px';
  wrap.style.height = vp.height + 'px';

  const pdfCanvas  = document.createElement('canvas');
  pdfCanvas.width  = vp.width;
  pdfCanvas.height = vp.height;

  // Minimal layers for read-only viewing
  const drawCanvas  = document.createElement('canvas');
  drawCanvas.width  = vp.width;
  drawCanvas.height = vp.height;
  drawCanvas.className = 'draw-canvas';

  const txtLayer = document.createElement('div');
  txtLayer.className = 'txt-layer'; // pointer-events disabled via CSS for pane-b
  txtLayer.style.width  = vp.width  + 'px';
  txtLayer.style.height = vp.height + 'px';

  const annOv = document.createElement('div');
  annOv.className = 'ann-ov';
  annOv.dataset.page = pageNum;
  annOv.style.width  = vp.width  + 'px';
  annOv.style.height = vp.height + 'px';

  wrap.append(pdfCanvas, annOv, txtLayer, drawCanvas);
  container.appendChild(wrap);

  await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp }).promise;

  // Build text items for display only
  const tc = await page.getTextContent();
  for (const item of tc.items) {
    if (!item.str || !item.transform) continue;
    const span = document.createElement('span');
    const tx   = pdfjsLib.Util.transform(vp.transform, item.transform);
    const fh   = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
    const angle = Math.atan2(tx[1], tx[0]);
    span.textContent = item.str;
    span.style.cssText = `left:${tx[4]}px;top:${tx[5] - fh}px;font-size:${fh}px;font-family:${item.fontName || 'sans-serif'}`;
    if (angle !== 0) span.style.transform = `rotate(${angle}rad)`;
    txtLayer.appendChild(span);
  }

  if (!paneState.pages) paneState.pages = {};
  paneState.pages[pageNum] = { wrap, pdfCanvas, drawCanvas, txtLayer, annOv, viewport: vp };
}

// ── Mode ──
export function setMode(m) {
  S.mode = m;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  document.getElementById('draw-ctrls').classList.toggle('visible', m === 'draw');
  for (const pn of Object.keys(S.pages)) applyModeVisuals(parseInt(pn));
}

function applyModeVisuals(pageNum) {
  const { txtLayer, drawCanvas, wrap } = S.pages[pageNum];
  txtLayer.className = 'txt-layer' + (S.mode === 'text' ? ' sel' : '');
  drawCanvas.className = 'draw-canvas' + (S.mode === 'draw' ? ' active' : '');
  wrap.style.cursor = S.mode === 'draw' ? 'crosshair' : 'default';
}

// ── Set up all listeners once per page ──
function setupAllListeners(pageNum) {
  if (!_textDone.has(pageNum)) {
    _textDone.add(pageNum);
    const { txtLayer } = S.pages[pageNum];
    txtLayer.addEventListener('mouseup', () => { if (S.mode === 'text') onTextUp(pageNum); });
    txtLayer.addEventListener('touchend', () => { if (S.mode === 'text') setTimeout(() => onTextUp(pageNum), 60); });
  }
  if (!_boxDone.has(pageNum)) {
    _boxDone.add(pageNum);
    setupBoxDrag(S.pages[pageNum].wrap, pageNum);
  }
  if (!_drawDone.has(pageNum)) {
    _drawDone.add(pageNum);
    // Use dynamic import to avoid circular dependency
    import('./draw.js').then(({ setupDrawListeners }) => {
      setupDrawListeners(S.pages[pageNum].drawCanvas, pageNum);
    });
  }
}

// ── Text selection highlight ──
function onTextUp(pageNum) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
  const text  = sel.toString().trim();
  const range = sel.getRangeAt(0);
  const pg    = S.pages[pageNum]; if (!pg) return;
  const wr    = pg.wrap.getBoundingClientRect();
  let rects = Array.from(range.getClientRects())
    .filter(r => r.width > 1 && r.height > 1)
    .map(r => ({ x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: r.height }));
  
  if (!rects.length) return;

  // Merge rects on the same line to create continuous highlights and fix gaps
  rects.sort((a,b) => {
    const over = Math.max(0, Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y));
    return over > 2 ? a.x - b.x : a.y - b.y;
  });
  const merged = [rects[0]];
  for (let i = 1; i < rects.length; i++) {
    const curr = rects[i];
    const prev = merged[merged.length - 1];
    
    const over = Math.max(0, Math.min(prev.y+prev.h, curr.y+curr.h) - Math.max(prev.y, curr.y));
    // If they share vertical space and are horizontally close (within 24px)
    if (over > 0 && curr.x <= prev.x + prev.w + 24) {
      const right = Math.max(prev.x + prev.w, curr.x + curr.w);
      const bottom = Math.max(prev.y + prev.h, curr.y + curr.h);
      prev.x = Math.min(prev.x, curr.x);
      prev.y = Math.min(prev.y, curr.y);
      prev.w = right - prev.x;
      prev.h = bottom - prev.y;
    } else {
      merged.push(curr);
    }
  }
  rects = merged;

  const last = rects[rects.length - 1];
  S.pendingSel = { pageNum, rects, text };
  const mx = Math.min(wr.left + last.x + last.w, window.innerWidth - 170);
  const my = Math.min(wr.top  + last.y + last.h + 6, window.innerHeight - 60);
  const m  = document.getElementById('sel-menu');
  m.style.left = mx + 'px';
  m.style.top  = my + 'px';
  m.classList.add('open');
}

// ── Box drag ──
function setupBoxDrag(wrap, pageNum) {
  const ghost = document.getElementById('drag-ghost');
  let sx, sy, dragging = false;

  function onStart(cx, cy) { if (S.mode !== 'box') return; sx = cx; sy = cy; dragging = false; }
  function onMove(cx, cy) {
    if (S.mode !== 'box' || sx === undefined) return;
    if (!dragging && Math.hypot(cx - sx, cy - sy) < 5) return;
    dragging = true;
    ghost.style.cssText = `display:block;left:${Math.min(sx,cx)}px;top:${Math.min(sy,cy)}px;width:${Math.abs(cx-sx)}px;height:${Math.abs(cy-sy)}px`;
  }
  function onEnd(cx, cy) {
    ghost.style.display = 'none';
    if (!dragging) { sx = undefined; return; }
    dragging = false;
    const wr  = wrap.getBoundingClientRect();
    const rx  = Math.min(sx, cx) - wr.left;
    const ry  = Math.min(sy, cy) - wr.top;
    const rw  = Math.abs(cx - sx);
    const rh  = Math.abs(cy - sy);
    sx = undefined;
    if (rw < 5 || rh < 5) return;
    const ti   = S.pages[pageNum]?.textItems || [];
    const text = ti.filter(it => it.x < rx + rw && it.x + it.w > rx && it.y < ry + rh && it.y + it.h > ry)
      .map(it => it.str).join(' ').trim() || '(selected region)';
    import('./annotate.js').then(({ createAnnotation }) => createAnnotation(pageNum, [{ x: rx, y: ry, w: rw, h: rh }], text, 'box'));
  }

  wrap.addEventListener('mousedown', e => {
    if (S.mode !== 'box') return;
    e.preventDefault(); onStart(e.clientX, e.clientY);
    const mm = mv => onMove(mv.clientX, mv.clientY);
    const mu = up => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); onEnd(up.clientX, up.clientY); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });
  wrap.addEventListener('touchstart', e => { if (S.mode !== 'box') return; const t = e.touches[0]; onStart(t.clientX, t.clientY); }, { passive: true });
  wrap.addEventListener('touchmove',  e => { if (S.mode !== 'box') return; e.preventDefault(); const t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive: false });
  wrap.addEventListener('touchend',   e => { if (S.mode !== 'box') return; const t = e.changedTouches[0]; onEnd(t.clientX, t.clientY); });
}

// ── Helper: keep active PDF highlighted in sidebar ──
export function updateActivePDF() {
  document.querySelectorAll('.li-pdf').forEach(el =>
    el.classList.toggle('active', el.dataset.id === S.curPDF?.id)
  );
  import('./ui.js').then(m => m.updateAppTitle?.()).catch(()=>{});
}

// ── Recent PDFs tracking ──
function pushRecent(pdf) {
  S.recentPDFs = [pdf, ...S.recentPDFs.filter(p => p.id !== pdf.id)].slice(0, 5);
  renderRecentPDFs();
}

function renderRecentPDFs() {
  const list = document.getElementById('recent-list');
  list.innerHTML = '';
  for (const pdf of S.recentPDFs) {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.innerHTML = `<span>📄</span><span class="recent-name" title="${pdf.name}">${pdf.name}</span>`;
    item.addEventListener('click', () => openPDFFromLibrary(pdf));
    list.appendChild(item);
  }
  document.getElementById('recent-wrap').style.display = S.recentPDFs.length ? 'block' : 'none';
}

export { renderRecentPDFs };
