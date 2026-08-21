// ═══════════════════════════════════════════════
// NOTEPAD — per-PDF general notes with auto-save
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { dbLoadNotepad, dbSaveNotepad } from './db.js';
import { showTablePicker, handlePaste } from './tablepicker.js';
import { openPdfLinkModal, insertWebLink } from './pdflink.js';
import { closeOtherPanels } from './ui.js';

// In-memory per-PDF cache: pdfId -> { content, digest, dirty, timestamp }
const _notepadCache = new Map();

// Active loaded PDF ID currently bound to editor UI
let _activePdfId = null;

// Debounce timer for auto-saving
let _saveTimer = null;

// Target PDF ID bound specifically to _saveTimer
let _timerPdfId = null;

// Monotonic sequence token to discard stale async dbLoad responses
let _loadSeq = 0;

// Active editor tab: 'notes' | 'digest'
let _activeTab = 'notes';

function $panel()        { return document.getElementById('notepad-panel'); }
function $notesEditor()  { return document.getElementById('np-editor'); }
function $digestEditor() { return document.getElementById('np-digest-editor'); }
function $currentEditor(){ return _activeTab === 'digest' ? $digestEditor() : $notesEditor(); }
function $saveLbl()      { return document.getElementById('np-save-lbl'); }

// ── Snapshot backup helper to protect against any data loss ──
function saveHistorySnapshot(pdfId, content, digest) {
  if (!pdfId || (!content && !digest)) return;
  try {
    const histKey = 'notepad_history_' + pdfId;
    const history = JSON.parse(localStorage.getItem(histKey) || '[]');
    const latest = history[history.length - 1];
    if (!latest || latest.content !== content || latest.digest !== digest) {
      history.push({
        t: Date.now(),
        content: content || '',
        digest: digest || ''
      });
      if (history.length > 20) history.shift();
      localStorage.setItem(histKey, JSON.stringify(history));
    }
  } catch {}
}

// ── Execute an explicit save for a specific PDF ID ──
async function executeSaveForPdf(targetPdfId) {
  if (!targetPdfId) return;

  let content = '';
  let digest = '';

  if (_notepadCache.has(targetPdfId)) {
    const entry = _notepadCache.get(targetPdfId);
    content = entry.content;
    digest = entry.digest;
    entry.dirty = false;
  } else if (_activePdfId === targetPdfId) {
    content = $notesEditor()?.innerHTML ?? '';
    digest = $digestEditor()?.innerHTML ?? '';
  } else {
    content = localStorage.getItem('local_notepad_' + targetPdfId) || '';
    digest = localStorage.getItem('local_digest_' + targetPdfId) || '';
  }

  const lbl = $saveLbl();
  try {
    await dbSaveNotepad(targetPdfId, content, digest);
    saveHistorySnapshot(targetPdfId, content, digest);

    if (_activePdfId === targetPdfId && lbl) {
      lbl.textContent = '✓ Saved';
      lbl.className = 'saved';
      setTimeout(() => {
        if (_activePdfId === targetPdfId && lbl.textContent === '✓ Saved') {
          lbl.textContent = '';
          lbl.className = '';
        }
      }, 2000);
    }
  } catch (err) {
    console.error(`[Notepad] Save failed for ${targetPdfId}:`, err);
    if (_activePdfId === targetPdfId && lbl) {
      lbl.textContent = '✗ Error';
      lbl.className = '';
    }
  }
}

// ── Schedule auto-save 1.0s after last keystroke, strictly locked to targetPdfId ──
function scheduleSaveForPdf(pdfId) {
  if (!pdfId) return;

  const lbl = $saveLbl();
  if (lbl && _activePdfId === pdfId) {
    lbl.textContent = 'Unsaved…';
    lbl.className = 'saving';
  }

  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }

  _timerPdfId = pdfId;
  _saveTimer = setTimeout(async () => {
    const toSave = _timerPdfId;
    _saveTimer = null;
    _timerPdfId = null;
    if (toSave) {
      await executeSaveForPdf(toSave);
    }
  }, 1000);
}

