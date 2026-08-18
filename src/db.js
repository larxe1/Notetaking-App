// ═══════════════════════════════════════════════
// DB — all Supabase interactions
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { driveDeleteFile } from './drive.js';
import { broadcastSync } from './sync.js';

// Inline sync helpers (avoids circular dep with ui.js)
const _el = id => document.getElementById(id);
function syncSpin(m) { const d=_el('sdot'),t=_el('stxt'); if(d) d.className='sdot spin'; if(t) t.textContent=m||'Working…'; }
function syncOK(m)   { const d=_el('sdot'),t=_el('stxt'); if(d) d.className='sdot ok';   if(t) t.textContent=m||'Synced'; }
function syncErr(m)  { const d=_el('sdot'),t=_el('stxt'); if(d) d.className='sdot err';  if(t) t.textContent=m||'Error'; }

// Supabase client — loaded via CDN in index.html, available as window.supabase
const SURL = window.APP_CONFIG.SUPABASE_URL;
const SKEY = window.APP_CONFIG.SUPABASE_KEY;
export const db = supabase.createClient(SURL, SKEY);

// ── Load all library data (with offline local snapshot restore) ──
export async function dbLoad(retries = 3) {
  syncSpin(retries < 3 ? `Retrying load... (${3 - retries})` : 'Loading…');
  try {
    const [s, f, p, c] = await Promise.all([
      db.from('subjects').select('*').order('created_at'),
      db.from('folders').select('*').order('sort_order').order('created_at'),
      db.from('pdf_files').select('*').order('created_at'),
      db.from('color_categories').select('*').order('created_at'),
    ]);
    if (s.error || f.error || p.error || c.error) throw new Error('DB error');
    S.subjects   = s.data || [];
    S.folders    = f.data || [];
    S.pdfs       = p.data || [];
    S.colorCats  = c.data || [];
    
    // Sanitize circular references caused by drag-and-drop bug
    for (const folder of S.folders) {
      if (!folder.parent_folder_id) continue;
      let curr = folder.parent_folder_id;
      let isCycle = false;
      const seen = new Set([folder.id]);
      while (curr) {
        if (seen.has(curr)) { isCycle = true; break; }
        seen.add(curr);
        const par = S.folders.find(x => x.id === curr);
        curr = par ? par.parent_folder_id : null;
      }
      if (isCycle) {
        console.warn('Fixed circular folder reference:', folder.name);
        folder.parent_folder_id = null;
        db.from('folders').update({ parent_folder_id: null }).eq('id', folder.id).then();
      }
    }

    // Save snapshot to local disk for offline startup
    try {
      localStorage.setItem('local_lib_snapshot', JSON.stringify({
        subjects: S.subjects,
        folders: S.folders,
        pdfs: S.pdfs,
        colorCats: S.colorCats,
        saved_at: Date.now()
      }));
    } catch {}

    syncOK('DB Sync Active');
  } catch (e) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return dbLoad(retries - 1);
    }

    // Fallback: Restore from local snapshot if device is offline
    const snapStr = localStorage.getItem('local_lib_snapshot');
    if (snapStr) {
      try {
        const snap = JSON.parse(snapStr);
        S.subjects   = snap.subjects  || [];
        S.folders    = snap.folders   || [];
        S.pdfs       = snap.pdfs      || [];
        S.colorCats  = snap.colorCats || [];
        syncOK('Offline Mode (Local Cache)');
        console.log('[DB] Restored library from local offline snapshot');
        return;
      } catch {}
    }

    syncErr('Connection failed');
    throw e; // re-throw so init() can handle it (Bug #12 fix)
  }
}

// ── Annotation counts (for badges) ──
export async function dbLoadAnnCounts() {
  try {
    const { data } = await db
      .from('annotations')
      .select('pdf_file_id');
    if (data) {
      S.annCounts = {};
      for (const row of data) {
        S.annCounts[row.pdf_file_id] = (S.annCounts[row.pdf_file_id] || 0) + 1;
      }
      try { localStorage.setItem('local_ann_counts', JSON.stringify(S.annCounts)); } catch {}
    }
  } catch {
    try {
      S.annCounts = JSON.parse(localStorage.getItem('local_ann_counts') || '{}');
    } catch {}
  }
}

