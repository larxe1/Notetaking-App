// ═══════════════════════════════════════════════
// LIBRARY — sidebar rendering with all upgrades:
//   - Annotation count badges
//   - Rename (subject, folder, PDF)
//   - Drag-to-reorder folders
//   - Recent PDFs
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { toast, openModal, closeModal } from './ui.js';
import {
  dbCreateSubject, dbRenameSubject, dbDelSubject,
  dbCreateFolder,  dbRenameFolder,  dbDelFolder, dbReorderFolder, dbMoveFolder,
  dbRegisterPDF,   dbRenamePDF,     dbDelPDF,    dbMovePDF, dbReorderPDF,
  dbLoadAnnCounts, dbUpdateFolderNotes
} from './db.js';
import { driveUploadPDF, driveDeleteFile, driveEnsureSubFolder } from './drive.js';
import { openPDFFromLibrary, updateActivePDF, openFolderDoc } from './viewer.js';
import { closeSidebar } from './ui.js';

let _pdfToLink = null;
let _folderNotesId = null;

// ── Library Right-Click Context Menu ──
let _ctxTargetPdf = null;

function showLibCtxMenu(pdf, x, y) {
  _ctxTargetPdf = pdf;
  const menu = document.getElementById('lib-ctx-menu');
  if (!menu) return;
  menu.classList.add('open');

  // Position menu, keeping it on-screen
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mw = 200, mh = 125;
  menu.style.left = (x + mw > vw ? vw - mw - 4 : x) + 'px';
  menu.style.top  = (y + mh > vh ? vh - mh - 4 : y) + 'px';
}

function hideLibCtxMenu() {
  document.getElementById('lib-ctx-menu')?.classList.remove('open');
  _ctxTargetPdf = null;
}

export function initContextMenu() {
  const menu = document.getElementById('lib-ctx-menu');
  if (!menu) return;

  // "Open" — normal open in primary pane
  document.getElementById('lib-ctx-open').addEventListener('click', () => {
    if (!_ctxTargetPdf) return;
    hideLibCtxMenu();
    openPDFFromLibrary(_ctxTargetPdf);
    closeSidebar();
  });

  // "Open as Reference" — open in pane B
  document.getElementById('lib-ctx-reference').addEventListener('click', async () => {
    if (!_ctxTargetPdf) return;
    const pdf = _ctxTargetPdf;
    hideLibCtxMenu();

    if (!S.curPDF) {
      // No primary PDF open yet — open it normally first
      openPDFFromLibrary(pdf);
      closeSidebar();
      return;
    }
    if (pdf.id === (S.curPDF?.id)) {
      toast('This PDF is already open as the primary.');
      return;
    }
    const { openPDFInPaneB } = await import('./dualview.js');
    openPDFInPaneB(pdf);
    closeSidebar();
  });

  // "Open in Google Drive" — opens file directly in Google Drive in new tab
  document.getElementById('lib-ctx-gdrive')?.addEventListener('click', () => {
    if (!_ctxTargetPdf) return;
    const pdf = _ctxTargetPdf;
    hideLibCtxMenu();

    const driveId = pdf.drive_file_id || S.pdfs.find(p => p.id === pdf.linked_pdf_id)?.drive_file_id;
    if (!driveId) {
      toast('No Google Drive file linked to this PDF.');
      return;
    }

    const driveUrl = `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view`;
    window.open(driveUrl, '_blank', 'noopener,noreferrer');
  });

  // "Save for Offline" — pre-cache PDF to IndexedDB
  document.getElementById('lib-ctx-offline')?.addEventListener('click', async () => {
    if (!_ctxTargetPdf) return;
    const pdf = _ctxTargetPdf;
    hideLibCtxMenu();
    const { preCachePDF } = await import('./pdfcache.js');
    await preCachePDF(pdf);
  });

  // Dismiss on outside click
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#lib-ctx-menu')) hideLibCtxMenu();
  });

  // Dismiss on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideLibCtxMenu();
  });
}

// ── Selection Logic ──
function getFlatLibraryItems() {
  const items = [];
  S.subjects.forEach(subj => {
    // We don't select subjects, but we iterate their contents
    const rootFolds = S.folders.filter(f => f.subject_id === subj.id && !f.parent_folder_id)
      .sort((a,b) => (a.sort_order??0)-(b.sort_order??0));
    
    function traverseFolder(fold) {
      items.push({ type: 'folder', id: fold.id, obj: fold });
      const children = [
        ...S.folders.filter(f => f.parent_folder_id === fold.id).map(f => ({ type: 'folder', id: f.id, obj: f, sort: f.sort_order??0 })),
        ...S.pdfs.filter(p => p.folder_id === fold.id).map(p => ({ type: 'pdf', id: p.id, obj: p, sort: p.sort_order??0 }))
      ].sort((a, b) => a.sort - b.sort);
      
      children.forEach(c => {
        if (c.type === 'folder') traverseFolder(c.obj);
        else items.push(c);
      });
    }
    rootFolds.forEach(traverseFolder);
  });
  return items;
}

