// ═══════════════════════════════════════════════
// ANNOTATE — highlights, annotation panel, notes
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { toast, autosave, openModal, closeModal, closeOtherPanels } from './ui.js';
import {
  dbCreateAnnotation, dbUpdateAnnColor, dbDelAnnotation,
  dbCreateNote, dbUpdateNote, dbDelNote,
} from './db.js';
import { handlePaste, showTablePicker, insertBannerHeader } from './tablepicker.js';
import { openPdfLinkModal, insertWebLink } from './pdflink.js';

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
  let html = note.note_html;
  const match = html.match(/^<div\s+data-note-type=["'](?:case|general)["'][^>]*>([\s\S]*)<\/div>$/i);
  if (match) html = match[1];

  // Auto-clean any legacy corrupted markup (e.g. copied PDF highlight rects / canvas / hi-grp / absolute elements)
  if (html.includes('class="hr"') || html.includes('class="hi-grp"') || html.includes('class="ann-ov"') || html.includes('class="txt-layer"') || html.includes('position: absolute') || html.includes('position:absolute')) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('.hi-grp, .hr, .ann-ov, .txt-layer, .draw-canvas, canvas, .srch-ov, #sel-menu, #drag-ghost').forEach(el => el.remove());
    d.querySelectorAll('*').forEach(el => {
      if (el.style.position === 'absolute' || el.style.position === 'fixed') el.remove();
    });
    html = d.body.innerHTML;
  }

  // Ensure tables have containment styling
  if (html.includes('<table') && !html.includes('note-table')) {
    html = html.replace(/<table(?:\s+[^>]*)?>/gi, '<table class="note-table" style="width:100%; max-width:100%; border-collapse:collapse; margin:10px 0; table-layout:auto; word-break:break-word;">');
  }

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
    const genNotes = ann.notes.filter(n => getNoteType(n) === 'general');
    if (!genNotes.length) return;
    
    let html = '';
    const toShow = Math.min(genNotes.length, 3);
    for (let i = 0; i < toShow; i++) {
      if (i > 0) html += '<div style="border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0; padding-top: 6px;"></div>';
      html += getNoteBody(genNotes[i]);
    }
    
    if (genNotes.length > 3) {
      html += `<div style="border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0; padding-top: 6px; font-size: 0.9em; color: #b0aaa0; text-align: center; font-style: italic;">...and ${genNotes.length - 3} more notes (click to view)</div>`;
    } else if (genNotes.length > 1) {
      html += `<div style="border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0; padding-top: 6px; font-size: 0.9em; color: #b0aaa0; text-align: center; font-style: italic;">(click to manage notes)</div>`;
    }
    
    showTip(e, html);
  });
  grp.addEventListener('mouseleave', hideTip);
  grp.addEventListener('mousemove', moveTip);
  pg.annOv.appendChild(grp);
}

export function redrawAllAnnotations() {
  document.querySelectorAll('.ann-ov .hi-grp').forEach(el => el.remove());
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
  document.querySelectorAll('#add-note-area .fmt-btn').forEach(b => {
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      const ed = document.getElementById('note-editor');
      if (!ed) return;

      const cmd = b.dataset.cmd;
      let val = b.dataset.val || null;
      if (cmd === 'formatBlock' && val && !val.startsWith('<')) {
        val = `<${val}>`;
      }

      if (cmd === 'insertTable') {
        showTablePicker(b, ed);
      } else if (cmd === 'insertBanner') {
        insertBannerHeader(ed);
      } else if (b.id === 'btn-add-pdflink') {
        openPdfLinkModal(ed);
      } else if (b.id === 'btn-add-weblink') {
        insertWebLink(ed);
      } else if (cmd) {
        ed.focus();
        document.execCommand(cmd, false, val);
      }
    });
  });

  // Format buttons (edit-note editor)
  document.querySelectorAll('#mo-edit-note .fmt-btn').forEach(b => {
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      const ed = document.getElementById('edit-note-ed');
      if (!ed) return;

      const cmd = b.dataset.cmd2;
      let val = b.dataset.val2 || null;
      if (cmd === 'formatBlock' && val && !val.startsWith('<')) {
        val = `<${val}>`;
      }

      if (cmd === 'insertTable') {
        showTablePicker(b, ed);
      } else if (cmd === 'insertBanner') {
        insertBannerHeader(ed);
      } else if (b.id === 'btn-edit-pdflink') {
        openPdfLinkModal(ed);
      } else if (b.id === 'btn-edit-weblink') {
        insertWebLink(ed);
      } else if (cmd) {
        ed.focus();
        document.execCommand(cmd, false, val);
      }
    });
  });

  // Attach sanitized paste handling to note editors
  document.getElementById('note-editor')?.addEventListener('paste', handlePaste);
  document.getElementById('edit-note-ed')?.addEventListener('paste', handlePaste);

  document.getElementById('edit-note-ed')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById('save-edit-note')?.click();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const sel = window.getSelection();
      const isInsideList = sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('li');

      if (e.shiftKey) {
        document.execCommand('outdent');
      } else if (!sel || sel.isCollapsed) {
        if (isInsideList) {
          document.execCommand('indent');
        } else {
          document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
        }
      } else {
        document.execCommand('indent');
      }
    }
  });

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

  initAnnPanelResizer();
}

function initAnnPanelResizer() {
  const panel = document.getElementById('ann-panel');
  const handle = document.getElementById('ap-resize-handle');
  if (!handle || !panel) return;

  // Restore saved width from localStorage
  const savedWidth = localStorage.getItem('ann_panel_width');
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
    localStorage.setItem('ann_panel_width', panel.offsetWidth);
  };

  handle.addEventListener('pointerup', stopResize);
  handle.addEventListener('pointercancel', stopResize);
}
