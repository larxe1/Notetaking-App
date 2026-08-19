export function showTablePicker(btn, editorElement) {
  let picker = document.getElementById('table-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'table-picker';
    picker.style.cssText = 'position:absolute; z-index:1000; background:var(--navy-d); border:1px solid var(--navy-b); padding:12px; border-radius:6px; box-shadow:0 4px 16px rgba(0,0,0,0.6); display:flex; flex-direction:column; gap:8px;';
    
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:repeat(10, 16px); gap:3px;';
    
    // Prevent focus loss on editor when clicking the picker
    picker.addEventListener('mousedown', e => e.preventDefault());
    
    const lbl = document.createElement('div');
    lbl.id = 'tp-label';
    lbl.style.cssText = 'text-align:center; font-size:13px; color:var(--text); font-family:monospace; margin-top:4px; font-weight:bold;';
    lbl.textContent = '0 x 0';

    // create 10x10 cells
    for (let r = 1; r <= 10; r++) {
      for (let c = 1; c <= 10; c++) {
        const cell = document.createElement('div');
        cell.className = 'tp-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.style.cssText = 'width:16px; height:16px; border:1px solid var(--navy-b); border-radius:2px; cursor:pointer; background:transparent; box-sizing:border-box; transition:none;';
        grid.appendChild(cell);
        
        cell.addEventListener('mouseenter', () => {
          lbl.textContent = `${c} x ${r}`;
          // highlight cells
          Array.from(grid.children).forEach(child => {
            const cr = parseInt(child.dataset.r);
            const cc = parseInt(child.dataset.c);
            if (cr <= r && cc <= c) {
              child.style.background = 'rgba(59, 130, 246, 0.3)';
              child.style.borderColor = '#3b82f6';
            } else {
              child.style.background = 'transparent';
              child.style.borderColor = 'var(--navy-b)';
            }
          });
        });
        
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          picker.style.display = 'none';
          insertTable(r, c, editorElement);
        });
      }
    }
    
    picker.appendChild(grid);
    picker.appendChild(lbl);
    document.body.appendChild(picker);
    
    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!picker.contains(e.target) && !e.target.closest('[data-cmd="insertTable"]')) {
        picker.style.display = 'none';
      }
    });
  }
  
  // If already open and clicking the same button, toggle off
  if (picker.style.display === 'flex' && picker.dataset.activeBtn === btn.id) {
    picker.style.display = 'none';
    return;
  }

  // Position picker
  const rect = btn.getBoundingClientRect();
  picker.style.left = rect.left + 'px';
  picker.style.top = (rect.bottom + 6) + 'px';
  picker.style.display = 'flex';
  picker.dataset.activeBtn = btn.id || 'btn-table';
  
  // reset styles
  picker.querySelectorAll('.tp-cell').forEach(c => {
    c.style.background = 'transparent';
    c.style.borderColor = 'var(--navy-b)';
  });
  document.getElementById('tp-label').textContent = '0 x 0';
}