// ── Immediately flush pending save for the active PDF ──
export async function flushNotepadSave() {
  const targetPdfId = _timerPdfId || _activePdfId;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    _timerPdfId = null;
  }

  if (targetPdfId) {
    let content = '';
    let digest = '';

    if (_activePdfId === targetPdfId) {
      content = $notesEditor()?.innerHTML ?? '';
      digest = $digestEditor()?.innerHTML ?? '';
    } else if (_notepadCache.has(targetPdfId)) {
      const entry = _notepadCache.get(targetPdfId);
      content = entry.content;
      digest = entry.digest;
    } else {
      content = localStorage.getItem('local_notepad_' + targetPdfId) || '';
      digest = localStorage.getItem('local_digest_' + targetPdfId) || '';
    }

    _notepadCache.set(targetPdfId, {
      content,
      digest,
      dirty: false,
      timestamp: Date.now()
    });

    try {
      localStorage.setItem('local_notepad_' + targetPdfId, content);
      localStorage.setItem('local_digest_' + targetPdfId, digest);
    } catch {}

    saveHistorySnapshot(targetPdfId, content, digest);
    await dbSaveNotepad(targetPdfId, content, digest).catch(() => {});
  }
}

// ── Open notepad for a specific PDF with atomic sequencing & cache priming ──
export async function openNotepad(pdfId) {
  if (!pdfId) {
    if ($notesEditor()) $notesEditor().innerHTML = '';
    if ($digestEditor()) $digestEditor().innerHTML = '';
    return;
  }

  // 1. Flush previous PDF notes if switching
  if (_activePdfId && _activePdfId !== pdfId) {
    await flushNotepadSave();
  }

  _activePdfId = pdfId;
  const seq = ++_loadSeq;

  const panel = $panel();
  const notesEd = $notesEditor();
  const digestEd = $digestEditor();

  closeOtherPanels('notepad-panel');
  panel.classList.add('open');

  // 2. Prime UI immediately from memory or local cache (0ms instant response, no blank flash)
  let initialContent = '';
  let initialDigest = '';

  if (_notepadCache.has(pdfId)) {
    const entry = _notepadCache.get(pdfId);
    initialContent = entry.content || '';
    initialDigest = entry.digest || '';
  } else {
    initialContent = localStorage.getItem('local_notepad_' + pdfId) || '';
    initialDigest = localStorage.getItem('local_digest_' + pdfId) || '';
  }

  if (notesEd) notesEd.innerHTML = initialContent;
  if (digestEd) digestEd.innerHTML = initialDigest;

  const activeEd = $currentEditor();
  if (activeEd) {
    try {
      const range = document.createRange();
      const sel   = window.getSelection();
      range.selectNodeContents(activeEd);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      activeEd.focus();
    } catch {}
  }

  // 3. Load latest data from database
  try {
    const { content, digest } = await dbLoadNotepad(pdfId);

    // Sequence check: discard if user hopped to another PDF while loading
    if (_loadSeq !== seq || _activePdfId !== pdfId) {
      return;
    }

    const currentEntry = _notepadCache.get(pdfId);
    // Don't overwrite if user is currently typing in this PDF
    if (!currentEntry || !currentEntry.dirty) {
      const finalContent = content || initialContent || '';
      const finalDigest = digest || initialDigest || '';

      _notepadCache.set(pdfId, {
        content: finalContent,
        digest: finalDigest,
        dirty: false,
        timestamp: Date.now()
      });

      if (notesEd) notesEd.innerHTML = finalContent;
      if (digestEd) digestEd.innerHTML = finalDigest;
    }
  } catch (e) {
    console.error('[Notepad load error]', e);
  }
}

