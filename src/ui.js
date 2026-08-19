// ═══════════════════════════════════════════════
// UI — toast, autosave, sync status, zoom, nav,
//      modals, keyboard shortcuts, export
// ═══════════════════════════════════════════════
import { S } from './state.js';

// ── Sync status ──
const $sdot = () => document.getElementById('sdot');
const $stxt = () => document.getElementById('stxt');
export const syncSpin = (m) => { $sdot().className = 'sdot spin'; $stxt().textContent = m || 'Working…'; };
export const syncOK   = (m) => { $sdot().className = 'sdot ok';   $stxt().textContent = m || 'Synced'; };
export const syncErr  = (m) => { $sdot().className = 'sdot err';  $stxt().textContent = m || 'Error'; };

// ── Auto-save indicator ──
let autosaveTimer = null;
export function autosave(state) {
  const lbl = document.getElementById('autosave-lbl');
  if (!lbl) return;
  clearTimeout(autosaveTimer);
  lbl.className = '';
  if (state === 'saving') {
    lbl.textContent = '↑ Saving…';
    lbl.className = 'saving';
  } else if (state === 'saved') {
    lbl.textContent = '✓ Saved';
    lbl.className = 'saved';
    autosaveTimer = setTimeout(() => { lbl.textContent = ''; lbl.className = ''; }, 2500);
  } else if (state === 'err') {
    lbl.textContent = '✗ Error';
    lbl.className = 'err';
  }
}

// ── Error Formatting & Recording (Option 1 & 2) ──
S.lastError = null;

export function formatError(err, context = '') {
  if (!err) return null;
  let code = err.code || err.status || '';
  let message = err.message || err.error_description || (typeof err === 'string' ? err : 'Unknown error');
  let details = err.details || err.hint || '';
  
  // Extract Postgres error code from string if present
  if (!code && message.includes('22P02')) code = '22P02';
  if (!code && message.includes('23505')) code = '23505';
  if (!code && message.includes('42501')) code = '42501';
  if (!code && message.includes('401')) code = '401';
  if (!code && message.includes('403')) code = '403';
  if (!code && message.includes('404')) code = '404';

  const codePrefix = code ? `[${code}] ` : '';
  const ctxPrefix = context ? `${context}: ` : '';
  
  return {
    code: code || 'ERR',
    message: message,
    details: details,
    display: `${ctxPrefix}${codePrefix}${message}`,
    time: new Date().toLocaleTimeString(),
    context
  };
}

export function recordError(err, context = '') {
  const formatted = formatError(err, context);
  if (formatted) {
    S.lastError = formatted;
    console.error(`[LegalAnnotator Error ${formatted.code}]`, context, err);
  }
  return formatted;
}

export function toastError(err, context = 'Error') {
  const rec = recordError(err, context);
  if (rec) toast(`⚠️ ${rec.display}`);
  else toast(`⚠️ ${context}`);
  return rec;
}

// ── Toast ──
let toastTimer = null;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Modal open/close ──
export function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
export function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

export function closeOtherPanels(exceptId) {
  if (exceptId !== 'notepad-panel') {
    import('./notepad.js').then(m => m.closeNotepad?.()).catch(() => {
      document.getElementById('notepad-panel')?.classList.remove('open');
    });
  }
  if (exceptId !== 'ann-panel') {
    import('./annotate.js').then(m => m.closeAnnPanel?.()).catch(() => {
      document.getElementById('ann-panel')?.classList.remove('open');
    });
  }
  if (exceptId !== 'search-panel') {
    import('./search.js').then(m => m.closeSearch?.()).catch(() => {
      document.getElementById('search-panel')?.classList.remove('open');
    });
  }
  if (exceptId !== 'dict-panel') {
    document.getElementById('dict-panel')?.classList.remove('open');
  }
}

