import { S } from './state.js';
import { dbLoadNotepad } from './db.js';
import { toast } from './ui.js';
import { safeStorageGet } from './storage.js';

// Strip emojis using Unicode property escapes and common icon sets
const stripEmojis = (str) => {
  if (!str) return '';
  return str
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, '')
    .replace(/[📖📑💾📥☁️⚙️📲📁📂📜⚖️📋📄✏️✕▶️◀️▲▼🕐🔍💡✨🔴🟠🟡🟢🔵🟣⚫⚪🟤]/g, '')
    .trim();
};

// Clean HTML check to verify if a section contains actual text, tables, or images
function hasMeaningfulContent(html) {
  if (!html) return false;
  const stripped = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  const hasImg = /<img\b/i.test(html);
  const hasTable = /<table\b/i.test(html);
  return stripped.length > 0 || hasImg || hasTable;
}

// Fetch notes and digest for a specific PDF (checking DB, in-memory cache, and local storage)
async function fetchPdfNotesAndDigest(pdf) {
  const trueId = pdf.linked_pdf_id || pdf.id;
  let content = '';
  let digest = '';

  // 1. Check in-memory active cache
  try {
    const { getCachedNotepad } = await import('./notepad.js');
    const mem = getCachedNotepad?.(trueId);
    if (mem) {
      content = mem.content || '';
      digest = mem.digest || '';
    }
  } catch {}

  // 2. Query Database
  if (!content && !digest) {
    try {
      const res = await dbLoadNotepad(trueId);
      if (res) {
        content = res.content || '';
        digest = res.digest || '';
      }
    } catch (err) {
      console.warn('[PDF Export] dbLoadNotepad failed:', err);
    }
  }

  // 3. Local storage fallbacks
  if (!content) content = safeStorageGet('local_notepad_' + trueId, '') || '';
  if (!digest) digest = safeStorageGet('local_digest_' + trueId, '') || '';

  return { content, digest };
}

