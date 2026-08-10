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
