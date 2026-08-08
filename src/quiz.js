import { S } from './state.js';
import { openModal, toast } from './ui.js';
import { generateMCQ, generateEssayQuestion, gradeEssay } from './ai.js';

let currentPdfText = '';
let currentMCQ = null;
let currentEssayQuestion = '';

const els = {
  setup: document.getElementById('quiz-setup'),
  selectMode: document.getElementById('quiz-select-mode'),
  loading: document.getElementById('quiz-loading'),
  loadingTxt: document.getElementById('quiz-loading-txt'),
  mcqUI: document.getElementById('quiz-mcq-ui'),
  mcqQs: document.getElementById('mcq-questions'),
  mcqRes: document.getElementById('mcq-result'),
  essayUI: document.getElementById('quiz-essay-ui'),
  essayQ: document.getElementById('essay-question'),
  essayAns: document.getElementById('essay-answer'),
  essayRes: document.getElementById('essay-result'),
  essayGrade: document.getElementById('essay-grade'),
  essayFb: document.getElementById('essay-feedback')
};

function showState(stateName) {
  Object.values(els).forEach(el => {
    if (el && el.id && el.id.startsWith('quiz-')) {
      if (el === els.loadingTxt || el === els.mcqQs || el === els.essayQ || el === els.essayAns || el === els.essayRes) return;
      el.style.display = 'none';
    }
  });
  if (els[stateName]) els[stateName].style.display = (stateName === 'essayUI') ? 'flex' : 'block';
}

function parsePageRange(rangeStr, maxPages) {
  if (!rangeStr.trim()) return null;
  const pages = new Set();
  const parts = rangeStr.split(',');
  for (let p of parts) {
    p = p.trim();
    if (p.includes('-')) {
      const [start, end] = p.split('-').map(x => parseInt(x));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= 1 && i <= maxPages) pages.add(i);
        }
      }
    } else {
      const val = parseInt(p);
      if (!isNaN(val) && val >= 1 && val <= maxPages) pages.add(val);
    }
  }
  return Array.from(pages).sort((a,b) => a - b);
}

async function extractPdfText() {
  if (!S.pdfDoc) return '';
  let fullText = '';
  
  const rangeStr = document.getElementById('quiz-page-range').value;
  const pageList = parsePageRange(rangeStr, S.pdfDoc.numPages);
  
  const limit = pageList ? pageList.length : Math.min(S.pdfDoc.numPages, 100);
  for (let idx = 0; idx < limit; idx++) {
    const i = pageList ? pageList[idx] : idx + 1;
    try {
      const page = await S.pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    } catch (e) {
      console.warn('Failed to extract page', i);
    }
  }
  return fullText.length > 900000 ? fullText.substring(0, 900000) : fullText;
}

document.getElementById('btn-quiz-pdf').addEventListener('click', async () => {
  if (!S.pdfDoc) return toast('Please open a PDF first.');
  openModal('mo-quiz');
  
  if (!localStorage.getItem('gemini_api_key')) {
    showState('setup');
  } else {
    showState('selectMode');
  }
});

document.getElementById('btn-save-key').addEventListener('click', () => {
  const key = document.getElementById('quiz-api-key').value.trim();
  if (!key) return toast('Please enter a valid key.');
  localStorage.setItem('gemini_api_key', key);
  showState('selectMode');
});

// MCQ Mode
document.getElementById('btn-quiz-mcq').addEventListener('click', async () => {
  showState('loading');
  els.loadingTxt.textContent = 'Extracting PDF text...';
  
  const key = localStorage.getItem('gemini_api_key');
  if (!currentPdfText) currentPdfText = await extractPdfText();
  
  els.loadingTxt.textContent = 'Gemini AI is generating your quiz...';
  
  try {
    const topic = document.getElementById('quiz-topic').value.trim();
    currentMCQ = await generateMCQ(currentPdfText, key, topic);
    renderMCQ(currentMCQ);
    showState('mcqUI');
  } catch (err) {
    console.error(err);
    toast(err.message);
    showState('selectMode');
  }
});

function renderMCQ(questions) {
  els.mcqQs.innerHTML = '';
  els.mcqRes.style.display = 'none';
  
  questions.forEach((q, qIndex) => {
    const qDiv = document.createElement('div');
    qDiv.className = 'mcq-q-block';
    
    let html = `<div style="font-weight:600; margin-bottom:12px; color:#e8e4db">${qIndex + 1}. ${q.question}</div>`;
    
    q.options.forEach((opt, oIndex) => {
      html += `
        <label style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px; cursor:pointer; color:var(--text)">
          <input type="radio" name="q${qIndex}" value="${oIndex}" style="margin-top:4px">
          <span class="mcq-opt-text" id="opt-txt-${qIndex}-${oIndex}">${opt}</span>
        </label>
      `;
    });
    
    qDiv.innerHTML = html;
    els.mcqQs.appendChild(qDiv);
  });
}

document.getElementById('btn-submit-mcq').addEventListener('click', () => {
  let score = 0;
  
  currentMCQ.forEach((q, qIndex) => {
    const selected = document.querySelector(`input[name="q${qIndex}"]:checked`);
    const correctIdx = q.correct_index;
    
    // Highlight correct
    const correctEl = document.getElementById(`opt-txt-${qIndex}-${correctIdx}`);
    if (correctEl) correctEl.style.color = '#4ade80';
    
    if (selected) {
      const selectedIdx = parseInt(selected.value);
      if (selectedIdx === correctIdx) {
        score++;
      } else {
        // Highlight wrong
        const wrongEl = document.getElementById(`opt-txt-${qIndex}-${selectedIdx}`);
        if (wrongEl) wrongEl.style.color = '#ef4444';
      }
    }
  });
  
  els.mcqRes.textContent = `You scored ${score} out of ${currentMCQ.length}`;
  els.mcqRes.style.display = 'block';
});

// Essay Mode
document.getElementById('btn-quiz-essay').addEventListener('click', async () => {
  showState('loading');
  els.loadingTxt.textContent = 'Extracting PDF text...';
  
  const key = localStorage.getItem('gemini_api_key');
  if (!currentPdfText) currentPdfText = await extractPdfText();
  
  els.loadingTxt.textContent = 'Gemini AI is crafting a complex essay question...';
  
  try {
    const topic = document.getElementById('quiz-topic').value.trim();
    currentEssayQuestion = await generateEssayQuestion(currentPdfText, key, topic);
    els.essayQ.textContent = currentEssayQuestion;
    els.essayAns.value = '';
    els.essayRes.style.display = 'none';
    showState('essayUI');
  } catch (err) {
    console.error(err);
    toast(err.message);
    showState('selectMode');
  }
});

document.getElementById('btn-submit-essay').addEventListener('click', async () => {
  const ans = els.essayAns.value.trim();
  if (!ans) return toast('Please write an answer first.');
  
  showState('loading');
  els.loadingTxt.textContent = 'The Professor is grading your essay...';
  const key = localStorage.getItem('gemini_api_key');
  
  try {
    const result = await gradeEssay(currentPdfText, currentEssayQuestion, ans, key);
    els.essayGrade.textContent = result.grade;
    els.essayFb.textContent = result.critique;
    
    showState('essayUI');
    els.essayRes.style.display = 'block';
  } catch (err) {
    console.error(err);
    toast(err.message);
    showState('essayUI');
  }
});
