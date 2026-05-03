importScripts('extractors.js');

const WS_URL = 'ws://localhost:7224';
const RECONNECT_ALARM = 'page-save-reconnect';
const KEEPALIVE_ALARM = 'page-save-keepalive';

// Backoff schedule for reconnect attempts when the bridge server is offline.
// Chromium's network stack auto-logs `WebSocket connection ... failed` on each
// constructor failure and that log is unsuppressable from JS. So instead of
// hammering every 15s forever (and dumping a stream of identical errors into
// the service-worker console), we fall back to long-poll mode after the first
// few attempts. Successful connect resets the index back to 0.
const RECONNECT_BACKOFF_MIN = [0.25, 0.5, 1, 2, 5];

let ws = null;
let reconnectStreak = 0;       // how many consecutive failures since last success
let loggedOfflineState = false; // suppresses repeat "disconnected" lines

// --- WebSocket Connection ---

function connect() {
  // Guard against multiple concurrent connection attempts
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  let socket;
  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    console.error('[page-save] WebSocket constructor error:', err);
    scheduleReconnect();
    return;
  }

  ws = socket;

  socket.onopen = () => {
    if (loggedOfflineState) {
      console.log('[page-save] Reconnected to bridge server');
    } else {
      console.log('[page-save] Connected to bridge server');
    }
    reconnectStreak = 0;
    loggedOfflineState = false;
    chrome.alarms.clear(RECONNECT_ALARM);
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
    // Use local ref to avoid race with a second connect() overwriting ws
    socket.send(JSON.stringify({ type: 'extension-hello' }));
  };

  socket.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      console.error('[page-save] Invalid JSON from server:', event.data);
      return;
    }
    await handleMessage(msg);
  };

  socket.onclose = () => {
    // Log only the first disconnect of the session; further close events
    // during the reconnect-backoff loop would just be noise.
    if (!loggedOfflineState) {
      console.log('[page-save] Bridge server offline. Will retry on backoff.');
      loggedOfflineState = true;
    }
    if (ws === socket) ws = null;
    chrome.alarms.clear(KEEPALIVE_ALARM);
    scheduleReconnect();
  };

  // Intentionally no socket.onerror handler — onerror's `Event` argument has no
  // useful detail beyond the unsuppressable Chromium network-stack error that
  // already prints, so logging it just doubles the noise with `[object Event]`.
}

function scheduleReconnect() {
  reconnectStreak += 1;
  const idx = Math.min(reconnectStreak - 1, RECONNECT_BACKOFF_MIN.length - 1);
  const periodInMinutes = RECONNECT_BACKOFF_MIN[idx];
  // chrome.alarms survives service worker suspension (setTimeout does not).
  // Use a one-shot alarm so we control the delay precisely on each retry.
  chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: periodInMinutes });
}

function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[page-save] Cannot send — not connected');
    return;
  }
  ws.send(JSON.stringify(msg));
}

// --- Alarm Handler (reconnect + keepalive) ---

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) {
    // Silent retry — connect() will log on success ("Reconnected") or stay
    // quiet on failure (the unsuppressable Chromium network error provides
    // signal enough). This is the noise-reduction half of the backoff fix.
    connect();
  }
  if (alarm.name === KEEPALIVE_ALARM) {
    // Just waking the service worker to keep WebSocket alive — no action needed
  }
});

// --- Message Handlers ---

