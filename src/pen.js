// ═══════════════════════════════════════════════
// PEN — Apple Pencil / stylus input layer (modular add-on)
//
// Self-contained. Loaded with a dynamic import from main.js inside try/catch,
// so a failure here can never break app startup.
//
//  • Manual toggle button ("✒ Pen") in the toolbar. Persisted in localStorage.
//  • Text mode + Pen ON: drag the Pencil along text like a highlighter pen; the words
//    under the stroke are highlighted (snapped to whole words) and saved through the
//    EXISTING createAnnotation() — DB / sync / export are untouched.
//  • Draw mode + Pen ON: only the Pencil draws (draw.js checks S.penMode); fingers scroll.
//  • Palm rejection: while the Pencil is down (and for a short moment after) other
//    touches on the PDF area are ignored so a resting hand can't scroll/select.
//  • Fingers are never touched when Pen is OFF, and Box mode is never touched.
//
// Kill switches: toolbar toggle, or open the app with ?nopen=1.
// Desktop testing: localStorage.setItem('pen_debug_mouse','1') makes the mouse act as a pen.
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { toast } from './ui.js';
import { safeStorageGet, safeStorageSet } from './storage.js';

const LS_KEY       = 'pen_mode';
const BAND_PX      = 16;     // live preview thickness of the highlighter band
const TAP_MAX_MOVE = 8;      // px  — shorter than this (and quick) = a tap, not a stroke
const TAP_MAX_MS   = 450;
const PALM_MS      = 250;    // ignore new finger touches this long after the Pencil lifts
const STUCK_MS     = 15000;  // safety: never keep touches blocked longer than this
const MAX_ERRORS   = 3;

let _enabled   = false;
let _installed = false;
let _errors    = 0;
let _btn       = null;
let _overlay   = null;
let _ctx       = null;
let _stroke    = null;   // { id, pn, pts:[{x,y}], t0 }
let _penDown   = false;
let _penDownTs = 0;
let _lastPenUp = 0;
let _raf       = 0;
let _scroll    = null;

const debugMouse = () => safeStorageGet('pen_debug_mouse', '0') === '1';
const isPenEvent = e => e.pointerType === 'pen' || (e.pointerType === 'mouse' && debugMouse());

// ───────────────────────── init / toggle ─────────────────────────
export function initPen() {
  try {
    if (_installed) return;
    if (new URLSearchParams(location.search).get('nopen') === '1') return;
    _scroll = document.getElementById('canvas-scroll');
    const toolbar = document.getElementById('toolbar');
    if (!_scroll || !toolbar) return;
    _installed = true;
    injectStyle();
    buildButton(toolbar);
    attach(_scroll);
    if (safeStorageGet(LS_KEY, '0') === '1') setPenMode(true, { silent: true });
  } catch (e) {
    console.warn('[Pen] init failed — pen support disabled:', e);
  }
}

export function isPenMode() { return _enabled; }

export function setPenMode(on, { silent = false } = {}) {
  _enabled = !!on;
  S.penMode = _enabled;                       // read by draw.js (pen-only drawing + pressure)
  if (_enabled) _errors = 0;
  document.body.classList.toggle('pen-on', _enabled);
  _btn?.classList.toggle('active', _enabled);
  _btn?.setAttribute('aria-pressed', String(_enabled));
  safeStorageSet(LS_KEY, _enabled ? '1' : '0');
  if (!_enabled) cancelStroke();
  if (!silent) {
    toast(_enabled
      ? '✒ Pen mode ON — Pencil highlights/draws, fingers scroll & zoom'
      : '✒ Pen mode OFF');
  }
}

function injectStyle() {
  if (document.getElementById('pen-style')) return;
  const st = document.createElement('style');
  st.id = 'pen-style';
  st.textContent = `
    #pen-toggle { white-space: nowrap; }
    #pen-toggle.active { background: var(--gold-bg); color: var(--gold); border-color: var(--gold); }
    #pen-overlay { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 9000; mix-blend-mode: multiply; }
    body.pen-on #canvas-scroll { -webkit-touch-callout: none; }
  `;
  document.head.appendChild(st);
}