// ── Subjects ──
export async function dbCreateSubject(name, hex_color) {
  const id = 'subj_' + Date.now();
  const { error } = await db.from('subjects').insert({ id, name, hex_color });
  if (error) throw error;
  S.subjects.push({ id, name, hex_color });
  broadcastSync({ type: 'LIBRARY_CHANGED' });
  return id;
}

export async function dbRenameSubject(id, name) {
  await db.from('subjects').update({ name }).eq('id', id);
  const subj = S.subjects.find(s => s.id === id);
  if (subj) subj.name = name;
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

export async function dbDelSubject(id) {
  // Get all folder IDs under this subject
  const fids = S.folders.filter(f => f.subject_id === id).map(f => f.id);
  // Get all PDF IDs under those folders
  const pdfsToDelete = S.pdfs.filter(p => fids.includes(p.folder_id));
  const pids = pdfsToDelete.map(p => p.id);

  // Delete annotations + notes for all PDFs (fix bug #6)
  if (pids.length) {
    const { data: anns } = await db.from('annotations').select('id').in('pdf_file_id', pids);
    const annIds = (anns || []).map(a => a.id);
    if (annIds.length) {
      await db.from('annotation_notes').delete().in('annotation_id', annIds);
      await db.from('annotations').delete().in('id', annIds);
    }
    await db.from('drawings').delete().in('pdf_file_id', pids);
    await db.from('pdf_files').delete().in('id', pids);
    
    // Also remove from Google Drive
    for (const p of pdfsToDelete) {
      if (p.drive_file_id) {
        try { await driveDeleteFile(p.drive_file_id); } catch (e) { console.error('Drive delete error', e); }
      }
    }
  }
  if (fids.length) await db.from('folders').delete().in('id', fids);
  await db.from('subjects').delete().eq('id', id);

  S.pdfs     = S.pdfs.filter(p => !pids.includes(p.id));
  S.folders  = S.folders.filter(f => f.subject_id !== id);
  S.subjects = S.subjects.filter(x => x.id !== id);
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

// ── Folders ──
export async function dbCreateFolder(subject_id, name, folder_type, parent_folder_id = null) {
  const id = 'fold_' + Date.now();
  
  const sibFolds = S.folders.filter(f => f.parent_folder_id === parent_folder_id && f.subject_id === subject_id);
  const sibPdfs = parent_folder_id ? S.pdfs.filter(p => p.folder_id === parent_folder_id) : [];
  const m1 = sibFolds.reduce((max, f) => Math.max(max, f.sort_order || 0), -1);
  const m2 = sibPdfs.reduce((max, p) => Math.max(max, p.sort_order || 0), -1);
  const sort_order = Math.max(m1, m2) + 1;

  const { error } = await db.from('folders').insert({ id, subject_id, name, folder_type, sort_order, parent_folder_id });
  if (error) throw error;
  S.folders.push({ id, subject_id, name, folder_type, sort_order, parent_folder_id });
  broadcastSync({ type: 'LIBRARY_CHANGED' });
  return id;
}

export async function dbRenameFolder(id, name) {
  await db.from('folders').update({ name }).eq('id', id);
  const fold = S.folders.find(f => f.id === id);
  if (fold) fold.name = name;
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

export async function dbReorderFolder(id, sort_order) {
  await db.from('folders').update({ sort_order }).eq('id', id);
  const fold = S.folders.find(f => f.id === id);
  if (fold) fold.sort_order = sort_order;
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

export async function dbUpdateFolderNotes(id, notes) {
  await db.from('folders').update({ notes }).eq('id', id);
  const fold = S.folders.find(f => f.id === id);
  if (fold) fold.notes = notes;
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

export async function dbDelFolder(id) {
  // Recursively collect all descendant folder IDs
  function collectFolderIds(foldId) {
    const children = S.folders.filter(f => f.parent_folder_id === foldId).map(f => f.id);
    return [foldId, ...children.flatMap(collectFolderIds)];
  }
  const allFoldIds = collectFolderIds(id);
  const pdfsToDelete = S.pdfs.filter(p => allFoldIds.includes(p.folder_id));
  const pids = pdfsToDelete.map(p => p.id);

  // Delete annotations + notes for all PDFs
  if (pids.length) {
    const { data: anns } = await db.from('annotations').select('id').in('pdf_file_id', pids);
    const annIds = (anns || []).map(a => a.id);
    if (annIds.length) {
      await db.from('annotation_notes').delete().in('annotation_id', annIds);
      await db.from('annotations').delete().in('id', annIds);
    }
    await db.from('drawings').delete().in('pdf_file_id', pids);
    await db.from('pdf_files').delete().in('id', pids);
    
    // Also remove from Google Drive
    for (const p of pdfsToDelete) {
      if (p.drive_file_id) {
        try { await driveDeleteFile(p.drive_file_id); } catch (e) { console.error('Drive delete error', e); }
      }
    }
  }
  // Delete all descendant folders (deepest first) + self
  await db.from('folders').delete().in('id', allFoldIds);

  S.pdfs    = S.pdfs.filter(p => !allFoldIds.includes(p.folder_id));
  S.folders = S.folders.filter(f => !allFoldIds.includes(f.id));
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

// ── PDFs (using Google Drive file ID instead of Supabase storage) ──
export async function dbRegisterPDF(folder_id, name, drive_file_id, linked_pdf_id = null) {
  const id = 'pdf_' + Date.now();
  
  const folder = S.folders.find(f => f.id === folder_id);
  const subject_id = folder ? folder.subject_id : null;
  const sibFolds = S.folders.filter(f => f.parent_folder_id === folder_id && f.subject_id === subject_id);
  const sibPdfs = S.pdfs.filter(p => p.folder_id === folder_id);
  const m1 = sibFolds.reduce((max, f) => Math.max(max, f.sort_order || 0), -1);
  const m2 = sibPdfs.reduce((max, p) => Math.max(max, p.sort_order || 0), -1);
  const sort_order = Math.max(m1, m2) + 1;

  // storage_path kept as empty string for backward compat with old schema
  const { error } = await db.from('pdf_files').insert({ id, folder_id, name, drive_file_id, linked_pdf_id, storage_path: '', sort_order });
  if (error) throw error;
  const rec = { id, folder_id, name, drive_file_id, linked_pdf_id, sort_order };
  S.pdfs.push(rec);
  broadcastSync({ type: 'LIBRARY_CHANGED' });
  return rec;
}

export async function dbRenamePDF(id, name) {
  await db.from('pdf_files').update({ name }).eq('id', id);
  const pdf = S.pdfs.find(p => p.id === id);
  if (pdf) pdf.name = name;
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

export async function dbMovePDF(id, folder_id) {
  await db.from('pdf_files').update({ folder_id }).eq('id', id);
  const p = S.pdfs.find(x => x.id === id);
  if (p) p.folder_id = folder_id;
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

export async function dbMoveFolder(id, parent_folder_id, subject_id) {
  await db.from('folders').update({ parent_folder_id, subject_id }).eq('id', id);
  const f = S.folders.find(x => x.id === id);
  if (f) {
    f.parent_folder_id = parent_folder_id;
    f.subject_id = subject_id;
  }
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

export async function dbReorderPDF(id, sort_order) {
  await db.from('pdf_files').update({ sort_order }).eq('id', id);
  const p = S.pdfs.find(x => x.id === id);
  if (p) p.sort_order = sort_order;
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

export async function dbDelPDF(id) {
  // Delete annotations + notes (fix bug #8)
  const { data: anns } = await db.from('annotations').select('id').eq('pdf_file_id', id);
  const annIds = (anns || []).map(a => a.id);
  if (annIds.length) {
    await db.from('annotation_notes').delete().in('annotation_id', annIds);
    await db.from('annotations').delete().in('id', annIds);
  }
  await db.from('drawings').delete().eq('pdf_file_id', id);
  await db.from('pdf_files').delete().eq('id', id);
  // Also remove from memory any shortcuts that point to this PDF
  S.pdfs = S.pdfs.filter(p => p.id !== id && p.linked_pdf_id !== id);
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

// ── Annotations ──
export async function dbLoadAnnotations(pfid) {
  try {
    const { data: anns } = await db
      .from('annotations').select('*')
      .eq('pdf_file_id', pfid).order('created_at');
    const ids = (anns || []).map(a => a.id);
    let notes = [];
    if (ids.length) {
      const { data: nd } = await db
        .from('annotation_notes').select('*')
        .in('annotation_id', ids).order('order_index');
      notes = nd || [];
    }
    S.annotations = (anns || []).map(a => ({
      ...a,
      notes: notes.filter(n => n.annotation_id === a.id),
    }));
    try { localStorage.setItem('local_anns_' + pfid, JSON.stringify(S.annotations)); } catch {}
  } catch {
    try {
      S.annotations = JSON.parse(localStorage.getItem('local_anns_' + pfid) || '[]');
      console.log(`[DB] Restored annotations for ${pfid} from local cache`);
    } catch {
      S.annotations = [];
    }
  }
}

export async function dbCreateAnnotation(ann) {
  const { error } = await db.from('annotations').insert({
    id: ann.id,
    pdf_file_id: ann.pdf_file_id,
    page: ann.page,
    rects: ann.rects,
    highlighted_text: ann.highlighted_text,
    hex_color: ann.hex_color,
    highlight_mode: ann.highlight_mode,
  });
  if (error) throw error;
  broadcastSync({ type: 'ANNOTATIONS_CHANGED', pdfId: ann.pdf_file_id });
}

export async function dbUpdateAnnColor(id, hex_color) {
  await db.from('annotations').update({ hex_color }).eq('id', id);
  broadcastSync({ type: 'ANNOTATIONS_CHANGED' });
}

export async function dbDelAnnotation(id) {
  const { data: notes } = await db.from('annotation_notes').select('id').eq('annotation_id', id);
  if (notes?.length) await db.from('annotation_notes').delete().eq('annotation_id', id);
  await db.from('annotations').delete().eq('id', id);
  S.annotations = S.annotations.filter(a => a.id !== id);
  broadcastSync({ type: 'ANNOTATIONS_CHANGED' });
}

// ── Custom Bookmarks (TOC) ──
export async function dbLoadBookmarks(pfid) {
  try {
    const { data } = await db.from('pdf_bookmarks').select('*').eq('pdf_file_id', pfid).order('page');
    S.bookmarks = data || [];
    try { localStorage.setItem('local_bms_' + pfid, JSON.stringify(S.bookmarks)); } catch {}
  } catch {
    try {
      S.bookmarks = JSON.parse(localStorage.getItem('local_bms_' + pfid) || '[]');
    } catch {
      S.bookmarks = [];
    }
  }
}

export async function dbCreateBookmark(pfid, page, title) {
  const id = 'bm_' + Date.now();
  const { error } = await db.from('pdf_bookmarks').insert({ id, pdf_file_id: pfid, page, title });
  if (error) throw error;
  const bm = { id, pdf_file_id: pfid, page, title };
  S.bookmarks.push(bm);
  S.bookmarks.sort((a, b) => a.page - b.page);
  broadcastSync({ type: 'ANNOTATIONS_CHANGED', pdfId: pfid });
  return bm;
}

export async function dbDelBookmark(id) {
  await db.from('pdf_bookmarks').delete().eq('id', id);
  S.bookmarks = S.bookmarks.filter(b => b.id !== id);
  broadcastSync({ type: 'ANNOTATIONS_CHANGED' });
}

// ── Notes ──
export async function dbCreateNote(annotation_id, note_html, order_index) {
  const id = 'note_' + Date.now();
  const { error } = await db.from('annotation_notes').insert({ id, annotation_id, note_html, order_index });
  if (error) throw error;
  broadcastSync({ type: 'ANNOTATIONS_CHANGED' });
  return { id, annotation_id, note_html, order_index };
}

export async function dbUpdateNote(id, note_html) {
  await db.from('annotation_notes').update({ note_html }).eq('id', id);
  broadcastSync({ type: 'ANNOTATIONS_CHANGED' });
}

export async function dbDelNote(id) {
  await db.from('annotation_notes').delete().eq('id', id);
  broadcastSync({ type: 'ANNOTATIONS_CHANGED' });
}

// ── Drawings ──
export async function dbLoadDrawings(pfid) {
  try {
    const { data } = await db.from('drawings').select('*').eq('pdf_file_id', pfid);
    S.drawData = {};
    for (const d of data || []) S.drawData[d.page] = d.strokes || [];
    try { localStorage.setItem('local_draws_' + pfid, JSON.stringify(S.drawData)); } catch {}
  } catch {
    try {
      S.drawData = JSON.parse(localStorage.getItem('local_draws_' + pfid) || '{}');
    } catch {
      S.drawData = {};
    }
  }
}

export async function dbSaveDrawings(pfid, page, strokes) {
  const id = `draw_${pfid}_${page}`;
  await db.from('drawings').upsert({
    id, pdf_file_id: pfid, page, strokes,
    updated_at: new Date().toISOString(),
  });
  broadcastSync({ type: 'ANNOTATIONS_CHANGED', pdfId: pfid });
}

// ── Color Categories ──
export async function dbCreateColorCat(name, hex_color) {
  const id = 'cc_' + Date.now();
  await db.from('color_categories').insert({ id, name, hex_color });
  const cat = { id, name, hex_color };
  S.colorCats.push(cat);
  broadcastSync({ type: 'LIBRARY_CHANGED' });
  return cat;
}

export async function dbDelColorCat(id) {
  await db.from('color_categories').delete().eq('id', id);
  S.colorCats = S.colorCats.filter(c => c.id !== id);
  broadcastSync({ type: 'LIBRARY_CHANGED' });
}

// ── PDF Notepad ──
export async function dbLoadNotepad(pdf_id) {
  const { data, error } = await db.from('pdf_notes').select('content').eq('pdf_id', pdf_id).maybeSingle();
  if (error) {
    console.error('[PDF Notepad load error]', error);
  }
  return data?.content || '';
}

export async function dbSaveNotepad(pdf_id, content) {
  const { error } = await db.from('pdf_notes').upsert({ pdf_id, content }, { onConflict: 'pdf_id' });
  if (error) {
    console.error('[PDF Notepad save error]', error);
    throw error;
  }
  broadcastSync({ type: 'NOTEPAD_CHANGED', pdfId: pdf_id, content });
}

// ───────────────────────────────────────────────
// DICTIONARY
// ───────────────────────────────────────────────
export async function dbSearchDictionary(term) {
  if (!term || term.trim() === '') return [];
  const { data, error } = await db.from('dictionary')
    .select('*')
    .ilike('word', `%${term}%`)
    .not('word', 'like', '__sys_%')
    .order('word', { ascending: true })
    .limit(10);
  
  if (error) {
    console.error('Dictionary search error:', error);
    return [];
  }
  return data || [];
}

export async function dbSaveDictionary(word, definition) {
  const { error } = await db.from('dictionary').upsert({ word, definition }, { onConflict: 'word' });
  if (error) {
    console.error('[Dictionary save error]', error);
    throw error;
  }
}

export async function dbLoadLinks() {
  const { data, error } = await db.from('dictionary').select('definition').eq('word', '__sys_links').maybeSingle();
  if (error || !data) return [];
  try {
    return JSON.parse(data.definition) || [];
  } catch {
    return [];
  }
}

export async function dbSaveLinks(links) {
  const { error } = await db.from('dictionary').upsert({ word: '__sys_links', definition: JSON.stringify(links) }, { onConflict: 'word' });
  if (error) console.error('Failed to save links:', error);
}