async function handleMessage(msg) {
  const { id, action, tabId } = msg;
  if (!id || !action) return;

  try {
    switch (action) {
      case 'list-tabs':
        await handleListTabs(id);
        break;
      case 'save-page':
        await handleSavePage(id, tabId);
        break;
      case 'get-text':
        await handleGetText(id, tabId);
        break;
      case 'get-structured':
        await handleGetStructured(id, tabId, { variant: msg.variant, forceRaw: msg.forceRaw });
        break;
      case 'get-structured-batch':
        await handleGetStructuredBatch(id, msg.tabIds, { variant: msg.variant, forceRaw: msg.forceRaw, perTabOptions: msg.perTabOptions });
        break;
      case 'get-structured-paginated':
        await handleGetStructuredPaginated(id, tabId, msg.maxPages, { variant: msg.variant, forceRaw: msg.forceRaw });
        break;
      case 'probe-dom':
        await handleProbeDom(id, tabId);
        break;
      case 'batch-urls':
        await handleBatchUrls(id, msg.urls, { variant: msg.variant, forceRaw: msg.forceRaw });
        break;
      case 'probe-result-html':
        await handleProbeResultHtml(id, tabId, msg.asins);
        break;
      case 'get-youtube-html':
        await handleGetYoutubeHtml(id, tabId);
        break;
      default:
        send({ id, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    send({ id, error: err.message || String(err) });
  }
}

async function handleListTabs(id) {
  const tabs = await chrome.tabs.query({});
  const result = tabs
    .filter((t) => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
    .map((t) => ({
      tabId: t.id,
      title: t.title || '',
      url: t.url || '',
      active: t.active,
      windowId: t.windowId,
    }));
  send({ id, result: { tabs: result } });
}

async function resolveTabId(tabId) {
  if (tabId === undefined || tabId === null || tabId === -1) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) throw new Error('No active tab found');
    return activeTab.id;
  }
  // Verify the tab exists
  await chrome.tabs.get(tabId);
  return tabId;
}

async function handleSavePage(id, tabId) {
  const resolvedId = await resolveTabId(tabId);
  const tab = await chrome.tabs.get(resolvedId);

  const blob = await chrome.pageCapture.saveAsMHTML({ tabId: resolvedId });
  const base64 = await blobToBase64(blob);

  send({
    id,
    result: {
      data: base64,
      title: tab.title || 'untitled',
      url: tab.url || '',
    },
  });
}

async function handleGetText(id, tabId) {
  const resolvedId = await resolveTabId(tabId);
  const tab = await chrome.tabs.get(resolvedId);

  const results = await chrome.scripting.executeScript({
    target: { tabId: resolvedId },
    func: () => document.body.innerText,
    world: 'ISOLATED',
  });

  const text = results?.[0]?.result || '';
  send({
    id,
    result: {
      text,
      title: tab.title || 'untitled',
      url: tab.url || '',
    },
  });
}

async function handleGetStructured(id, tabId, options = {}) {
  const resolvedId = await resolveTabId(tabId);
  const tab = await chrome.tabs.get(resolvedId);

  const result = await globalThis.extractors.extractStructured(resolvedId, tab.url, options);
  result.title = tab.title || 'untitled';

  send({ id, result });
}

async function handleGetYoutubeHtml(id, tabId) {
  const resolvedId = await resolveTabId(tabId);
  const tab = await chrome.tabs.get(resolvedId);

  // Capture the full page HTML (contains caption track data in ytInitialPlayerResponse)
  const results = await chrome.scripting.executeScript({
    target: { tabId: resolvedId },
    func: () => document.documentElement.outerHTML,
    world: 'ISOLATED',
  });

  const html = results?.[0]?.result || '';

  send({
    id,
    result: {
      type: 'youtube-html',
      url: tab.url || '',
      title: tab.title || 'untitled',
      html,
    },
  });
}

async function handleBatchUrls(id, urls, options = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    send({ id, error: 'urls must be a non-empty array' });
    return;
  }

  const results = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        let newTab;
        try {
          // Open background tab
          newTab = await chrome.tabs.create({ url, active: false });

          // Wait for page load
          await new Promise((resolve) => {
            const listener = (tid, info) => {
              if (tid === newTab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 20000);
          });

          // Brief settle for dynamic content
          await new Promise(r => setTimeout(r, 1000));

          // Extract
          const result = await globalThis.extractors.extractStructured(newTab.id, url, options);
          const tab = await chrome.tabs.get(newTab.id);
          result.title = tab.title || 'untitled';

          // Close tab
          await chrome.tabs.remove(newTab.id);

          return result;
        } catch (err) {
          // Try to clean up the tab
          if (newTab?.id) {
            try { await chrome.tabs.remove(newTab.id); } catch {}
          }
          return { type: 'error', url, error: err.message || String(err) };
        }
      })
    );
    results.push(...batchResults);
  }

  send({ id, result: { results, count: results.length } });
}

/**
 * One-shot debugging probe: capture outerHTML of search-result containers
 * that match a list of ASINs. Used to ground-truth schema improvements
 * (e.g. why some listings come back with empty price fields).
 */
