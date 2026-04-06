importScripts('extractors.js');

const WS_URL = 'ws://localhost:7224';
const RECONNECT_ALARM = 'page-save-reconnect';
const KEEPALIVE_ALARM = 'page-save-keepalive';

let ws = null;

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
    console.log('[page-save] Connected to bridge server');
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
    console.log('[page-save] Disconnected from bridge server');
    if (ws === socket) ws = null;
    chrome.alarms.clear(KEEPALIVE_ALARM);
    scheduleReconnect();
  };

  socket.onerror = (err) => {
    console.error('[page-save] WebSocket error:', err);
  };
}

function scheduleReconnect() {
  // chrome.alarms survives service worker suspension (setTimeout does not)
  // Minimum alarm period is 0.5 minutes (30 seconds) for production extensions,
  // but unpacked extensions allow shorter. Use 0.25 min (~15 seconds).
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.25 });
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
    console.log('[page-save] Reconnect alarm fired, attempting connection...');
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
        await handleGetStructured(id, tabId);
        break;
      case 'get-structured-batch':
        await handleGetStructuredBatch(id, msg.tabIds);
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

async function handleGetStructured(id, tabId) {
  const resolvedId = await resolveTabId(tabId);
  const tab = await chrome.tabs.get(resolvedId);

  const result = await globalThis.extractors.extractStructured(resolvedId, tab.url);
  result.title = tab.title || 'untitled';

  send({ id, result });
}

async function handleGetStructuredBatch(id, tabIds) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) {
    send({ id, error: 'tabIds must be a non-empty array' });
    return;
  }

  const results = [];
  // Process in parallel with concurrency limit of 5 to avoid overwhelming Chrome
  const CONCURRENCY = 5;
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

  if (msg.type === 'get-status') {
    sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN });
    return false;
  }

  if (msg.type === 'batch-extract') {
    // Async handler — must return true to keep sendResponse channel open
    handleBatchExtractFromPanel(msg.tabIds)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  return false;
});

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

// --- Initialize (handles service worker wakeup) ---

globalThis.extractors.loadSchemas();
connect();