// ── Sync & Error Diagnostics Modal Wiring ──
export function initSyncDiagnostics() {
  const syncBar = document.getElementById('sync-bar');
  if (syncBar) {
    syncBar.addEventListener('click', () => {
      import('./outbox.js').then(outbox => {
        const queue = outbox.getOutboxQueue();
        const netStatus = document.getElementById('diag-net-status');
        const queueCount = document.getElementById('diag-queue-count');
        const errTime = document.getElementById('diag-err-time');
        const errCode = document.getElementById('diag-err-code');
        const errMsg = document.getElementById('diag-err-msg');
        const errDetailsWrap = document.getElementById('diag-err-details-wrap');
        const errDetails = document.getElementById('diag-err-details');

        if (netStatus) {
          netStatus.textContent = navigator.onLine ? 'Online' : 'Offline';
          netStatus.style.color = navigator.onLine ? 'var(--green)' : 'var(--red)';
        }

        if (queueCount) {
          queueCount.textContent = `${queue.length} edit${queue.length === 1 ? '' : 's'}`;
          queueCount.style.color = queue.length > 0 ? 'var(--gold)' : 'var(--green)';
        }

        if (S.lastError) {
          if (errTime) errTime.textContent = S.lastError.time || '';
          if (errCode) errCode.textContent = S.lastError.code || 'ERR';
          if (errMsg) errMsg.textContent = S.lastError.display || S.lastError.message || 'Error occurred';
          if (errDetails && S.lastError.details) {
            errDetails.textContent = S.lastError.details;
            errDetailsWrap.style.display = 'block';
          } else if (errDetailsWrap) {
            errDetailsWrap.style.display = 'none';
          }
        } else {
          if (errTime) errTime.textContent = '';
          if (errCode) errCode.textContent = 'None';
          if (errMsg) errMsg.textContent = 'No errors recorded. Everything is operating normally.';
          if (errDetailsWrap) errDetailsWrap.style.display = 'none';
        }

        openModal('mo-sync-diag');
      });
    });
  }

  // Copy Error button
  document.getElementById('diag-btn-copy')?.addEventListener('click', () => {
    import('./outbox.js').then(outbox => {
      const payload = {
        time: S.lastError?.time || new Date().toLocaleTimeString(),
        code: S.lastError?.code || 'None',
        context: S.lastError?.context || '',
        message: S.lastError?.message || 'No error recorded',
        details: S.lastError?.details || '',
        online: navigator.onLine,
        pendingQueueCount: outbox.getOutboxQueue().length,
        pendingQueue: outbox.getOutboxQueue()
      };
      navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
        toast('📋 Copied error diagnostics to clipboard!');
      }).catch(() => {
        toast('Failed to copy to clipboard.');
      });
    });
  });

  // Clear Queue button
  document.getElementById('diag-btn-clear-queue')?.addEventListener('click', () => {
    localStorage.removeItem('offline_outbox_queue');
    import('./outbox.js').then(outbox => {
      outbox.updateOutboxUI();
      closeModal('mo-sync-diag');
      toast('🗑 Offline queue reset.');
    });
  });
}

// Wire all [data-close] buttons and backdrop clicks
export function initModals() {
  initSyncDiagnostics();

  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => closeModal(b.dataset.close))
  );

  document.querySelectorAll('.modal-ov').forEach(ov => {
    let isMouseDownOnBackdrop = false;

    ov.addEventListener('mousedown', e => {
      // Only true if the click began directly on the dark overlay (not inside the modal box)
      isMouseDownOnBackdrop = (e.target === ov);
    });

    ov.addEventListener('click', e => {
      // Only close if the mouse press originated and released on the overlay itself
      if (e.target === ov && isMouseDownOnBackdrop) {
        closeModal(ov.id);
      }
      isMouseDownOnBackdrop = false;
    });
  });
}

