// ═══════════════════════════════════════════════
// PDF CACHE — Persistent IndexedDB Cache for PDFs
// ═══════════════════════════════════════════════

const DB_NAME = 'LegalAnnotatorCache';
const DB_VERSION = 1;
const STORE_NAME = 'pdf_blobs';

let _dbPromise = null;

function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      return resolve(null);
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => {
      console.warn('[PDFCache] IndexedDB open error', e);
      resolve(null);
    };
  });
  return _dbPromise;
}

// ── Ask browser to never purge our cache under low disk space ──
export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persist();
      console.log(`[PDFCache] Persistent storage granted: ${isPersisted}`);
      return isPersisted;
    } catch (e) {
      console.warn('[PDFCache] Error requesting storage persistence:', e);
    }
  }
  return false;
}

export async function isPDFCached(fileId) {
  if (!fileId) return false;
  try {
    const db = await getDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count(fileId);
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function getCachedPDF(fileId) {
  try {
    const db = await getDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(fileId);
      req.onsuccess = () => resolve(req.result ? req.result.buffer : null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('[PDFCache] getCachedPDF failed', err);
    return null;
  }
}

export async function setCachedPDF(fileId, buffer, name = '') {
  try {
    const db = await getDB();
    if (!db || !buffer) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      id: fileId,
      name: name,
      size: buffer.byteLength || 0,
      buffer: buffer,
      saved_at: Date.now(),
    });
  } catch (err) {
    console.warn('[PDFCache] setCachedPDF failed', err);
  }
}

export async function deleteCachedPDF(fileId) {
  try {
    const db = await getDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(fileId);
  } catch (err) {
    console.warn('[PDFCache] deleteCachedPDF failed', err);
  }
}

// ── Get cache statistics for Settings Modal ──
export async function getCacheStorageStats() {
  try {
    const db = await getDB();
    if (!db) return { count: 0, totalBytes: 0, formattedSize: '0 MB' };
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        let totalBytes = 0;
        items.forEach(item => {
          totalBytes += item.size || item.buffer?.byteLength || 0;
        });
        const mb = (totalBytes / (1024 * 1024)).toFixed(1);
        resolve({
          count: items.length,
          totalBytes,
          formattedSize: `${mb} MB`
        });
      };
      req.onerror = () => resolve({ count: 0, totalBytes: 0, formattedSize: '0 MB' });
    });
  } catch (e) {
    console.warn('[PDFCache] getCacheStorageStats failed', e);
    return { count: 0, totalBytes: 0, formattedSize: '0 MB' };
  }
}

// ── Clear all cached PDFs from local disk ──
export async function clearAllCachedPDFs() {
  try {
    const db = await getDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[PDFCache] clearAllCachedPDFs failed', e);
  }
}

// ── Download and Cache a PDF on demand (e.g. from right-click menu) ──
export async function preCachePDF(pdf) {
  const { driveFetchPDF } = await import('./drive.js');
  const { toast } = await import('./ui.js');

  const driveId = pdf.drive_file_id || (pdf.linked_pdf_id ? (await import('./state.js')).S.pdfs.find(p => p.id === pdf.linked_pdf_id)?.drive_file_id : null);
  if (!driveId) {
    toast('Cannot save: PDF is not linked to Google Drive.');
    return;
  }

  const already = await isPDFCached(driveId);
  if (already) {
    toast(`"${pdf.name}" is already saved for offline study!`);
    return;
  }

  toast(`Downloading "${pdf.name}" for offline use…`);
  try {
    const buf = await driveFetchPDF(driveId);
    await setCachedPDF(driveId, buf, pdf.name);
    toast(`✅ "${pdf.name}" is now ready for offline reading!`);
  } catch (err) {
    console.error('Failed to pre-cache PDF:', err);
    toast('❌ Failed to download PDF for offline use.');
  }
}
