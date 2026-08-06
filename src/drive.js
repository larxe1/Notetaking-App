// ═══════════════════════════════════════════════
// GOOGLE DRIVE — auth + upload + fetch PDF
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { toast, syncSpin, syncOK, syncErr } from './ui.js';

const CLIENT_ID   = window.APP_CONFIG.GOOGLE_CLIENT_ID;
const SCOPE       = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Legal Annotator';

// ── Sign in / get token ──
export async function driveSignIn() {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: async (resp) => {
        if (resp.error) { reject(resp); return; }
        S.driveToken = resp.access_token;
        // Get user info
        try {
          const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${S.driveToken}` }
          });
          const info = await r.json();
          S.driveUser = info.email || 'Connected';
        } catch { S.driveUser = 'Connected'; }
        // Ensure our folder exists
        S.driveFolderId = await ensureAppFolder();
        updateDriveBar();
        resolve();
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export function driveSignOut() {
  if (S.driveToken) google.accounts.oauth2.revoke(S.driveToken);
  S.driveToken = null;
  S.driveUser  = null;
  S.driveFolderId = null;
  updateDriveBar();
}

function updateDriveBar() {
  const userEl = document.getElementById('drive-user');
  const btnEl  = document.getElementById('drive-sign-btn');
  if (S.driveUser) {
    userEl.textContent = S.driveUser;
    btnEl.textContent  = 'Sign out';
    btnEl.onclick = driveSignOut;
  } else {
    userEl.textContent = 'Not connected';
    btnEl.textContent  = 'Sign in';
    btnEl.onclick = async () => {
      try { await driveSignIn(); toast('Google Drive connected!'); }
      catch { toast('Drive sign-in failed'); }
    };
  }
}

// ── Ensure "Legal Annotator" folder exists in Drive ──
async function ensureAppFolder() {
  const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const resp = await driveGet(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  if (resp.files && resp.files.length > 0) return resp.files[0].id;

  // Create it
  const meta = { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' };
  const created = await drivePost('https://www.googleapis.com/drive/v3/files?fields=id', meta);
  return created.id;
}

// ── Upload PDF to Drive ──
export async function driveUploadPDF(file) {
  if (!S.driveToken) throw new Error('Not signed in to Google Drive');
  if (!S.driveFolderId) S.driveFolderId = await ensureAppFolder();

  syncSpin('Uploading to Drive…');
  const meta = {
    name: file.name,
    parents: [S.driveFolderId],
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', file);

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${S.driveToken}` },
      body: form,
    }
  );
  if (!resp.ok) {
    const err = await resp.text();
    syncErr('Upload failed');
    throw new Error(err);
  }
  const data = await resp.json();
  syncOK('Uploaded to Drive');
  return data; // { id, name }
}

// ── Fetch PDF bytes from Drive (with cache) ──
export async function driveFetchPDF(drive_file_id) {
  // Cache by file ID (fix bug #4)
  if (S.pdfCache[drive_file_id]) return S.pdfCache[drive_file_id];

  if (!S.driveToken) throw new Error('Not signed in to Google Drive');
  syncSpin('Downloading from Drive…');

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${drive_file_id}?alt=media`,
    { headers: { Authorization: `Bearer ${S.driveToken}` } }
  );
  if (!resp.ok) throw new Error('Drive download failed: ' + resp.status);
  const buf = await resp.arrayBuffer();
  S.pdfCache[drive_file_id] = buf;
  return buf;
}

// ── Delete file from Drive ──
export async function driveDeleteFile(drive_file_id) {
  if (!S.driveToken || !drive_file_id) return;
  await fetch(`https://www.googleapis.com/drive/v3/files/${drive_file_id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${S.driveToken}` },
  }).catch(() => {}); // best-effort
}

// ── Helper: authenticated GET ──
async function driveGet(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${S.driveToken}` } });
  return r.json();
}

// ── Helper: authenticated POST with JSON body ──
async function drivePost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${S.driveToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ── Init: render drive bar on load ──
export function initDriveBar() {
  updateDriveBar();
  document.getElementById('drive-sign-btn').addEventListener('click', async () => {
    if (S.driveUser) {
      driveSignOut();
      toast('Signed out of Google Drive');
    } else {
      try { await driveSignIn(); toast('Google Drive connected!'); }
      catch { toast('Drive sign-in failed'); }
    }
  });
}
