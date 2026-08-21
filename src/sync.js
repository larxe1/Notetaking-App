// ═══════════════════════════════════════════════
// SYNC — Real-time synchronization across tabs & devices
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { db, dbLoad, dbLoadAnnCounts, dbLoadAnnotations, dbLoadDrawings } from './db.js';

let _channel = null;
let _refreshTimer = null;
let _annTimer = null;

export function broadcastSync(msg) {
  try {
    if (!_channel && typeof BroadcastChannel !== 'undefined') {
      _channel = new BroadcastChannel('legal_annotator_realtime');
    }
    if (_channel) {
      _channel.postMessage({ ...msg, timestamp: Date.now() });
    }
  } catch (e) {
    console.warn('[Sync] broadcast failed', e);
  }
}

async function handleLibraryRefresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(async () => {
    try {
      await dbLoad();
      await dbLoadAnnCounts();
      const { renderLibrary } = await import('./library.js');
      renderLibrary();
    } catch (err) {
      console.error('[Sync] Library refresh error', err);
    }
  }, 100);
}

async function handleAnnotationsRefresh(pdfId) {
  if (!S.curPDF) return;
  const trueId = S.curPDF.linked_pdf_id || S.curPDF.id;
  if (pdfId && pdfId !== trueId) return;

  clearTimeout(_annTimer);
  _annTimer = setTimeout(async () => {
    try {
      await dbLoadAnnotations(trueId);
      await dbLoadDrawings(trueId);
      const { redrawAllAnnotations } = await import('./annotate.js');
      const { redrawAllDrawings }    = await import('./draw.js');
      redrawAllAnnotations();
      redrawAllDrawings();
    } catch (err) {
      console.error('[Sync] Annotations refresh error', err);
    }
  }, 150);
}

export function initRealtimeSync() {
  // 1. Cross-Tab Broadcast Channel (instant 0ms sync on same browser)
  if (typeof BroadcastChannel !== 'undefined') {
    _channel = new BroadcastChannel('legal_annotator_realtime');
    _channel.onmessage = (event) => {
      const data = event.data;
      if (!data || !data.type) return;

      if (data.type === 'LIBRARY_CHANGED') {
        handleLibraryRefresh();
      } else if (data.type === 'ANNOTATIONS_CHANGED') {
        handleAnnotationsRefresh(data.pdfId);
      } else if (data.type === 'NOTEPAD_CHANGED') {
        if (S.curPDF) {
          const trueId = S.curPDF.linked_pdf_id || S.curPDF.id;
          if (data.pdfId === trueId) {
            const editor = document.getElementById('np-editor');
            const digestEditor = document.getElementById('np-digest-editor');
            if (editor && document.activeElement !== editor && data.content !== undefined) {
              editor.innerHTML = data.content;
            }
            if (digestEditor && document.activeElement !== digestEditor && data.digest !== undefined) {
              digestEditor.innerHTML = data.digest;
            }
          }
        }
      }
    };
  }

  // 2. Supabase Postgres Realtime (cross-device live sync)
  try {
    if (db && db.channel) {
      db.channel('public:realtime_library')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'subjects' }, () => handleLibraryRefresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'folders' }, () => handleLibraryRefresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pdf_files' }, () => handleLibraryRefresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'annotations' }, (payload) => {
          const pdfId = payload.new?.pdf_file_id || payload.old?.pdf_file_id;
          handleAnnotationsRefresh(pdfId);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'drawings' }, (payload) => {
          const pdfId = payload.new?.pdf_file_id || payload.old?.pdf_file_id;
          handleAnnotationsRefresh(pdfId);
        })
        .subscribe();
    }
  } catch (err) {
    console.warn('[Sync] Supabase realtime subscription unavailable', err);
  }
}
