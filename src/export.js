import { S } from './state.js';
import { dbLoadNotepad } from './db.js';
import { toast } from './ui.js';

// Strip emojis using Unicode property escapes
const stripEmojis = (str) => {
  if (!str) return '';
  return str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
};

async function buildFolderHTML(folderId, depth = 1) {
  const folder = S.folders.find(f => f.id === folderId);
  if (!folder) return '';

  let html = '';
  
  // 1. Folder Header
  const hTag = `h${Math.min(depth, 6)}`;
  html += `<${hTag} style="color: #111; border-bottom: 2px solid #333; padding-bottom: 5px; margin-top: 30px;">${stripEmojis(folder.name)}</${hTag}>`;
  
  // 2. Folder Notes
  if (folder.notes && folder.notes.trim()) {
    html += `<div class="folder-notes-section" style="margin-bottom: 20px;">
               ${stripEmojis(folder.notes)}
             </div>`;
  }
  
  // 3. Cases / PDFs inside this folder
  const pdfs = S.pdfs
    .filter(p => p.folder_id === folderId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  
  for (const pdf of pdfs) {
    const { content, digest } = await dbLoadNotepad(pdf.id);
    
    // Only include if there's actual note content
    if ((digest && digest.trim()) || (content && content.trim())) {
      const pdfHTag = `h${Math.min(depth + 1, 6)}`;
      html += `<div style="margin-top: 25px; margin-bottom: 15px;">`;
      html += `<${pdfHTag} style="color: #222; margin-bottom: 10px;">📄 ${stripEmojis(pdf.name)}</${pdfHTag}>`;
      
      if (digest && digest.trim()) {
        html += `<div style="margin-bottom: 5px; font-weight: bold; color: #444; font-size: 14px; text-transform: uppercase;">Case Digest</div>`;
        html += `<div class="case-digest" style="margin-bottom: 15px; padding-left: 10px; border-left: 3px solid #666;">
                   ${stripEmojis(digest)}
                 </div>`;
      }
      
      if (content && content.trim()) {
        html += `<div style="margin-bottom: 5px; font-weight: bold; color: #444; font-size: 14px; text-transform: uppercase;">Appendix / Notes</div>`;
        html += `<div class="case-notes" style="margin-bottom: 15px; padding-left: 10px; border-left: 3px solid #888;">
                   ${stripEmojis(content)}
                 </div>`;
      }
      
      html += `</div>`;
      html += `<hr style="margin: 20px 0; border: 0; border-top: 1px dashed #ccc;">`;
    }
  }
  
  // 4. Subfolders recursively
  const subfolders = S.folders
    .filter(f => f.parent_folder_id === folderId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    
  for (const sf of subfolders) {
    html += await buildFolderHTML(sf.id, depth + 1);
  }
  
  return html;
}

export async function exportFolderToPDF(folder) {
  if (typeof window.html2pdf === 'undefined') {
    toast('PDF library is still loading. Please try again in a moment.');
    return;
  }

  toast('Gathering notes for export...');
  
  const htmlContent = await buildFolderHTML(folder.id, 1);
  
  if (!htmlContent.trim()) {
    toast('No notes found in this folder or its subfolders.');
    return;
  }
  
  toast('Generating PDF... This may take a moment.');
  
  const container = document.createElement('div');
  container.innerHTML = `
    <style>
      body { margin: 0; padding: 0; }
      * { color: #000; font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
      table { width: 100% !important; border-collapse: collapse; margin: 15px 0; }
      th, td { border: 1px solid #444 !important; padding: 8px; text-align: left; vertical-align: top; }
      th { background-color: #f4f4f4 !important; font-weight: bold; }
      img { max-width: 100%; height: auto; }
      pre, code { background: #f9f9f9; padding: 2px 4px; border-radius: 4px; }
      blockquote { border-left: 4px solid #ccc; margin-left: 0; padding-left: 10px; color: #555; }
    </style>
    <div style="padding: 20px; max-width: 800px; margin: 0 auto; line-height: 1.6;">
      ${htmlContent}
    </div>
  `;
  
  const opt = {
    margin:       0.5,
    filename:     `${stripEmojis(folder.name).replace(/\s+/g, '_')}_Notes.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, logging: false },
    pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
  };
  
  try {
    await window.html2pdf().set(opt).from(container).save();
    toast('PDF Downloaded successfully!');
  } catch (err) {
    console.error('PDF Export Error:', err);
    toast('Failed to generate PDF.');
  }
}
