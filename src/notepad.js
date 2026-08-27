// ═══════════════════════════════════════════════
// NOTEPAD — per-PDF general notes with auto-save
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { dbLoadNotepad, dbSaveNotepad } from './db.js';
import { showTablePicker, handlePaste, insertBannerHeader, toggleGrayOut, handleEditorKeyDown, outdentLine, indentLine } from './tablepicker.js';
import { openPdfLinkModal, insertWebLink } from './pdflink.js';
import { closeOtherPanels, toast } from './ui.js';
import { safeStorageSet, safeStorageGet } from './storage.js';
import { getNotepadHistoryIDB, saveNotepadHistoryIDB } from './pdfcache.js';
import { getNotepadDiagnostics, generateDiagnosticReport, logNotepadDiagnostic } from './diag.js';

// ── Timestamp helpers for conflict detection ──
function setWriteTs(pdfId)  { safeStorageSet('local_notepad_write_ts_' + pdfId, Date.now()); }
function setSyncTs(pdfId)   { safeStorageSet('local_notepad_sync_ts_' + pdfId,  Date.now()); }
function getWriteTs(pdfId)  { return parseInt(safeStorageGet('local_notepad_write_ts_' + pdfId, '0') || '0'); }
function getSyncTs(pdfId)   { return parseInt(safeStorageGet('local_notepad_sync_ts_'  + pdfId, '0') || '0'); }