function buildButton(toolbar) {
  _btn = document.createElement('button');
  _btn.id = 'pen-toggle';
  _btn.type = 'button';
  _btn.className = 'tb-btn';
  _btn.title = 'Pen mode: use Apple Pencil to highlight text / draw. Fingers keep scrolling and zooming.';
  _btn.innerHTML = '✒ <span>Pen</span>';
  const anchor = document.getElementById('mode-tog');
  if (anchor?.parentNode) anchor.parentNode.insertBefore(_btn, anchor.nextSibling);
  else toolbar.appendChild(_btn);
  _btn.addEventListener('click', () => setPenMode(!_enabled));
}

// ───────────────────────── error guard ─────────────────────────
function guard(fn) {
  return function (...args) {
    try { return fn.apply(this, args); }
    catch (err) {
      _errors++;
      console.error('[Pen] handler error', err);
      cancelStroke();
      if (_errors >= MAX_ERRORS && _enabled) {
        setPenMode(false, { silent: true });
        toast('✒ Pen mode turned off after repeated errors — app is unaffected.');
      }
    }
  };
}

// ───────────────────────── event wiring ─────────────────────────
function attach(scroll) {
  const cap = { capture: true };
  scroll.addEventListener('pointerdown',   guard(onPointerDown), cap);
  scroll.addEventListener('pointermove',   guard(onPointerMove), cap);
  scroll.addEventListener('pointerup',     guard(onPointerUp),   cap);
  scroll.addEventListener('pointercancel', guard(onPointerCancel), cap);
  // Non-passive touch listeners so we can stop the page scrolling for Pencil touches only.
  scroll.addEventListener('touchstart', guard(onTouchGuard), { capture: true, passive: false });
  scroll.addEventListener('touchmove',  guard(onTouchGuard), { capture: true, passive: false });
  // No native text selection / callout while the Pencil is down.
  document.addEventListener('selectstart', e => { if (_enabled && _penDown) e.preventDefault(); }, true);
  scroll.addEventListener('contextmenu',   e => { if (_enabled && _penDown) e.preventDefault(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelStroke(); });
  window.addEventListener('blur', cancelStroke);
}

function penActiveForMode() { return _enabled && S.mode !== 'box'; }

function onPointerDown(e) {
  if (!penActiveForMode() || !isPenEvent(e)) return;

  // Draw mode: draw.js does the drawing. We only note "pen is down" so touches are blocked.
  if (S.mode === 'draw') { markPenDown(); return; }

  // Text mode: begin a highlighter stroke if the Pencil landed on a rendered page.
  if (S.mode !== 'text') return;
  const pn = pageAt(e.clientX, e.clientY);
  if (pn == null) return;                    // not on a page → let it scroll normally

  e.preventDefault();
  markPenDown();
  _stroke = { id: e.pointerId, pn, pts: [{ x: e.clientX, y: e.clientY }], t0: performance.now() };
  try { _scroll.setPointerCapture(e.pointerId); } catch {}
  window.getSelection()?.removeAllRanges();
  ensureOverlay();
  schedulePreview();
}

function onPointerMove(e) {
  if (!_stroke || e.pointerId !== _stroke.id) return;
  e.preventDefault();
  let list = [];
  if (typeof e.getCoalescedEvents === 'function') { try { list = e.getCoalescedEvents(); } catch {} }
  if (!list.length) list = [e];
  for (const ev of list) _stroke.pts.push({ x: ev.clientX, y: ev.clientY });
  schedulePreview();
}

function onPointerUp(e) {
  if (isPenEvent(e)) { _penDown = false; _lastPenUp = Date.now(); }
  if (!_stroke || e.pointerId !== _stroke.id) return;
  const st = _stroke;
  _stroke = null;
  st.pts.push({ x: e.clientX, y: e.clientY });
  hideOverlay();
  try { _scroll.releasePointerCapture(e.pointerId); } catch {}
  window.getSelection()?.removeAllRanges();
  finishStroke(st);
}

function onPointerCancel(e) {
  if (isPenEvent(e)) { _penDown = false; _lastPenUp = Date.now(); }
  if (_stroke && e.pointerId === _stroke.id) cancelStroke();
}

// Block page scroll / selection for Pencil touches + palm rejection.
function onTouchGuard(e) {
  if (!penActiveForMode()) return;
  if (_penDown && Date.now() - _penDownTs > STUCK_MS) _penDown = false;   // safety release

  let stylus = false;
  for (const t of e.changedTouches) if (t.touchType === 'stylus') { stylus = true; break; }

  const palmWindow = e.type === 'touchstart' && (Date.now() - _lastPenUp) < PALM_MS;
  if ((stylus || _penDown || palmWindow) && e.cancelable) {
    e.preventDefault();                       // stops scroll + native selection for these touches
  }
}

function markPenDown() { _penDown = true; _penDownTs = Date.now(); }

function cancelStroke() {
  _stroke = null;
  _penDown = false;
  hideOverlay();
}

// ───────────────────────── live preview overlay ─────────────────────────
function ensureOverlay() {
  if (!_overlay) {
    _overlay = document.createElement('canvas');
    _overlay.id = 'pen-overlay';
    document.body.appendChild(_overlay);
    _ctx = _overlay.getContext('2d');
  }
  const dpr = window.devicePixelRatio || 1;
  _overlay.width  = Math.round(window.innerWidth  * dpr);
  _overlay.height = Math.round(window.innerHeight * dpr);
  _overlay.style.width  = window.innerWidth  + 'px';
  _overlay.style.height = window.innerHeight + 'px';
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _overlay.style.display = 'block';
}

function hideOverlay() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  if (_overlay) { _ctx.clearRect(0, 0, _overlay.width, _overlay.height); _overlay.style.display = 'none'; }
}