export function handleSelection(id, e) {
  if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
    S.selectedIds.clear();
    S.selectedIds.add(id);
    S.lastSelectedId = id;
  } else if (e.ctrlKey || e.metaKey) {
    if (S.selectedIds.has(id)) S.selectedIds.delete(id);
    else S.selectedIds.add(id);
    S.lastSelectedId = id;
  } else if (e.shiftKey && S.lastSelectedId) {
    const items = getFlatLibraryItems();
    const idx1 = items.findIndex(i => i.id === S.lastSelectedId);
    const idx2 = items.findIndex(i => i.id === id);
    if (idx1 !== -1 && idx2 !== -1) {
      const start = Math.min(idx1, idx2);
      const end = Math.max(idx1, idx2);
      for (let i = start; i <= end; i++) {
        S.selectedIds.add(items[i].id);
      }
    }
    // DO NOT update lastSelectedId on shift-click
  }
  updateSelectionUI();
}

export function updateSelectionUI() {
  document.querySelectorAll('.li-fold, .li-pdf').forEach(el => {
    if (S.selectedIds.has(el.dataset.id)) {
      el.classList.add('li-selected');
    } else {
      el.classList.remove('li-selected');
    }
  });
}

// ── Unified Drag & Drop Logic ──
async function handleReorder(targetId, targetType, draggedIds, insertAfter = false) {
  const pdfIds = draggedIds.filter(id => id.startsWith('pdf:')).map(id => id.replace('pdf:', ''));
  const foldIds = draggedIds.filter(id => !id.startsWith('pdf:'));
  
  let parentId = null;
  let subjectId = null;

  if (targetType === 'folder') {
    const f = S.folders.find(x => x.id === targetId);
    if (!f) return;
    parentId = f.parent_folder_id;
    subjectId = f.subject_id;
  } else {
    const p = S.pdfs.find(x => x.id === targetId);
    if (!p) return;
    parentId = p.folder_id;
    const f = S.folders.find(x => x.id === parentId);
    if (f) subjectId = f.subject_id;
  }

  let sibFolds = S.folders.filter(f => f.parent_folder_id === parentId && f.subject_id === subjectId);
  let sibPdfs = parentId ? S.pdfs.filter(p => p.folder_id === parentId) : [];

  sibFolds = sibFolds.filter(f => !foldIds.includes(f.id));
  sibPdfs = sibPdfs.filter(p => !pdfIds.includes(p.id));

  let siblings = [
    ...sibFolds.map(f => ({ id: f.id, type: 'folder', obj: f })),
    ...sibPdfs.map(p => ({ id: p.id, type: 'pdf', obj: p }))
  ].sort((a, b) => (a.obj.sort_order ?? 0) - (b.obj.sort_order ?? 0));

  let dropIdx = siblings.findIndex(s => s.id === targetId && s.type === targetType);
  if (dropIdx === -1) dropIdx = siblings.length;
  if (insertAfter) dropIdx++;

  const draggedObjects = [
    ...foldIds.map(id => {
      const f = S.folders.find(x => x.id === id);
      if (f) return { id: f.id, type: 'folder', obj: f };
      return null;
    }),
    ...pdfIds.map(id => {
      const p = S.pdfs.find(x => x.id === id);
      if (p) return { id: p.id, type: 'pdf', obj: p };
      return null;
    })
  ].filter(Boolean);

  if (draggedObjects.length === 0) return;

  snapshotMove();

  siblings.splice(dropIdx, 0, ...draggedObjects);

  siblings.forEach((s, i) => {
    s.obj.sort_order = i;
    if (s.type === 'folder') {
      // Prevent circular cycles
      let isCircular = false;
      let curr = parentId;
      while (curr) {
        if (curr === s.id) { isCircular = true; break; }
        const par = S.folders.find(x => x.id === curr);
        curr = par ? par.parent_folder_id : null;
      }
      
      if (!isCircular && (s.obj.parent_folder_id !== parentId || s.obj.subject_id !== subjectId)) {
        dbMoveFolder(s.id, parentId, subjectId).catch(()=>{});
        s.obj.parent_folder_id = parentId;
        s.obj.subject_id = subjectId;
      }
      dbReorderFolder(s.id, i).catch(()=>{});
    } else {
      if (s.obj.folder_id !== parentId) {
        dbMovePDF(s.id, parentId).catch(()=>{});
        s.obj.folder_id = parentId;
      }
      dbReorderPDF(s.id, i).catch(()=>{});
    }
  });
  renderLibrary();
}