// ── Merge two HTML note bodies without losing either side ──
function mergeNoteHtml(localHtml, remoteHtml) {
  if (!localHtml && !remoteHtml) return '';
  if (!localHtml) return remoteHtml;
  if (!remoteHtml) return localHtml;
  if (localHtml === remoteHtml) return localHtml;
  return (
    localHtml +
    '<hr style="border-color:var(--gold);margin:14px 0;opacity:.5">' +
    '<p style="color:var(--gold);font-size:11px;font-family:Inter,sans-serif;margin:0 0 6px">⚠️ Notes recovered from another device — please review and merge manually:</p>' +
    remoteHtml
  );
}

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
async function saveHistorySnapshot(pdfId, content, digest) {
  if (!pdfId || (!content && !digest)) return;
  try {
    const histKey = 'notepad_history_' + pdfId;
    let history = await getNotepadHistoryIDB(pdfId);
    if (!Array.isArray(history) || history.length === 0) {
      history = JSON.parse(safeStorageGet(histKey, '[]') || '[]');
    }
    const latest = history[history.length - 1];
    if (!latest || latest.content !== content || latest.digest !== digest) {
      history.push({
        t: Date.now(),
        content: content || '',
        digest: digest || ''
      });
      if (history.length > 50) history.shift();
      // 1. Save full rich history to IndexedDB (virtually unlimited quota)
      await saveNotepadHistoryIDB(pdfId, history);
      // 2. Keep only top 3 in localStorage so quota is never exceeded
      const top3 = history.slice(-3);
      safeStorageSet(histKey, JSON.stringify(top3));
    }
  } catch (e) {
    console.warn('[Notepad] saveHistorySnapshot error:', e);
  }
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
    content = safeStorageGet('local_notepad_' + targetPdfId, '') || '';
    digest = safeStorageGet('local_digest_' + targetPdfId, '') || '';
  }

  const lbl = $saveLbl();
  try {
    const res = await dbSaveNotepad(targetPdfId, content, digest);
    setSyncTs(targetPdfId); // mark as successfully synced to Supabase
    saveHistorySnapshot(targetPdfId, content, digest);

    if (_activePdfId === targetPdfId && lbl) {
      if (res?.saved && res?.code === '200_OK') {
        lbl.textContent = '✓ Saved';
        lbl.className = 'saved';
        lbl.title = 'Saved to Supabase cloud (Click for Error & Sync Log)';
      } else if (res?.code === 'WARN_SAVED_WITHOUT_DIGEST') {
        lbl.textContent = '⚠️ Saved (No Cloud Digest)';
        lbl.className = 'saving';
        lbl.title = 'Notes saved to cloud, but "digest" column is missing in Supabase. Digest saved locally. Click for Error Log.';
      } else if (res?.code === 'ERR_23503_FK' || res?.localOnly) {
        lbl.textContent = '💾 Local Only (23503)';
        lbl.className = 'saving';
        lbl.title = 'PDF missing in Supabase library table (23503). Saved safely to local storage. Click for Error Log.';
      } else if (res?.queued) {
        lbl.textContent = '⏳ Queued Offline';
        lbl.className = 'saving';
        lbl.title = 'Offline or cloud sync pending. Queued in outbox. Click for Error Log.';
      } else if (res?.error) {
        lbl.textContent = `✗ Err: ${res.code || 'FAIL'}`;
        lbl.className = 'err';
        lbl.title = `Save failed: ${res.error}. Click to open Error Log.`;
      } else {
        lbl.textContent = '✓ Saved';
        lbl.className = 'saved';
      }

      setTimeout(() => {
        if (_activePdfId === targetPdfId && (lbl.textContent === '✓ Saved' || lbl.textContent.startsWith('✓'))) {
          lbl.textContent = '';
          lbl.className = '';
        }
      }, 3500);
    }
  } catch (err) {
    console.error(`[Notepad] Save failed for ${targetPdfId}:`, err);
    if (_activePdfId === targetPdfId && lbl) {
      lbl.textContent = `✗ Err: ${err?.code || 'FAIL'}`;
      lbl.className = 'err';
      lbl.title = `Save failed: ${err?.message || err}. Click to open Error Log.`;
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
      content = safeStorageGet('local_notepad_' + targetPdfId, '') || '';
      digest = safeStorageGet('local_digest_' + targetPdfId, '') || '';
    }

    _notepadCache.set(targetPdfId, {
      content,
      digest,
      dirty: false,
      timestamp: Date.now()
    });

    safeStorageSet('local_notepad_' + targetPdfId, content);
    safeStorageSet('local_digest_' + targetPdfId, digest);

    saveHistorySnapshot(targetPdfId, content, digest);
    try {
      await dbSaveNotepad(targetPdfId, content, digest);
      setSyncTs(targetPdfId);
    } catch {}
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
    initialContent = safeStorageGet('local_notepad_' + pdfId, '') || '';
    initialDigest = safeStorageGet('local_digest_' + pdfId, '') || '';
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
    const { content: remoteContent, digest: remoteDigest } = await dbLoadNotepad(pdfId);

    // Sequence check: discard if user hopped to another PDF while loading
    if (_loadSeq !== seq || _activePdfId !== pdfId) return;

    const currentEntry = _notepadCache.get(pdfId);
    // Don't overwrite if user is actively typing right now
    if (currentEntry?.dirty) return;

    const localContent = initialContent || '';
    const localDigest  = initialDigest  || '';
    const remC = remoteContent || '';
    const remD = remoteDigest  || '';

    // ── Conflict detection: did this device have unsynced local writes? ──
    const writeTs = getWriteTs(pdfId);
    const syncTs  = getSyncTs(pdfId);
    const hasLocalUnsaved = writeTs > 0 && writeTs > syncTs;

    // Edge case: pre-v55 notes — write_ts was never set (writeTs === 0), BUT local content
    // exists and differs from Supabase. This means the PC had notes that were saved to
    // localStorage but never assigned a write_ts. Treat these as potentially unsaved so
    // we don't silently overwrite them.
    const hasLegacyLocal = writeTs === 0 && syncTs === 0 && !!(localContent || localDigest) && (localContent !== remC || localDigest !== remD);

    const contentDiffers  = localContent !== remC || localDigest !== remD;

    let finalContent = remC || localContent;
    let finalDigest  = remD || localDigest;
    let didMerge = false;

    if ((hasLocalUnsaved || hasLegacyLocal) && contentDiffers) {
      if ((localContent || localDigest) && (remC || remD)) {
        // Both devices have content — MERGE so nothing is lost
        finalContent = mergeNoteHtml(localContent, remC);
        finalDigest  = mergeNoteHtml(localDigest,  remD);
        didMerge = true;
      } else if ((localContent || localDigest) && !(remC || remD)) {
        // Only local has content — push local up to Supabase
        finalContent = localContent;
        finalDigest  = localDigest;
      }
      // If only remote has content (local empty): use remote (handled by finalContent = remC above)
    }


    _notepadCache.set(pdfId, {
      content:   finalContent,
      digest:    finalDigest,
      dirty:     didMerge, // merged content needs to be pushed
      timestamp: Date.now()
    });

    if (notesEd) notesEd.innerHTML = finalContent;
    if (digestEd) digestEd.innerHTML = finalDigest;

    if (didMerge) {
      // Push the merged version to Supabase immediately so all devices get it
      // (immediate, not debounced — user typing within 1s must not discard remote half)
      executeSaveForPdf(pdfId);
      toast('⚠️ Notes from two devices were merged — please review and clean up.');
    } else if ((hasLocalUnsaved || hasLegacyLocal) && (localContent || localDigest) && !(remC || remD)) {
      // Local-only content — push to Supabase now
      executeSaveForPdf(pdfId);
    }
  } catch (e) {
    console.error('[Notepad load error]', e);
  }
}

