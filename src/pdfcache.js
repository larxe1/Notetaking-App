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

export async function setCachedPDF(fileId, buffer) {
  try {
    const db = await getDB();
    if (!db || !buffer) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      id: fileId,
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