function schedulePreview() {
  if (_raf) return;
  _raf = requestAnimationFrame(() => {
    _raf = 0;
    if (!_stroke || !_ctx) return;
    const pts = _stroke.pts;
    _ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    _ctx.lineCap = 'round';
    _ctx.lineJoin = 'round';
    _ctx.lineWidth = BAND_PX;
    _ctx.strokeStyle = rgba(S.activeColor, 0.45);
    _ctx.beginPath();
    _ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) _ctx.lineTo(pts[i].x, pts[i].y);
    if (pts.length === 1) _ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    _ctx.stroke();
  });
}

function rgba(hex, a) {
  let h = String(hex || '').trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return `rgba(201,168,76,${a})`;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ───────────────────────── stroke → highlight ─────────────────────────
function pageAt(x, y) {
  for (const k of Object.keys(S.pages || {})) {
    const pg = S.pages[k];
    if (!pg?.wrap || !pg.rendered || !pg.txtLayer) continue;
    const r = pg.wrap.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return parseInt(k, 10);
  }
  return null;
}

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}

function finishStroke(st) {
  const dist = pathLength(st.pts);
  const dur  = performance.now() - st.t0;
  if (dist < TAP_MAX_MOVE && dur < TAP_MAX_MS) { handleTap(st); return; }

  const res = computeHighlight(st);
  if (!res) { toast('✒ No text under that stroke'); return; }
  import('./annotate.js')
    .then(({ createAnnotation }) => createAnnotation(st.pn, res.rects, res.text, 'text'))
    .catch(err => { console.error('[Pen] createAnnotation failed', err); toast('Highlight failed — try again'); });
}

// Tap an existing highlight with the Pencil → open it (same as clicking it).
function handleTap(st) {
  const pg = S.pages[st.pn];
  if (!pg?.wrap) return;
  const wr = pg.wrap.getBoundingClientRect();
  const x = st.pts[0].x - wr.left, y = st.pts[0].y - wr.top;
  const hit = (S.annotations || []).filter(a => a.page === st.pn &&
    (a.rects || []).some(r => x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - 2 && y <= r.y + r.h + 2)).pop();
  if (hit) pg.annOv?.querySelector(`[data-id="${hit.id}"]`)?.click();
}

function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  return out;
}

const isWs = c => c === undefined || /\s/.test(c);

