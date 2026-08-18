// ═══════════════════════════════════════════════
// ANNOTATE — highlights, annotation panel, notes
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { toast, autosave, openModal, closeModal, closeOtherPanels } from './ui.js';
import {
  dbCreateAnnotation, dbUpdateAnnColor, dbDelAnnotation,
  dbCreateNote, dbUpdateNote, dbDelNote,
} from './db.js';

// ── Create annotation (text or box) ──
export async function createAnnotation(pageNum, rects, text, mode_) {
  if (!S.curPDF) return;
  const trueId = S.curPDF.linked_pdf_id || S.curPDF.id;
  const ann = {
    id: 'ann_' + Date.now(),
    pdf_file_id: trueId,
    page: pageNum,
    rects,
    highlighted_text: text,
    hex_color: S.activeColor,
    highlight_mode: mode_,
    notes: [],
  };
  try {
    autosave('saving');
    await dbCreateAnnotation(ann);
    S.annotations.push(ann);
    // Update badge count
    S.annCounts[trueId] = (S.annCounts[trueId] || 0) + 1;
    updateAnnBadge(trueId);
    drawAnnotation(ann);
    autosave('saved');
    toast('Highlight saved');
  } catch (e) {
    autosave('err');
    toast('Save failed — check connection');
  }
}

let activeNoteTab = 'general'; // 'general' | 'case'

export function getNoteType(note) {
  if (!note || !note.note_html) return 'general';
  if (note.note_html.includes('data-note-type="case"') || note.note_html.includes("data-note-type='case'")) {
    return 'case';
  }
  return 'general';
}

