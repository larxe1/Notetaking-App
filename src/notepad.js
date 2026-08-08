// ═══════════════════════════════════════════════
// NOTEPAD — per-PDF general notes with auto-save
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { dbLoadNotepad, dbSaveNotepad } from './db.js';

let _saveTimer = null;
let _currentPdfId = null;

function $panel()   { return document.getElementById('notepad-panel'); }
function $editor()  { return document.getElementById('np-editor'); }
function $saveLbl() { return document.getElementById('np-save-lbl'); }

// ── Open notepad for a specific PDF ──
export async function openNotepad(pdfId) {
  _currentPdfId = pdfId;
  const panel = $panel();
  const editor = $editor();

  // Clear and show loading state
  editor.textContent = '';
  panel.classList.add('open');

  // Load existing notes
  try {
    const content = await dbLoadNotepad(pdfId);
    // Only populate if this PDF is still active (user didn't switch)
    if (_currentPdfId === pdfId) {
      editor.textContent = content;
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
      dbSaveNotepad(_currentPdfId, $editor().textContent).catch(() => {});
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
      await dbSaveNotepad(_currentPdfId, $editor().textContent);
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
        $editor().textContent = '';
        panel.classList.add('open');
      }
    }
  });

  document.getElementById('np-close').addEventListener('click', closeNotepad);

  $editor().addEventListener('input', () => {
    if (_currentPdfId) scheduleSave();
  });

  // Close on Esc
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $panel().classList.contains('open')) {
      closeNotepad();
    }
  });
}

// ── Called when switching to a different PDF ──
export function notepadOnPDFChange(newPdfId) {
  // Flush old save immediately
  if (_saveTimer && _currentPdfId) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    dbSaveNotepad(_currentPdfId, $editor().textContent).catch(() => {});
  }
  // If panel is open, load the new PDF's notes
  if ($panel().classList.contains('open')) {
    openNotepad(newPdfId);
  } else {
    _currentPdfId = newPdfId;
  }
}