export function closeNotepad() {
  $panel().classList.remove('open');
  flushNotepadSave();
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

// ── Called whenever the active PDF changes in viewer or dual-view ──
export async function notepadOnPDFChange(newPdfId) {
  const oldPdfId = _activePdfId;

  // 1. Immediately flush old PDF data so it never bleeds into new PDF
  if (oldPdfId && oldPdfId !== newPdfId) {
    const oldContent = $notesEditor()?.innerHTML ?? '';
    const oldDigest = $digestEditor()?.innerHTML ?? '';

    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
      _timerPdfId = null;
    }

    _notepadCache.set(oldPdfId, {
      content: oldContent,
      digest: oldDigest,
      dirty: false,
      timestamp: Date.now()
    });

    try {
      localStorage.setItem('local_notepad_' + oldPdfId, oldContent);
      localStorage.setItem('local_digest_' + oldPdfId, oldDigest);
    } catch {}

    saveHistorySnapshot(oldPdfId, oldContent, oldDigest);
    dbSaveNotepad(oldPdfId, oldContent, oldDigest).catch(() => {});
  }

  // 2. Clear editor DOM immediately
  const notesEd = $notesEditor();
  const digestEd = $digestEditor();
  if (notesEd) notesEd.innerHTML = '';
  if (digestEd) digestEd.innerHTML = '';

  // 3. Update active pointer
  _activePdfId = newPdfId;

  // 4. If notepad panel is open, open for new PDF
  if (newPdfId && $panel().classList.contains('open')) {
    await openNotepad(newPdfId);
  }
}

// ── Wire up button + panel events ──
export function initNotepad() {
  document.getElementById('btn-notepad')?.addEventListener('click', () => {
    const panel = $panel();
    if (panel.classList.contains('open')) {
      closeNotepad();
    } else {
      if (S.curPDF) {
        const trueId = S.curPDF.linked_pdf_id || S.curPDF.id;
        openNotepad(trueId);
      } else {
        if ($notesEditor()) $notesEditor().innerHTML = '';
        if ($digestEditor()) $digestEditor().innerHTML = '';
        panel.classList.add('open');
      }
    }
  });

  document.getElementById('np-close')?.addEventListener('click', closeNotepad);

  // Tab switching (Notes vs Digest)
  document.querySelectorAll('#np-tabs .ap-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchNotepadTab(btn.dataset.nptab);
    });
  });

  // Bind formatting toolbar commands for PDF Notepad
  const npToolbar = document.getElementById('np-toolbar');
  if (npToolbar) {
    npToolbar.addEventListener('mousedown', e => e.preventDefault());
    npToolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.np-fmt-btn');
      if (!btn) return;
      
      e.stopPropagation();
      const activeEd = $currentEditor();

      if (btn.id === 'np-link-pdf') {
        openPdfLinkModal(activeEd, () => {
          activeEd?.dispatchEvent(new Event('input'));
          if (_activePdfId) scheduleSaveForPdf(_activePdfId);
        });
        return;
      }
      if (btn.id === 'np-link-url') {
        insertWebLink(activeEd, () => {
          activeEd?.dispatchEvent(new Event('input'));
          if (_activePdfId) scheduleSaveForPdf(_activePdfId);
        });
        return;
      }

      const cmd = btn.dataset.cmd;
      let val = btn.dataset.val || null;
      
      if (cmd === 'formatBlock' && val && !val.startsWith('<')) {
        val = `<${val}>`;
      }
      
      try {
        if (cmd === 'insertTable') {
          showTablePicker(btn, activeEd);
        } else if (cmd) {
          document.execCommand(cmd, false, val);
        }
      } catch (err) {
        console.error('execCommand failed:', err);
      } finally {
        activeEd?.focus();
        if (_activePdfId) {
          const content = $notesEditor()?.innerHTML ?? '';
          const digest = $digestEditor()?.innerHTML ?? '';
          _notepadCache.set(_activePdfId, { content, digest, dirty: true, timestamp: Date.now() });
          try {
            localStorage.setItem('local_notepad_' + _activePdfId, content);
            localStorage.setItem('local_digest_' + _activePdfId, digest);
          } catch {}
          scheduleSaveForPdf(_activePdfId);
        }
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
      if (_activePdfId) {
        const content = $notesEditor()?.innerHTML ?? '';
        const digest = $digestEditor()?.innerHTML ?? '';
        _notepadCache.set(_activePdfId, { content, digest, dirty: true, timestamp: Date.now() });
        try {
          localStorage.setItem('local_notepad_' + _activePdfId, content);
          localStorage.setItem('local_digest_' + _activePdfId, digest);
        } catch {}
        scheduleSaveForPdf(_activePdfId);
      }
    });
    
    ed.addEventListener('paste', handlePaste);
  });

  // Close on Esc
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $panel()?.classList.contains('open')) {
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
    panel.style.transition = 'none';
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });

  handle.addEventListener('pointermove', (e) => {
    if (!isResizing) return;
    const deltaX = startX - e.clientX;
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
