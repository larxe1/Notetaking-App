// ═══════════════════════════════════════════════
// NOTEPAD — per-PDF general notes with auto-save
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { dbLoadNotepad, dbSaveNotepad } from './db.js';
import { showTablePicker, handlePaste } from './tablepicker.js';
import { closeOtherPanels } from './ui.js';

let _saveTimer = null;
let _currentPdfId = null;
let _activeTab = 'notes'; // 'notes' | 'digest'

function $panel()        { return document.getElementById('notepad-panel'); }
function $notesEditor()  { return document.getElementById('np-editor'); }
function $digestEditor() { return document.getElementById('np-digest-editor'); }
function $currentEditor(){ return _activeTab === 'digest' ? $digestEditor() : $notesEditor(); }
function $saveLbl()      { return document.getElementById('np-save-lbl'); }

// ── Open notepad for a specific PDF ──
export async function openNotepad(pdfId) {
  // Flush previous notes save immediately if switching
  if (_saveTimer && _currentPdfId && _currentPdfId !== pdfId) {
    await flushNotepadSave();
  }

  _currentPdfId = pdfId;
  const panel = $panel();
  const notesEd = $notesEditor();
  const digestEd = $digestEditor();

  // Clear and show loading state
  if (notesEd) notesEd.innerHTML = '';
  if (digestEd) digestEd.innerHTML = '';
  closeOtherPanels('notepad-panel');
  panel.classList.add('open');

  // Load existing notes and digest
  try {
    const { content, digest } = await dbLoadNotepad(pdfId);
    // Only populate if this PDF is still active (user didn't switch)
    if (_currentPdfId === pdfId) {
      if (notesEd) notesEd.innerHTML = content || '';
      if (digestEd) digestEd.innerHTML = digest || '';

      const activeEd = $currentEditor();
      if (activeEd) {
        // Move cursor to end
        const range = document.createRange();
        const sel   = window.getSelection();
        range.selectNodeContents(activeEd);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        activeEd.focus();
      }
    }
  } catch (e) {
    console.error('[Notepad load error]', e);
  }
}

export async function flushNotepadSave() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (_currentPdfId) {
    const content = $notesEditor()?.innerHTML ?? '';
    const digest = $digestEditor()?.innerHTML ?? '';
    await dbSaveNotepad(_currentPdfId, content, digest).catch(() => {});
  }
}

export function closeNotepad() {
  $panel().classList.remove('open');
  flushNotepadSave();
}

// ── Schedule auto-save 1.2s after last keystroke ──
function scheduleSave() {
  const lbl = $saveLbl();
  if (lbl) {
    lbl.textContent = 'Unsaved…';
    lbl.className = 'saving';
  }

  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!_currentPdfId) return;
    try {
      const content = $notesEditor()?.innerHTML ?? '';
      const digest = $digestEditor()?.innerHTML ?? '';
      await dbSaveNotepad(_currentPdfId, content, digest);
      if (lbl) {
        lbl.textContent = '✓ Saved';
        lbl.className = 'saved';
        setTimeout(() => { lbl.textContent = ''; lbl.className = ''; }, 2000);
      }
    } catch (e) {
      console.error('[Notepad save error]', e);
      if (lbl) {
        lbl.textContent = '✗ Error';
        lbl.className = '';
      }
    }
    _saveTimer = null;
  }, 1200);
}

// ── Switch between Notes and Digest tabs ──
export function switchNotepadTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('#np-tabs .ap-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nptab === tab);
  });

  const notesEd = $notesEditor();
  const digestEd = $digestEditor();

  if (tab === 'digest') {
    if (notesEd) notesEd.style.display = 'none';
    if (digestEd) digestEd.style.display = 'block';
    digestEd?.focus();
  } else {
    if (digestEd) digestEd.style.display = 'none';
    if (notesEd) notesEd.style.display = 'block';
    notesEd?.focus();
  }
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
        // No PDF open — just show empty panel
        if ($notesEditor()) $notesEditor().innerHTML = '';
        if ($digestEditor()) $digestEditor().innerHTML = '';
        panel.classList.add('open');
      }
    }
  });

  document.getElementById('np-close').addEventListener('click', closeNotepad);

  // Tab switching (Notes vs Digest)
  document.querySelectorAll('#np-tabs .ap-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchNotepadTab(btn.dataset.nptab);
    });
  });

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
      
      const activeEd = $currentEditor();
      try {
        if (cmd === 'insertTable') {
          showTablePicker(btn, activeEd);
        } else {
          document.execCommand(cmd, false, val);
        }
      } catch (err) {
        console.error('execCommand failed:', err);
      } finally {
        activeEd?.focus();
        if (_currentPdfId) scheduleSave();
      }
    });
  }

  // Setup input, keydown, paste for both editors
  [$notesEditor(), $digestEditor()].forEach(ed => {
    if (!ed) return;
    ed.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
      }
    });

    ed.addEventListener('input', () => {
      if (_currentPdfId) scheduleSave();
    });
    
    ed.addEventListener('paste', handlePaste);
  });

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
    flushNotepadSave();
  }
  // If panel is open, load the new PDF's notes
  if ($panel().classList.contains('open')) {
    openNotepad(newPdfId);
  } else {
    _currentPdfId = newPdfId;
  }
}