// ── Sidebar (mobile) ──
export function openSidebar()  {
  document.getElementById('lib-side').classList.add('open');
  document.getElementById('lib-backdrop').classList.add('open');
}
export function closeSidebar() {
  document.getElementById('lib-side').classList.remove('open');
  document.getElementById('lib-backdrop').classList.remove('open');
}
export function initSidebar() {
  document.getElementById('mob-menu-btn').addEventListener('click', openSidebar);
  document.getElementById('lib-close').addEventListener('click', closeSidebar);
  document.getElementById('lib-backdrop').addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) closeSidebar();
  });
}

// ── Zoom ──
export async function changeZoom(delta) {
  const ns = Math.max(0.5, Math.min(3, S.scale + delta));
  if (ns === S.scale) return;
  S.scale = ns;
  document.getElementById('zoom-lbl').textContent = Math.round(ns / 1.5 * 100) + '%';
  if (!S.pdfDoc) return;

  // Re-render all pages
  const { reRenderAll } = await import('./viewer.js');
  reRenderAll();
}

export function initZoom() {
  document.getElementById('btn-zin').addEventListener('click',  () => changeZoom( 0.25));
  document.getElementById('btn-zout').addEventListener('click', () => changeZoom(-0.25));
}

let _scrollTimer = null;
let _isJumping = false;

// ── Page navigation ──
export function initNavButtons() {
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (S.curPage > 1) jumpToPage(S.curPage - 1, true);
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    if (S.curPage < S.totalPages) jumpToPage(S.curPage + 1, true);
  });
  document.getElementById('pg-input').addEventListener('change', function () {
    const v = parseInt(this.value);
    if (v >= 1 && v <= S.totalPages) jumpToPage(v, false);
  });

  const scrollEl = document.getElementById('canvas-scroll');
  scrollEl.addEventListener('scroll', function () {
    if (_isJumping) return;
    if (_scrollTimer) return;
    _scrollTimer = setTimeout(() => {
      _scrollTimer = null;
      if (_isJumping) return;
      const scrollRect = scrollEl.getBoundingClientRect();
      const probeY = scrollRect.top + 150;
      const probeX = scrollRect.left + scrollRect.width / 2;
      const el = document.elementFromPoint(probeX, probeY);
      const wrap = el?.closest('.pg-wrap');
      if (wrap?.dataset.page) {
        const pg = parseInt(wrap.dataset.page);
        if (pg && pg !== S.curPage && pg >= 1 && pg <= S.totalPages) {
          S.curPage = pg;
          document.getElementById('pg-input').value = pg;
          if (S.curPDF) localStorage.setItem('bookmark_' + S.curPDF.id, pg);
          document.querySelectorAll('.thumb-item').forEach(th =>
            th.classList.toggle('active', parseInt(th.dataset.page) === pg)
          );
          updateAppTitle();
        }
      }
    }, 80);
  });
}