async function handleMoveInto(targetFolderId, draggedIds) {
  const pdfIds = draggedIds.filter(id => id.startsWith('pdf:')).map(id => id.replace('pdf:', ''));
  const foldIds = draggedIds.filter(id => !id.startsWith('pdf:'));
  
  snapshotMove();
  
  let changed = false;
  for (const pdfId of pdfIds) {
    const pdf = S.pdfs.find(p => p.id === pdfId);
    if (pdf && pdf.folder_id !== targetFolderId) {
      dbMovePDF(pdfId, targetFolderId).catch(()=>{});
      pdf.folder_id = targetFolderId;
      changed = true;
    }
  }

  const targetFolder = S.folders.find(f => f.id === targetFolderId);
  if (targetFolder) {
    for (const foldId of foldIds) {
      const folder = S.folders.find(f => f.id === foldId);
      
      // Prevent circular cycles
      let isCircular = false;
      let curr = targetFolderId;
      while (curr) {
        if (curr === foldId) { isCircular = true; break; }
        const par = S.folders.find(x => x.id === curr);
        curr = par ? par.parent_folder_id : null;
      }

      if (!isCircular && folder && folder.parent_folder_id !== targetFolderId) {
        dbMoveFolder(foldId, targetFolderId, targetFolder.subject_id).catch(()=>{});
        folder.parent_folder_id = targetFolderId;
        folder.subject_id = targetFolder.subject_id;
        changed = true;
      }
    }
  }

  if (changed) renderLibrary();
}


// ── Render full library tree ──
export function renderLibrary() {
  const tree = document.getElementById('lib-tree');
  if (!S.subjects.length) {
    tree.innerHTML = '<div class="lib-empty">No subjects yet.<br>Click "+ New Subject" to start.</div>';
    return;
  }
  tree.innerHTML = '';
  for (const subj of S.subjects) tree.appendChild(buildSubjectEl(subj));
  updateSelectionUI();
}

// ── Subject node ──
function buildSubjectEl(subj) {
  const w   = document.createElement('div');
  w.className   = 'li-subj';
  w.dataset.id  = subj.id;
  const exp = !S.collapsedSubj[subj.id];

  w.innerHTML = `
    <div class="li-subj-hd">
      <span class="li-chev ${exp ? '' : 'closed'}">▼</span>
      <span class="li-dot" style="background:${subj.hex_color || '#c9a84c'}"></span>
      <span class="li-subj-name" title="${subj.name.replace(/"/g, '&quot;')}">${subj.name}</span>
      <div class="li-acts">
        <button class="li-act-btn" title="Add folder" data-act="add-fold">📁+</button>
        <button class="li-act-btn" title="Rename" data-act="rename">✏</button>
        <button class="li-act-btn del" title="Delete" data-act="del">✕</button>
      </div>
    </div>
    <div class="li-subj-ch" style="display:${exp ? 'flex' : 'none'}"></div>`;

  const hd   = w.querySelector('.li-subj-hd');
  const ch   = w.querySelector('.li-subj-ch');
  const chev = w.querySelector('.li-chev');

  hd.addEventListener('click', e => {
    if (e.target.closest('.li-acts')) return;
    S.collapsedSubj[subj.id] = !S.collapsedSubj[subj.id];
    chev.classList.toggle('closed');
    ch.style.display = S.collapsedSubj[subj.id] ? 'none' : 'flex';
  });

  w.querySelector('[data-act="add-fold"]').addEventListener('click', e => {
    e.stopPropagation();
    openNewFolderModal(subj.id);
  });

  w.querySelector('[data-act="rename"]').addEventListener('click', e => {
    e.stopPropagation();
    startInlineRename(w.querySelector('.li-subj-name'), async newName => {
      await dbRenameSubject(subj.id, newName);
      toast('Renamed');
    });
  });

  w.querySelector('[data-act="del"]').addEventListener('click', e => {
    e.stopPropagation();
    if (!confirm(`Delete subject "${subj.name}" and all its content?`)) return;
    dbDelSubject(subj.id).then(() => { renderLibrary(); toast('Deleted'); });
  });

  hd.addEventListener('dragover', e => {
    e.preventDefault();
    hd.classList.add('drag-over');
  });
  hd.addEventListener('dragleave', () => hd.classList.remove('drag-over'));
  hd.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    hd.classList.remove('drag-over');
    const rawData = e.dataTransfer.getData('text/plain');
    if (!rawData) return;
    let payload;
    try { payload = JSON.parse(rawData); } catch { payload = { type: 'single', id: rawData }; }
    const draggedIds = payload.type === 'multi' ? payload.ids : [payload.id];
    const foldIds = draggedIds.filter(id => !id.startsWith('pdf:'));
    
    snapshotMove();
    
    let changed = false;
    for (const foldId of foldIds) {
      const folder = S.folders.find(f => f.id === foldId);
      if (folder && (folder.parent_folder_id !== null || folder.subject_id !== subj.id)) {
        dbMoveFolder(foldId, null, subj.id).catch(()=>{});
        folder.parent_folder_id = null;
        folder.subject_id = subj.id;
        changed = true;
      }
    }
    if (changed) renderLibrary();
  });

  const folds = S.folders
    .filter(f => f.subject_id === subj.id && !f.parent_folder_id) // root folders only
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const f of folds) ch.appendChild(buildFolderEl(f));
  return w;
}

