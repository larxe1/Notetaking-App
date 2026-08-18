// ═══════════════════════════════════════════════
// MAIN — entry point, wires everything together
// ═══════════════════════════════════════════════
import { S }                  from './state.js';
import { dbLoad, dbLoadAnnCounts, dbCreateBookmark, dbDelBookmark, dbLoadLinks, dbSaveLinks } from './db.js';
import { initDriveBar }       from './drive.js';
import { renderLibrary, initLibraryModals, initLibrarySelection, initContextMenu } from './library.js';
import { renderColorDots, initColors } from './colors.js';
import { setMode }            from './viewer.js';
import { initAnnPanel }       from './annotate.js';
import { initSearch, openSearch, closeSearch } from './search.js';
import { initDrawControls, initPinchZoom } from './draw.js';
import {
  initModals, initSidebar, initZoom, initNavButtons,
  initKeyboard, exportAnnotations, toast, syncErr,
  openModal, closeModal, autosave
} from './ui.js';
import { initNotepad } from './notepad.js';
import { initDictionary } from './dictionary.js';
import { initTableContextMenu } from './tablepicker.js';
import { initDualView } from './dualview.js';
import { initRealtimeSync } from './sync.js';

// Global Error Boundary to prevent tab-freezing crashes
function setupGlobalErrorBoundary() {
  let errorCount = 0;
  window.addEventListener('error', (event) => {
    console.error('[Global Crash Boundary caught error]', event.error || event.message);
    errorCount++;
    if (errorCount <= 3) {
      document.querySelectorAll('#ann-panel, #notepad-panel, #dict-panel, #search-panel')
        .forEach(el => el.classList.remove('open'));
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[Global Crash Boundary caught unhandled promise]', event.reason);
  });
}

async function init() {
  // 1. Setup crash boundary and pre-flight reset
  setupGlobalErrorBoundary();
  document.querySelectorAll('#ann-panel, #notepad-panel, #dict-panel, #search-panel')
    .forEach(el => el.classList.remove('open'));

  // 2. Init Google Drive bar (guarded)
  try { initDriveBar(); } catch (e) { console.error('[Init] DriveBar error:', e); }

  // 3. Load data from Supabase (guarded)
  try {
    await dbLoad();
    await dbLoadAnnCounts();
  } catch (err) {
    console.error('[Init] Database load error:', err);
  }

  // 4. Render library (guarded)
  try { renderLibrary(); } catch (e) { console.error('[Init] Library render error:', e); }

  // 5. Active color (guarded)
  try {
    if (S.colorCats.length) S.activeColor = S.colorCats[0].hex_color;
    renderColorDots();
  } catch (e) { console.error('[Init] Colors render error:', e); }

  // 6. Wire all UI independently (a failure in one module never breaks the others)
  const safeInit = (fn, name) => {
    try { fn(); } catch (err) { console.error(`[Init] ${name} error:`, err); }
  };

  safeInit(initModals, 'Modals');
  
  const welcomeHTML = document.getElementById('canvas-scroll')?.innerHTML;
  document.getElementById('app-title')?.addEventListener('click', async () => {
    S.curPDF = null;
    const scroll = document.getElementById('canvas-scroll');
    if (scroll && welcomeHTML) scroll.innerHTML = welcomeHTML;
    
    // Reset view to Welcome (content-area visible, notepad/folder-doc hidden)
    document.getElementById('folder-doc-viewer').style.display = 'none';
    document.getElementById('notepad-panel').style.display = 'none';
    document.getElementById('content-area').style.display = 'flex';

    try {
      const { updateActivePDF } = await import('./viewer.js');
      updateActivePDF();
    } catch {}
  });

  safeInit(initSidebar, 'Sidebar');
  safeInit(initLibraryModals, 'LibraryModals');
  safeInit(initLibrarySelection, 'LibrarySelection');
  safeInit(initColors, 'Colors');
  safeInit(initAnnPanel, 'AnnPanel');
  safeInit(initSearch, 'Search');
  safeInit(initDrawControls, 'DrawControls');
  safeInit(initPinchZoom, 'PinchZoom');
  safeInit(initZoom, 'Zoom');
  safeInit(initNavButtons, 'NavButtons');
  safeInit(initNotepad, 'Notepad');
  safeInit(initTableContextMenu, 'TableContextMenu');
  safeInit(initDictionary, 'Dictionary');
  safeInit(initDualView, 'DualView');
  safeInit(initContextMenu, 'ContextMenu');
  safeInit(initCalendar, 'Calendar');
  safeInit(initLinks, 'Links');
  safeInit(initRealtimeSync, 'RealtimeSync');

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  );


  // Add custom bookmark
  document.getElementById('btn-add-bm').addEventListener('click', async () => {
    if (!S.curPDF || !S.curPage) return;
    const inp = document.getElementById('bm-title');
    const title = inp.value.trim() || `Page ${S.curPage}`;
    
    try {
      autosave('saving');
      const trueId = S.curPDF.linked_pdf_id || S.curPDF.id;
      await dbCreateBookmark(trueId, S.curPage, title);
      S.bookmarks.push({ pdf_id: trueId, page: S.curPage, title });
      S.bookmarks.sort((a, b) => a.page - b.page);
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
            div.addEventListener('click', async (e) => {
              e.stopPropagation(); // prevent click leaking to elements beneath the modal
              
              // Capture pdfDoc NOW before any awaits — prevents race condition if
              // another PDF is opened while this async handler is running
              const doc = S.pdfDoc;
              if (!doc) return;

              try {
                // Resolve destination: item.dest can be a string (named dest),
                // an array (explicit dest), or null (action-only item)
                let dest = item.dest;

                // Some PDFs store the destination inside an action object
                if (!dest && item.action?.dest) dest = item.action.dest;

                if (typeof dest === 'string') {
                  dest = await doc.getDestination(dest);
                }

                if (!Array.isArray(dest)) {
                  // No resolvable page destination — close and do nothing
                  closeModal('mo-toc');
                  return;
                }

                let pageIdx = -1;
                const ref = dest[0];
                if (typeof ref === 'object' && ref !== null) {
                  pageIdx = await doc.getPageIndex(ref);
                } else if (Number.isInteger(ref)) {
                  pageIdx = ref;
                }

                // Validate within bounds before navigating
                const page = pageIdx + 1;
                if (pageIdx >= 0 && page <= S.totalPages) {
                  closeModal('mo-toc');
                  import('./ui.js').then(m => m.jumpToPage(page));
                } else {
                  closeModal('mo-toc');
                }
              } catch (err) {
                console.warn('Failed to resolve PDF bookmark destination:', err);
                closeModal('mo-toc');
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

  // Settings & Export buttons
  document.getElementById('btn-settings')?.addEventListener('click', () => openModal('mo-settings'));
  document.getElementById('btn-export-settings')?.addEventListener('click', () => {
    closeModal('mo-settings');
    exportAnnotations();
  });
  document.getElementById('btn-open-keys')?.addEventListener('click', () => {
    closeModal('mo-settings');
    openModal('mo-keys');
  });
  document.getElementById('btn-export')?.addEventListener('click', exportAnnotations);

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

let curSubj = null;
function initCalendar() {
  document.addEventListener('click', e => {
    const item = e.target.closest('.cal-item');
    if (!item) return;
    const strong = item.querySelector('strong');
    if (!strong) return;
    
    curSubj = strong.textContent.trim();
    document.getElementById('mo-subj-notes-title').textContent = curSubj + ' Notes';
    const notes = localStorage.getItem('subj_notes_' + curSubj) || '';
    document.getElementById('subj-notes-ta').value = notes;
    openModal('mo-subj-notes');
  });

  // Dynamically set title on hover to show notes
  document.addEventListener('mouseover', e => {
    const item = e.target.closest('.cal-item');
    if (!item) return;
    const strong = item.querySelector('strong');
    if (!strong) return;
    const subj = strong.textContent.trim();
    const notes = localStorage.getItem('subj_notes_' + subj);
    if (notes) {
      // Limit notes preview length and escape quotes if needed, but native title handles raw strings fine
      item.title = notes.length > 500 ? notes.substring(0, 500) + '...' : notes;
    } else {
      item.title = 'Click to add notes';
    }
  });

  document.getElementById('save-subj-notes')?.addEventListener('click', () => {
    if (!curSubj) return;
    const notes = document.getElementById('subj-notes-ta').value;
    localStorage.setItem('subj_notes_' + curSubj, notes);
    closeModal('mo-subj-notes');
  });
}

async function initLinks() {
  const btnLinks = document.getElementById('btn-links');
  if (!btnLinks) return;
  
  // Migration + Load
  let links = await dbLoadLinks();
  const localLinks = JSON.parse(localStorage.getItem('law_school_links') || '[]');
  
  if (localLinks.length > 0) {
    // Merge local links if they aren't already in the db
    const existingUrls = new Set(links.map(l => l.url));
    let added = false;
    for (const l of localLinks) {
      if (!existingUrls.has(l.url)) {
        links.push(l);
        added = true;
      }
    }
    if (added) await dbSaveLinks(links);
    // Clear local cache to prevent re-merging
    localStorage.removeItem('law_school_links');
  }
  
  S.links = links;

  btnLinks.addEventListener('click', () => {
    renderLinks();
    openModal('mo-links');
  });

  document.getElementById('btn-add-link')?.addEventListener('click', async () => {
    const titleInp = document.getElementById('new-link-title');
    const urlInp = document.getElementById('new-link-url');
    const title = titleInp.value.trim();
    let url = urlInp.value.trim();
    if (!title || !url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    S.links.push({ id: Date.now().toString(), title, url });
    await dbSaveLinks(S.links);
    
    titleInp.value = '';
    urlInp.value = '';
    renderLinks();
  });
}

function renderLinks() {
  const list = document.getElementById('links-list');
  if (!list) return;
  list.innerHTML = '';
  if (!S.links || S.links.length === 0) {
    list.innerHTML = '<div style="color:var(--muted); font-size:12px; text-align:center; padding:10px">No links added yet.</div>';
    return;
  }
  S.links.forEach(l => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--navy); padding:8px 10px; border:1px solid rgba(255,255,255,0.05); border-radius:6px';
    d.innerHTML = `
      <a href="${l.url}" target="_blank" style="color:var(--gold); text-decoration:none; font-size:13px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1" title="${l.url}">${l.title}</a>
      <button class="btn-sec btn-del-link" data-id="${l.id}" style="padding:4px 8px; font-size:11px; margin-left:8px; flex-shrink:0">×</button>
    `;
    list.appendChild(d);
  });
  list.querySelectorAll('.btn-del-link').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      S.links = S.links.filter(x => x.id !== id);
      await dbSaveLinks(S.links);
      renderLinks();
    });
  });
}

init();
