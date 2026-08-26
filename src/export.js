import { S } from './state.js';
import { dbLoadNotepad } from './db.js';
import { toast } from './ui.js';
import { safeStorageGet } from './storage.js';
import { getCachedNotepad } from './notepad.js';

// Strip emojis using Unicode property escapes and common icon sets
const stripEmojis = (str) => {
  if (!str) return '';
  return str
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, '')
    .replace(/[📖📑💾📥☁️⚙️📲📁📂📜⚖️📋📄✏️✕▶️◀️▲▼🕐🔍💡✨🔴🟠🟡🟢🔵🟣⚫⚪🟤]/g, '')
    .trim();
};

// Clean HTML to ensure dark text and strip light colors
function cleanAndSanitizeHtml(html) {
  if (!html) return '';
  let clean = stripEmojis(html);
  // Replace inline light colors (white, off-white, light gray) with dark slate
  clean = clean
    .replace(/color:\s*(#[d-fD-F0-9]{3,6}|rgb\(\s*2[0-5][0-9]\s*,\s*2[0-5][0-9]\s*,\s*2[0-5][0-9]\s*\)|white|#fff|#f1f5f9|#e8e4db|#e0dbd2)/gi, 'color: #0f172a')
    .replace(/background:\s*(var\(--navy[^)]*\)|#0c1322|#141c2d|#1e293b|#101827)/gi, 'background: transparent');
  return clean;
}

// Clean HTML check to verify if a section contains actual text, tables, or images
function hasMeaningfulContent(html) {
  if (!html) return false;
  const stripped = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  const hasImg = /<img\b/i.test(html);
  const hasTable = /<table\b/i.test(html);
  return stripped.length > 0 || hasImg || hasTable;
}

// Fetch notes and digest for a specific PDF (checking active memory, DB, and local cache)
async function fetchPdfNotesAndDigest(pdf) {
  const trueId = pdf.linked_pdf_id || pdf.id;
  let content = '';
  let digest = '';

  // 1. Check in-memory active cache
  try {
    const mem = getCachedNotepad(trueId);
    if (mem) {
      content = mem.content || '';
      digest = mem.digest || '';
    }
  } catch {}

  // 2. Query Database / Local Storage if either content or digest is missing
  if (!content || !digest) {
    try {
      const res = await dbLoadNotepad(trueId);
      if (res) {
        if (!content) content = res.content || '';
        if (!digest) digest = res.digest || '';
      }
    } catch (err) {
      console.warn('[PDF Export] dbLoadNotepad failed:', err);
    }
  }

  // 3. Fallbacks from local storage
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
  const hSize = depth === 1 ? '22pt' : (depth === 2 ? '17pt' : '14pt');
  const hTag = depth === 1 ? 'h1' : (depth === 2 ? 'h2' : 'h3');
  
  let folderHeaderHtml = `
    <div style="margin-top: ${depth === 1 ? '0' : '28pt'}; margin-bottom: 14pt; page-break-after: avoid;">
      <${hTag} style="margin: 0 0 6pt 0; font-size: ${hSize}; color: #0f172a; font-weight: 700; border-bottom: 2pt solid #334155; padding-bottom: 4pt;">
        ${folderName}
      </${hTag}>
    </div>
  `;

  // 2. Folder Notes (from folder doc)
  const folderNotes = folder.notes || safeStorageGet('local_folder_notes_' + folder.id, '') || '';
  if (hasMeaningfulContent(folderNotes)) {
    hasAnyContent = true;
    folderHeaderHtml += `
      <div class="folder-notes-section" style="margin-bottom: 18pt; padding: 10pt 14pt; background: #f8fafc; border: 1pt solid #e2e8f0; border-radius: 4pt; color: #1e293b; line-height: 1.6;">
        <div style="font-size: 9pt; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6pt;">Folder Notes</div>
        <div class="note-content" style="color: #1e293b;">${cleanAndSanitizeHtml(folderNotes)}</div>
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
        <div class="case-section" style="margin: 16pt 0; padding: 12pt 16pt; border: 1pt solid #cbd5e1; border-radius: 6pt; background: #ffffff; page-break-inside: avoid;">
          <div style="font-size: 13pt; font-weight: 700; color: #0f172a; margin-bottom: 8pt; border-bottom: 1pt solid #e2e8f0; padding-bottom: 4pt;">
            ${pdfName}
          </div>
      `;

      // 3a. Case Digest
      if (hasDigest) {
        sectionHtml += `
          <div style="margin-bottom: 12pt;">
            <div style="font-size: 9pt; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4pt;">Case Digest</div>
            <div class="case-digest-body" style="padding-left: 10pt; border-left: 2.5pt solid #0284c7; color: #1e293b; line-height: 1.6;">
              ${cleanAndSanitizeHtml(digest)}
            </div>
          </div>
        `;
      }

      // 3b. Appendix / Notes
      if (hasContent) {
        sectionHtml += `
          <div style="margin-top: 8pt;">
            <div style="font-size: 9pt; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4pt;">Appendix / Notes</div>
            <div class="case-notes-body" style="padding-left: 10pt; border-left: 2.5pt solid #64748b; color: #1e293b; line-height: 1.6;">
              ${cleanAndSanitizeHtml(content)}
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

  toast('Preparing PDF export document...');

  const rawName = stripEmojis(folder.name) || 'Folder';
  const pageTitle = `${rawName} — Notes & Case Digests`;

  const fullDocumentHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${pageTitle}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 0.6in 0.5in 0.6in 0.5in;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0;
      background: #f1f5f9;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
    }
    .top-bar {
      position: sticky;
      top: 0;
      background: #0c1322;
      color: #ffffff;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      z-index: 10000;
    }
    .top-bar-title {
      font-weight: 700;
      font-size: 14px;
      color: #c9a84c;
    }
    .top-bar-actions {
      display: flex;
      gap: 10px;
    }
    .btn-print {
      background: #c9a84c;
      color: #0c1322;
      border: none;
      padding: 8px 18px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-print:hover {
      background: #dfbe65;
    }
    .btn-close {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #475569;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }
    .btn-close:hover {
      background: #334155;
    }
    .paper-container {
      max-width: 8.5in;
      margin: 24px auto;
      background: #ffffff;
      padding: 0.6in;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
      border-radius: 4px;
    }
    table {
      width: 100% !important;
      border-collapse: collapse !important;
      margin: 12pt 0 !important;
      page-break-inside: avoid;
    }
    th, td {
      border: 1pt solid #cbd5e1 !important;
      padding: 6pt 10pt !important;
      text-align: left !important;
      vertical-align: top !important;
      font-size: 10pt !important;
      color: #1e293b !important;
    }
    th {
      background-color: #f1f5f9 !important;
      font-weight: 700 !important;
      color: #0f172a !important;
    }
    img {
      max-width: 100% !important;
      height: auto !important;
      display: block !important;
      margin: 10pt 0 !important;
      page-break-inside: avoid;
    }
    blockquote {
      margin: 8pt 0 !important;
      padding: 6pt 12pt !important;
      border-left: 3pt solid #94a3b8 !important;
      background: #f8fafc !important;
      color: #334155 !important;
    }
    pre, code {
      background: #f1f5f9 !important;
      color: #0f172a !important;
      padding: 2px 4px !important;
      border-radius: 4px !important;
      font-size: 10pt !important;
    }
    .np-banner-hdr {
      background: #e0f2fe !important;
      border-bottom: 2.5pt solid #0284c7 !important;
      color: #0369a1 !important;
      padding: 8pt 14pt !important;
      margin: 16pt 0 8pt !important;
      font-weight: 800 !important;
      font-size: 14pt !important;
      border-radius: 4pt 4pt 0 0 !important;
      display: block !important;
      letter-spacing: 0.02em !important;
      page-break-after: avoid;
    }
    ul, ol {
      margin: 6pt 0 !important;
      padding-left: 20pt !important;
      list-style-type: disc !important;
    }
    ul ul, ol ol, ul ol, ol ul {
      margin: 2pt 0 !important;
      padding-left: 20pt !important;
      list-style-type: circle !important;
    }
    ul ul ul, ol ol ol {
      list-style-type: square !important;
    }
    li {
      margin-bottom: 3pt !important;
    }
    .dim-text {
      opacity: 0.45 !important;
      color: #64748b !important;
      display: inline !important;
    }
    @media print {
      .no-print {
        display: none !important;
      }
      body {
        background: #ffffff !important;
        color: #000000 !important;
      }
      .paper-container {
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        max-width: none !important;
        width: 100% !important;
      }
      .case-section {
        page-break-inside: avoid;
      }
      h1, h2, h3, h4 {
        page-break-after: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="top-bar no-print">
    <div class="top-bar-title">${pageTitle}</div>
    <div class="top-bar-actions">
      <button class="btn-print" onclick="window.print()">
        <span>Print / Save to PDF</span>
      </button>
      <button class="btn-close" onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="paper-container">
    ${htmlContent}
  </div>

  <script>
    // Automatically open print dialog upon document readiness
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        window.focus();
        window.print();
      }, 350);
    });
  </script>
</body>
</html>`;

  // 1. Try opening dedicated print preview tab
  const printWin = window.open('', '_blank');
  if (printWin) {
    printWin.document.open();
    printWin.document.write(fullDocumentHtml);
    printWin.document.close();
    toast('PDF export window opened — select "Save as PDF" to save.');
  } else {
    // 2. Fallback to hidden print iframe if popups are blocked
    let iframe = document.getElementById('export-print-frame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'export-print-frame';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
    }
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(fullDocumentHtml);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      toast('Print prompt opened — choose "Save as PDF"');
    }, 400);
  }
}