// ── Folder node ──
function buildFolderEl(fold) {
  const w  = document.createElement('div');
  w.className  = 'li-fold';
  w.dataset.id = fold.id;
  w.draggable  = true;
  const exp  = !!S.expandedFold[fold.id];
  const icons = { codal: '📜', cases: '⚖', laws: '📋', others: '📁', custom: '📂' };

  w.innerHTML = `
    <div class="li-fold-hd">
      <span class="li-chev ${exp ? '' : 'closed'}" style="font-size:9px">▼</span>
      <span>${icons[fold.folder_type] || '📁'}</span>
      <span class="li-fold-name" title="${fold.name.replace(/"/g, '&quot;')}">${fold.name}</span>
      <div class="li-acts">
        <button class="li-act-btn" title="Add subfolder" data-act="subfolder">📁+</button>
        <button class="li-act-btn" title="Add PDF" data-act="upload">📄+</button>
        <button class="li-act-btn" title="Rename" data-act="rename">✏</button>
        <button class="li-act-btn del" title="Delete" data-act="del">✕</button>
      </div>
    </div>
    <div class="li-fold-ch" style="display:${exp ? 'flex' : 'none'}"></div>`;

  const hd   = w.querySelector('.li-fold-hd');
  const ch   = w.querySelector('.li-fold-ch');
  const chev = w.querySelector('.li-chev');

  // Handle selection on pointerdown
  hd.addEventListener('pointerdown', e => {
    if (e.target.closest('.li-acts')) return;
    
    // If holding modifier, handle selection
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      handleSelection(fold.id, e);
      return;
    }
  });

  // Handle expand/collapse on chevron OR open general notes on folder click
  hd.addEventListener('click', e => {
    if (e.target.closest('.li-acts')) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    
    if (e.target.closest('.li-chev')) {
      S.expandedFold[fold.id] = !S.expandedFold[fold.id];
      chev.classList.toggle('closed');
      ch.style.display = S.expandedFold[fold.id] ? 'flex' : 'none';
    } else {
      // Clicking the folder immediately opens the folder's general notes
      openFolderDoc(fold);
      closeSidebar();
    }
  });

  w.querySelector('[data-act="subfolder"]').addEventListener('click', e => {
    e.stopPropagation();
    const subjId = fold.subject_id || S.folders.find(f => f.id === fold.parent_folder_id)?.subject_id;
    openNewSubfolderModal(fold.id, subjId);
  });

  w.querySelector('[data-act="upload"]').addEventListener('click', e => {
    e.stopPropagation();
    triggerPDFUpload(fold.id);
  });

  w.querySelector('[data-act="rename"]').addEventListener('click', e => {
    e.stopPropagation();
    startInlineRename(w.querySelector('.li-fold-name'), async newName => {
      await dbRenameFolder(fold.id, newName);
      toast('Renamed');
    });
  });

  w.querySelector('[data-act="del"]').addEventListener('click', e => {
    e.stopPropagation();
    if (!confirm(`Delete folder "${fold.name}" and all its PDFs?`)) return;
    dbDelFolder(fold.id).then(() => { renderLibrary(); toast('Deleted'); });
  });

  // Unify and render children
  const childFolds = S.folders.filter(f => f.parent_folder_id === fold.id).map(f => ({ ...f, _type: 'folder' }));
  const childPdfs = S.pdfs.filter(p => p.folder_id === fold.id).map(p => ({ ...p, _type: 'pdf' }));
  
  const children = [...childFolds, ...childPdfs].sort((a, b) => {
    const sA = a.sort_order ?? 0;
    const sB = b.sort_order ?? 0;
    if (sA === sB) return a.name.localeCompare(b.name);
    return sA - sB;
  });

  for (const child of children) {
    if (child._type === 'folder') {
      const childEl = buildFolderEl(child);
      childEl.style.marginLeft = '12px';
      childEl.style.borderLeft = '2px solid rgba(201,168,76,0.2)';
      ch.appendChild(childEl);
    } else {
      ch.appendChild(buildPdfEl(child));
    }
  }

  // ── Drag-to-reorder/move ──
  w.addEventListener('dragstart', e => {
    e.stopPropagation();
    if (e.target.closest('.li-pdf')) return;
    if (!S.selectedIds.has(fold.id)) {
      S.selectedIds.clear();
      S.selectedIds.add(fold.id);
      updateSelectionUI();
    }
    const dragPayload = JSON.stringify({ type: 'multi', ids: Array.from(S.selectedIds) });
    e.dataTransfer.setData('text/plain', dragPayload);
    document.querySelectorAll('.li-selected').forEach(el => el.style.opacity = '0.5');
  });
  w.addEventListener('dragend', () => { 
    document.querySelectorAll('.li-selected').forEach(el => el.style.opacity = '');
  });

  hd.addEventListener('dragover', e => {
    if (!S.selectedIds.has(fold.id)) {
      e.preventDefault();
      hd.classList.add('drag-over');
    }
  });
  hd.addEventListener('dragleave', () => hd.classList.remove('drag-over'));
  hd.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    hd.classList.remove('drag-over');
    const rawData = e.dataTransfer.getData('text/plain');
    if (!rawData) return;
    
    let payload;
    try { payload = JSON.parse(rawData); } catch { payload = { type: 'single', id: rawData }; }
    const draggedIds = payload.type === 'multi' ? payload.ids : [payload.id];

    if (draggedIds.includes(fold.id)) return;

    // Check intent based on mouse Y coordinate
    const rect = hd.getBoundingClientRect();
    const y = e.clientY - rect.top;
    
    if (y < rect.height * 0.25) {
      await handleReorder(fold.id, 'folder', draggedIds, false);
    } else if (y > rect.height * 0.75) {
      await handleReorder(fold.id, 'folder', draggedIds, true);
    } else {
      await handleMoveInto(fold.id, draggedIds);
    }
  });

  return w;
}

