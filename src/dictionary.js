import { dbSearchDictionary, dbSaveDictionary } from './db.js';
import { closeOtherPanels } from './ui.js';

let searchTimer = null;
let currentTerm = '';

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

  if (!btnDict || !panel) return;

  btnDict.addEventListener('click', () => {
    if (!panel.classList.contains('open')) {
      closeOtherPanels('dict-panel');
    }
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      searchInput.focus();
    }
  });

  btnClose.addEventListener('click', () => {
    panel.classList.remove('open');
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
