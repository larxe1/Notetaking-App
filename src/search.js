// ═══════════════════════════════════════════════
// SEARCH — PDF text search + annotation search
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { closeOtherPanels } from './ui.js';

let searchMode = 'pdf'; // 'pdf' | 'ann'

export function openSearch() {
  closeOtherPanels('search-panel');
  document.getElementById('search-panel').classList.add('open');
  document.getElementById('search-input').focus();
  document.getElementById('search-ann-results').style.display = searchMode === 'ann' ? 'block' : 'none';
}

export function closeSearch() {
  document.getElementById('search-panel').classList.remove('open');
  clearSearchHighlights();
  document.getElementById('search-count').textContent = '';
  document.getElementById('search-input').value = '';
}

export function clearSearchHighlights() {
  document.querySelectorAll('.srch-hi').forEach(el => el.remove());
  S.searchResults = [];
  S.searchIdx = 0;
}

export function initSearch() {
  // Tab toggle
  document.querySelectorAll('.stab').forEach(btn => {
    btn.addEventListener('click', () => {
      searchMode = btn.dataset.stab;
      document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('search-ann-results').style.display = searchMode === 'ann' ? 'block' : 'none';
      runSearch();
    });
  });

  document.getElementById('btn-search').addEventListener('click', openSearch);
  document.getElementById('search-close-btn').addEventListener('click', closeSearch);

  let debounce = null;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 200);
  });
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') nextSearchResult(e.shiftKey ? -1 : 1);
    if (e.key === 'Escape') closeSearch();
  });
  document.getElementById('snext').addEventListener('click', () => nextSearchResult(1));
  document.getElementById('sprev').addEventListener('click', () => nextSearchResult(-1));
}

function runSearch() {
  clearSearchHighlights();
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  if (!q) {
    document.getElementById('search-count').textContent = '';
    document.getElementById('search-ann-results').innerHTML = '';
    return;
  }
  if (searchMode === 'pdf') runPDFSearch(q);
  else                      runAnnSearch(q);
}

let _searchQueryId = 0;

// ── PDF text search — searches full PDF document on-demand ──
async function runPDFSearch(q) {
  const currentQueryId = ++_searchQueryId;
  S.searchResults = [];
  document.getElementById('search-count').textContent = 'Searching…';

  if (!S.pdfDoc) return;

  for (let pn = 1; pn <= S.totalPages; pn++) {
    if (currentQueryId !== _searchQueryId) return; // cancelled by new search query

    let textItems = S.pages[pn]?.textItems;
    if (!textItems || !textItems.length) {
      try {
        const page = await S.pdfDoc.getPage(pn);
        const vp = page.getViewport({ scale: S.scale });
        const tc = await page.getTextContent();
        textItems = [];
        for (const item of tc.items) {
          if (!item.str || !item.transform) continue;
          const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
          const fh = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
          textItems.push({
            str: item.str,
            x: item.transform[4] * S.scale,
            y: vp.height - item.transform[5] * S.scale,
            w: (item.width || 0) * S.scale,
            h: (item.height || fh) * S.scale,
          });
        }
        if (S.pages[pn]) S.pages[pn].textItems = textItems;
      } catch (err) {
        continue;
      }
    }

    for (const item of textItems) {
      const lower = item.str.toLowerCase();
      let start = 0;
      while (true) {
        const idx = lower.indexOf(q, start);
        if (idx < 0) break;

        // Calculate sub-rect for the matched portion only
        const charW  = item.w / (item.str.length || 1);
        const matchX = item.x + idx * charW;
        const matchW = q.length * charW;

        S.searchResults.push({
          page: pn,
          item,
          matchX,
          matchW,
          matchY: item.y,
          matchH: item.h,
          q,
        });
        start = idx + q.length;
      }
    }
  }

  if (currentQueryId !== _searchQueryId) return;

  for (const res of S.searchResults) drawSearchHL(res, false);
  S.searchIdx = 0;

  if (S.searchResults.length) {
    highlightCurrentResult();
  } else {
    document.getElementById('search-count').textContent = 'No results';
  }
}

export function drawSearchHL(res, isCurrent) {
  const pg = S.pages[res.page];
  if (!pg || !pg.rendered || !pg.srchOv) return;
  const d  = document.createElement('div');
  d.className = 'srch-hi' + (isCurrent ? ' current' : '');
  // Use exact match sub-rect (not entire word box)
  d.style.cssText = `left:${res.matchX}px;top:${res.matchY - res.matchH * .1}px;width:${res.matchW}px;height:${res.matchH * 1.2}px`;
  d.dataset.sridx = S.searchResults.indexOf(res);
  pg.srchOv.appendChild(d);
}

async function highlightCurrentResult() {
  document.querySelectorAll('.srch-hi').forEach(el => el.classList.remove('current'));
  const res = S.searchResults[S.searchIdx]; if (!res) return;
  
  const { jumpToPage } = await import('./ui.js');
  await jumpToPage(res.page);

  const el = document.querySelector(`.srch-hi[data-sridx="${S.searchIdx}"]`);
  if (el) el.classList.add('current');
  document.getElementById('search-count').textContent = `${S.searchIdx + 1} / ${S.searchResults.length}`;
}

function nextSearchResult(dir) {
  if (!S.searchResults.length) return;
  S.searchIdx = (S.searchIdx + dir + S.searchResults.length) % S.searchResults.length;
  highlightCurrentResult();
}

// ── Annotation search ──
function runAnnSearch(q) {
  const results = document.getElementById('search-ann-results');
  results.style.display = 'block';
  const stripHTML = html => html.replace(/<[^>]*>/g, '');
  const matches = S.annotations.filter(a =>
    a.highlighted_text?.toLowerCase().includes(q) ||
    a.notes.some(n => stripHTML(n.note_html).toLowerCase().includes(q))
  );
  document.getElementById('search-count').textContent =
    matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'No matches';
  if (!matches.length) {
    results.innerHTML = '<div class="sar-empty">No matching annotations.</div>';
    return;
  }
  results.innerHTML = '';
  const sorted = [...matches].sort((a, b) => a.page - b.page);
  for (const ann of sorted) {
    const noteMatch = ann.notes.find(n => stripHTML(n.note_html).toLowerCase().includes(q));
    const item = document.createElement('div');
    item.className = 'sar-item';
    item.innerHTML =
      `<div class="sar-ex">"${ann.highlighted_text.slice(0, 60)}${ann.highlighted_text.length > 60 ? '…' : ''}"</div>` +
      (noteMatch ? `<div class="sar-note">${stripHTML(noteMatch.note_html).slice(0, 70)}</div>` : '') +
      `<div class="sar-page">Page ${ann.page}</div>`;
    item.addEventListener('click', async () => {
      const { jumpToPage } = await import('./ui.js');
      await jumpToPage(ann.page);
      import('./annotate.js').then(({ openAnnPanel }) => setTimeout(() => openAnnPanel(ann), 300));
    });
    results.appendChild(item);
  }
}
