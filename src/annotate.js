// ═══════════════════════════════════════════════
// ANNOTATE — highlights, annotation panel, notes
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { toast, autosave, openModal, closeModal } from './ui.js';
import {
  dbCreateAnnotation, dbUpdateAnnColor, dbDelAnnotation,
  dbCreateNote, dbUpdateNote, dbDelNote,
} from './db.js';

// ── Create annotation (text or box) ──
export async function createAnnotation(pageNum, rects, text, mode_) {
  if (!S.curPDF) return;
  const ann = {
    id: 'ann_' + Date.now(),
    pdf_file_id: S.curPDF.id,
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
    S.annCounts[S.curPDF.id] = (S.annCounts[S.curPDF.id] || 0) + 1;
    updateAnnBadge(S.curPDF.id);
    drawAnnotation(ann);
    autosave('saved');
    toast('Highlight saved');
  } catch (e) {
    autosave('err');
    toast('Save failed — check connection');
  }
}

// ── Draw annotation overlay ──
export function drawAnnotation(ann) {
  const pg = S.pages[ann.page]; if (!pg) return;
  pg.annOv.querySelector(`[data-id="${ann.id}"]`)?.remove();

  const grp = document.createElement('div');
  grp.className  = 'hi-grp';
  grp.dataset.id = ann.id;

  for (const r of ann.rects) {
    const d = document.createElement('div');
    d.className = 'hr';
    d.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${ann.hex_color}44;border-bottom:2px solid ${ann.hex_color}`;
    grp.appendChild(d);
  }
  grp.addEventListener('click', e => { e.stopPropagation(); openAnnPanel(ann); });
  grp.addEventListener('mouseenter', e => {
    if (!ann.notes.length) return;
    showTip(e, ann.notes.length === 1
      ? ann.notes[0].note_html
      : `<b>${ann.notes.length} notes</b> — click to view`);
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

function renderNotes(ann) {
  const list = document.getElementById('ann-notes');
  list.innerHTML = '';
  if (!ann.notes.length) {
    list.innerHTML = '<div class="note-empty">No notes yet — add one below.</div>';
    return;
  }
  ann.notes.forEach((note, i) => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `<div class="note-num">Note ${i + 1}</div><div class="note-body">${note.note_html}</div><div class="note-actions"><button class="note-act-btn">✏ Edit</button><button class="note-act-btn del">🗑 Delete</button></div>`;
    card.querySelector('.note-act-btn').addEventListener('click', () => {
      S.editingNoteId = note.id;
      document.getElementById('edit-note-ed').innerHTML = note.note_html;
      openModal('mo-edit-note');
    });
    card.querySelector('.note-act-btn.del').addEventListener('click', async () => {
      autosave('saving');
      await dbDelNote(note.id);
      ann.notes = ann.notes.filter(n => n.id !== note.id);
      S.annCounts[S.curPDF?.id] = Math.max(0, (S.annCounts[S.curPDF?.id] || 1) - 0); // notes don't affect ann count
      renderNotes(ann);
      autosave('saved');
      toast('Note deleted');
    });
    list.appendChild(card);
  });
}

// ── Wire annotation panel buttons ──
export function initAnnPanel() {
  document.getElementById('ap-close').addEventListener('click', closeAnnPanel);

  document.getElementById('btn-del-hi').addEventListener('click', async () => {
    if (!S.selAnn) return;
    autosave('saving');
    await dbDelAnnotation(S.selAnn.id);
    clearAnnMark(S.selAnn.id);
    // Update badge
    S.annCounts[S.curPDF?.id] = Math.max(0, (S.annCounts[S.curPDF?.id] || 1) - 1);
    updateAnnBadge(S.curPDF?.id);
    closeAnnPanel();
    autosave('saved');
    toast('Highlight deleted');
  });

  // Add note — with empty-editor shake (fixes bug #5)
  document.getElementById('btn-add-note').addEventListener('click', async () => {
    const ed   = document.getElementById('note-editor');
    const html = ed.innerHTML.trim();
    if (!html || html === '<br>' || !S.selAnn) {
      ed.classList.remove('shake');
      void ed.offsetWidth; // reflow to restart animation
      ed.classList.add('shake');
      return;
    }
    autosave('saving');
    const note = await dbCreateNote(S.selAnn.id, html, S.selAnn.notes.length);
    S.selAnn.notes.push(note);
    ed.innerHTML = '';
    renderNotes(S.selAnn);
    autosave('saved');
    toast('Note added');
  });

  // Save edited note
  document.getElementById('save-edit-note').addEventListener('click', async () => {
    const html = document.getElementById('edit-note-ed').innerHTML.trim();
    if (!html) return;
    autosave('saving');
    await dbUpdateNote(S.editingNoteId, html);
    const note = S.selAnn?.notes.find(n => n.id === S.editingNoteId);
    if (note) { note.note_html = html; renderNotes(S.selAnn); }
    closeModal('mo-edit-note');
    autosave('saved');
    toast('Note updated');
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
}
