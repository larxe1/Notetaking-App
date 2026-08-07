// ═══════════════════════════════════════════════
// MAIN — entry point, wires everything together
// ═══════════════════════════════════════════════
import { S }                  from './state.js';
import { dbLoad, dbLoadAnnCounts, dbCreateBookmark, dbDelBookmark } from './db.js';
import { initDriveBar }       from './drive.js';
import { renderLibrary, initLibraryModals, initLibrarySelection } from './library.js';
import { renderColorDots, initColors } from './colors.js';
import { setMode }            from './viewer.js';
import { initAnnPanel }       from './annotate.js';
import { initSearch, openSearch, closeSearch } from './search.js';
import { initDrawControls, initPinchZoom } from './draw.js';
import {
  initModals, initSidebar, initZoom, initNavButtons,
  initKeyboard, exportAnnotations, toast, syncErr,
  openModal, closeModal
} from './ui.js';
import { initNotepad } from './notepad.js';

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
  initLibrarySelection();
  initColors();
  initAnnPanel();
  initSearch();
  initDrawControls();
  initPinchZoom();
  initZoom();
  initNavButtons();
  initNotepad();

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  );

  // Bookmark Start Page
  document.getElementById('btn-set-start').addEventListener('click', () => {
    if (!S.curPDF || !S.curPage) return;
    localStorage.setItem('bookmark_' + S.curPDF.id, S.curPage);
    toast('Start page set to ' + S.curPage);
  });

  // Add custom bookmark
  document.getElementById('btn-add-bm').addEventListener('click', async () => {
    if (!S.curPDF || !S.curPage) return;
    const inp = document.getElementById('bm-title');
    const title = inp.value.trim() || `Page ${S.curPage}`;
    
    try {
      await dbCreateBookmark(S.curPDF.id, S.curPage, title);
      inp.value = '';
      // Re-render TOC
      document.getElementById('btn-toc').click();
    } catch (e) {
      console.error('Bookmark Error:', e);
      alert('Supabase Error: ' + (e.message || JSON.stringify(e)));
      toast('Failed to add bookmark.');
    }
  });

  document.getElementById('bm-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-add-bm').click();
  });

  // Table of Contents
  document.getElementById('btn-toc').addEventListener('click', async () => {
    if (!S.pdfDoc) return;
    openModal('mo-toc');
    const list = document.getElementById('toc-list');
    list.innerHTML = '<div style="color:#888;font-style:italic;padding:10px">Loading contents...</div>';
    
    try {
      const outline = await S.pdfDoc.getOutline();
      list.innerHTML = '';
      
      // 1. Render custom bookmarks
      if (S.bookmarks && S.bookmarks.length > 0) {
        const custHeader = document.createElement('div');
        custHeader.style.padding = '10px 10px 4px';
        custHeader.style.color = 'var(--gold)';
        custHeader.style.fontSize = '11px';
        custHeader.style.textTransform = 'uppercase';
        custHeader.style.fontWeight = 'bold';
        custHeader.textContent = 'Custom Bookmarks';
        list.appendChild(custHeader);

        S.bookmarks.forEach(bm => {
          const div = document.createElement('div');
          div.style.display = 'flex';
          div.style.justifyContent = 'space-between';
          div.style.alignItems = 'center';
          div.style.padding = '8px 10px';
          div.style.cursor = 'pointer';
          div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
          
          const label = document.createElement('div');
          label.textContent = `[Pg ${bm.page}] ${bm.title}`;
          label.style.fontSize = '14px';
          label.style.flex = '1';
          label.addEventListener('click', () => {
            closeModal('mo-toc');
            import('./ui.js').then(m => m.jumpToPage(bm.page));
          });
          
          const del = document.createElement('div');
          del.textContent = '✕';
          del.style.color = '#888';
          del.style.fontSize = '12px';
          del.style.padding = '0 4px';
          del.addEventListener('click', async (e) => {
            e.stopPropagation();
            await dbDelBookmark(bm.id);
            document.getElementById('btn-toc').click();
          });
          
          div.appendChild(label);
          div.appendChild(del);
          list.appendChild(div);
        });
      }

      // 2. Render built-in TOC
      if (outline && outline.length > 0) {
        const natHeader = document.createElement('div');
        natHeader.style.padding = '16px 10px 4px';
        natHeader.style.color = '#888';
        natHeader.style.fontSize = '11px';
        natHeader.style.textTransform = 'uppercase';
        natHeader.style.fontWeight = 'bold';
        natHeader.textContent = 'PDF Bookmarks';
        list.appendChild(natHeader);

        const renderToc = (items, depth = 0) => {
          items.forEach(item => {
            const div = document.createElement('div');
            div.style.paddingLeft = (10 + depth * 16) + 'px';
            div.style.paddingTop = '8px';
            div.style.paddingBottom = '8px';
            div.style.cursor = 'pointer';
            div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
            div.style.fontSize = '14px';
            div.textContent = item.title;
            
            div.addEventListener('mouseover', () => div.style.color = 'var(--gold)');
            div.addEventListener('mouseout', () => div.style.color = '');
            div.addEventListener('click', async () => {
              closeModal('mo-toc');
              let dest = item.dest;
              if (typeof dest === 'string') dest = await S.pdfDoc.getDestination(dest);
              if (dest) {
                const ref = dest[0];
                const pageIdx = await S.pdfDoc.getPageIndex(ref);
                import('./ui.js').then(m => m.jumpToPage(pageIdx + 1));
              }
            });
            
            list.appendChild(div);
            if (item.items && item.items.length) {
              renderToc(item.items, depth + 1);
            }
          });
        };
        renderToc(outline);
      } else if (!S.bookmarks || S.bookmarks.length === 0) {
        list.innerHTML = '<div style="color:#888;padding:10px">No bookmarks yet. Add one above!</div>';
      }
    } catch (e) {
      list.innerHTML = '<div style="color:red;padding:10px">Failed to load contents.</div>';
      console.error(e);
    }
  });

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