function buildPdfEl(pdf) {
  const el = document.createElement('div');
  el.className  = 'li-pdf' + (S.curPDF?.id === pdf.id ? ' active' : '');
  el.dataset.id = pdf.id;
  el.draggable  = true;

  const count = S.annCounts[pdf.id] || 0;
  el.innerHTML = `
    <span>📄</span>
    <span class="li-pdf-name" title="${pdf.name.replace(/"/g, '&quot;')}">
      ${pdf.linked_pdf_id ? '<span style="color:var(--gold);margin-right:4px" title="Shortcut">🔗</span>' : ''}
      ${pdf.name}
    </span>
    <span class="ann-badge" style="${count ? '' : 'display:none'}">${count}</span>
    <div class="li-acts">
      <button class="li-act-btn" title="Create Shortcut in another folder" data-act="link">🔗</button>
      <button class="li-act-btn" title="Rename" data-act="rename">✏</button>
      <button class="li-act-btn del" title="Delete" data-act="del">✕</button>
    </div>`;

  el.addEventListener('dragstart', e => {
    e.stopPropagation();
    
    if (!S.selectedIds.has(pdf.id)) {
      S.selectedIds.clear();
      S.selectedIds.add(pdf.id);
      updateSelectionUI();
    }
    
    const dragPayload = JSON.stringify({ type: 'multi', ids: Array.from(S.selectedIds).map(id => id.startsWith('pdf_') ? 'pdf:'+id : id) });
    e.dataTransfer.setData('text/plain', dragPayload);
    
    document.querySelectorAll('.li-selected').forEach(el => el.style.opacity = '0.5');
  });
  el.addEventListener('dragend', () => { 
    document.querySelectorAll('.li-selected').forEach(el => el.style.opacity = '');
  });

  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation(); // prevent folder from also highlighting
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', e => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
  });
  el.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag-over');

    const rawData = e.dataTransfer.getData('text/plain');
    if (!rawData) return;
    
    let payload;
    try { payload = JSON.parse(rawData); } catch { payload = { type: 'single', id: rawData }; }
    const draggedIds = payload.type === 'multi' ? payload.ids : [payload.id];
    
    if (draggedIds.includes(pdf.id) || draggedIds.includes(`pdf:${pdf.id}`)) return;

    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    await handleReorder(pdf.id, 'pdf', draggedIds, y > rect.height / 2);
  });

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.li-acts')) return;
    handleSelection(pdf.id, e);
  });
  
  el.addEventListener('click', e => {
    if (e.target.closest('.li-acts')) return;
    // Only open PDF if we are not multi-selecting
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      openPDFFromLibrary(pdf);
      closeSidebar();
    }
  });

  // Right-click context menu
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showLibCtxMenu(pdf, e.clientX, e.clientY);
  });

  el.querySelector('[data-act="link"]').addEventListener('click', e => {
    e.stopPropagation();
    _pdfToLink = pdf;
    
    // Populate dropdown with proper hierarchical folder structure EXCEPT the current folder
    const sel = document.getElementById('link-target-folder');
    sel.innerHTML = '';
    
    // Group by subject and render proper hierarchical folder tree
    S.subjects.forEach(subj => {
      const optGroup = document.createElement('optgroup');
      optGroup.label = subj.name;

      // 1. Only get top-level folders (parent_id is null/undefined)
      const rootFolds = S.folders
        .filter(f => f.subject_id === subj.id && !f.parent_id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      function addFolderOptions(folder, depth = 0) {
        if (folder.id !== pdf.folder_id) {
          const opt = document.createElement('option');
          opt.value = folder.id;
          const indent = depth > 0 ? '\u00A0\u00A0\u00A0\u00A0'.repeat(depth) + '↳ ' : '';
          opt.textContent = `${indent}${folder.name}`;
          optGroup.appendChild(opt);
        }

        // Find child subfolders belonging to this folder
        const childFolds = S.folders
          .filter(f => f.parent_id === folder.id)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

        childFolds.forEach(child => addFolderOptions(child, depth + 1));
      }

      rootFolds.forEach(rf => addFolderOptions(rf, 0));

      if (optGroup.children.length > 0) sel.appendChild(optGroup);
    });
    
    if (sel.options.length === 0) {
      toast('No other folders available to link to!');
      return;
    }
    
    import('./ui.js').then(m => m.openModal('mo-link-pdf'));
  });

  el.querySelector('[data-act="rename"]').addEventListener('click', e => {
    e.stopPropagation();
    startInlineRename(el.querySelector('.li-pdf-name'), async newName => {
      await dbRenamePDF(pdf.id, newName);
      toast('Renamed');
    });
  });

  el.querySelector('[data-act="del"]').addEventListener('click', e => {
    e.stopPropagation();
    
    const isMaster = S.pdfs.some(p => p.linked_pdf_id === pdf.id);
    let msg = `Delete "${pdf.name}"?`;
    if (isMaster) {
      msg = `WARNING: "${pdf.name}" has shortcuts linked to it! Deleting this Master PDF will also delete ALL its shortcuts across other folders. Proceed?`;
    }
    
    if (!confirm(msg)) return;
    
    dbDelPDF(pdf.id).then(async () => {
      // Also remove from Drive
      if (pdf.drive_file_id) await driveDeleteFile(pdf.drive_file_id);
      renderLibrary();
      if (S.curPDF?.id === pdf.id || S.curPDF?.linked_pdf_id === pdf.id) {
        S.curPDF = null;
        document.getElementById('canvas-scroll').innerHTML =
          '<div id="welcome" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center"><p style="color:var(--muted);font-size:13px">PDF removed. Select another from the library.</p></div>';
      }
      toast('PDF deleted');
    });
  });

  return el;
}

