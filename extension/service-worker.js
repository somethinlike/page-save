const WS_URL = 'ws://localhost:7224';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let ws = null;
let reconnectDelay = RECONNECT_BASE_MS;
let reconnectTimer = null;

// --- WebSocket Connection ---

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    console.error('[page-save] WebSocket constructor error:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[page-save] Connected to bridge server');
    reconnectDelay = RECONNECT_BASE_MS;
    ws.send(JSON.stringify({ type: 'extension-hello' }));
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      console.error('[page-save] Invalid JSON from server:', event.data);
      return;
    }
    await handleMessage(msg);
  };

  ws.onclose = () => {
    console.log('[page-save] Disconnected from bridge server');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error('[page-save] WebSocket error:', err);
    // onclose will fire after this, triggering reconnect
  };
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[page-save] Cannot send — not connected');
    return;
  }
  ws.send(JSON.stringify(msg));
}

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

// --- Initialize ---

connect();
