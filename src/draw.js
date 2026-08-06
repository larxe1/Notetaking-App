// ═══════════════════════════════════════════════
// DRAW — freehand drawing on canvas
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { autosave, toast } from './ui.js';
import { dbSaveDrawings } from './db.js';

export function setupDrawListeners(canvas, pageNum) {
  function getPt(e) {
    const r  = canvas.getBoundingClientRect();
    const sx = canvas.width  / r.width;
    const sy = canvas.height / r.height;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
  }

  canvas.addEventListener('pointerdown', e => {
    if (S.mode !== 'draw') return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = getPt(e);
    S.curPts = [[x / canvas.width, y / canvas.height]];
    S.isDrawing = true;
  });

  canvas.addEventListener('pointermove', e => {
    if (!S.isDrawing || S.mode !== 'draw') return;
    e.preventDefault();
    const [x, y] = getPt(e);
    S.curPts.push([x / canvas.width, y / canvas.height]);
    renderCanvas(canvas, [
      ...(S.drawData[pageNum] || []),
      { points: S.curPts, color: S.activeColor, width: S.drawWidth },
    ]);
  });

  const onEnd = async () => {
    if (!S.isDrawing) return;
    S.isDrawing = false;
    if (S.curPts.length >= 2) {
      if (!S.drawData[pageNum]) S.drawData[pageNum] = [];
      S.drawData[pageNum].push({ points: S.curPts, color: S.activeColor, width: S.drawWidth });
      if (S.curPDF) {
        autosave('saving');
        try {
          await dbSaveDrawings(S.curPDF.id, pageNum, S.drawData[pageNum]);
          autosave('saved');
        } catch { autosave('err'); }
      }
    }
    S.curPts = [];
  };

  canvas.addEventListener('pointerup',     onEnd);
  canvas.addEventListener('pointercancel', onEnd);
}

export function renderCanvas(canvas, strokes) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) {
    if (!s.points || s.points.length < 2) continue;
    const pts = s.points.map(([px, py]) => [px * canvas.width, py * canvas.height]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.strokeStyle = s.color  || '#c9a84c';
    ctx.lineWidth   = s.width  || 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
  }
}

export function redrawAllDrawings() {
  for (const [pn, pg] of Object.entries(S.pages)) {
    renderCanvas(pg.drawCanvas, S.drawData[parseInt(pn)] || []);
  }
}

export function initDrawControls() {
  document.getElementById('btn-undo').addEventListener('click', async () => {
    if (!S.curPDF) return;
    const pg = S.curPage;
    if (!S.drawData[pg]?.length) return;
    S.drawData[pg].pop();
    const c = S.pages[pg]?.drawCanvas;
    if (c) renderCanvas(c, S.drawData[pg]);
    autosave('saving');
    await dbSaveDrawings(S.curPDF.id, pg, S.drawData[pg]);
    autosave('saved');
    toast('Undone');
  });

  document.getElementById('btn-clear').addEventListener('click', async () => {
    if (!S.curPDF) return;
    const pg = S.curPage;
    S.drawData[pg] = [];
    const c = S.pages[pg]?.drawCanvas;
    if (c) renderCanvas(c, []);
    autosave('saving');
    await dbSaveDrawings(S.curPDF.id, pg, []);
    autosave('saved');
    toast('Drawing cleared');
  });

  document.querySelectorAll('.dw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      S.drawWidth = parseInt(btn.dataset.w);
      document.querySelectorAll('.dw-btn').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
    });
  });
}

// ── Pinch zoom ──
export function initPinchZoom() {
  let pinchD = null, pinchS = null;
  const sc = document.getElementById('canvas-scroll');
  sc.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinchD = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchS = S.scale;
    }
  }, { passive: true });

  sc.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchD) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      S.scale = Math.max(0.5, Math.min(3, Math.round(pinchS * dist / pinchD * 4) / 4));
      document.getElementById('zoom-lbl').textContent = Math.round(S.scale / 1.5 * 100) + '%';
    }
  }, { passive: false });

  sc.addEventListener('touchend', async e => {
    if (pinchD && e.touches.length < 2) {
      pinchD = null;
      if (S.pdfDoc) {
        const { reRenderAll } = await import('./viewer.js');
        reRenderAll();
      }
    }
  }, { passive: true });
}
