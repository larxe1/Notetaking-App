// ═══════════════════════════════════════════════
// MAIN — entry point, wires everything together
// ═══════════════════════════════════════════════
import { S }                  from './state.js';
import { dbLoad, dbLoadAnnCounts } from './db.js';
import { initDriveBar }       from './drive.js';
import { renderLibrary, initLibraryModals } from './library.js';
import { renderColorDots, initColors } from './colors.js';
import { setMode }            from './viewer.js';
import { initAnnPanel }       from './annotate.js';
import { initSearch, openSearch, closeSearch } from './search.js';
import { initDrawControls, initPinchZoom } from './draw.js';
import {
  initModals, initSidebar, initZoom, initNavButtons,
  initKeyboard, exportAnnotations, toast, syncErr,
} from './ui.js';

async function init() {
  // Init Google Drive bar
  initDriveBar();

  // Load data from Supabase
  try {
    await dbLoad();
    await dbLoadAnnCounts();
  } catch {
    // dbLoad already called syncErr — just stop init (fixes bug #12)
    return;
  }

  // Render library
  renderLibrary();

  // Set initial active color from first category
  if (S.colorCats.length) S.activeColor = S.colorCats[0].hex_color;
  renderColorDots();

  // Wire all UI
  initModals();
  initSidebar();
  initLibraryModals();
  initColors();
  initAnnPanel();
  initSearch();
  initDrawControls();
  initPinchZoom();
  initZoom();
  initNavButtons();

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  );

  // Export button
  document.getElementById('btn-export').addEventListener('click', exportAnnotations);

  // Keyboard shortcuts (with deps injected)
  initKeyboard({
    setMode,
    openSearch,
    closeSearch,
    closeAnnPanel: () => import('./annotate.js').then(m => m.closeAnnPanel()),
  });

  // Hide recent wrap initially (no recents yet)
  document.getElementById('recent-wrap').style.display = 'none';
}

init();