export async function closeNotepad() {
  $panel().classList.remove('open');
  await flushNotepadSave();
}

// ── Switch between Notes and Digest tabs ──
export function switchNotepadTab(tab) {
  // Capture latest text from both editors before switching tabs
  if (_activePdfId) {
    const curContent = $notesEditor()?.innerHTML ?? '';
    const curDigest = $digestEditor()?.innerHTML ?? '';
    _notepadCache.set(_activePdfId, {
      content: curContent,
      digest: curDigest,
      dirty: true,
      timestamp: Date.now()
    });
    safeStorageSet('local_notepad_' + _activePdfId, curContent);
    safeStorageSet('local_digest_' + _activePdfId, curDigest);
    setWriteTs(_activePdfId);
    scheduleSaveForPdf(_activePdfId);
  }

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

    safeStorageSet('local_notepad_' + oldPdfId, oldContent);
    safeStorageSet('local_digest_' + oldPdfId, oldDigest);

    saveHistorySnapshot(oldPdfId, oldContent, oldDigest);
    // NOTE: actual Supabase save is handled by the awaited flushNotepadSave()
    // that every caller runs BEFORE calling notepadOnPDFChange. No fire-and-forget here.
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

// ── History panel: show snapshots and allow revert ──
function formatHistoryDate(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return String(ts); }
}

function htmlToPlainPreview(html) {
  if (!html) return '(empty)';
  try {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) || '(empty)';
  } catch { return '(empty)'; }
}