// ── Inline rename helper ──
function startInlineRename(nameEl, onSave) {
  const old = nameEl.textContent;
  const inp = document.createElement('input');
  inp.className = 'rename-input';
  inp.value = old;
  nameEl.replaceWith(inp);
  inp.focus();
  inp.select();

  const finish = async (save) => {
    const val = inp.value.trim();
    inp.replaceWith(nameEl);
    if (save && val && val !== old) {
      nameEl.textContent = val;
      nameEl.title = val;
      try { await onSave(val); }
      catch { 
        nameEl.textContent = old; 
        nameEl.title = old;
        toast('Rename failed'); 
      }
    } else {
      nameEl.textContent = old;
      nameEl.title = old;
    }
  };

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
}

// ── Modal wiring (subjects, folders, upload) ──
export function initLibraryModals() {
  document.getElementById('new-subj-btn').addEventListener('click', () => {
    const inp = document.getElementById('subj-name');
    if (inp) {
      inp.value = '';
      setTimeout(() => inp.focus(), 50);
    }
    openModal('mo-subj');
  });

  document.getElementById('save-subj').addEventListener('click', async () => {
    const name = document.getElementById('subj-name').value.trim();
    if (!name) return;
    await dbCreateSubject(name, document.getElementById('subj-color').value);
    renderLibrary();
    closeModal('mo-subj');
    toast('Subject created');
  });

  document.getElementById('subj-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('save-subj')?.click();
    }
  });

  // Preset color clicks
  document.querySelectorAll('.subj-cpre').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('subj-color').value = btn.dataset.c;
    });
  });

  // Preset emoji clicks
  document.querySelectorAll('.subj-emo').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById('subj-name');
      inp.value = btn.textContent + ' ' + inp.value;
      inp.focus();
    });
  });

  document.querySelectorAll('.ftype-btn').forEach(b =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.ftype-btn').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
    })
  );
  
  // ── Link PDF Shortcut Modal ──
  document.getElementById('confirm-link-pdf')?.addEventListener('click', async () => {
    if (!_pdfToLink) return;
    const targetFolderId = document.getElementById('link-target-folder').value;
    if (!targetFolderId) return;
    
    // The true master ID is the original linked_pdf_id (if it's already a shortcut) or the id itself
    const trueId = _pdfToLink.linked_pdf_id || _pdfToLink.id;
    
    try {
      import('./ui.js').then(m => m.autosave('saving'));
      await dbRegisterPDF(targetFolderId, _pdfToLink.name, _pdfToLink.drive_file_id, trueId);
      renderLibrary();
      import('./ui.js').then(m => {
        m.closeModal('mo-link-pdf');
        m.toast('Shortcut created!');
        m.autosave('saved');
      });
    } catch (e) {
      console.error(e);
      import('./ui.js').then(m => {
        m.toast('Failed to create shortcut');
        m.autosave('err');
      });
    }
  });
  
  // Removed mo-fold-notes listener

  document.getElementById('save-fold').addEventListener('click', async () => {
    const inp = document.getElementById('fold-name');
    const name = inp.value.trim();
    if (!name || !S.newFolderSubjId) return;
    const subjId = S.newFolderSubjId;
    const type = document.querySelector('.ftype-btn.sel')?.dataset.type || 'custom';
    inp.value = '';
    closeModal('mo-fold');
    try {
      const newId = await dbCreateFolder(subjId, name, type);
      S.collapsedSubj[subjId] = false;
      if (newId) S.expandedFold[newId] = true;
      renderLibrary();
      toast('Folder created');
    } catch (e) {
      const { toastError } = await import('./ui.js');
      toastError(e, 'Folder creation failed');
    }
  });

  document.getElementById('fold-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('save-fold')?.click();
    }
  });

  // Save subfolder (nested inside an existing folder)
  document.getElementById('save-subfold').addEventListener('click', async () => {
    const inp = document.getElementById('subfold-name');
    const name = inp.value.trim();
    if (!name || !S.newSubfolderParentId) return;
    const parentId = S.newSubfolderParentId;
    const subjId = S.newFolderSubjId || S.folders.find(f => f.id === parentId)?.subject_id;
    inp.value = '';
    closeModal('mo-subfold');
    try {
      const newId = await dbCreateFolder(subjId, name, 'custom', parentId);
      S.expandedFold[parentId] = true;
      if (newId) S.expandedFold[newId] = true;
      renderLibrary();
      toast('Subfolder created');
    } catch (e) {
      const { toastError } = await import('./ui.js');
      toastError(e, 'Subfolder creation failed');
    }
  });

  document.getElementById('subfold-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('save-subfold')?.click();
    }
  });

  // PDF upload via Drive
  document.getElementById('pdf-file-in').addEventListener('change', async function () {
    if (!this.files || this.files.length === 0 || !S.uploadFolderId) return;
    try {
      const files = Array.from(this.files);

      // ── Duplicate detection ──
      const existingNames = S.pdfs.map(p => p.name.toLowerCase().trim());
      const duplicates = files.filter(f => existingNames.includes(f.name.toLowerCase().trim()));
      const newFiles   = files.filter(f => !existingNames.includes(f.name.toLowerCase().trim()));

      if (duplicates.length > 0 && newFiles.length === 0) {
        // All files are duplicates — block entirely
        const names = duplicates.map(f => `• ${f.name}`).join('\n');
        toast(`Already in your library:\n${names}`);
        this.value = '';
        return;
      }

      if (duplicates.length > 0) {
        // Some are duplicates — ask whether to skip them
        const names = duplicates.map(f => `• ${f.name}`).join('\n');
        const proceed = confirm(
          `The following file${duplicates.length > 1 ? 's are' : ' is'} already in your library:\n\n${names}\n\nSkip ${duplicates.length > 1 ? 'them' : 'it'} and upload only the new files?`
        );
        if (!proceed) { this.value = ''; return; }
        // Proceed with only the new ones
      }

      const toUpload = newFiles.length > 0 ? newFiles : files;
      toast(`Uploading ${toUpload.length} PDF${toUpload.length > 1 ? 's' : ''}…`);

      // ── Resolve Drive folder path (Subject / Folder) ──
      let driveFolderId = null;
      try {
        const appFolder = S.driveFolderId;
        if (appFolder) {
          const folder   = S.folders.find(f => f.id === S.uploadFolderId);
          const subject  = folder ? S.subjects.find(s => s.id === folder.subject_id) : null;
          if (subject && folder) {
            const subjDriveId = await driveEnsureSubFolder(subject.name, appFolder);
            // If nested subfolder, build full path
            if (folder.parent_folder_id) {
              const parentFold = S.folders.find(f => f.id === folder.parent_folder_id);
              if (parentFold) {
                const parentDriveId = await driveEnsureSubFolder(parentFold.name, subjDriveId);
                driveFolderId = await driveEnsureSubFolder(folder.name, parentDriveId);
              } else {
                driveFolderId = await driveEnsureSubFolder(folder.name, subjDriveId);
              }
            } else {
              driveFolderId = await driveEnsureSubFolder(folder.name, subjDriveId);
            }
          }
        }
      } catch (e) {
        console.warn('Could not create Drive subfolder, uploading to root:', e);
      }

      let lastRec = null;
      for (const file of toUpload) {
        // Upload to Drive (inside the resolved subject/folder path)
        const driveFile = await driveUploadPDF(file, driveFolderId);
        // Register in Supabase
        lastRec = await dbRegisterPDF(S.uploadFolderId, file.name, driveFile.id);
        S.annCounts[lastRec.id] = 0;
      }

      renderLibrary();
      toast('Upload complete!');

      // If they only uploaded one file, open it automatically
      if (toUpload.length === 1 && lastRec) {
        await openPDFFromLibrary(lastRec);
      }
    } catch (e) {
      console.error('[Upload Error]', e);
      const { toastError, recordError } = await import('./ui.js');
      const msg = e.message || '';
      let tip = '';
      if (msg.includes('signed') || msg.includes('Drive') || msg.includes('token')) {
        tip = 'Sign in to Google Drive first (button is in the sidebar)!';
      } else if (msg.includes('401') || msg.includes('403')) {
        tip = 'Google auth expired [401] — sign out and sign in again.';
      } else if (msg.includes('quota')) {
        tip = 'Google Drive is full [403 quota exceeded]!';
      } else if (msg.includes('drive_file_id') || msg.includes('column')) {
        tip = 'DB error [Column Missing]: run the SQL migration in Supabase';
      }
      if (tip) {
        recordError(e, 'Upload');
        toast(`⚠️ ${tip}`);
      } else {
        toastError(e, 'Upload failed');
      }
    }
    this.value = '';
  });
}