export function getNoteBody(note) {
  if (!note || !note.note_html) return '';
  const html = note.note_html;
  const match = html.match(/^<div\s+data-note-type=["'](?:case|general)["'][^>]*>([\s\S]*)<\/div>$/i);
  if (match) return match[1];
  return html;
}

export function wrapNoteHtml(html, type) {
  if (type === 'case') {
    return `<div data-note-type="case">${html}</div>`;
  }
  return html;
}

// ── Draw annotation overlay ──
export function drawAnnotation(ann) {
  const pg = S.pages[ann.page]; if (!pg || !pg.rendered || !pg.annOv) return;
  pg.annOv.querySelector(`[data-id="${ann.id}"]`)?.remove();

  const grp = document.createElement('div');
  grp.className  = 'hi-grp';
  grp.dataset.id = ann.id;
  grp.style.opacity = '0.4';
  grp.style.mixBlendMode = 'multiply';

  for (const r of ann.rects) {
    const d = document.createElement('div');
    d.className = 'hr';
    d.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${ann.hex_color};`;
    grp.appendChild(d);
  }
  grp.addEventListener('click', e => { e.stopPropagation(); openAnnPanel(ann); });
  grp.addEventListener('mouseenter', e => {
    if (!ann.notes.length) return;
    
    let html = '';
    const genNotes = ann.notes.filter(n => getNoteType(n) === 'general');
    const caseNotes = ann.notes.filter(n => getNoteType(n) === 'case');

    let count = 0;
    for (const n of genNotes) {
      if (count >= 3) break;
      if (count > 0) html += '<div style="border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0; padding-top: 6px;"></div>';
      html += `<div style="font-size:10px; color:var(--muted); margin-bottom:2px">📝 Note:</div>` + getNoteBody(n);
      count++;
    }

    for (const c of caseNotes) {
      if (count >= 3) break;
      if (count > 0) html += '<div style="border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0; padding-top: 6px;"></div>';
      html += `<div style="font-size:10px; color:var(--gold); font-weight:600; margin-bottom:2px">⚖️ Case Summary:</div>` + getNoteBody(c);
      count++;
    }
    
    if (ann.notes.length > 3) {
      html += `<div style="border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0; padding-top: 6px; font-size: 0.9em; color: #b0aaa0; text-align: center; font-style: italic;">...and ${ann.notes.length - 3} more (click to view)</div>`;
    } else if (ann.notes.length > 1) {
      html += `<div style="border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0; padding-top: 6px; font-size: 0.9em; color: #b0aaa0; text-align: center; font-style: italic;">(click to view notes & cases)</div>`;
    }
    
    showTip(e, html);
  });
  grp.addEventListener('mouseleave', hideTip);
  grp.addEventListener('mousemove', moveTip);
  pg.annOv.appendChild(grp);
}

export function redrawAllAnnotations() {
  for (const a of S.annotations) drawAnnotation(a);
}

export function clearAnnMark(id) {
  document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.remove());
}

// ── Annotation badge helper ──
export function updateAnnBadge(pdfId) {
  document.querySelectorAll(`.li-pdf[data-id="${pdfId}"] .ann-badge`).forEach(b => {
    const count = S.annCounts[pdfId] || 0;
    if (count > 0) { b.textContent = count; b.style.display = ''; }
    else b.style.display = 'none';
  });
}

// ── Tooltip ──
let tip = null;
function showTip(e, html) {
  if (navigator.maxTouchPoints > 0) return;
  if (!tip) {
    tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;background:#1a2540;border:1px solid #c9a84c;border-radius:8px;padding:9px 13px;font-size:12px;max-width:240px;line-height:1.5;z-index:700;pointer-events:none;color:#e8e4db;box-shadow:0 6px 20px rgba(0,0,0,.4)';
    document.body.appendChild(tip);
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  moveTip(e);
}
function moveTip(e) {
  if (!tip) return;
  let x = e.clientX + 12, y = e.clientY - 10;
  if (x + 250 > window.innerWidth)  x = e.clientX - 254;
  if (y + 100 > window.innerHeight) y = e.clientY - 110;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}
function hideTip() { if (tip) tip.style.display = 'none'; }

// ── Annotation Panel ──
export function openAnnPanel(ann) {
  S.selAnn = ann;
  document.querySelectorAll('.hi-grp').forEach(g => g.classList.remove('selected'));
  document.querySelector(`[data-id="${ann.id}"]`)?.classList.add('selected');
  document.getElementById('ap-ex').textContent =
    ann.highlighted_text.length > 90 ? ann.highlighted_text.slice(0, 90) + '…' : ann.highlighted_text;
  renderAnnColors();
  renderNotes(ann);
  document.getElementById('note-editor').innerHTML = '';
  closeOtherPanels('ann-panel');
  document.getElementById('ann-panel').classList.add('open');
}

export function closeAnnPanel() {
  document.getElementById('ann-panel').classList.remove('open');
  document.querySelectorAll('.hi-grp').forEach(g => g.classList.remove('selected'));
  S.selAnn = null;
}

function renderAnnColors() {
  const c = document.getElementById('ap-colors');
  c.innerHTML = '<div class="ap-colors-lbl">Highlight Color</div>';
  for (const cat of S.colorCats) {
    const d = document.createElement('div');
    d.className = 'apc-dot' + (S.selAnn?.hex_color === cat.hex_color ? ' sel' : '');
    d.style.background = cat.hex_color;
    d.title = cat.name;
    d.addEventListener('click', async () => {
      if (!S.selAnn) return;
      autosave('saving');
      S.selAnn.hex_color = cat.hex_color;
      await dbUpdateAnnColor(S.selAnn.id, cat.hex_color);
      clearAnnMark(S.selAnn.id);
      drawAnnotation(S.selAnn);
      renderAnnColors();
      autosave('saved');
      toast('Color updated');
    });
    c.appendChild(d);
  }
}

function updateTabBadges(ann) {
  if (!ann) return;
  const genCount = ann.notes.filter(n => getNoteType(n) === 'general').length;
  const caseCount = ann.notes.filter(n => getNoteType(n) === 'case').length;
  const bgGen = document.getElementById('badge-general');
  const bgCase = document.getElementById('badge-case');
  if (bgGen) bgGen.textContent = genCount;
  if (bgCase) bgCase.textContent = caseCount;
}

function updateEditorState() {
  const ed = document.getElementById('note-editor');
  const addBtn = document.getElementById('btn-add-note');
  if (activeNoteTab === 'case') {
    if (ed) ed.setAttribute('data-ph', 'Case Title / G.R. No. (e.g. Laurel v. Garcia), Ruling, Ratio…');
    if (addBtn) addBtn.textContent = 'Add Case Summary';
  } else {
    if (ed) ed.setAttribute('data-ph', 'Add a note, doctrine, citation…');
    if (addBtn) addBtn.textContent = 'Add Note';
  }
}

function renderNotes(ann) {
  const list = document.getElementById('ann-notes');
  list.innerHTML = '';
  updateTabBadges(ann);
  updateEditorState();

  const filtered = ann.notes.filter(n => getNoteType(n) === activeNoteTab);

  if (!filtered.length) {
    const emptyMsg = activeNoteTab === 'case'
      ? 'No case summaries yet — add a case digest or ruling below.'
      : 'No notes yet — add one below.';
    list.innerHTML = `<div class="note-empty">${emptyMsg}</div>`;
    return;
  }

  filtered.forEach((note, i) => {
    const card = document.createElement('div');
    const isCase = activeNoteTab === 'case';
    card.className = 'note-card' + (isCase ? ' case-card' : '');
    
    const cardTitle = isCase ? `⚖️ Case Summary ${i + 1}` : `📝 Note ${i + 1}`;
    const cleanBody = getNoteBody(note);

    card.innerHTML = `<div class="note-num">${cardTitle}</div><div class="note-body">${cleanBody}</div><div class="note-actions"><button class="note-act-btn">✏ Edit</button><button class="note-act-btn del">🗑 Delete</button></div>`;
    
    // Intercept PDF links
    card.querySelectorAll('[data-pdf-link]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const pdfId = link.getAttribute('data-pdf-link');
        const pdf = S.pdfs.find(p => p.id === pdfId);
        if (pdf) {
          import('./viewer.js').then(m => m.openPDFFromLibrary(pdf));
        } else {
          import('./ui.js').then(m => m.toast('PDF not found or deleted'));
        }
      });
    });

    card.querySelector('.note-act-btn').addEventListener('click', () => {
      S.editingNoteId = note.id;
      const modalTitle = document.getElementById('mo-edit-note-title');
      if (modalTitle) modalTitle.textContent = isCase ? 'Edit Case Summary' : 'Edit Note';
      document.getElementById('edit-note-ed').innerHTML = cleanBody;
      import('./ui.js').then(m => m.openModal('mo-edit-note'));
    });

    card.querySelector('.note-act-btn.del').addEventListener('click', async () => {
      autosave('saving');
      await dbDelNote(note.id);
      ann.notes = ann.notes.filter(n => n.id !== note.id);
      renderNotes(ann);
      autosave('saved');
      import('./ui.js').then(m => m.toast(isCase ? 'Case summary deleted' : 'Note deleted'));
    });

    list.appendChild(card);
  });
}

// ── Wire annotation panel buttons ──
export function initAnnPanel() {
  document.getElementById('ap-close').addEventListener('click', closeAnnPanel);

  // Tab switching
  document.querySelectorAll('.ap-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeNoteTab = btn.dataset.aptab;
      document.querySelectorAll('.ap-tab').forEach(b => b.classList.toggle('active', b === btn));
      if (S.selAnn) renderNotes(S.selAnn);
      else updateEditorState();
    });
  });

  document.getElementById('btn-del-hi').addEventListener('click', async () => {
    if (!S.selAnn) return;
    autosave('saving');
    await dbDelAnnotation(S.selAnn.id);
    S.annotations = S.annotations.filter(x => x.id !== S.selAnn.id);
    const trueId = S.selAnn.pdf_file_id;
    if (trueId) {
      S.annCounts[trueId] = Math.max(0, (S.annCounts[trueId] || 1) - 1);
      updateAnnBadge(trueId);
    }
    clearAnnMark(S.selAnn.id);
    closeAnnPanel();
    autosave('saved');
    toast('Highlight deleted');
  });

  // Add note / Case summary — with empty-editor shake (fixes bug #5)
  document.getElementById('btn-add-note').addEventListener('click', async () => {
    const ed   = document.getElementById('note-editor');
    const rawHtml = ed.innerHTML.trim();
    if (!rawHtml || rawHtml === '<br>' || !S.selAnn) {
      ed.classList.remove('shake');
      void ed.offsetWidth; // reflow to restart animation
      ed.classList.add('shake');
      return;
    }
    const htmlToSave = wrapNoteHtml(rawHtml, activeNoteTab);
    autosave('saving');
    const note = await dbCreateNote(S.selAnn.id, htmlToSave, S.selAnn.notes.length);
    S.selAnn.notes.push(note);
    ed.innerHTML = '';
    renderNotes(S.selAnn);
    autosave('saved');
    toast(activeNoteTab === 'case' ? 'Case summary added' : 'Note added');
  });

  // Save edited note / Case summary
  document.getElementById('save-edit-note').addEventListener('click', async () => {
    const rawHtml = document.getElementById('edit-note-ed').innerHTML.trim();
    if (!rawHtml) return;
    const note = S.selAnn?.notes.find(n => n.id === S.editingNoteId);
    const noteType = getNoteType(note);
    const htmlToSave = wrapNoteHtml(rawHtml, noteType);
    autosave('saving');
    await dbUpdateNote(S.editingNoteId, htmlToSave);
    if (note) { note.note_html = htmlToSave; renderNotes(S.selAnn); }
    closeModal('mo-edit-note');
    autosave('saved');
    toast(noteType === 'case' ? 'Case summary updated' : 'Note updated');
  });

  // Format buttons (add-note editor)
  document.querySelectorAll('.fmt-btn[data-cmd]').forEach(b => {
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      document.getElementById('note-editor').focus();
      document.execCommand(b.dataset.cmd, false, null);
    });
  });

  // Format buttons (edit-note editor)
  document.querySelectorAll('.fmt-btn[data-cmd2]').forEach(b => {
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      document.getElementById('edit-note-ed').focus();
      document.execCommand(b.dataset.cmd2, false, null);
    });
  });

  // PDF Linking
  let savedRange = null;
  let activeEditorId = null;

  const openPdfLink = (editorId) => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) savedRange = sel.getRangeAt(0);
    else savedRange = null;
    
    activeEditorId = editorId;
    import('./ui.js').then(m => m.openModal('mo-pdf-link'));
    renderPdfLinkList();
  };

  document.getElementById('btn-add-pdflink').addEventListener('mousedown', e => e.preventDefault());
  document.getElementById('btn-add-pdflink').addEventListener('click', () => openPdfLink('note-editor'));

  document.getElementById('btn-edit-pdflink').addEventListener('mousedown', e => e.preventDefault());
  document.getElementById('btn-edit-pdflink').addEventListener('click', () => openPdfLink('edit-note-ed'));

  function renderPdfLinkList() {
    const list = document.getElementById('pdf-link-list');
    const search = document.getElementById('pdf-link-search').value.toLowerCase();
    
    list.innerHTML = '';
    const filtered = S.pdfs.filter(p => p.name.toLowerCase().includes(search));
    
    if (filtered.length === 0) {
      list.innerHTML = '<div style="color:#888;padding:10px">No PDFs found.</div>';
      return;
    }
    
    filtered.forEach(pdf => {
      const div = document.createElement('div');
      div.style.padding = '8px 10px';
      div.style.cursor = 'pointer';
      div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      div.textContent = '📄 ' + pdf.name;
      
      div.addEventListener('mouseover', () => div.style.color = 'var(--gold)');
      div.addEventListener('mouseout', () => div.style.color = '');
      div.addEventListener('click', () => {
        import('./ui.js').then(m => m.closeModal('mo-pdf-link'));
        const ed = document.getElementById(activeEditorId);
        ed.focus();
        const sel = window.getSelection();
        let linkText = '📄 ' + pdf.name;
        
        if (savedRange) {
          sel.removeAllRanges();
          sel.addRange(savedRange);
          const selectedText = savedRange.toString().trim();
          if (selectedText.length > 0) {
            linkText = selectedText;
          }
        }
        
        const html = `<a href="#" data-pdf-link="${pdf.id}" contenteditable="false" style="color:var(--gold);text-decoration:underline;cursor:pointer">${linkText}</a>&nbsp;`;
        document.execCommand('insertHTML', false, html);
      });
      list.appendChild(div);
    });
  }
  document.getElementById('pdf-link-search').addEventListener('input', renderPdfLinkList);

  // Selection confirm/cancel (fixes bug #1 — was cut off in original)
  document.getElementById('sel-confirm').addEventListener('mousedown', e => e.preventDefault());
  document.getElementById('sel-confirm').addEventListener('click', () => {
    if (!S.pendingSel) return;
    window.getSelection()?.removeAllRanges();
    document.getElementById('sel-menu').classList.remove('open');
    createAnnotation(S.pendingSel.pageNum, S.pendingSel.rects, S.pendingSel.text, 'text');
    S.pendingSel = null;
  });
  document.getElementById('sel-cancel').addEventListener('click', () => {
    window.getSelection()?.removeAllRanges();
    document.getElementById('sel-menu').classList.remove('open');
    S.pendingSel = null;
  });

  // Auto-close selection menu when clicking outside
  document.addEventListener('mousedown', e => {
    const selMenu = document.getElementById('sel-menu');
    if (S.pendingSel && selMenu.classList.contains('open')) {
      if (!selMenu.contains(e.target)) {
        window.getSelection()?.removeAllRanges();
        selMenu.classList.remove('open');
        S.pendingSel = null;
      }
    }
  });
}