// ── History & Diagnostics panel: show snapshots and live error logs ──
export async function openHistoryPanel(initialTab = 'snapshots') {
  const pdfId = _activePdfId;
  if (!pdfId) {
    toast('Open a PDF first to view its note history and error logs.');
    return;
  }

  const modal = document.getElementById('np-history-modal');
  const snapList  = document.getElementById('np-history-list');
  const diagList  = document.getElementById('np-diag-list');
  const btnSnapshots = document.getElementById('nhm-tab-snapshots');
  const btnLogs      = document.getElementById('nhm-tab-logs');
  const viewSnapshots= document.getElementById('np-history-view-snapshots');
  const viewLogs     = document.getElementById('np-history-view-logs');
  const copyBtn      = document.getElementById('nhm-copy-diag-btn');
  const countSpan    = document.getElementById('nhm-log-count');

  if (!modal) return;

  modal.classList.add('open');

  // Wire up tabs
  function switchTab(t) {
    if (t === 'logs') {
      btnLogs?.classList.add('active');
      btnSnapshots?.classList.remove('active');
      if (viewLogs) viewLogs.style.display = 'flex';
      if (viewSnapshots) viewSnapshots.style.display = 'none';
      renderLogs();
    } else {
      btnSnapshots?.classList.add('active');
      btnLogs?.classList.remove('active');
      if (viewSnapshots) viewSnapshots.style.display = 'flex';
      if (viewLogs) viewLogs.style.display = 'none';
      renderSnapshots();
    }
  }

  if (btnSnapshots) btnSnapshots.onclick = () => switchTab('snapshots');
  if (btnLogs) btnLogs.onclick = () => switchTab('logs');

  // Copy diagnostics button
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const curPdf = S.pdfs?.find(p => p.id === pdfId);
      const report = generateDiagnosticReport(pdfId, curPdf?.name || '');
      try {
        await navigator.clipboard.writeText(report);
        copyBtn.textContent = '✓ Copied Report!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy Diagnostics'; }, 2500);
        toast('📋 Diagnostic error report copied to clipboard!');
      } catch {
        toast('Clipboard copy blocked by browser. Please select text manually.');
      }
    };
  }

  // Render logs tab
  function renderLogs() {
    if (!diagList) return;
    const logs = getNotepadDiagnostics(pdfId);
    if (countSpan) countSpan.textContent = String(logs.length);

    if (logs.length === 0) {
      diagList.innerHTML = '<div class="nhm-empty">No sync or error events recorded for this PDF yet.<br>Saving or loading notes will automatically record detailed error codes here.</div>';
      return;
    }

    diagList.innerHTML = '';
    logs.forEach(item => {
      const div = document.createElement('div');
      div.className = 'diag-entry';

      const badgeClass = item.status === 'OK' ? 'diag-badge-ok' :
                         item.status === 'WARN' ? 'diag-badge-warn' :
                         item.status === 'ERR' ? 'diag-badge-err' : 'diag-badge-info';

      const dStr = formatHistoryDate(item.ts);
      let extraHtml = '';
      if (item.extra && Object.keys(item.extra).length > 0) {
        extraHtml = `<pre class="diag-extra">${JSON.stringify(item.extra, null, 2)}</pre>`;
      }

      div.innerHTML = `
        <div class="diag-entry-hd">
          <span class="diag-ts">${dStr}</span>
          <span class="diag-action">[${item.action}]</span>
          <span class="diag-badge ${badgeClass}">${item.code} (${item.status})</span>
        </div>
        <div class="diag-msg">${item.message}</div>
        ${extraHtml}
      `;
      diagList.appendChild(div);
    });
  }

  // Render snapshots tab
  async function renderSnapshots() {
    if (!snapList) return;
    snapList.innerHTML = '<div class="nhm-empty">Loading history…</div>';

    // Snapshot current state
    const curContent = $notesEditor()?.innerHTML ?? '';
    const curDigest  = $digestEditor()?.innerHTML ?? '';
    if (curContent || curDigest) {
      await saveHistorySnapshot(pdfId, curContent, curDigest);
    }

    const entries = [];

    try {
      const { dbLoadNotepad: load } = await import('./db.js');
      const cloudData = await load(pdfId);
      if (cloudData.content || cloudData.digest) {
        entries.push({
          t: null,
          content: cloudData.content || '',
          digest:  cloudData.digest  || '',
          badge:   'cloud',
          label:   '☁️ Cloud (Supabase) — current saved version'
        });
      }
    } catch (err) {
      console.warn('[History] Cloud fetch error:', err);
    }

    try {
      let hist = await getNotepadHistoryIDB(pdfId);
      if (!Array.isArray(hist) || hist.length === 0) {
        hist = JSON.parse(safeStorageGet('notepad_history_' + pdfId, '[]') || '[]');
      }
      for (let i = hist.length - 1; i >= 0; i--) {
        const snap = hist[i];
        entries.push({
          t:       snap.t,
          content: snap.content || '',
          digest:  snap.digest  || '',
          badge:   i === hist.length - 1 ? 'current' : 'local',
          label:   i === hist.length - 1 ? '📍 Latest local snapshot' : '📂 Local snapshot'
        });
      }
    } catch {}

    if (entries.length === 0) {
      snapList.innerHTML = '<div class="nhm-empty">No history snapshots found for this PDF yet.<br>Snapshots are created automatically each time notes are saved.</div>';
      return;
    }

    snapList.innerHTML = '';
    entries.forEach((entry, idx) => {
      const div = document.createElement('div');
      div.className = 'nhm-entry';

      const tsStr = entry.t ? formatHistoryDate(entry.t) : '';
      const badgeClass = entry.badge === 'cloud' ? 'nhm-badge-cloud' :
                         entry.badge === 'current' ? 'nhm-badge-current' : 'nhm-badge-local';

      const hd = document.createElement('div');
      hd.className = 'nhm-entry-hd';
      hd.innerHTML = `
        <span class="nhm-ts">${entry.label}${tsStr ? ' — ' + tsStr : ''}</span>
        <span class="nhm-badge ${badgeClass}">${entry.badge === 'cloud' ? 'CLOUD' : entry.badge === 'current' ? 'LATEST' : 'LOCAL'}</span>
        <button class="nhm-restore-btn" data-idx="${idx}" title="Restore this version">Restore</button>
      `;

      const preview = document.createElement('div');
      preview.className = 'nhm-preview';
      const notesPreview = htmlToPlainPreview(entry.content);
      const digestPreview = htmlToPlainPreview(entry.digest);
      preview.textContent = notesPreview !== '(empty)'
        ? notesPreview
        : digestPreview !== '(empty)' ? '(Digest) ' + digestPreview : '(empty)';

      div.appendChild(hd);
      div.appendChild(preview);
      snapList.appendChild(div);

      hd.querySelector('.nhm-restore-btn').addEventListener('click', async () => {
        const confirmRestore = confirm(
          `Restore this version?\n\n"${notesPreview.slice(0, 120)}…"\n\nYour current notes will be snapshotted first so you can always revert again.`
        );
        if (!confirmRestore) return;

        const before = $notesEditor()?.innerHTML ?? '';
        const beforeD = $digestEditor()?.innerHTML ?? '';
        saveHistorySnapshot(pdfId, before, beforeD);

        const notesEd = $notesEditor();
        const digestEd = $digestEditor();
        if (notesEd) notesEd.innerHTML = entry.content;
        if (digestEd) digestEd.innerHTML = entry.digest;

        _notepadCache.set(pdfId, {
          content:   entry.content,
          digest:    entry.digest,
          dirty:     true,
          timestamp: Date.now()
        });
        setWriteTs(pdfId);
        safeStorageSet('local_notepad_' + pdfId, entry.content);
        safeStorageSet('local_digest_' + pdfId, entry.digest);

        logNotepadDiagnostic(pdfId, 'RESTORE', 'INFO', 'INFO_USER_RESTORE', `User restored version from ${entry.label}`);

        modal.classList.remove('open');
        toast('⏪ Notes restored — saving to cloud…');
        await executeSaveForPdf(pdfId);
        toast('✓ Restored version saved to cloud.');
      });
    });
  }

  // Update diagnostic count badge
  const allLogs = getNotepadDiagnostics(pdfId);
  if (countSpan) countSpan.textContent = String(allLogs.length);

  // Show requested initial tab
  switchTab(initialTab);
}

