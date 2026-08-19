import { dbSearchDictionary, dbSaveDictionary } from './db.js';
import { closeOtherPanels } from './ui.js';

let searchTimer = null;
let currentTerm = '';

export function openDictionary() {
  const panel = document.getElementById('dict-panel');
  if (!panel) return;
  closeOtherPanels('dict-panel');
  panel.classList.add('open');
  const searchInput = document.getElementById('dict-search-input');
  setTimeout(() => searchInput?.focus(), 50);
}

export function closeDictionary() {
  const panel = document.getElementById('dict-panel');
  if (!panel) return;
  panel.classList.remove('open');
}

function initDictResize() {
  const panel = document.getElementById('dict-panel');
  const handle = document.getElementById('dict-resize-handle');
  if (!panel || !handle) return;

  let isResizing = false;
  let startX = 0;
  let startW = 0;

  const onPointerDown = (e) => {
    isResizing = true;
    startX = e.clientX;
    startW = panel.offsetWidth;
    handle.classList.add('resizing');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e) => {
    if (!isResizing) return;
    const delta = startX - e.clientX;
    const maxW = Math.min(window.innerWidth * 0.85, 700);
    const newW = Math.max(260, Math.min(maxW, startW + delta));
    panel.style.width = newW + 'px';
  };

  const onPointerUp = () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  handle.addEventListener('pointerdown', onPointerDown);
}

export function initDictionary() {
  const btnDict = document.getElementById('btn-dict');
  const panel = document.getElementById('dict-panel');
  const btnClose = document.getElementById('dict-close');
  const searchInput = document.getElementById('dict-search-input');
  const resultsDiv = document.getElementById('dict-results');
  
  const editorArea = document.getElementById('dict-editor-area');
  const wordInput = document.getElementById('dict-word-input');
  const defInput = document.getElementById('dict-def-input');
  const saveBtn = document.getElementById('dict-save-btn');
  const saveLbl = document.getElementById('dict-save-lbl');

  if (!panel) return;

  initDictResize();

  btnDict?.addEventListener('click', () => {
    if (panel.classList.contains('open')) {
      closeDictionary();
    } else {
      openDictionary();
    }
  });

  btnClose?.addEventListener('click', () => {
    closeDictionary();
  });

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    currentTerm = val;
    
    clearTimeout(searchTimer);
    if (!val) {
      resultsDiv.innerHTML = '<div style="color:var(--muted); font-style:italic;">Type a word to search or add...</div>';
      editorArea.style.display = 'none';
      return;
    }

    resultsDiv.innerHTML = '<div style="color:var(--muted); font-style:italic;">Searching...</div>';
    
    searchTimer = setTimeout(async () => {
      try {
        const results = await dbSearchDictionary(val);
        
        let exactMatch = null;
        resultsDiv.innerHTML = '';
        
        if (results.length === 0) {
          resultsDiv.innerHTML = '<div style="color:var(--gold); font-style:italic;">Word not found. You can add it below.</div>';
        } else {
          results.forEach(res => {
            if (res.word.toLowerCase() === val.toLowerCase()) exactMatch = res;
            
            const item = document.createElement('div');
            item.style.marginBottom = '12px';
            item.style.padding = '8px';
            item.style.background = 'rgba(0,0,0,0.1)';
            item.style.borderRadius = '6px';
            item.style.borderLeft = '3px solid var(--gold)';
            
            const title = document.createElement('div');
            title.textContent = res.word;
            title.style.fontWeight = 'bold';
            title.style.color = 'white';
            title.style.marginBottom = '4px';
            title.style.fontSize = '15px';
            
            const desc = document.createElement('div');
            desc.textContent = res.definition;
            desc.style.whiteSpace = 'pre-wrap';
            
            item.appendChild(title);
            item.appendChild(desc);
            resultsDiv.appendChild(item);
          });
        }

        // Show editor pre-filled if no exact match
        if (!exactMatch) {
          editorArea.style.display = 'flex';
          wordInput.value = val;
          defInput.value = '';
        } else {
          editorArea.style.display = 'none';
        }
        
      } catch (err) {
        resultsDiv.innerHTML = '<div style="color:red; font-style:italic;">Error searching dictionary.</div>';
        console.error(err);
      }
    }, 400); // 400ms debounce
  });

  saveBtn.addEventListener('click', async () => {
    const w = wordInput.value.trim();
    const d = defInput.value.trim();
    if (!w || !d) return;

    saveBtn.disabled = true;
    saveLbl.textContent = 'Saving...';
    saveLbl.style.color = 'var(--muted)';
    
    try {
      await dbSaveDictionary(w, d);
      saveLbl.textContent = 'Saved!';
      saveLbl.style.color = '#4ade80'; // green
      
      // Clear definition input
      defInput.value = '';
      
      // Trigger search again to refresh results and hide editor
      searchInput.dispatchEvent(new Event('input'));
      
    } catch (err) {
      saveLbl.textContent = 'Error';
      saveLbl.style.color = 'red';
      console.error(err);
    } finally {
      saveBtn.disabled = false;
      setTimeout(() => {
        if (saveLbl.textContent === 'Saved!' || saveLbl.textContent === 'Error') {
          saveLbl.textContent = '';
        }
      }, 3000);
    }
  });
}