async function handleProbeResultHtml(id, tabId, asins) {
  const resolvedId = await resolveTabId(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId: resolvedId },
    func: (asinList) => {
      const out = {};
      for (const asin of asinList) {
        const el = document.querySelector(`[data-asin="${asin}"]`);
        if (!el) {
          out[asin] = { found: false };
          continue;
        }
        // Capture the price-region subtree and any text mentioning "options" or "$"
        const priceArea = el.querySelector('[data-cy="price-recipe"]')
          || el.querySelector('.s-price-instructions-style')
          || el.querySelector('[class*="price"]')
          || el;
        out[asin] = {
          found: true,
          priceAreaHtml: (priceArea?.outerHTML || '').slice(0, 4000),
          containerSnippet: el.outerHTML.slice(0, 8000),
        };
      }
      return out;
    },
    args: [asins],
    world: 'ISOLATED',
  });
  send({ id, result: results?.[0]?.result || {} });
}

async function handleProbeDom(id, tabId) {
  const resolvedId = await resolveTabId(tabId);
  const tab = await chrome.tabs.get(resolvedId);
  const candidates = await globalThis.extractors.probeDomStructure(resolvedId);

  let domain;
  try { domain = new URL(tab.url).hostname; } catch { domain = 'unknown'; }

  send({ id, result: { url: tab.url, domain, candidates } });
}

async function handleGetStructuredPaginated(id, tabId, maxPages, options = {}) {
  const resolvedId = await resolveTabId(tabId);
  const tab = await chrome.tabs.get(resolvedId);
  const results = await globalThis.extractors.extractWithPagination(resolvedId, tab.url, maxPages || 10, options);
  send({ id, result: { results, count: results.length } });
}

async function handleGetStructuredBatch(id, tabIds, options = {}) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) {
    send({ id, error: 'tabIds must be a non-empty array' });
    return;
  }

  const results = [];
  // Process in parallel with concurrency limit of 5 to avoid overwhelming Chrome
  const CONCURRENCY = 5;
  const perTabOptions = options.perTabOptions || {};
  for (let i = 0; i < tabIds.length; i += CONCURRENCY) {
    const batch = tabIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (tid) => {
        try {
          const tab = await chrome.tabs.get(tid);
          const tabOpts = perTabOptions[tid] || { variant: options.variant, forceRaw: options.forceRaw };
          const result = await globalThis.extractors.extractStructured(tid, tab.url, tabOpts);
          result.title = tab.title || 'untitled';
          result.tabId = tid;
          return result;
        } catch (err) {
          return { tabId: tid, type: 'error', error: err.message || String(err) };
        }
      })
    );
    results.push(...batchResults);
  }

  send({ id, result: { results, count: results.length } });
}

// --- Blob to Base64 ---

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// --- Keyboard Shortcut ---

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-current-tab') return;

  try {
    chrome.action.setBadgeText({ text: '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#4A90D9' });

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      chrome.action.setBadgeText({ text: 'ERR' });
      chrome.action.setBadgeBackgroundColor({ color: '#D94A4A' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
      return;
    }

    const blob = await chrome.pageCapture.saveAsMHTML({ tabId: activeTab.id });
    const base64 = await blobToBase64(blob);

    send({
      type: 'shortcut-save',
      result: {
        data: base64,
        title: activeTab.title || 'untitled',
        url: activeTab.url || '',
      },
    });

    chrome.action.setBadgeText({ text: 'OK' });
    chrome.action.setBadgeBackgroundColor({ color: '#4AD94A' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  } catch (err) {
    console.error('[page-save] Shortcut save failed:', err);
    chrome.action.setBadgeText({ text: 'ERR' });
    chrome.action.setBadgeBackgroundColor({ color: '#D94A4A' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  }
});

// --- Lifecycle: ensure connection on startup/install ---

chrome.runtime.onStartup.addListener(() => {
  console.log('[page-save] Chrome started, connecting...');
  connect();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[page-save] Extension installed/updated, connecting...');
  connect();
});

// --- Side Panel Message Handlers ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get-schema-domains') {
    const domains = Array.from(globalThis.extractors.schemaRegistry.keys());
    sendResponse({ domains });
    return false;
  }

  if (msg.type === 'get-schema-info') {
    // Return per-domain summary: which variants are available, base schema present
    const info = {};
    for (const [domain, schema] of globalThis.extractors.schemaRegistry.entries()) {
      const variants = schema.variants
        ? Object.entries(schema.variants).map(([name, v]) => ({
            name,
            description: v.description || '',
          }))
        : [];
      info[domain] = {
        version: schema.version,
        description: schema.description || '',
        variants,
      };
    }
    sendResponse({ schemas: info });
    return false;
  }

  if (msg.type === 'get-status') {
    sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN });
    return false;
  }

  if (msg.type === 'launch-server') {
    handleLaunchServer()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, stage: 'unexpected', error: err.message || String(err) }));
    return true;
  }

  if (msg.type === 'batch-extract') {
    // Async handler — must return true to keep sendResponse channel open
    handleBatchExtractFromPanel(msg.tabIds)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (msg.type === 'preview-extract') {
    // Extract but return results to sidebar for preview (don't save yet)
    handlePreviewExtract(msg.tabIds, msg.perTabOptions || {})
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (msg.type === 'batch-extract-save') {
    // Save pre-filtered results (from preview confirm)
    handleSaveFilteredResults(msg.results)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  return false;
});

// --- Launch Server (Native Messaging) ---------------------------------------

const NATIVE_HOST = 'com.pagesave.launcher';
const LAUNCH_COOLDOWN_MS = 5000;
const POST_LAUNCH_POLL_INTERVAL_MS = 400;
const POST_LAUNCH_TIMEOUT_MS = 10000;

let lastLaunchAttemptAt = 0;

/**
 * Probe the WebSocket port directly from the extension. We can't open raw TCP
 * sockets from a service worker, but the existing connection state already
 * tells us whether the server is up. For a fresh probe, we briefly attempt a
 * test WebSocket and discard it.
 */
function probeServerOnce(timeoutMs = 1500) {
  return new Promise((resolve) => {
    let probe;
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      try { probe && probe.close(); } catch {}
      resolve(status);
    };
    try {
      probe = new WebSocket(WS_URL);
    } catch {
      finish('unreachable');
      return;
    }
    probe.onopen = () => finish('reachable');
    probe.onerror = () => finish('unreachable');
    probe.onclose = () => finish(settled ? undefined : 'unreachable');
    setTimeout(() => finish('unreachable'), timeoutMs);
  });
}