export function getCachedNotepad(pdfId) {
  if (!pdfId) return null;
  if (_activePdfId === pdfId) {
    return {
      content: $notesEditor()?.innerHTML ?? '',
      digest: $digestEditor()?.innerHTML ?? ''
    };
  }
  if (_notepadCache.has(pdfId)) {
    const entry = _notepadCache.get(pdfId);
    return {
      content: entry.content || '',
      digest: entry.digest || ''
    };
  }
  return null;
}

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

  // Clicking save status indicator opens the Error & Sync Log tab directly
  const saveLbl = document.getElementById('np-save-lbl');
  if (saveLbl) {
    saveLbl.style.cursor = 'pointer';
    saveLbl.addEventListener('click', () => {
      openHistoryPanel('logs');
    });
  }

  // History button — opens the history/recovery panel
  document.getElementById('np-history-btn')?.addEventListener('click', () => {
    openHistoryPanel('snapshots');
  });
  document.getElementById('np-history-close')?.addEventListener('click', () => {
    document.getElementById('np-history-modal')?.classList.remove('open');
  });
  // Close history modal on backdrop click
  document.getElementById('np-history-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('np-history-modal')) {
      document.getElementById('np-history-modal').classList.remove('open');
    }
  });

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
        } else if (cmd === 'insertBanner') {
          insertBannerHeader(activeEd);
        } else if (cmd === 'grayOut') {
          toggleGrayOut(activeEd);
        } else if (cmd === 'outdent') {
          outdentLine(activeEd);
        } else if (cmd === 'indent') {
          indentLine(activeEd);
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
          setWriteTs(_activePdfId);
          safeStorageSet('local_notepad_' + _activePdfId, content);
          safeStorageSet('local_digest_' + _activePdfId, digest);
          scheduleSaveForPdf(_activePdfId);
        }
      }
    });
  }

  // Setup input, keydown, paste for both editors
  [$notesEditor(), $digestEditor()].forEach(ed => {
    if (!ed) return;
    ed.addEventListener('keydown', e => {
      handleEditorKeyDown(e, ed);
    });

    ed.addEventListener('input', () => {
      if (_activePdfId) {
        const content = $notesEditor()?.innerHTML ?? '';
        const digest = $digestEditor()?.innerHTML ?? '';
        _notepadCache.set(_activePdfId, { content, digest, dirty: true, timestamp: Date.now() });
        setWriteTs(_activePdfId); // record that this device has local unsaved changes
        safeStorageSet('local_notepad_' + _activePdfId, content);
        safeStorageSet('local_digest_' + _activePdfId, digest);
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

  // ── Bug A fix: flush notes when tab is closed, hidden, or app is backgrounded ──
  // visibilitychange fires reliably on iOS/iPad when switching apps
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && _activePdfId) {
      // Synchronous localStorage write is already done by the input handler.
      // Fire the async Supabase save — the browser gives us a few seconds of grace.
      flushNotepadSave();
    }
  });

  // beforeunload is the last-resort on desktop tab close / navigation
  window.addEventListener('beforeunload', () => {
    if (_activePdfId) {
      // Ensure localStorage has the latest (sync operation, always succeeds)
      try {
        const content = $notesEditor()?.innerHTML ?? '';
        const digest  = $digestEditor()?.innerHTML ?? '';
        if (content || digest) {
          safeStorageSet('local_notepad_' + _activePdfId, content);
          safeStorageSet('local_digest_'  + _activePdfId, digest);
          setWriteTs(_activePdfId);
          saveHistorySnapshot(_activePdfId, content, digest);
        }
      } catch {}
      // Fire the async Supabase write — browser may or may not let it complete
      flushNotepadSave();
    }
  });

  initNotepadResizer();
}

function initNotepadResizer() {
  const panel = $panel();
  const handle = document.getElementById('np-resize-handle');
  if (!handle || !panel) return;

  // Restore saved width from localStorage
  const savedWidth = safeStorageGet('notepad_width');
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
    safeStorageSet('notepad_width', panel.offsetWidth);
  };

  handle.addEventListener('pointerup', stopResize);
  handle.addEventListener('pointercancel', stopResize);
}

// ── Global lifecycle safeguards: Flush on tab close, hide, or reload ──
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushNotepadSave();
  });
  window.addEventListener('pagehide', () => {
    flushNotepadSave();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushNotepadSave();
    }
  });
}