function insertTable(rows, cols, editorElement) {
  // Construct the HTML for the table
  let html = `<br><table style="width:100%; border-collapse:collapse; margin:10px 0;"><tbody>`;
  for (let r = 0; r < rows; r++) {
    html += `<tr>`;
    for (let c = 0; c < cols; c++) {
      html += `<td style="border:1px solid var(--navy-b); padding:8px;"><br></td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table><br>`;
  
  editorElement.focus();
  document.execCommand('insertHTML', false, html);
}

// ───────────────────────────────────────────────
// PASTE SANITIZER & TABLE IMPORTER
// ───────────────────────────────────────────────
function parseTextToTable(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0);
  if (lines.length < 2) return null;

  let rows = [];
  const hasTabs = lines.some(l => l.includes('\t'));

  if (hasTabs) {
    rows = lines.map(l => l.split('\t').map(c => c.trim()));
  } else {
    // Check if lines have markdown | separators
    const isMarkdownTable = lines.some(l => l.includes('|'));
    if (isMarkdownTable) {
      rows = lines
        .filter(l => !l.match(/^[\s|:-]+$/)) // Skip markdown divider like |---|---|
        .map(l => l.split('|').map(c => c.trim()).filter((c, idx, arr) => {
          return (idx > 0 && idx < arr.length - 1) || (idx === 0 && c !== '') || (idx === arr.length - 1 && c !== '');
        }));
    } else {
      // Check for 2+ consecutive spaces (standard PDF table column spacing)
      const candidateRows = lines.map(l => l.split(/\s{2,}/).map(c => c.trim()));
      const colCounts = candidateRows.map(r => r.length);
      const isMultiCol = colCounts.length >= 2 && colCounts[0] >= 2 && colCounts.every(c => c === colCounts[0] || c === colCounts[0] - 1);
      if (isMultiCol) {
        rows = candidateRows;
      }
    }
  }

  // Must have at least 2 rows and 2 columns
  if (rows.length >= 2 && rows[0].length >= 2) {
    let html = `<br><table style="width:100%; border-collapse:collapse; margin:10px 0;"><tbody>`;
    for (let r = 0; r < rows.length; r++) {
      html += `<tr>`;
      for (let c = 0; c < rows[r].length; c++) {
        const cellText = rows[r][c] || '';
        const tag = r === 0 ? 'th' : 'td';
        const style = r === 0
          ? 'border:1px solid var(--navy-b); padding:8px; background:rgba(255,255,255,0.06); font-weight:bold;'
          : 'border:1px solid var(--navy-b); padding:8px;';
        html += `<${tag} style="${style}">${cellText ? cellText.replace(/\n/g, '<br>') : '<br>'}</${tag}>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table><br>`;
    return html;
  }
  return null;
}

function parseTextToList(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;
  
  const bulletPattern = /^[\s]*[•\-\*]\s+(.*)$/;
  const numberedPattern = /^[\s]*\d+[\.\)]\s+(.*)$/;

  const hasBullets = lines.length >= 2 && lines.every(l => bulletPattern.test(l));
  const hasNumbered = lines.length >= 2 && lines.every(l => numberedPattern.test(l));

  if (hasBullets) {
    return `<ul style="margin:6px 0; padding-left:24px;">` + lines.map(l => {
      const m = l.match(bulletPattern);
      return `<li>${m ? m[1] : l}</li>`;
    }).join('') + `</ul>`;
  }
  if (hasNumbered) {
    return `<ol style="margin:6px 0; padding-left:24px;">` + lines.map(l => {
      const m = l.match(numberedPattern);
      return `<li>${m ? m[1] : l}</li>`;
    }).join('') + `</ol>`;
  }
  return null;
}

export function handlePaste(e) {
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  
  // If plain text represents a tabular copy or bullet list
  if (!html && text) {
    const tableHtml = parseTextToTable(text);
    if (tableHtml) {
      e.preventDefault();
      document.execCommand('insertHTML', false, tableHtml);
      return;
    }
    const listHtml = parseTextToList(text);
    if (listHtml) {
      e.preventDefault();
      document.execCommand('insertHTML', false, listHtml);
      return;
    }
    return; // Allow native plain text paste
  }
  
  if (!html) return;
  
  e.preventDefault();
  
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const hasHtmlTable = doc.querySelector('table');

  if (!hasHtmlTable && text) {
    const tableFromText = parseTextToTable(text);
    if (tableFromText) {
      document.execCommand('insertHTML', false, tableFromText);
      return;
    }
  }

  function cleanNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    
    let inner = '';
    node.childNodes.forEach(c => inner += cleanNode(c));
    
    const tag = node.tagName.toLowerCase();
    
    if (['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'a', 'span', 'sup', 'sub'].includes(tag)) {
      if (tag === 'a') return `<a href="${node.href}">${inner}</a>`;
      return `<${tag}>${inner}</${tag}>`;
    }
    
    // Preserve lists
    if (['ul', 'ol'].includes(tag)) {
      return `<${tag} style="margin:6px 0; padding-left:24px;">${inner}</${tag}>`;
    }
    if (tag === 'li') {
      return `<li>${inner || '<br>'}</li>`;
    }

    // Preserve headings
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      return `<${tag} style="margin:8px 0 4px;">${inner}</${tag}>`;
    }

    // Preserve blockquotes
    if (tag === 'blockquote') {
      return `<blockquote style="border-left:3px solid var(--gold); margin:8px 0; padding-left:10px; color:var(--text-d);">${inner}</blockquote>`;
    }

    // Preserve tables
    if (tag === 'table') {
      return `<br><table style="width:100%; border-collapse:collapse; margin:10px 0;">${inner}</table><br>`;
    }
    if (['tbody', 'thead', 'tfoot'].includes(tag)) {
      return `<${tag}>${inner}</${tag}>`;
    }
    if (tag === 'tr') {
      return `<tr>${inner}</tr>`;
    }
    if (tag === 'th') {
      const colspan = node.getAttribute('colspan') ? ` colspan="${node.getAttribute('colspan')}"` : '';
      const rowspan = node.getAttribute('rowspan') ? ` rowspan="${node.getAttribute('rowspan')}"` : '';
      return `<th style="border:1px solid var(--navy-b); padding:8px; background:rgba(255,255,255,0.06); font-weight:bold;"${colspan}${rowspan}>${inner || '<br>'}</th>`;
    }
    if (tag === 'td') {
      const colspan = node.getAttribute('colspan') ? ` colspan="${node.getAttribute('colspan')}"` : '';
      const rowspan = node.getAttribute('rowspan') ? ` rowspan="${node.getAttribute('rowspan')}"` : '';
      return `<td style="border:1px solid var(--navy-b); padding:8px;"${colspan}${rowspan}>${inner || '<br>'}</td>`;
    }
    
    // Convert block elements to line breaks
    if (['p', 'div', 'br'].includes(tag)) {
      return inner ? `${inner}<br>` : '<br>';
    }
    
    return inner;
  }
  
  const cleanHtml = cleanNode(doc.body);
  document.execCommand('insertHTML', false, cleanHtml || text.replace(/\n/g, '<br>'));
}

// ───────────────────────────────────────────────
// TABLE CONTEXT MENU
// ───────────────────────────────────────────────
let activeTableCell = null;

export function initTableContextMenu() {
  const ctxMenu = document.getElementById('table-ctx-menu');
  if (!ctxMenu) return;

  // Listen for right-clicks anywhere in the document
  document.addEventListener('contextmenu', (e) => {
    // Only intercept if we right-clicked inside a table cell in one of our editors
    const td = e.target.closest('td, th');
    const editor = e.target.closest('[contenteditable="true"]');
    
    if (td && editor) {
      e.preventDefault();
      activeTableCell = td;
      
      ctxMenu.style.display = 'flex';
      
      // Keep menu on screen
      let x = e.pageX;
      let y = e.pageY;
      
      // small delay to let browser calculate width
      requestAnimationFrame(() => {
        const mw = ctxMenu.offsetWidth;
        const mh = ctxMenu.offsetHeight;
        if (x + mw > window.innerWidth) x = window.innerWidth - mw - 10;
        if (y + mh > window.innerHeight) y = window.innerHeight - mh - 10;
        
        ctxMenu.style.left = x + 'px';
        ctxMenu.style.top = y + 'px';
      });
    } else {
      ctxMenu.style.display = 'none';
      activeTableCell = null;
    }
  });

  document.addEventListener('click', () => {
    ctxMenu.style.display = 'none';
  });

  // Bind actions
  document.getElementById('ctx-row-above')?.addEventListener('click', () => modifyTable('row-above'));
  document.getElementById('ctx-row-below')?.addEventListener('click', () => modifyTable('row-below'));
  document.getElementById('ctx-col-left')?.addEventListener('click', () => modifyTable('col-left'));
  document.getElementById('ctx-col-right')?.addEventListener('click', () => modifyTable('col-right'));
  document.getElementById('ctx-del-row')?.addEventListener('click', () => modifyTable('del-row'));
  document.getElementById('ctx-del-col')?.addEventListener('click', () => modifyTable('del-col'));
  document.getElementById('ctx-del-table')?.addEventListener('click', () => modifyTable('del-table'));
}

function modifyTable(action) {
  if (!activeTableCell) return;
  const tr = activeTableCell.closest('tr');
  const tbody = activeTableCell.closest('tbody') || activeTableCell.closest('table');
  const table = activeTableCell.closest('table');
  if (!tr || !tbody || !table) return;

  const cellIndex = activeTableCell.cellIndex;
  const rowIndex = Array.from(tbody.children).indexOf(tr);

  // Helper to trigger an input event so the editor saves
  const triggerSave = () => {
    const editor = table.closest('[contenteditable="true"]');
    if (editor) editor.dispatchEvent(new Event('input', { bubbles: true }));
  };

  if (action === 'row-above' || action === 'row-below') {
    const newRow = tbody.insertRow(action === 'row-above' ? rowIndex : rowIndex + 1);
    const cols = tr.children.length;
    for (let i = 0; i < cols; i++) {
      const td = newRow.insertCell(i);
      td.style.border = '1px solid var(--navy-b)';
      td.style.padding = '8px';
      td.innerHTML = '<br>';
    }
    triggerSave();
  } 
  else if (action === 'col-left' || action === 'col-right') {
    const targetIdx = action === 'col-left' ? cellIndex : cellIndex + 1;
    Array.from(tbody.children).forEach(row => {
      const td = row.insertCell(targetIdx);
      td.style.border = '1px solid var(--navy-b)';
      td.style.padding = '8px';
      td.innerHTML = '<br>';
    });
    triggerSave();
  }
  else if (action === 'del-row') {
    tbody.deleteRow(rowIndex);
    if (tbody.children.length === 0) table.remove();
    triggerSave();
  }
  else if (action === 'del-col') {
    Array.from(tbody.children).forEach(row => {
      if (row.children[cellIndex]) row.deleteCell(cellIndex);
    });
    // If table is empty
    if (tbody.children[0] && tbody.children[0].children.length === 0) table.remove();
    triggerSave();
  }
  else if (action === 'del-table') {
    table.remove();
    triggerSave();
  }
}
