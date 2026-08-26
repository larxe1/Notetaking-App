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

function getFolderPathString(folder) {
  const parts = [];
  let currFolder = folder;
  while (currFolder) {
    const rawName = stripEmojis(currFolder.name) || 'Folder';
    parts.unshift(rawName);
    if (currFolder.parent_folder_id) {
      currFolder = S.folders.find(f => f.id === currFolder.parent_folder_id);
    } else {
      break;
    }
  }
  if (folder.subject_id) {
    const subj = S.subjects.find(s => s.id === folder.subject_id);
    if (subj) {
      const subjName = stripEmojis(subj.name) || 'Subject';
      parts.unshift(subjName);
    }
  }
  return parts.join(' > ');
}

async function buildFolderHTML(folderId, depth = 1) {
  const folder = S.folders.find(f => f.id === folderId);
  if (!folder) return '';

  let sectionHtml = '';
  let hasAnyContent = false;

  // 1. Folder Header
  const folderName = stripEmojis(folder.name) || 'Folder';
  const hSize = depth === 1 ? '14pt' : (depth === 2 ? '12.5pt' : '11.5pt');
  const hTag = depth === 1 ? 'h1' : (depth === 2 ? 'h2' : 'h3');
  
  let folderHeaderHtml = `
    <div class="folder-header-wrap" style="margin-top: ${depth === 1 ? '0' : '14pt'}; margin-bottom: 8pt; page-break-after: avoid; break-after: avoid;">
      <${hTag} style="margin: 0 0 3pt 0; font-size: ${hSize}; color: #0f172a; font-weight: 700; border-bottom: 1.5pt solid #334155; padding-bottom: 2pt;">
        ${folderName}
      </${hTag}>
    </div>
  `;

  // 2. Folder Notes (from folder doc)
  const folderNotes = folder.notes || safeStorageGet('local_folder_notes_' + folder.id, '') || '';
  if (hasMeaningfulContent(folderNotes)) {
    hasAnyContent = true;
    folderHeaderHtml += `
      <div class="folder-notes-section" style="margin-bottom: 10pt; padding: 6pt 10pt; background: #f8fafc; border: 0.75pt solid #e2e8f0; border-radius: 4pt; color: #1e293b; line-height: 1.25; page-break-inside: avoid; break-inside: avoid;">
        <div style="font-size: 8pt; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3pt;">Folder Notes</div>
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
        <div class="case-section" style="margin: 8pt 0; padding: 8pt 10pt; border: 0.75pt solid #cbd5e1; border-radius: 4pt; background: #ffffff; page-break-inside: avoid; break-inside: avoid;">
          <div style="font-size: 11pt; font-weight: 700; color: #0f172a; margin-bottom: 5pt; border-bottom: 0.75pt solid #e2e8f0; padding-bottom: 2pt;">
            ${pdfName}
          </div>
      `;

      // 3a. Case Digest
      if (hasDigest) {
        sectionHtml += `
          <div style="margin-bottom: 6pt;">
            <div style="font-size: 8pt; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2pt;">Case Digest</div>
            <div class="case-digest-body" style="padding-left: 8pt; border-left: 2pt solid #0284c7; color: #1e293b; line-height: 1.25;">
              ${cleanAndSanitizeHtml(digest)}
            </div>
          </div>
        `;
      }

      // 3b. Appendix / Notes
      if (hasContent) {
        sectionHtml += `
          <div style="margin-top: 5pt;">
            <div style="font-size: 8pt; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2pt;">Appendix / Notes</div>
            <div class="case-notes-body" style="padding-left: 8pt; border-left: 2pt solid #64748b; color: #1e293b; line-height: 1.25;">
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
  const folderPath = getFolderPathString(folder);
  const pageTitle = `${rawName} — Notes & Case Digests`;

  const fullDocumentHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${pageTitle}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 0.5in 0.5in 0.5in 0.5in;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0;
      background: #f1f5f9;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Calibri, Aptos, Arial, Helvetica, sans-serif;
      font-size: 10pt;
      line-height: 1.25;
    }
    .top-bar {
      position: sticky;
      top: 0;
      background: #0c1322;
      color: #ffffff;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      z-index: 10000;
      flex-wrap: wrap;
      gap: 10px;
    }
    .top-bar-left {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .top-bar-title {
      font-weight: 700;
      font-size: 14px;
      color: #c9a84c;
    }
    .top-bar-sub {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 500;
    }
    .top-bar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .btn-group {
      display: flex;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 2px;
    }
    .btn-toggle {
      background: none;
      border: none;
      color: #94a3b8;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-toggle.active {
      background: #334155;
      color: #f1f5f9;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .btn-print {
      background: #c9a84c;
      color: #0c1322;
      border: none;
      padding: 7px 16px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background .15s;
    }
    .btn-print:hover {
      background: #dfbe65;
    }
    .btn-close {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #475569;
      padding: 7px 12px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      transition: background .15s;
    }
    .btn-close:hover {
      background: #334155;
    }
    .paper-container {
      max-width: 8.5in;
      margin: 18px auto;
      background: #ffffff;
      padding: 0.5in;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
      border-radius: 4px;
    }

    /* Print Document Report Table for Perfect Non-Overlapping Repeating Header & Footer */
    .report-table {
      width: 100% !important;
      border-collapse: collapse !important;
      border: none !important;
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      table-layout: fixed !important;
    }
    .report-table thead {
      display: table-header-group !important;
    }
    .report-table tfoot {
      display: table-footer-group !important;
    }
    .report-table tbody {
      display: table-row-group !important;
    }
    .report-th, .report-body-cell {
      border: none !important;
      padding: 0 !important;
      background: transparent !important;
      text-align: left !important;
      font-weight: normal !important;
    }
    .report-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding-bottom: 3pt !important;
      margin-bottom: 8pt !important;
      border-bottom: 1.5pt solid #334155 !important;
      font-size: 8.5pt !important;
      font-weight: 700 !important;
      color: #475569 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.04em !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Calibri, Aptos, Arial, sans-serif !important;
      width: 100% !important;
    }

    /* Compact Layout Styling */
    p {
      margin: 3pt 0 !important;
    }
    table:not(.report-table) {
      width: 100% !important;
      border-collapse: collapse !important;
      margin: 6pt 0 !important;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    th:not(.report-th), td:not(.report-tf):not(.report-body-cell) {
      border: 1pt solid #cbd5e1 !important;
      padding: 4pt 6pt !important;
      text-align: left !important;
      vertical-align: top !important;
      font-size: 9.5pt !important;
      color: #1e293b !important;
      line-height: 1.25 !important;
    }
    th:not(.report-th) {
      background-color: #f1f5f9 !important;
      font-weight: 700 !important;
      color: #0f172a !important;
    }
    img {
      max-width: 100% !important;
      height: auto !important;
      display: block !important;
      margin: 6pt 0 !important;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    blockquote {
      margin: 4pt 0 !important;
      padding: 3pt 8pt !important;
      border-left: 2.5pt solid #94a3b8 !important;
      background: #f8fafc !important;
      color: #334155 !important;
    }
    pre, code {
      background: #f1f5f9 !important;
      color: #0f172a !important;
      padding: 2px 4px !important;
      border-radius: 3px !important;
      font-size: 9pt !important;
    }
    .np-banner-hdr {
      background: #e0f2fe !important;
      border-bottom: 2pt solid #0284c7 !important;
      color: #0369a1 !important;
      padding: 5pt 10pt !important;
      margin: 8pt 0 4pt !important;
      font-weight: 800 !important;
      font-size: 11pt !important;
      border-radius: 3pt 3pt 0 0 !important;
      display: block !important;
      letter-spacing: 0.02em !important;
      page-break-after: avoid;
      break-after: avoid;
    }
    ul, ol {
      margin: 3pt 0 !important;
      padding-left: 18pt !important;
      list-style-type: disc !important;
    }
    ul ul, ol ol, ul ol, ol ul {
      margin: 1.5pt 0 !important;
      padding-left: 16pt !important;
      list-style-type: circle !important;
    }
    ul ul ul, ol ol ol {
      list-style-type: square !important;
    }
    li {
      margin-bottom: 1.5pt !important;
    }
    .dim-text {
      opacity: 0.45 !important;
      color: #64748b !important;
      display: inline !important;
    }

    /* 2-Column Mode */
    .two-column-layout {
      column-count: 2;
      column-gap: 16pt;
    }
    .two-column-layout .case-section,
    .two-column-layout .folder-notes-section {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .two-column-layout .folder-header-wrap {
      column-span: all;
    }

    /* Standard Mode Override */
    .standard-mode {
      font-size: 11pt !important;
      line-height: 1.5 !important;
    }
    .standard-mode p {
      margin: 6pt 0 !important;
    }
    .standard-mode th:not(.report-th), .standard-mode td:not(.report-tf):not(.report-body-cell) {
      font-size: 10pt !important;
      padding: 6pt 8pt !important;
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
        break-inside: avoid;
      }
      h1, h2, h3, h4 {
        page-break-after: avoid;
        break-after: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="top-bar no-print">
    <div class="top-bar-left">
      <div class="top-bar-title">${pageTitle}</div>
      <div class="top-bar-sub">${folderPath} &bull; <span style="color:#fcd34d;">Tip: In print settings, uncheck "Headers and footers" for a clean look without browser URLs.</span></div>
    </div>
    <div class="top-bar-actions">
      <div class="btn-group">
        <button id="btn-mode-compact" class="btn-toggle active" onclick="setLayoutMode('compact')" title="Save pages with compact margins and tight spacing">⚡ Compact (Save Pages)</button>
        <button id="btn-mode-standard" class="btn-toggle" onclick="setLayoutMode('standard')" title="Standard spacious layout">📐 Standard</button>
      </div>
      <div class="btn-group">
        <button id="btn-col-1" class="btn-toggle active" onclick="setColumns(1)" title="Single column width">📄 1 Col</button>
        <button id="btn-col-2" class="btn-toggle" onclick="setColumns(2)" title="2-column newspaper style for text-heavy summaries">📰 2 Col</button>
      </div>
      <button class="btn-print" onclick="window.print()">
        <span>Print / Save as PDF</span>
      </button>
      <button class="btn-close" onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="paper-container">
    <table class="report-table">
      <thead>
        <tr>
          <th class="report-th">
            <div class="report-header">
              <span class="report-header-path">${folderPath}</span>
              <span class="report-header-title">Notes &amp; Case Digests</span>
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="report-body-cell">
            <div id="document-body">
              ${htmlContent}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <script>
    function setLayoutMode(mode) {
      const container = document.getElementById('document-body');
      const btnCompact = document.getElementById('btn-mode-compact');
      const btnStandard = document.getElementById('btn-mode-standard');
      if (mode === 'compact') {
        container.classList.remove('standard-mode');
        btnCompact.classList.add('active');
        btnStandard.classList.remove('active');
      } else {
        container.classList.add('standard-mode');
        btnStandard.classList.add('active');
        btnCompact.classList.remove('active');
      }
    }

    function setColumns(cols) {
      const container = document.getElementById('document-body');
      const btn1 = document.getElementById('btn-col-1');
      const btn2 = document.getElementById('btn-col-2');
      if (cols === 2) {
        container.classList.add('two-column-layout');
        btn2.classList.add('active');
        btn1.classList.remove('active');
      } else {
        container.classList.remove('two-column-layout');
        btn1.classList.add('active');
        btn2.classList.remove('active');
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        window.focus();
        window.print();
      }, 400);
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