export function openNewFolderModal(id) {
  S.newFolderSubjId = id;
  const inp = document.getElementById('fold-name');
  if (inp) {
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
  }
  openModal('mo-fold');
}

export function openNewSubfolderModal(folderId, subjId) {
  S.newSubfolderParentId = folderId;
  S.newFolderSubjId = subjId || S.folders.find(f => f.id === folderId)?.subject_id;
  const inp = document.getElementById('subfold-name');
  if (inp) {
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
  }
  openModal('mo-subfold');
}

export function triggerPDFUpload(fid) {
  S.uploadFolderId = fid;
  document.getElementById('pdf-file-in').click();
}

// ── Marquee Selection ──
export function initLibrarySelection() {
  const tree = document.getElementById('lib-tree');
  let isDragging = false;
  let startX = 0, startY = 0;
  let marquee = null;

  tree.addEventListener('pointerdown', e => {
    // Only start marquee if clicking directly on the empty background, NOT on an item
    if (e.target.closest('.li-subj-hd') || e.target.closest('.li-fold-hd') || e.target.closest('.li-pdf') || e.target.closest('.li-acts')) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      S.selectedIds.clear();
      updateSelectionUI();
    }

    marquee = document.createElement('div');
    marquee.className = 'selection-marquee';
    document.body.appendChild(marquee);
    updateMarquee(e.clientX, e.clientY);
  });

  document.addEventListener('pointermove', e => {
    if (!isDragging || !marquee) return;
    updateMarquee(e.clientX, e.clientY);
    
    // Calculate intersections
    const rect = marquee.getBoundingClientRect();
    const items = tree.querySelectorAll('.li-fold, .li-pdf');
    items.forEach(item => {
      const itemRect = item.getBoundingClientRect();
      const intersect = !(
        rect.right < itemRect.left || 
        rect.left > itemRect.right || 
        rect.bottom < itemRect.top || 
        rect.top > itemRect.bottom
      );
      
      const id = item.dataset.id;
      if (intersect) {
        S.selectedIds.add(id);
        S.lastSelectedId = id;
      } else if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        S.selectedIds.delete(id);
      }
    });
    updateSelectionUI();
  });

  document.addEventListener('pointerup', () => {
    isDragging = false;
    if (marquee) {
      marquee.remove();
      marquee = null;
    }
  });

  function updateMarquee(endX, endY) {
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(startX - endX);
    const height = Math.abs(startY - endY);
    marquee.style.left = left + 'px';
    marquee.style.top = top + 'px';
    marquee.style.height = height + 'px';
  }
}

