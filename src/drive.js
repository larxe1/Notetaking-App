// ═══════════════════════════════════════════════
// GOOGLE DRIVE — auth + upload + fetch PDF
// ═══════════════════════════════════════════════
import { S } from './state.js';
import { toast, syncSpin, syncOK, syncErr } from './ui.js';
import { getCachedPDF, setCachedPDF, deleteCachedPDF } from './pdfcache.js';
import { safeStorageSet, safeStorageGet, safeStorageRemove } from './storage.js';

const CLIENT_ID   = window.APP_CONFIG?.GOOGLE_CLIENT_ID || '';
const SCOPE       = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Legal Annotator';

let _tokenRefreshTimer = null;
let _healthCheckInterval = null;

function getClientId() {
  return window.APP_CONFIG?.GOOGLE_CLIENT_ID || CLIENT_ID || '';
}

async function ensureGoogleScript() {
  if (typeof google !== 'undefined' && google.accounts?.oauth2) {
    return true;
  }
  // Wait up to 3 seconds for script if it is currently loading
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (typeof google !== 'undefined' && google.accounts?.oauth2) {
      return true;
    }
  }
  // Dynamically inject script tag if missing
  if (!document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
    console.log('[Drive Auth] Injecting Google Identity Services script tag');
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (typeof google !== 'undefined' && google.accounts?.oauth2) {
        return true;
      }
    }
  }
  return typeof google !== 'undefined' && !!google.accounts?.oauth2;
}