async function pollUntilConnected(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ws && ws.readyState === WebSocket.OPEN) return true;
    // Trigger a connect attempt each cycle so we don't have to wait for the
    // alarm-driven reconnect (which is on a 15s schedule).
    connect();
    await new Promise((r) => setTimeout(r, POST_LAUNCH_POLL_INTERVAL_MS));
  }
  return ws && ws.readyState === WebSocket.OPEN;
}

function sendNative(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || 'Native messaging error'));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Launch the local page-save server via the registered native messaging host.
 *
 * Safety layers (matching the spec):
 *   1. Spam protection — refuse if a launch was attempted within the cooldown
 *      window (5s). Returns ok:true with `cooldown:true` so the UI can show
 *      "Already starting…" without alarming the user.
 *   2. Pre-flight WS probe — if the server is already reachable, no-op.
 *   3. Port conflict detection — the native launcher refuses to spawn a
 *      duplicate when the port is already bound. We surface that as a
 *      distinct error so the UI can say "port 7224 is in use by something
 *      else" rather than the generic launch failure.
 *   4. Post-launch confirmation — poll the WebSocket for up to 10s after
 *      reporting success. If we never connect, return ok:false with the
 *      timeout reason so the UI doesn't leave the user staring at a button
 *      that lied.
 */
async function handleLaunchServer() {
  const now = Date.now();
  if (now - lastLaunchAttemptAt < LAUNCH_COOLDOWN_MS) {
    return { ok: true, cooldown: true, message: 'Launch already in progress.' };
  }
  lastLaunchAttemptAt = now;

  // (2) Pre-flight: if we're already connected, nothing to do.
  if (ws && ws.readyState === WebSocket.OPEN) {
    return { ok: true, alreadyRunning: true };
  }
  const probe = await probeServerOnce();
  if (probe === 'reachable') {
    // Something is on the port. Hand the existing connect() loop a kick.
    connect();
    const connected = await pollUntilConnected(3000);
    if (connected) return { ok: true, alreadyRunning: true };
    // Reachable but doesn't speak our protocol → port conflict from another app.
    return {
      ok: false,
      stage: 'port-conflict',
      error: `Port ${WS_URL.replace('ws://localhost:', '')} is in use by something that isn't page-save.`,
    };
  }

  // (3) Ask the native host to spawn the server.
  let response;
  try {
    response = await sendNative({ action: 'start' });
  } catch (err) {
    const detail = err.message || String(err);
    console.error('[page-save] sendNativeMessage failed:', detail, err);
    return {
      ok: false,
      stage: 'native-messaging',
      error: `Native messaging failed: ${detail}`,
      details: detail,
      extensionId: chrome.runtime.id,
    };
  }

  if (!response) {
    return { ok: false, stage: 'native-response', error: 'No response from native launcher.' };
  }
  if (response.error) {
    return { ok: false, stage: 'native-response', error: response.error };
  }
  if (response.alreadyRunning && response.occupied) {
    // Native side detected something on the port but we couldn't speak page-save with it.
    return {
      ok: false,
      stage: 'port-conflict',
      error: `Port is occupied. Either page-save is already running and unreachable, or another app is using port 7224.`,
    };
  }

  // (4) Confirm by polling for our own WebSocket connection.
  const connected = await pollUntilConnected(POST_LAUNCH_TIMEOUT_MS);
  if (connected) {
    return { ok: true, started: true };
  }
  return {
    ok: false,
    stage: 'connect-timeout',
    error: `Server reported started but extension couldn't connect within ${POST_LAUNCH_TIMEOUT_MS / 1000}s.`,
  };
}

