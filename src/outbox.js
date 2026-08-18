// ═══════════════════════════════════════════════
// OUTBOX — Offline Write & Two-Way Auto-Sync Queue
// Allows creating, editing, and deleting notes/highlights offline,
// and automatically replays all changes to Supabase when reconnected.
// ═══════════════════════════════════════════════

const QUEUE_KEY = 'offline_outbox_queue';
let _isReplaying = false;

// ── Read / Write Queue in localStorage ──
export function getOutboxQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveOutboxQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn('[Outbox] Failed to save queue to localStorage:', e);
  }
  updateOutboxUI();
}

// ── Add action to offline queue ──
export function enqueueAction(table, action, data, matchQuery = null) {
  const queue = getOutboxQueue();
  const entry = {
    qid: 'outbox_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    table,
    action, // 'upsert' | 'delete'
    data,
    matchQuery, // { id: '...' } for delete
    created_at: Date.now()
  };

  queue.push(entry);
  saveOutboxQueue(queue);
  console.log(`[Outbox] Enqueued offline action: ${action} on ${table}`, entry);
}

// ── Update sync status bar with pending count ──
export function updateOutboxUI() {
  const queue = getOutboxQueue();
  const stxt = document.getElementById('stxt');
  const sdot = document.getElementById('sdot');
  if (!stxt || !sdot) return;

  if (queue.length > 0) {
    sdot.className = 'sdot spin';
    sdot.style.background = 'var(--gold)';
    stxt.textContent = `Offline (${queue.length} edit${queue.length === 1 ? '' : 's'} pending sync)`;
  } else if (!navigator.onLine) {
    sdot.className = 'sdot ok';
    sdot.style.background = '#38bdf8';
    stxt.textContent = 'Offline Mode (Local Cache)';
  } else {
    sdot.style.background = '';
  }
}

// ── Replay all queued actions to Supabase ──
export async function replayOutbox(dbClient) {
  if (_isReplaying) return;
  if (!navigator.onLine) return;

  const queue = getOutboxQueue();
  if (queue.length === 0) return;

  _isReplaying = true;
  console.log(`[Outbox] Replaying ${queue.length} pending offline actions to Supabase…`);

  const stxt = document.getElementById('stxt');
  const sdot = document.getElementById('sdot');
  if (stxt) stxt.textContent = `Syncing ${queue.length} offline edit${queue.length === 1 ? '' : 's'}…`;
  if (sdot) sdot.className = 'sdot spin';

  const remaining = [];

  for (const item of queue) {
    try {
      if (item.action === 'upsert') {
        const { error } = await dbClient.from(item.table).upsert(item.data);
        if (error) throw error;
      } else if (item.action === 'delete') {
        if (item.matchQuery) {
          const { error } = await dbClient.from(item.table).delete().match(item.matchQuery);
          if (error) throw error;
        }
      }
      console.log(`[Outbox] Successfully synced: ${item.action} on ${item.table}`);
    } catch (err) {
      console.warn(`[Outbox] Action failed to sync (will retry later):`, item, err);
      remaining.push(item);
    }
  }

  saveOutboxQueue(remaining);
  _isReplaying = false;

  if (remaining.length === 0) {
    if (stxt) stxt.textContent = 'DB Sync Active (All Synced)';
    if (sdot) { sdot.className = 'sdot ok'; sdot.style.background = ''; }
    import('./ui.js').then(m => m.toast('✅ Offline changes successfully synced to cloud!'));
  } else {
    updateOutboxUI();
  }
}

// ── Wrapper: Execute Supabase write or safely enqueue if offline ──
export async function safeDbWrite(dbClient, table, action, data, matchQuery = null) {
  // If we know we are offline, enqueue immediately
  if (!navigator.onLine) {
    enqueueAction(table, action, data, matchQuery);
    return;
  }

  try {
    if (action === 'upsert') {
      const { error } = await dbClient.from(table).upsert(data);
      if (error) throw error;
    } else if (action === 'delete') {
      if (matchQuery) {
        const { error } = await dbClient.from(table).delete().match(matchQuery);
        if (error) throw error;
      }
    }
  } catch (err) {
    console.warn(`[Outbox] Direct Supabase write failed — saving to offline outbox queue:`, err);
    enqueueAction(table, action, data, matchQuery);
  }
}

// ── Initialize event listeners for online reconnection ──
export function initOutbox(dbClient) {
  // 1. When Wi-Fi reconnects, automatically replay queue
  window.addEventListener('online', () => {
    console.log('[Outbox] Device is back ONLINE. Triggering auto-sync…');
    replayOutbox(dbClient);
  });

  window.addEventListener('offline', () => {
    console.log('[Outbox] Device went OFFLINE.');
    updateOutboxUI();
  });

  // 2. Periodic sync check every 30 seconds
  setInterval(() => {
    if (navigator.onLine && getOutboxQueue().length > 0) {
      replayOutbox(dbClient);
    }
  }, 30000);

  // 3. Initial check on startup
  if (navigator.onLine && getOutboxQueue().length > 0) {
    setTimeout(() => replayOutbox(dbClient), 2000);
  } else {
    updateOutboxUI();
  }
}
