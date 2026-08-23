import { dbSearchDictionary, dbSaveDictionary } from './db.js';

let searchTimer = null;
let _inited = false;

// ── Synchronous open/close (no async imports, no races) ──
export function openDictionary() {
  const panel = document.getElementById('dict-panel');
  if (!panel) return;

  // Close all other panels synchronously by removing their .open class directly.
  // This avoids async import races that previously caused ghost-open states.
  document.getElementById('notepad-panel')?.classList.remove('open');
  document.getElementById('ann-panel')?.classList.remove('open');
  document.getElementById('search-panel')?.classList.remove('open');

  panel.classList.add('open');
  setTimeout(() => document.getElementById('dict-search-input')?.focus(), 60);
}

export function closeDictionary() {
  document.getElementById('dict-panel')?.classList.remove('open');
}

function initDictResize() {
  const panel  = document.getElementById('dict-panel');
  const handle = document.getElementById('dict-resize-handle');
  if (!panel || !handle) return;

  const savedWidth = localStorage.getItem('dict_panel_width');
  if (savedWidth) {
    const maxW = Math.min(window.innerWidth * 0.85, 700);
    const w = Math.max(260, Math.min(maxW, parseInt(savedWidth, 10)));
    panel.style.width = w + 'px';
  }

  let isResizing = false, startX = 0, startW = 0;

  const onPointerDown = (e) => {
    isResizing = true;
    startX = e.clientX;
    startW = panel.offsetWidth;
    handle.classList.add('resizing');
    panel.style.transition = 'none';
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e) => {
    if (!isResizing) return;
    const delta = startX - e.clientX;
    const maxW = Math.min(window.innerWidth * 0.85, 700);
    panel.style.width = Math.max(260, Math.min(maxW, startW + delta)) + 'px';
  };

  const onPointerUp = () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('resizing');
    panel.style.transition = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    localStorage.setItem('dict_panel_width', panel.offsetWidth);
  };

  handle.addEventListener('pointerdown', onPointerDown);
}

export function initDictionary() {
  if (_inited) return; // guard against double-init
  _inited = true;

  const panel       = document.getElementById('dict-panel');
  const btnClose    = document.getElementById('dict-close');
  const searchInput = document.getElementById('dict-search-input');
  const resultsDiv  = document.getElementById('dict-results');
  const editorArea  = document.getElementById('dict-editor-area');
  const wordInput   = document.getElementById('dict-word-input');
  const defInput    = document.getElementById('dict-def-input');
  const saveBtn     = document.getElementById('dict-save-btn');
  const saveLbl     = document.getElementById('dict-save-lbl');

  if (!panel || !searchInput || !resultsDiv) return;

  initDictResize();

  // ── Single toggle function used by ALL buttons ──
  const toggleDict = () => {
    if (panel.classList.contains('open')) {
      closeDictionary();
    } else {
      openDictionary();
    }
  };

  // Top toolbar button (always visible, works from every view)
  document.getElementById('btn-dict')?.addEventListener('click', toggleDict);

  // Folder notes toolbar button — registered HERE only, not in viewer.js
  document.getElementById('folder-doc-btn-dict')?.addEventListener('click', toggleDict);

  // Close button inside panel
  btnClose?.addEventListener('click', closeDictionary);

  // Click outside the panel while it's open → close it
  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('open')) return;
    if (panel.contains(e.target)) return;
    // Don't close if clicking one of the dict toggle buttons
    const dictBtns = ['btn-dict', 'folder-doc-btn-dict'];
    if (dictBtns.includes(e.target.closest('button')?.id)) return;
    closeDictionary();
  }, { capture: false });

  // ── Search logic ──
  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearTimeout(searchTimer);

    if (!val) {
      resultsDiv.innerHTML = '<div style="color:var(--muted); font-style:italic;">Type a word to search or add...</div>';
      if (editorArea) editorArea.style.display = 'none';
      return;
    }

    resultsDiv.innerHTML = '<div style="color:var(--muted); font-style:italic;">Searching...</div>';

    searchTimer = setTimeout(async () => {
      try {
        const results = await dbSearchDictionary(val);
        let exactMatch = null;
        resultsDiv.innerHTML = '';

        if (results.length === 0) {
          resultsDiv.innerHTML = '<div style="color:var(--gold); font-style:italic;">Word not found. You can add it below.</div>';
        } else {
          results.forEach(res => {
            if (res.word.toLowerCase() === val.toLowerCase()) exactMatch = res;

            const item = document.createElement('div');
            item.style.cssText = 'margin-bottom:12px; padding:8px; background:rgba(0,0,0,0.1); border-radius:6px; border-left:3px solid var(--gold);';

            const title = document.createElement('div');
            title.textContent = res.word;
            title.style.cssText = 'font-weight:bold; color:white; margin-bottom:4px; font-size:15px;';

            const desc = document.createElement('div');
            desc.textContent = res.definition;
            desc.style.whiteSpace = 'pre-wrap';

            item.appendChild(title);
            item.appendChild(desc);
            resultsDiv.appendChild(item);
          });
        }

        // Show add-definition editor if no exact match found
        if (editorArea) {
          if (!exactMatch) {
            editorArea.style.display = 'flex';
            if (wordInput) wordInput.value = val;
            if (defInput)  defInput.value  = '';
          } else {
            editorArea.style.display = 'none';
          }
        }
      } catch (err) {
        resultsDiv.innerHTML = '<div style="color:red; font-style:italic;">Error searching dictionary.</div>';
        console.error('[Dictionary] Search error:', err);
      }
    }, 400);
  });

  // ── Save new definition ──
  saveBtn?.addEventListener('click', async () => {
    const w = wordInput?.value.trim();
    const d = defInput?.value.trim();
    if (!w || !d) return;

    if (saveBtn) saveBtn.disabled = true;
    if (saveLbl) { saveLbl.textContent = 'Saving...'; saveLbl.style.color = 'var(--muted)'; }

    try {
      await dbSaveDictionary(w, d);
      if (saveLbl) { saveLbl.textContent = 'Saved!'; saveLbl.style.color = '#4ade80'; }
      if (defInput) defInput.value = '';
      // Refresh search results
      searchInput.dispatchEvent(new Event('input'));
    } catch (err) {
      if (saveLbl) { saveLbl.textContent = 'Error'; saveLbl.style.color = 'red'; }
      console.error('[Dictionary] Save error:', err);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      setTimeout(() => {
        if (saveLbl && (saveLbl.textContent === 'Saved!' || saveLbl.textContent === 'Error')) {
          saveLbl.textContent = '';
        }
      }, 3000);
    }
  });
}
