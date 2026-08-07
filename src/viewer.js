// ═══════════════════════════════════════════════
// VIEWER — PDF rendering + page management
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { syncOK, syncSpin, jumpToPage } from './ui.js';
import { dbLoadAnnotations, dbLoadDrawings, dbLoadBookmarks } from './db.js';
import { driveFetchPDF } from './drive.js';
import { renderColorDots } from './colors.js';
import { renderThumbnails } from './thumbnails.js';

// Guard set to prevent double listener registration (fixes bug #3)
const _boxDone  = new Set();
const _drawDone = new Set();
const _textDone = new Set();

// ── Open PDF from library ──
export async function openPDFFromLibrary(pdfFile, retries = 3) {
  S.curPDF = pdfFile;
  updateActivePDF();

  const { closeAnnPanel } = await import('./annotate.js');
  closeAnnPanel();

  const { clearSearchHighlights } = await import('./search.js');
  clearSearchHighlights();

  const scroll = document.getElementById('canvas-scroll');
  scroll.innerHTML = `<div class="spin-w"><div class="spinner"></div>${retries < 3 ? 'Retrying PDF...' : 'Loading PDF…'}</div>`;

  try {
    const buf = await driveFetchPDF(pdfFile.drive_file_id);

    S.pdfDoc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    S.totalPages = S.pdfDoc.numPages;
    document.getElementById('pg-total').textContent = S.totalPages;
    document.getElementById('pg-input').value = 1;
    document.getElementById('pg-input').max   = S.totalPages;

    scroll.innerHTML = '';
    S.pages = {};
    _boxDone.clear();
    _drawDone.clear();
    _textDone.clear();

    // Render all pages sequentially
    const expectedId = pdfFile.id;
    for (let p = 1; p <= S.totalPages; p++) {
      if (S.curPDF?.id !== expectedId) return;
      await renderPage(p, scroll, expectedId);
    }

    // Render thumbnails
    if (S.curPDF?.id !== expectedId) return;
    await renderThumbnails(expectedId);

    // Load annotations + drawings + bookmarks
    syncSpin('Loading annotations…');
    await dbLoadBookmarks(pdfFile.id);
    await dbLoadAnnotations(pdfFile.id);
    await dbLoadDrawings(pdfFile.id);
    const { redrawAllAnnotations } = await import('./annotate.js');
    const { redrawAllDrawings }    = await import('./draw.js');
    redrawAllAnnotations();
    redrawAllDrawings();
    renderColorDots();

    // Track recent PDFs
    pushRecent(pdfFile);

    // Notify notepad of PDF change
    const { notepadOnPDFChange } = await import('./notepad.js');
    notepadOnPDFChange(pdfFile.id);

    // Jump to bookmarked page (or stay on page 1)
    const savedStart = localStorage.getItem('bookmark_' + pdfFile.id);
    if (savedStart) {
      import('./ui.js').then(m => m.jumpToPage(parseInt(savedStart)));
    }

    syncOK('Ready');
  } catch (e) {
    if (retries > 0) {
      console.warn('PDF load failed, retrying...', e);
      await new Promise(r => setTimeout(r, 1500));
      return openPDFFromLibrary(pdfFile, retries - 1);
    }
    console.error(e);
    const msg = e.message?.includes('Drive') || e.message?.includes('signed')
      ? 'Sign in to Google Drive first (click the Drive bar at the top of the sidebar).'
      : 'Could not load PDF. Check your connection.';
    scroll.innerHTML = `<div style="color:var(--red);padding:20px;font-size:13px;max-width:340px;line-height:1.6">${msg}<br><br><button onclick="window.location.reload()" style="padding:6px 12px;background:var(--navy-l);border:1px solid var(--navy-b);color:var(--text);border-radius:6px;cursor:pointer">Reload App</button></div>`;
    const { syncErr } = await import('./ui.js');
    syncErr('Load failed');
  }
}

// ── Re-render all pages (after zoom change) ──
export async function reRenderAll() {
  if (!S.pdfDoc) return;
  const scroll = document.getElementById('canvas-scroll');
  scroll.innerHTML = '<div class="spin-w"><div class="spinner"></div>Re-rendering…</div>';
  S.pages = {};
  _boxDone.clear();
  _drawDone.clear();
  _textDone.clear();

  // Small delay so spinner renders
  await new Promise(r => setTimeout(r, 30));
  scroll.innerHTML = '';
  for (let p = 1; p <= S.totalPages; p++) await renderPage(p, scroll);
  await renderThumbnails();
  const { redrawAllAnnotations } = await import('./annotate.js');
  const { redrawAllDrawings }    = await import('./draw.js');
  redrawAllAnnotations();
  redrawAllDrawings();
}

// ── Render a single page ──
export async function renderPage(pageNum, container, expectedId) {
  const page = await S.pdfDoc.getPage(pageNum);
  if (expectedId && S.curPDF?.id !== expectedId) return;
  const vp   = page.getViewport({ scale: S.scale });

  const wrap = document.createElement('div');
  wrap.className  = 'pg-wrap';
  wrap.dataset.page = pageNum;
  wrap.style.width  = vp.width  + 'px';
  wrap.style.height = vp.height + 'px';

  const pdfCanvas  = document.createElement('canvas');
  pdfCanvas.width  = vp.width;
  pdfCanvas.height = vp.height;

  const drawCanvas  = document.createElement('canvas');
  drawCanvas.width  = vp.width;
  drawCanvas.height = vp.height;
  drawCanvas.className   = 'draw-canvas';
  drawCanvas.dataset.page = pageNum;

  const txtLayer = document.createElement('div');
  txtLayer.className = 'txt-layer';
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
  container.appendChild(wrap);

  // Render PDF page
  await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp }).promise;

  // Build text items
  const tc        = await page.getTextContent();
  if (expectedId && S.curPDF?.id !== expectedId) return;
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

  S.pages[pageNum] = { wrap, pdfCanvas, drawCanvas, txtLayer, annOv, srchOv, viewport: vp, textItems };

  // Set up interaction listeners exactly once per page (fixes bug #3)
  setupAllListeners(pageNum);
  applyModeVisuals(pageNum);
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
