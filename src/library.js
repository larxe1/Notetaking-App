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
  dbCreateFolder,  dbRenameFolder,  dbDelFolder, dbReorderFolder,
  dbRegisterPDF,   dbRenamePDF,     dbDelPDF,    dbMovePDF, dbReorderPDF,
  dbLoadAnnCounts,
} from './db.js';
import { driveUploadPDF, driveDeleteFile } from './drive.js';
import { openPDFFromLibrary, updateActivePDF } from './viewer.js';
import { closeSidebar } from './ui.js';

// ── Render full library tree ──
export function renderLibrary() {
  const tree = document.getElementById('lib-tree');
  if (!S.subjects.length) {
    tree.innerHTML = '<div class="lib-empty">No subjects yet.<br>Click "+ New Subject" to start.</div>';
    return;
  }
  tree.innerHTML = '';
  for (const subj of S.subjects) tree.appendChild(buildSubjectEl(subj));
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
      <span class="li-subj-name">${subj.name}</span>
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
  const exp  = !S.collapsedFold[fold.id];
  const icons = { codal: '📜', cases: '⚖', laws: '📋', others: '📁', custom: '📂' };

  w.innerHTML = `
    <div class="li-fold-hd">
      <span class="li-chev ${exp ? '' : 'closed'}" style="font-size:9px">▼</span>
      <span>${icons[fold.folder_type] || '📁'}</span>
      <span class="li-fold-name">${fold.name}</span>
      <div class="li-acts">
        <button class="li-act-btn" title="Add subfolder" data-act="subfolder">📁+</button>
        <button class="li-act-btn" title="Upload PDF" data-act="upload">📄+</button>
        <button class="li-act-btn" title="Rename" data-act="rename">✏</button>
        <button class="li-act-btn del" title="Delete" data-act="del">✕</button>
      </div>
    </div>
    <div class="li-fold-ch" style="display:${exp ? 'flex' : 'none'}"></div>`;

  const hd   = w.querySelector('.li-fold-hd');
  const ch   = w.querySelector('.li-fold-ch');
  const chev = w.querySelector('.li-chev');

  hd.addEventListener('click', e => {
    if (e.target.closest('.li-acts')) return;
    S.collapsedFold[fold.id] = !S.collapsedFold[fold.id];
    chev.classList.toggle('closed');
    ch.style.display = S.collapsedFold[fold.id] ? 'none' : 'flex';
  });

  w.querySelector('[data-act="subfolder"]').addEventListener('click', e => {
    e.stopPropagation();
    S.newSubfolderParentId = fold.id;
    S.newFolderSubjId = fold.subject_id;
    document.getElementById('subfold-name').value = '';
    openModal('mo-subfold');
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

  S.pdfs
    .filter(p => p.folder_id === fold.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .forEach(p => ch.appendChild(buildPdfEl(p)));

  // Render child subfolders recursively (indented)
  const childFolds = S.folders
    .filter(f => f.parent_folder_id === fold.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const child of childFolds) {
    const childEl = buildFolderEl(child);
    childEl.style.marginLeft = '12px';
    childEl.style.borderLeft = '2px solid rgba(201,168,76,0.2)';
    ch.appendChild(childEl);
  }

  // ── Drag-to-reorder (folders only, not when dragging a child PDF) ──
  w.addEventListener('dragstart', e => {
    // Only start a folder drag if the drag originated from the folder header
    if (e.target.closest('.li-pdf')) return;
    e.dataTransfer.setData('text/plain', fold.id);
    w.style.opacity = '0.5';
  });
  w.addEventListener('dragend', () => { w.style.opacity = ''; });
  w.addEventListener('dragover', e => {
    const draggedId = e.dataTransfer.types.includes('text/plain') ? e.dataTransfer.getData('text/plain') : '';
    // If a PDF is being dragged, let the PDF's own dragover handle it
    if (e.target.closest('.li-pdf')) return;
    e.preventDefault();
    w.classList.add('drag-over');
  });
  w.addEventListener('dragleave', () => w.classList.remove('drag-over'));
  w.addEventListener('drop', async e => {
    e.preventDefault();
    w.classList.remove('drag-over');
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === fold.id) return;
    
    // Check if dragging a PDF
    if (draggedId.startsWith('pdf:')) {
      const pdfId = draggedId.replace('pdf:', '');
      const pdf = S.pdfs.find(p => p.id === pdfId);
      if (pdf && pdf.folder_id !== fold.id) {
        await dbMovePDF(pdfId, fold.id);
        renderLibrary();
      }
      return;
    }

    // Otherwise, it's a folder being dragged
    const draggedFold = S.folders.find(f => f.id === draggedId);
    if (!draggedFold || draggedFold.subject_id !== fold.subject_id) return;

    // Reorder: give dragged item the sort_order just before the drop target
    const sibFolds = S.folders
      .filter(f => f.subject_id === fold.subject_id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const targetIdx  = sibFolds.findIndex(f => f.id === fold.id);
    const newSortOrder = targetIdx === 0 ? (sibFolds[0].sort_order ?? 0) - 1 : ((sibFolds[targetIdx - 1].sort_order ?? 0) + (sibFolds[targetIdx].sort_order ?? 0)) / 2;
    await dbReorderFolder(draggedId, newSortOrder);
    renderLibrary();
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
    <span class="li-pdf-name" title="${pdf.name}">${pdf.name}</span>
    <span class="ann-badge" style="${count ? '' : 'display:none'}">${count}</span>
    <div class="li-acts">
      <button class="li-act-btn" title="Rename" data-act="rename">✏</button>
      <button class="li-act-btn del" title="Delete" data-act="del">✕</button>
    </div>`;

  el.addEventListener('dragstart', e => {
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', 'pdf:' + pdf.id);
    el.style.opacity = '0.5';
  });
  el.addEventListener('dragend', () => { el.style.opacity = ''; });

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

    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || !draggedId.startsWith('pdf:')) return;

    const dragPdfId = draggedId.replace('pdf:', '');
    if (dragPdfId === pdf.id) return;

    const dragPdf = S.pdfs.find(p => p.id === dragPdfId);

    // Different folder → move
    if (dragPdf && dragPdf.folder_id !== pdf.folder_id) {
      await dbMovePDF(dragPdfId, pdf.folder_id);
      renderLibrary();
      return;
    }

    // Same folder → reorder
    if (!dragPdf) return;
    const sibPdfs = S.pdfs
      .filter(p => p.folder_id === pdf.folder_id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const targetIdx = sibPdfs.findIndex(p => p.id === pdf.id);
    const newSortOrder = targetIdx === 0
      ? (sibPdfs[0].sort_order ?? 0) - 1
      : ((sibPdfs[targetIdx - 1].sort_order ?? 0) + (sibPdfs[targetIdx].sort_order ?? 0)) / 2;
    await dbReorderPDF(dragPdfId, newSortOrder);
    renderLibrary();
  });

  el.addEventListener('click', e => {
    if (e.target.closest('.li-acts')) return;
    openPDFFromLibrary(pdf);
    closeSidebar();
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
    if (!confirm(`Delete "${pdf.name}"?`)) return;
    dbDelPDF(pdf.id).then(async () => {
      // Also remove from Drive
      if (pdf.drive_file_id) await driveDeleteFile(pdf.drive_file_id);
      renderLibrary();
      if (S.curPDF?.id === pdf.id) {
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
      try { await onSave(val); }
      catch { nameEl.textContent = old; toast('Rename failed'); }
    } else {
      nameEl.textContent = old;
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
    document.getElementById('subj-name').value = '';
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

  document.getElementById('save-fold').addEventListener('click', async () => {
    const name = document.getElementById('fold-name').value.trim();
    if (!name || !S.newFolderSubjId) return;
    const type = document.querySelector('.ftype-btn.sel')?.dataset.type || 'custom';
    await dbCreateFolder(S.newFolderSubjId, name, type);
    renderLibrary();
    closeModal('mo-fold');
    toast('Folder created');
  });

  // Save subfolder (nested inside an existing folder)
  document.getElementById('save-subfold').addEventListener('click', async () => {
    const name = document.getElementById('subfold-name').value.trim();
    if (!name || !S.newSubfolderParentId) return;
    await dbCreateFolder(S.newFolderSubjId, name, 'custom', S.newSubfolderParentId);
    renderLibrary();
    closeModal('mo-subfold');
    toast('Subfolder created');
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

      let lastRec = null;
      for (const file of toUpload) {
        // Upload to Drive
        const driveFile = await driveUploadPDF(file);
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
      const msg = e.message || '';
      let tip = 'Upload failed. Check connection.';
      if (msg.includes('signed') || msg.includes('Drive') || msg.includes('token')) {
        tip = 'Sign in to Google Drive first!';
      } else if (msg.includes('401') || msg.includes('403')) {
        tip = 'Google auth expired — sign out and sign in again.';
      } else if (msg.includes('quota')) {
        tip = 'Google Drive is full!';
      } else if (msg.includes('drive_file_id') || msg.includes('column')) {
        tip = 'DB error: run the SQL migration in Supabase (see SETUP.md)';
      }
      toast(tip);
    }
    this.value = '';
  });
}

export function openNewFolderModal(id) {
  S.newFolderSubjId = id;
  document.getElementById('fold-name').value = '';
  openModal('mo-fold');
}

export function triggerPDFUpload(fid) {
  S.uploadFolderId = fid;
  document.getElementById('pdf-file-in').click();
}
