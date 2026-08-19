// ═══════════════════════════════════════════════
// NOTEPAD — per-PDF general notes with auto-save
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { dbLoadNotepad, dbSaveNotepad } from './db.js';
import { showTablePicker, handlePaste } from './tablepicker.js';
import { closeOtherPanels } from './ui.js';

let _saveTimer = null;
let _currentPdfId = null;

function $panel()   { return document.getElementById('notepad-panel'); }
function $editor()  { return document.getElementById('np-editor'); }
function $saveLbl() { return document.getElementById('np-save-lbl'); }

// ── Open notepad for a specific PDF ──
export async function openNotepad(pdfId) {
  // Flush previous notes save immediately if switching
  if (_saveTimer && _currentPdfId && _currentPdfId !== pdfId) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    await dbSaveNotepad(_currentPdfId, $editor().innerHTML).catch(() => {});
  }

  _currentPdfId = pdfId;
  const panel = $panel();
  const editor = $editor();

  // Clear and show loading state
  editor.innerHTML = '';
  closeOtherPanels('notepad-panel');
  panel.classList.add('open');

  // Load existing notes
  try {
    const content = await dbLoadNotepad(pdfId);
    // Only populate if this PDF is still active (user didn't switch)
    if (_currentPdfId === pdfId) {
      editor.innerHTML = content;
      // Move cursor to end
      const range = document.createRange();
      const sel   = window.getSelection();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
    }
  } catch (e) {
    console.error('[Notepad load error]', e);
  }
}

export function closeNotepad() {
  $panel().classList.remove('open');
  // Flush any pending save immediately on close
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    if (_currentPdfId) {
      dbSaveNotepad(_currentPdfId, $editor().innerHTML).catch(() => {});
    }
  }
}

// ── Schedule auto-save 1.5s after last keystroke ──
function scheduleSave() {
  const lbl = $saveLbl();
  lbl.textContent = 'Unsaved…';
  lbl.className = 'saving';

  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!_currentPdfId) return;
    try {
      await dbSaveNotepad(_currentPdfId, $editor().innerHTML);
      lbl.textContent = '✓ Saved';
      lbl.className = 'saved';
      setTimeout(() => { lbl.textContent = ''; lbl.className = ''; }, 2000);
    } catch (e) {
      console.error('[Notepad save error]', e);
      lbl.textContent = '✗ Error';
      lbl.className = '';
    }
    _saveTimer = null;
  }, 1500);
}

// ── Wire up button + panel events ──
export function initNotepad() {
  document.getElementById('btn-notepad').addEventListener('click', () => {
    const panel = $panel();
    if (panel.classList.contains('open')) {
      closeNotepad();
    } else {
      if (S.curPDF) {
        openNotepad(S.curPDF.linked_pdf_id || S.curPDF.id);
      } else {
        // No PDF open — just show empty panel with message
        $editor().innerHTML = '';
        panel.classList.add('open');
      }
    }
  });

  document.getElementById('np-close').addEventListener('click', closeNotepad);

  // Bind formatting toolbar commands for PDF Notepad
  const npToolbar = document.getElementById('np-toolbar');
  if (npToolbar) {
    npToolbar.addEventListener('mousedown', e => e.preventDefault()); // Keep focus on editor
    npToolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.np-fmt-btn');
      if (!btn) return;
      
      e.stopPropagation();
      const cmd = btn.dataset.cmd;
      let val = btn.dataset.val || null;
      
      // Some browsers require tags to be wrapped in brackets for formatBlock
      if (cmd === 'formatBlock' && val && !val.startsWith('<')) {
        val = `<${val}>`;
      }
      
      try {
        if (cmd === 'insertTable') {
          showTablePicker(btn, document.getElementById('np-editor'));
        } else {
          document.execCommand(cmd, false, val);
        }
      } catch (err) {
        console.error('execCommand failed:', err);
      } finally {
        $editor().focus();
        if (_currentPdfId) scheduleSave();
      }
    });
  }

  $editor().addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
    }
  });

  $editor().addEventListener('input', () => {
    if (_currentPdfId) scheduleSave();
  });
  
  $editor().addEventListener('paste', handlePaste);

  // Close on Esc
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $panel().classList.contains('open')) {
      closeNotepad();
    }
  });

  initNotepadResizer();
}

function initNotepadResizer() {
  const panel = $panel();
  const handle = document.getElementById('np-resize-handle');
  if (!handle || !panel) return;

  // Restore saved width from localStorage
  const savedWidth = localStorage.getItem('notepad_width');
  if (savedWidth) {
    const w = parseInt(savedWidth);
    if (w >= 260 && w <= window.innerWidth * 0.85) {
      panel.style.width = w + 'px';
    }
  }

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('resizing');
    panel.style.transition = 'none'; // disable CSS transition while dragging for instant responsiveness
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });

  handle.addEventListener('pointermove', (e) => {
    if (!isResizing) return;
    const deltaX = startX - e.clientX; // dragging left increases width
    const minW = 260;
    const maxW = Math.floor(window.innerWidth * 0.85);
    const newWidth = Math.max(minW, Math.min(maxW, startWidth + deltaX));
    panel.style.width = newWidth + 'px';
  });

  const stopResize = (e) => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('resizing');
    panel.style.transition = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {}
    localStorage.setItem('notepad_width', panel.offsetWidth);
  };

  handle.addEventListener('pointerup', stopResize);
  handle.addEventListener('pointercancel', stopResize);
}

// ── Called when switching to a different PDF ──
export function notepadOnPDFChange(newPdfId) {
  // Flush old save immediately
  if (_saveTimer && _currentPdfId) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    dbSaveNotepad(_currentPdfId, $editor().innerHTML).catch(() => {});
  }
  // If panel is open, load the new PDF's notes
  if ($panel().classList.contains('open')) {
    openNotepad(newPdfId);
  } else {
    _currentPdfId = newPdfId;
  }
}