// ── Undo functionality ──
export function snapshotMove() {
  const snap = {
    folders: S.folders.map(f => ({ id: f.id, sort_order: f.sort_order, parent_folder_id: f.parent_folder_id, subject_id: f.subject_id })),
    pdfs: S.pdfs.map(p => ({ id: p.id, sort_order: p.sort_order, folder_id: p.folder_id }))
  };
  S.undoStack.push(snap);
}

window.undoLastMove = async function() {
  if (!S.undoStack || S.undoStack.length === 0) {
    toast('Nothing to undo');
    return;
  }
  const snap = S.undoStack.pop();
  let changed = false;
  
  for (const sf of snap.folders) {
    const f = S.folders.find(x => x.id === sf.id);
    if (f && (f.sort_order !== sf.sort_order || f.parent_folder_id !== sf.parent_folder_id || f.subject_id !== sf.subject_id)) {
      f.sort_order = sf.sort_order;
      f.parent_folder_id = sf.parent_folder_id;
      f.subject_id = sf.subject_id;
      // We don't need to await each to update DB fast
      import('./db.js').then(db => {
        db.db.from('folders').update({ sort_order: sf.sort_order, parent_folder_id: sf.parent_folder_id, subject_id: sf.subject_id }).eq('id', sf.id).catch(()=>{});
      });
      changed = true;
    }
  }
  
  for (const sp of snap.pdfs) {
    const p = S.pdfs.find(x => x.id === sp.id);
    if (p && (p.sort_order !== sp.sort_order || p.folder_id !== sp.folder_id)) {
      p.sort_order = sp.sort_order;
      p.folder_id = sp.folder_id;
      import('./db.js').then(db => {
        db.db.from('pdf_files').update({ sort_order: sp.sort_order, folder_id: sp.folder_id }).eq('id', sp.id).catch(()=>{});
      });
      changed = true;
    }
  }
  
  if (changed) {
    renderLibrary();
    toast('Undo successful');
  } else {
    toast('Nothing to undo');
  }
};

window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    // Check if user is typing in an input/textarea
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    e.preventDefault();
    window.undoLastMove();
  }
});