async function buildFolderHTML(folderId, depth = 1) {
  const folder = S.folders.find(f => f.id === folderId);
  if (!folder) return '';

  let sectionHtml = '';
  let hasAnyContent = false;

  // 1. Folder Header
  const folderName = stripEmojis(folder.name) || 'Folder';
  const hSize = depth === 1 ? '22px' : (depth === 2 ? '18px' : '15px');
  const hTag = depth === 1 ? 'h1' : (depth === 2 ? 'h2' : 'h3');
  
  let folderHeaderHtml = `
    <div style="margin-top: ${depth === 1 ? '0' : '28px'}; margin-bottom: 14px; page-break-after: avoid;">
      <${hTag} style="margin: 0 0 6px 0; font-size: ${hSize}; color: #0f172a; font-weight: 700; border-bottom: 2px solid #334155; padding-bottom: 6px;">
        ${folderName}
      </${hTag}>
    </div>
  `;

  // 2. Folder Notes (from folder doc)
  const folderNotes = folder.notes || safeStorageGet('local_folder_notes_' + folder.id, '') || '';
  if (hasMeaningfulContent(folderNotes)) {
    hasAnyContent = true;
    folderHeaderHtml += `
      <div class="folder-notes-section" style="margin-bottom: 20px; padding: 12px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; color: #1e293b; line-height: 1.6;">
        <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Folder Notes</div>
        <div class="note-content">${stripEmojis(folderNotes)}</div>
      </div>
    `;
  }

  sectionHtml += folderHeaderHtml;

  // 3. Cases / PDFs inside this folder
  const pdfs = S.pdfs
    .filter(p => p.folder_id === folderId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  for (const pdf of pdfs) {
    const { content, digest } = await fetchPdfNotesAndDigest(pdf);
    const hasDigest = hasMeaningfulContent(digest);
    const hasContent = hasMeaningfulContent(content);

    if (hasDigest || hasContent) {
      hasAnyContent = true;
      const pdfName = stripEmojis(pdf.name) || 'Case Document';

      sectionHtml += `
        <div class="case-section" style="margin: 18px 0; padding: 14px 18px; border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff; page-break-inside: avoid;">
          <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
            ${pdfName}
          </div>
      `;

      // 3a. Case Digest
      if (hasDigest) {
        sectionHtml += `
          <div style="margin-bottom: 14px;">
            <div style="font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Case Digest</div>
            <div class="case-digest-body" style="padding-left: 12px; border-left: 3px solid #0284c7; color: #1e293b; line-height: 1.6;">
              ${stripEmojis(digest)}
            </div>
          </div>
        `;
      }

      // 3b. Appendix / Notes
      if (hasContent) {
        sectionHtml += `
          <div style="margin-top: 10px;">
            <div style="font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Appendix / Notes</div>
            <div class="case-notes-body" style="padding-left: 12px; border-left: 3px solid #64748b; color: #1e293b; line-height: 1.6;">
              ${stripEmojis(content)}
            </div>
          </div>
        `;
      }

      sectionHtml += `</div>`;
    }
  }

  // 4. Subfolders recursively
  const subfolders = S.folders
    .filter(f => f.parent_folder_id === folderId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  for (const sf of subfolders) {
    const subHtml = await buildFolderHTML(sf.id, depth + 1);
    if (subHtml) {
      sectionHtml += subHtml;
      hasAnyContent = true;
    }
  }

  return hasAnyContent ? sectionHtml : '';
}

export async function exportFolderToPDF(folder) {
  // 1. Flush any pending active editor notes from memory to state
  try {
    const { flushFolderDoc } = await import('./viewer.js');
    await flushFolderDoc();
  } catch {}
  try {
    const { flushNotepadSave } = await import('./notepad.js');
    await flushNotepadSave();
  } catch {}

  toast('Gathering notes for export...');

  const htmlContent = await buildFolderHTML(folder.id, 1);

  if (!htmlContent || !hasMeaningfulContent(htmlContent)) {
    toast('No notes or digests found in this folder or its subfolders.');
    return;
  }

  toast('Generating PDF... Please wait.');

  // Create an explicit, live DOM container behind the app layer so html2canvas can measure geometry
  const container = document.createElement('div');
  container.id = 'pdf-export-render-box';
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 760px;
    z-index: -9999;
    background: #ffffff !important;
    color: #0f172a !important;
    padding: 32px 36px;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    overflow: visible;
  `;

  // Comprehensive styling to override dark mode & guarantee crisp printing
  container.innerHTML = `
    <style>
      #pdf-export-render-box * {
        box-sizing: border-box;
      }
      #pdf-export-render-box p, 
      #pdf-export-render-box div, 
      #pdf-export-render-box span, 
      #pdf-export-render-box li {
        color: #1e293b;
      }
      #pdf-export-render-box h1, 
      #pdf-export-render-box h2, 
      #pdf-export-render-box h3, 
      #pdf-export-render-box h4 {
        color: #0f172a;
      }
      #pdf-export-render-box table {
        width: 100% !important;
        border-collapse: collapse !important;
        margin: 12px 0 !important;
        page-break-inside: avoid;
      }
      #pdf-export-render-box th, 
      #pdf-export-render-box td {
        border: 1px solid #cbd5e1 !important;
        padding: 6px 10px !important;
        text-align: left !important;
        vertical-align: top !important;
        color: #1e293b !important;
        font-size: 12px !important;
        background: transparent !important;
      }
      #pdf-export-render-box th {
        background-color: #f1f5f9 !important;
        font-weight: 700 !important;
        color: #0f172a !important;
      }
      #pdf-export-render-box img {
        max-width: 100% !important;
        height: auto !important;
        display: block !important;
        margin: 10px 0 !important;
      }
      #pdf-export-render-box blockquote {
        margin: 8px 0 !important;
        padding: 6px 12px !important;
        border-left: 3px solid #94a3b8 !important;
        background: #f8fafc !important;
        color: #334155 !important;
      }
      #pdf-export-render-box pre, 
      #pdf-export-render-box code {
        background: #f1f5f9 !important;
        color: #0f172a !important;
        padding: 2px 4px !important;
        border-radius: 4px !important;
        font-size: 12px !important;
      }
      #pdf-export-render-box .np-banner-hdr {
        background: #e0f2fe !important;
        border-bottom: 2px solid #0284c7 !important;
        color: #0369a1 !important;
        padding: 6px 12px !important;
        margin: 14px 0 8px !important;
        font-weight: 700 !important;
        font-size: 14px !important;
        border-radius: 4px 4px 0 0 !important;
        display: block !important;
      }
      #pdf-export-render-box ul, 
      #pdf-export-render-box ol {
        margin: 6px 0 !important;
        padding-left: 24px !important;
      }
      #pdf-export-render-box li {
        margin-bottom: 3px !important;
      }
    </style>
    <div style="width: 100%;">
      ${htmlContent}
    </div>
  `;

  document.body.appendChild(container);

  // Give browser layout engine 100ms to calculate all dimensions and positions
  await new Promise(resolve => setTimeout(resolve, 100));

  const rawName = stripEmojis(folder.name) || 'Folder';
  const cleanFileName = `${rawName.replace(/[^a-zA-Z0-9_\-]/g, '_')}_Notes.pdf`;

  const opt = {
    margin:       [0.4, 0.4, 0.4, 0.4],
    filename:     cleanFileName,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { 
      scale: 2, 
      useCORS: true, 
      logging: false,
      scrollY: 0,
      scrollX: 0
    },
    pagebreak:    { mode: ['css', 'legacy'] },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
  };

  try {
    if (typeof window.html2pdf === 'function') {
      await window.html2pdf().set(opt).from(container).save();
      toast('PDF Downloaded successfully!');
    } else {
      // Fallback print preview
      const printWin = window.open('', '_blank');
      if (printWin) {
        printWin.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>${rawName} Notes</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #000; background: #fff; }
              table { width: 100%; border-collapse: collapse; margin: 12px 0; }
              th, td { border: 1px solid #999; padding: 6px 10px; }
              th { background: #eee; font-weight: bold; }
              .np-banner-hdr { background: #e0f2fe; border-bottom: 2px solid #0284c7; color: #0369a1; padding: 6px 12px; font-weight: bold; }
            </style>
          </head>
          <body>
            ${container.innerHTML}
          </body>
          </html>
        `);
        printWin.document.close();
        printWin.focus();
        printWin.print();
        toast('Opened print preview');
      } else {
        toast('PDF library unavailable');
      }
    }
  } catch (err) {
    console.error('PDF Export Error:', err);
    toast('Failed to generate PDF. Check console.');
  } finally {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  }
}
