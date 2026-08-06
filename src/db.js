// ═══════════════════════════════════════════════
// DB — all Supabase interactions
// ═══════════════════════════════════════════════
import { S } from './state.js';

// Inline sync helpers (avoids circular dep with ui.js)
const _el = id => document.getElementById(id);
function syncSpin(m) { const d=_el('sdot'),t=_el('stxt'); if(d) d.className='sdot spin'; if(t) t.textContent=m||'Working…'; }
function syncOK(m)   { const d=_el('sdot'),t=_el('stxt'); if(d) d.className='sdot ok';   if(t) t.textContent=m||'Synced'; }
function syncErr(m)  { const d=_el('sdot'),t=_el('stxt'); if(d) d.className='sdot err';  if(t) t.textContent=m||'Error'; }

// Supabase client — loaded via CDN in index.html, available as window.supabase
const SURL = window.APP_CONFIG.SUPABASE_URL;
const SKEY = window.APP_CONFIG.SUPABASE_KEY;
export const db = supabase.createClient(SURL, SKEY);

// ── Load all library data ──
export async function dbLoad() {
  syncSpin('Loading…');
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
    syncOK('Connected');
  } catch (e) {
    syncErr('Connection failed');
    throw e; // re-throw so init() can handle it (Bug #12 fix)
  }
}

// ── Annotation counts (for badges) ──
export async function dbLoadAnnCounts() {
  const { data } = await db
    .from('annotations')
    .select('pdf_file_id');
  if (!data) return;
  S.annCounts = {};
  for (const row of data) {
    S.annCounts[row.pdf_file_id] = (S.annCounts[row.pdf_file_id] || 0) + 1;
  }
}

// ── Subjects ──
export async function dbCreateSubject(name, hex_color) {
  const id = 'subj_' + Date.now();
  const { error } = await db.from('subjects').insert({ id, name, hex_color });
  if (error) throw error;
  S.subjects.push({ id, name, hex_color });
  return id;
}

export async function dbRenameSubject(id, name) {
  await db.from('subjects').update({ name }).eq('id', id);
  const subj = S.subjects.find(s => s.id === id);
  if (subj) subj.name = name;
}

export async function dbDelSubject(id) {
  // Get all folder IDs under this subject
  const fids = S.folders.filter(f => f.subject_id === id).map(f => f.id);
  // Get all PDF IDs under those folders
  const pids = S.pdfs.filter(p => fids.includes(p.folder_id)).map(p => p.id);

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
  }
  if (fids.length) await db.from('folders').delete().in('id', fids);
  await db.from('subjects').delete().eq('id', id);

  S.pdfs     = S.pdfs.filter(p => !pids.includes(p.id));
  S.folders  = S.folders.filter(f => f.subject_id !== id);
  S.subjects = S.subjects.filter(x => x.id !== id);
}

// ── Folders ──
export async function dbCreateFolder(subject_id, name, folder_type, parent_folder_id = null) {
  const id = 'fold_' + Date.now();
  const { error } = await db.from('folders').insert({ id, subject_id, name, folder_type, sort_order: 0, parent_folder_id });
  if (error) throw error;
  S.folders.push({ id, subject_id, name, folder_type, sort_order: 0, parent_folder_id });
  return id;
}

export async function dbRenameFolder(id, name) {
  await db.from('folders').update({ name }).eq('id', id);
  const fold = S.folders.find(f => f.id === id);
  if (fold) fold.name = name;
}

export async function dbReorderFolder(id, sort_order) {
  await db.from('folders').update({ sort_order }).eq('id', id);
  const fold = S.folders.find(f => f.id === id);
  if (fold) fold.sort_order = sort_order;
}

export async function dbDelFolder(id) {
  // Recursively collect all descendant folder IDs
  function collectFolderIds(foldId) {
    const children = S.folders.filter(f => f.parent_folder_id === foldId).map(f => f.id);
    return [foldId, ...children.flatMap(collectFolderIds)];
  }
  const allFoldIds = collectFolderIds(id);
  const pids = S.pdfs.filter(p => allFoldIds.includes(p.folder_id)).map(p => p.id);

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
  }
  // Delete all descendant folders (deepest first) + self
  await db.from('folders').delete().in('id', allFoldIds);

  S.pdfs    = S.pdfs.filter(p => !allFoldIds.includes(p.folder_id));
  S.folders = S.folders.filter(f => !allFoldIds.includes(f.id));
}