// ── Internal: request/refresh an access token ──
// silent=true → no popup (works if user already granted + has active Google session)
async function _requestToken(silent = false) {
  const isLoaded = await ensureGoogleScript();
  if (!isLoaded) {
    throw new Error('Google Identity Services failed to load. Please check your internet connection or ad-blocker.');
  }

  const clientId = getClientId();
  if (!clientId) {
    throw new Error('Google Client ID is not configured.');
  }

  return new Promise((resolve, reject) => {
    let resolvedOrRejected = false;

    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      error_callback: (err) => {
        if (resolvedOrRejected) return;
        resolvedOrRejected = true;
        console.error('[Drive Auth] Google token client error:', err);
        const errMsg = err?.message || err?.type || 'OAuth window closed or blocked';
        reject(new Error(errMsg));
      },
      callback: async (resp) => {
        if (resolvedOrRejected) return;
        if (resp.error) {
          resolvedOrRejected = true;
          console.error('[Drive Auth] Google response error:', resp);
          reject(new Error(resp.error_description || resp.error || 'Authentication error'));
          return;
        }

        try {
          S.driveToken = resp.access_token;
          safeStorageSet('driveToken', S.driveToken);
          safeStorageSet('driveTokenExpiry', Date.now() + 3500000); // ~58 mins

          // Get user info (only needed on first sign-in)
          if (!S.driveUser) {
            try {
              const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${S.driveToken}` }
              });
              if (r.ok) {
                const info = await r.json();
                S.driveUser = info.email || 'Connected';
              } else {
                S.driveUser = 'Connected';
              }
            } catch {
              S.driveUser = 'Connected';
            }
            safeStorageSet('driveUser', S.driveUser);
          }

          // Ensure our app folder exists (non-blocking if temporary Drive API issue)
          try {
            S.driveFolderId = await ensureAppFolder();
            safeStorageSet('driveFolderId', S.driveFolderId);
          } catch (fErr) {
            console.warn('[Drive Auth] App folder could not be verified on login (will retry on upload):', fErr);
          }

          hideDriveWarning();
          updateDriveBar();
          _scheduleRefresh();   // schedule the next silent refresh
          _startHealthCheck(); // begin periodic token health checks

          resolvedOrRejected = true;
          resolve();
        } catch (procErr) {
          resolvedOrRejected = true;
          console.error('[Drive Auth] Error during post-auth processing:', procErr);
          reject(procErr);
        }
      },
    });

    try {
      client.requestAccessToken({ prompt: silent ? '' : 'select_account' });
    } catch (reqErr) {
      resolvedOrRejected = true;
      console.error('[Drive Auth] requestAccessToken threw:', reqErr);
      reject(reqErr);
    }
  });
}

// -- Schedule a silent token refresh ~50 mins from now --
function _scheduleRefresh() {
  if (_tokenRefreshTimer) clearTimeout(_tokenRefreshTimer);
  _tokenRefreshTimer = setTimeout(async () => {
    try {
      await _requestToken(true); // silent
      await _verifyToken();      // confirm it actually works
    } catch {
      _onSessionExpired();
    }
  }, 50 * 60 * 1000); // 50 minutes
}

// -- Start a periodic health check every 5 minutes --
function _startHealthCheck() {
  _stopHealthCheck(); // clear any existing interval first
  _healthCheckInterval = setInterval(async () => {
    if (S.driveToken) {
      await _verifyToken();
    }
  }, 5 * 60 * 1000); // every 5 minutes
}

// -- Stop the periodic health check --
function _stopHealthCheck() {
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
}

// -- Ping Google OAuth endpoint to confirm token is actually valid --
async function _verifyToken() {
  if (!S.driveToken) return;
  try {
    const r = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(S.driveToken)}`
    );
    if (r.status === 400 || r.status === 401) {
      console.warn('[Drive] Token verification failed (expired or revoked):', r.status);
      _onSessionExpired();
    } else if (r.ok) {
      hideDriveWarning();
    }
  } catch {
    // Network error — don't sign out, just warn
    showDriveWarning('No internet connection. Drive is offline.');
  }
}

// -- Called when we detect the Drive session is dead / needs login --
export function _onSessionExpired() {
  _stopHealthCheck();
  if (_tokenRefreshTimer) { clearTimeout(_tokenRefreshTimer); _tokenRefreshTimer = null; }
  S.driveToken    = null;
  S.driveUser     = null;
  S.driveFolderId = null;
  safeStorageRemove('driveToken');
  safeStorageRemove('driveUser');
  safeStorageRemove('driveTokenExpiry');
  safeStorageRemove('driveFolderId');
  updateDriveBar();

  // Show warning banner with explicit user action button (never open unprompted popups)
  showDriveWarning('Google Drive session expired. Click "Sign in again" to reconnect.');
}

// -- Show / hide the Drive warning banner --
export function showDriveWarning(msg) {
  let banner = document.getElementById('drive-warn-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'drive-warn-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'background:#7f1d1d', 'color:#fecaca',
      'font-size:13px', 'font-family:Inter,sans-serif',
      'padding:10px 16px', 'display:flex', 'align-items:center', 'gap:12px',
      'box-shadow:0 4px 12px rgba(0,0,0,.5)',
      'border-bottom:1px solid #991b1b',
      'animation:slideDown .25s ease',
    ].join(';');
    document.head.insertAdjacentHTML('beforeend',
      '<style>@keyframes slideDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}</style>');
    document.body.appendChild(banner);
  }
  banner.innerHTML = `
    <span style="font-size:18px">⚠️</span>
    <span style="flex:1">${msg}</span>
    <button id="drive-warn-signin" style="background:#991b1b;border:1px solid #ef4444;color:#fecaca;
      border-radius:5px;padding:4px 12px;cursor:pointer;font-size:12px;font-family:Inter,sans-serif;
      white-space:nowrap;transition:background .15s">Sign in again</button>
    <button id="drive-warn-close" style="background:none;border:none;color:#fca5a5;font-size:18px;
      cursor:pointer;padding:0 2px;line-height:1" title="Dismiss">×</button>
  `;
  document.getElementById('drive-warn-signin')?.addEventListener('click', async () => {
    try {
      await driveSignIn();
      hideDriveWarning();
      toast('Google Drive reconnected!');
    } catch { toast('Sign-in failed. Try again.'); }
  });
  document.getElementById('drive-warn-close')?.addEventListener('click', hideDriveWarning);
}

export function hideDriveWarning() {
  document.getElementById('drive-warn-banner')?.remove();
}

let _signInInProgress = false;

// ── Sign in (user-initiated, shows account picker) ──
export async function driveSignIn() {
  if (_signInInProgress) {
    console.warn('[Drive Auth] Sign-in already in progress, ignoring duplicate trigger');
    return;
  }
  _signInInProgress = true;
  try {
    await _requestToken(false);
    toast('Google Drive connected!');
  } catch (err) {
    console.error('[Drive Auth] Sign-in failed:', err);
    const msg = (err?.message || err?.type || String(err || '')).toLowerCase();
    if (msg.includes('popup_closed') || msg.includes('user_cancel') || msg.includes('cancel')) {
      toast('Sign-in cancelled.');
    } else if (msg.includes('popup_blocked') || msg.includes('blocked')) {
      toast('⚠️ Pop-up was blocked by browser. Please click the pop-up icon in your address bar to allow pop-ups.');
    } else if (msg.includes('access_denied')) {
      toast('⚠️ Google Drive permission was denied.');
    } else if (msg.includes('identity services') || msg.includes('script')) {
      toast('⚠️ Google sign-in script could not load. Check your internet connection or ad-blocker.');
    } else if (!navigator.onLine || msg.includes('network') || msg.includes('offline')) {
      toast('⚠️ Offline: check your internet connection.');
    } else {
      toast(`Drive sign-in failed: ${err?.message || 'Check browser console'}`);
    }
    throw err;
  } finally {
    _signInInProgress = false;
  }
}

export function driveSignOut() {
  if (S.driveToken && typeof google !== 'undefined' && google.accounts?.oauth2) {
    try { google.accounts.oauth2.revoke(S.driveToken); } catch {}
  }
  if (_tokenRefreshTimer) clearTimeout(_tokenRefreshTimer);
  _stopHealthCheck();
  S.driveToken = null;
  S.driveUser  = null;
  S.driveFolderId = null;
  safeStorageRemove('driveToken');
  safeStorageRemove('driveUser');
  safeStorageRemove('driveTokenExpiry');
  safeStorageRemove('driveFolderId');
  hideDriveWarning();
  updateDriveBar();
}

function updateDriveBar() {
  const userEl = document.getElementById('drive-user');
  const btnEl  = document.getElementById('drive-sign-btn');
  if (!userEl || !btnEl) return;

  if (S.driveUser) {
    userEl.textContent = S.driveUser;
    btnEl.textContent  = 'Sign out';
    btnEl.title        = 'Sign out of Google Drive';
  } else {
    userEl.textContent = 'Not connected';
    btnEl.textContent  = 'Sign in';
    btnEl.title        = 'Sign in to Google Drive';
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

// ── Ensure a named subfolder exists inside a parent Drive folder ──
export async function driveEnsureSubFolder(name, parentId) {
  const safeParent = parentId || S.driveFolderId;
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${safeParent}' in parents and trashed=false`;
  const resp = await driveGet(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  if (resp.files && resp.files.length > 0) return resp.files[0].id;

  // Create it
  const meta = { name, mimeType: 'application/vnd.google-apps.folder', parents: [safeParent] };
  const created = await drivePost('https://www.googleapis.com/drive/v3/files?fields=id', meta);
  return created.id;
}

// ── Upload PDF to Drive ──
// targetFolderId: optional Drive folder ID to place the file in (defaults to root app folder)
export async function driveUploadPDF(file, targetFolderId) {
  if (!S.driveToken) throw new Error('Not signed in to Google Drive');
  if (!S.driveFolderId) S.driveFolderId = await ensureAppFolder();

  const parentId = targetFolderId || S.driveFolderId;

  syncSpin('Uploading to Drive…');
  const meta = {
    name: file.name,
    parents: [parentId],
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

// ── Fetch PDF bytes from Drive (with RAM + IndexedDB disk cache) ──
export async function driveFetchPDF(drive_file_id, onProgress = null, pdfName = '') {
  if (!drive_file_id) {
    throw new Error('No Google Drive file attached to this PDF entry.');
  }

  // 1. Check in-memory RAM cache (instant 0ms)
  if (S.pdfCache[drive_file_id]) return S.pdfCache[drive_file_id];

  // 2. Check persistent IndexedDB disk cache (instant < 15ms without network)
  const cachedBuf = await getCachedPDF(drive_file_id);
  if (cachedBuf) {
    S.pdfCache[drive_file_id] = cachedBuf;
    syncOK('Loaded from Local Cache');
    return cachedBuf;
  }

  if (!S.driveToken) {
    throw new Error('Not signed in to Google Drive');
  }

  // ── Inner helper: attempt one fetch with the current token ──
  async function _doFetch(token) {
    return fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(drive_file_id)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }

  syncSpin('Downloading from Drive…');
  let resp = await _doFetch(S.driveToken);

  // ── On 401: try one silent token refresh before giving up ──
  if (resp.status === 401) {
    try {
      await _requestToken(true); // silent refresh — no popup, fast if Google session is active
      resp = await _doFetch(S.driveToken); // retry with the fresh token
    } catch {
      // Silent refresh failed — must show login prompt
      _onSessionExpired();
      throw new Error('Google Drive session expired. Please sign in again.');
    }
    // If the retry also fails with 401, fall through to the error handler below
  }

  if (!resp.ok) {
    if (resp.status === 401) {
      _onSessionExpired();
      throw new Error('Google Drive session expired. Please sign in again.');
    }
    syncErr('Download failed');
    throw new Error(`Drive download failed (${resp.status}): ${resp.statusText || 'File inaccessible'}`);
  }

  // Stream chunks with live percentage & MB progress indicator
  const contentLength = resp.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  let loaded = 0;

  const reader = resp.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;

    if (total > 0) {
      const pct = Math.min(100, Math.round((loaded / total) * 100));
      const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
      const totalMB = (total / (1024 * 1024)).toFixed(1);
      syncSpin(`Downloading: ${pct}% (${loadedMB}/${totalMB} MB)`);
      if (onProgress) onProgress(pct, loadedMB, totalMB);
    } else {
      const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
      syncSpin(`Downloading: ${loadedMB} MB…`);
      if (onProgress) onProgress(null, loadedMB, null);
    }
  }

  const blob = new Blob(chunks, { type: 'application/pdf' });

  // Store Blob directly in RAM — no ArrayBuffer conversion, no extra 150MB memory copy
  S.pdfCache[drive_file_id] = blob;
  syncOK('Downloaded & Cached');

  // Save to persistent IndexedDB disk cache as Blob (single write, zero V8 clone overhead)
  setCachedPDF(drive_file_id, blob, pdfName);
  return blob;
}

// ── Delete file from Drive + Local Cache ──
export async function driveDeleteFile(drive_file_id) {
  if (!drive_file_id) return;
  delete S.pdfCache[drive_file_id];
  deleteCachedPDF(drive_file_id);
  if (!S.driveToken) return;
  await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(drive_file_id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${S.driveToken}` },
  }).catch(() => {}); // best-effort
}

// ── Helper: authenticated GET ──
async function driveGet(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${S.driveToken}` } });
  if (r.status === 401) { _onSessionExpired(); throw new Error('Drive session expired'); }
  if (!r.ok) throw new Error(`Drive request failed (${r.status})`);
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
  if (r.status === 401) { _onSessionExpired(); throw new Error('Drive session expired'); }
  if (!r.ok) throw new Error(`Drive request failed (${r.status})`);
  return r.json();
}

// ── Init: render drive bar on load ──
export function initDriveBar() {
  const token  = safeStorageGet('driveToken');
  const expiry = safeStorageGet('driveTokenExpiry');
  const user   = safeStorageGet('driveUser');

  if (token && expiry && Date.now() < parseInt(expiry)) {
    // Token still valid from cache — restore session
    S.driveToken    = token;
    S.driveUser     = user;
    S.driveFolderId = safeStorageGet('driveFolderId');
    updateDriveBar();
    // Verify the cached token is actually still accepted by Google
    // (It may have been revoked, even if it hasn't expired yet)
    setTimeout(() => _verifyToken(), 2000);
    _scheduleRefresh();
    _startHealthCheck(); // begin 5-min periodic checks
  } else if (user) {
    // Token expired but user previously signed in — try silent refresh
    S.driveUser = user; // keep name visible while refreshing
    updateDriveBar();
    const trySilent = async () => {
      try {
        await _requestToken(true);
        await _verifyToken();
      } catch {
        _onSessionExpired();
      }
    };
    if (typeof google !== 'undefined') {
      trySilent();
    } else {
      setTimeout(trySilent, 1000);
    }
  } else {
    // Never signed in
    updateDriveBar();
  }

  const signBtn = document.getElementById('drive-sign-btn');
  if (signBtn) {
    signBtn.onclick = async () => {
      if (S.driveUser) {
        driveSignOut();
        toast('Signed out of Google Drive');
      } else {
        try {
          await driveSignIn();
        } catch {}
      }
    };
  }
}