function computeHighlight(st) {
  const pg = S.pages[st.pn];
  if (!pg?.txtLayer || !pg.wrap) return null;
  const wr = pg.wrap.getBoundingClientRect();

  // Geometry of every text span on the page (read once per stroke)
  const geo = [];
  for (const el of pg.txtLayer.children) {
    if (el.tagName !== 'SPAN') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) continue;
    geo.push({ el, l: r.left, r: r.right, t: r.top, b: r.bottom, cy: (r.top + r.bottom) / 2, h: r.height });
  }
  if (!geo.length) return null;

  // Assign every stroke sample to the single nearest text line it passes over
  const cover = new Map();   // geo index -> { min, max } (screen x extent of the stroke on that span)
  for (const p of resample(st.pts, 3)) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < geo.length; i++) {
      const g = geo[i];
      if (p.x < g.l - 2 || p.x > g.r + 2) continue;
      const d = Math.abs(p.y - g.cy);
      if (d <= g.h * 0.75 && d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) continue;
    const c = cover.get(best);
    if (c) { if (p.x < c.min) c.min = p.x; if (p.x > c.max) c.max = p.x; }
    else cover.set(best, { min: p.x, max: p.x });
  }
  if (!cover.size) return null;

  // Convert each covered span into a word-snapped rectangle
  const pieces = [];
  const range = document.createRange();
  for (const [i, c] of cover) {
    const g = geo[i];
    const node = g.el.firstChild;
    const rotated = !!g.el.style.transform;

    if (!node || node.nodeType !== 3 || rotated) {
      pieces.push({ cy: g.cy, x: g.l, text: g.el.textContent || '',
        rect: { x: g.l - wr.left, y: g.t - wr.top, w: g.r - g.l, h: g.h } });
      continue;
    }

    const str = node.data, n = str.length;
    if (!n) continue;
    const charAt = x => {
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        range.setStart(node, mid); range.setEnd(node, mid + 1);
        if (x > range.getBoundingClientRect().right) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    let i0 = charAt(c.min), i1 = charAt(c.max);
    if (i1 < i0) [i0, i1] = [i1, i0];
    while (i0 < i1 && isWs(str[i0])) i0++;                    // trim spaces inside the stroke
    while (i1 > i0 && isWs(str[i1])) i1--;
    if (isWs(str[i0])) continue;                              // only whitespace
    while (i0 > 0 && !isWs(str[i0 - 1])) i0--;                // snap out to whole words
    while (i1 < n - 1 && !isWs(str[i1 + 1])) i1++;

    range.setStart(node, i0); range.setEnd(node, i1 + 1);
    const rr = range.getBoundingClientRect();
    if (rr.width < 1 || rr.height < 1) continue;
    pieces.push({ cy: g.cy, x: rr.left, text: str.slice(i0, i1 + 1),
      rect: { x: rr.left - wr.left, y: rr.top - wr.top, w: rr.width, h: rr.height } });
  }
  if (!pieces.length) return null;

  // Reading order: top→bottom by line, then left→right
  pieces.sort((a, b) => (Math.abs(a.cy - b.cy) > Math.min(a.rect.h, b.rect.h) * 0.5) ? a.cy - b.cy : a.x - b.x);

  // Merge rects on the same line (same rule as text-selection highlights in viewer.js)
  const merged = [{ ...pieces[0].rect }];
  for (let k = 1; k < pieces.length; k++) {
    const cur = pieces[k].rect, prev = merged[merged.length - 1];
    const over = Math.max(0, Math.min(prev.y + prev.h, cur.y + cur.h) - Math.max(prev.y, cur.y));
    if (over > 0 && cur.x <= prev.x + prev.w + 24) {
      const right  = Math.max(prev.x + prev.w, cur.x + cur.w);
      const bottom = Math.max(prev.y + prev.h, cur.y + cur.h);
      prev.x = Math.min(prev.x, cur.x);
      prev.y = Math.min(prev.y, cur.y);
      prev.w = right - prev.x;
      prev.h = bottom - prev.y;
    } else merged.push({ ...cur });
  }

  const text = pieces.map(p => p.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return { rects: merged, text: text || '(highlighted text)' };
}