// ── PDFs (using Google Drive file ID instead of Supabase storage) ──
export async function dbRegisterPDF(folder_id, name, drive_file_id) {
  const id = 'pdf_' + Date.now();
  // storage_path kept as empty string for backward compat with old schema
  const { error } = await db.from('pdf_files').insert({ id, folder_id, name, drive_file_id, storage_path: '' });
  if (error) throw error;
  const rec = { id, folder_id, name, drive_file_id };
  S.pdfs.push(rec);
  return rec;
}

export async function dbRenamePDF(id, name) {
  await db.from('pdf_files').update({ name }).eq('id', id);
  const pdf = S.pdfs.find(p => p.id === id);
  if (pdf) pdf.name = name;
}

export async function dbMovePDF(id, folder_id) {
  await db.from('pdf_files').update({ folder_id }).eq('id', id);
  const p = S.pdfs.find(x => x.id === id);
  if (p) p.folder_id = folder_id;
}

export async function dbReorderPDF(id, sort_order) {
  await db.from('pdf_files').update({ sort_order }).eq('id', id);
  const p = S.pdfs.find(x => x.id === id);
  if (p) p.sort_order = sort_order;
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
  S.pdfs = S.pdfs.filter(p => p.id !== id);
}

// ── Annotations ──
export async function dbLoadAnnotations(pfid) {
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
}

export async function dbUpdateAnnColor(id, hex_color) {
  await db.from('annotations').update({ hex_color }).eq('id', id);
}

export async function dbDelAnnotation(id) {
  const { data: notes } = await db.from('annotation_notes').select('id').eq('annotation_id', id);
  if (notes?.length) await db.from('annotation_notes').delete().eq('annotation_id', id);
  await db.from('annotations').delete().eq('id', id);
  S.annotations = S.annotations.filter(a => a.id !== id);
}

// ── Custom Bookmarks (TOC) ──
export async function dbLoadBookmarks(pfid) {
  const { data } = await db.from('pdf_bookmarks').select('*').eq('pdf_file_id', pfid).order('page');
  S.bookmarks = data || [];
}

export async function dbCreateBookmark(pfid, page, title) {
  const id = 'bm_' + Date.now();
  const { error } = await db.from('pdf_bookmarks').insert({ id, pdf_file_id: pfid, page, title });
  if (error) throw error;
  const bm = { id, pdf_file_id: pfid, page, title };
  S.bookmarks.push(bm);
  S.bookmarks.sort((a, b) => a.page - b.page);
  return bm;
}

export async function dbDelBookmark(id) {
  await db.from('pdf_bookmarks').delete().eq('id', id);
  S.bookmarks = S.bookmarks.filter(b => b.id !== id);
}

// ── Notes ──
export async function dbCreateNote(annotation_id, note_html, order_index) {
  const id = 'note_' + Date.now();
  const { error } = await db.from('annotation_notes').insert({ id, annotation_id, note_html, order_index });
  if (error) throw error;
  return { id, annotation_id, note_html, order_index };
}

export async function dbUpdateNote(id, note_html) {
  await db.from('annotation_notes').update({ note_html }).eq('id', id);
}

export async function dbDelNote(id) {
  await db.from('annotation_notes').delete().eq('id', id);
}

// ── Drawings ──
export async function dbLoadDrawings(pfid) {
  const { data } = await db.from('drawings').select('*').eq('pdf_file_id', pfid);
  S.drawData = {};
  for (const d of data || []) S.drawData[d.page] = d.strokes || [];
}

export async function dbSaveDrawings(pfid, page, strokes) {
  const id = `draw_${pfid}_${page}`;
  await db.from('drawings').upsert({
    id, pdf_file_id: pfid, page, strokes,
    updated_at: new Date().toISOString(),
  });
}

// ── Color Categories ──
export async function dbCreateColorCat(name, hex_color) {
  const id = 'cc_' + Date.now();
  await db.from('color_categories').insert({ id, name, hex_color });
  const cat = { id, name, hex_color };
  S.colorCats.push(cat);
  return cat;
}

export async function dbDelColorCat(id) {
  await db.from('color_categories').delete().eq('id', id);
  S.colorCats = S.colorCats.filter(c => c.id !== id);
}