/**
 * Extract data from tabs and return results for preview (no saving).
 * @param {number[]} tabIds
 * @param {Object<number, { variant?: string, forceRaw?: boolean }>} perTabOptions
 */
async function handlePreviewExtract(tabIds, perTabOptions = {}) {
  if (!tabIds || tabIds.length === 0) {
    return { error: 'No tabs selected' };
  }

  const CONCURRENCY = 5;
  const results = [];
  for (let i = 0; i < tabIds.length; i += CONCURRENCY) {
    const batch = tabIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (tid) => {
        try {
          const tab = await chrome.tabs.get(tid);
          const opts = perTabOptions[tid] || {};
          const result = await globalThis.extractors.extractStructured(tid, tab.url, opts);
          result.title = tab.title || 'untitled';
          result.tabId = tid;
          return result;
        } catch (err) {
          return { tabId: tid, type: 'error', error: err.message || String(err) };
        }
      })
    );
    results.push(...batchResults);
  }

  return { results };
}

/**
 * Save pre-filtered extraction results (from preview confirm).
 */
async function handleSaveFilteredResults(results) {
  if (!results || results.length === 0) {
    return { error: 'No results to save' };
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { error: 'Node.js server not connected. Start the page-save server.' };
  }

  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      resolve({ error: 'Server did not respond within 30 seconds.' });
    }, 30000);

    const handler = (event) => {
      let response;
      try { response = JSON.parse(event.data); } catch { return; }
      if (response.id !== id) return;

      ws.removeEventListener('message', handler);
      clearTimeout(timeout);

      if (response.error) {
        resolve({ error: response.error });
      } else {
        resolve(response.result || response);
      }
    };
    ws.addEventListener('message', handler);

    ws.send(JSON.stringify({
      type: 'panel-save-session',
      id,
      results,
    }));
  });
}

/**
 * Handle batch extraction triggered from the side panel.
 * Extracts data from all specified tabs using the schema engine,
 * then sends results to the Node.js server for session writing.
 */
async function handleBatchExtractFromPanel(tabIds) {
  if (!tabIds || tabIds.length === 0) {
    return { error: 'No tabs selected' };
  }

  // Extract from all tabs
  const CONCURRENCY = 5;
  const results = [];
  for (let i = 0; i < tabIds.length; i += CONCURRENCY) {
    const batch = tabIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (tid) => {
        try {
          const tab = await chrome.tabs.get(tid);
          const result = await globalThis.extractors.extractStructured(tid, tab.url);
          result.title = tab.title || 'untitled';
          result.tabId = tid;
          return result;
        } catch (err) {
          return { tabId: tid, type: 'error', error: err.message || String(err) };
        }
      })
    );
    results.push(...batchResults);
  }

  // Send to Node.js server for session writing
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { error: 'Node.js server not connected. Start the page-save server.' };
  }

  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      resolve({ error: 'Server did not respond within 30 seconds.' });
    }, 30000);

    // Listen for the response
    const handler = (event) => {
      let response;
      try { response = JSON.parse(event.data); } catch { return; }
      if (response.id !== id) return;

      ws.removeEventListener('message', handler);
      clearTimeout(timeout);

      if (response.error) {
        resolve({ error: response.error });
      } else {
        resolve(response.result || response);
      }
    };
    ws.addEventListener('message', handler);

    // Send extraction results to server for session writing
    ws.send(JSON.stringify({
      type: 'panel-save-session',
      id,
      results,
    }));
  });
}

// --- Action Click → Open Side Panel ---

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Enable the side panel to be openable
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// --- Initialize (handles service worker wakeup) ---

globalThis.extractors.loadSchemas();
connect();
