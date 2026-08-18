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

// ── Toast ──
let toastTimer = null;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Modal open/close ──
export function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
export function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

export function closeOtherPanels(exceptId) {
  const panels = ['notepad-panel', 'dict-panel', 'search-panel', 'ann-panel'];
  panels.forEach(id => {
    if (id !== exceptId) document.getElementById(id)?.classList.remove('open');
  });
}

// Wire all [data-close] buttons and backdrop clicks
export function initModals() {
  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => closeModal(b.dataset.close))
  );
  document.querySelectorAll('.modal-ov').forEach(ov =>
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov.id); })
  );
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
    ensurePageRendered(pg);
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