export async function jumpToPage(pg, smooth = false) {
  if (pg < 1 || pg > S.totalPages) return;
  S.curPage = pg;
  document.getElementById('pg-input').value = pg;
  if (S.curPDF) localStorage.setItem('bookmark_' + S.curPDF.id, pg);

  document.querySelectorAll('.thumb-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.page) === pg)
  );
  updateAppTitle();
  
  const pageState = S.pages[pg];
  if (pageState?.wrap) {
    const scrollEl = document.getElementById('canvas-scroll');
    _isJumping = true;

    // Use smooth scroll only if adjacent navigation (<= 3 pages).
    // For large jumps (or auto-loading bookmark on page 1000), direct scrollTop is 100% reliable
    // and prevents browser smooth-scroll distance timeouts at page ~700.
    if (smooth && Math.abs(pg - S.curPage) <= 3) {
      pageState.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      if (scrollEl) {
        scrollEl.scrollTop = pageState.wrap.offsetTop;
      } else {
        pageState.wrap.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }

    setTimeout(() => { _isJumping = false; }, 350);

    const { ensurePageRendered } = await import('./viewer.js');
    await ensurePageRendered(pg);
  }
}

// ── Keyboard shortcuts ──
export function initKeyboard(deps) {
  // deps: { setMode, openSearch, closeSearch, closeAnnPanel }
  document.addEventListener('keydown', e => {
    const tag      = document.activeElement?.tagName;
    const editable = document.activeElement?.contentEditable === 'true';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;

    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const scrollEl = document.getElementById('canvas-scroll');
      if (scrollEl) {
        const amount = scrollEl.clientHeight * 0.85;
        scrollEl.scrollBy({ top: e.key === 'PageDown' ? amount : -amount, behavior: 'smooth' });
      }
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const scrollEl = document.getElementById('canvas-scroll');
      if (scrollEl && document.activeElement !== scrollEl) {
        e.preventDefault();
        scrollEl.scrollBy({ top: e.key === 'ArrowDown' ? 80 : -80, behavior: 'smooth' });
        return;
      }
    }

    if (e.key === 't' || e.key === 'T') deps.setMode('text');
    else if (e.key === 'b' || e.key === 'B') deps.setMode('box');
    else if (e.key === 'd' || e.key === 'D') deps.setMode('draw');
    else if (e.key === '?') openModal('mo-keys');
    else if (e.key === 'Escape') {
      deps.closeAnnPanel();
      deps.closeSearch();
      closeModal('mo-keys');
      document.getElementById('notepad-panel')?.classList.remove('open');
      document.getElementById('dict-panel')?.classList.remove('open');
    }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); deps.openSearch(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && S.mode === 'draw') {
      document.getElementById('btn-undo').click();
    }
  });

  // Automatically blur toolbar buttons on click to prevent keyboard accidental activations
  document.querySelectorAll('.tb-btn').forEach(btn => {
    btn.addEventListener('mouseup', () => btn.blur());
  });

  document.getElementById('note-editor').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('btn-add-note').click();
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
    }
  });
}

// ── Export annotations to Markdown ──
export function exportAnnotations() {
  if (!S.curPDF || !S.annotations.length) {
    toast('No annotations to export');
    return;
  }
  const lines = [`# Annotations — ${S.curPDF.name}`, ''];
  const sorted = [...S.annotations].sort((a, b) => a.page - b.page);
  for (const ann of sorted) {
    lines.push(`## Page ${ann.page}`);
    lines.push(`> ${ann.highlighted_text}`);
    lines.push('');
    if (ann.notes.length) {
      for (const note of ann.notes) {
        const plain = note.note_html.replace(/<[^>]*>/g, '');
        lines.push(`- ${plain}`);
      }
      lines.push('');
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${S.curPDF.name.replace(/\.pdf$/i, '')}_annotations.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported!');
}

// ── Dynamic Window Title & Multi-Monitor Indicator ──
export function getScreenIndicator() {
  const x = window.screenLeft ?? window.screenX ?? 0;
  const y = window.screenTop ?? window.screenY ?? 0;
  const w = window.screen?.width || 1920;
  const h = window.screen?.height || 1080;

  const isExtended = Boolean(window.screen && window.screen.isExtended);
  const isOffPrimary = (x < -100 || x >= w - 100 || y < -100 || y >= h - 100);

  // Single-screen laptop mode: keep title clean
  if (!isExtended && !isOffPrimary) {
    return '';
  }

  // Dual/Multi-screen setup:
  if (isOffPrimary) {
    return '[Screen 2] ';
  } else {
    return '[Screen 1] ';
  }
}

export function updateAppTitle() {
  const prefix = getScreenIndicator();
  if (S.curPDF) {
    const pageStr = S.curPage ? `(p. ${S.curPage})` : '';
    document.title = `${prefix}📄 ${S.curPDF.name} ${pageStr} — Legal Annotator`;
  } else {
    document.title = `${prefix}Legal Annotator`;
  }
}

// Keep title updated on window resize, focus, and movement
if (typeof window !== 'undefined') {
  window.addEventListener('resize', updateAppTitle);
  window.addEventListener('focus', updateAppTitle);
  setInterval(updateAppTitle, 2000);
}
