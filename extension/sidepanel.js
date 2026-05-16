/**
 * sidepanel.js — Chrome Side Panel UI for Page Save
 *
 * Displays open tabs grouped by domain, with checkboxes for mass selection.
 * Communicates with the service worker to trigger batch extraction.
 */

// --- State ---

let allTabs = [];        // TabInfo[] from service worker
let selectedIds = new Set(); // Set<tabId>
let schemasLoaded = [];  // domain strings that have schemas
let schemaInfo = {};     // domain → { version, description, variants: [{name, description}] }
let extractionMode = {}; // domain → "raw" | "schema" | "variant:<name>"
let previewResults = []; // ExtractionResult[] for preview
let previewIncluded = new Set(); // Set<index> of included items

let serverConnected = false;
let launchInFlight = false;
let lastLaunchClickAt = 0;
let lastLaunchError = '';
const LAUNCH_DEBOUNCE_MS = 5000;

const STORAGE_KEY_MODE = 'pageSave.extractionMode.v1';

// --- DOM refs ---

const tabList = document.getElementById('tab-list');
const btnSave = document.getElementById('btn-save');
const btnRefresh = document.getElementById('btn-refresh');
const btnSelectAll = document.getElementById('btn-select-all');
const btnDeselectAll = document.getElementById('btn-deselect-all');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const lastSessionEl = document.getElementById('last-session');
const sessionInfoEl = document.getElementById('session-info');
const previewPane = document.getElementById('preview-pane');
const previewList = document.getElementById('preview-list');
const previewCount = document.getElementById('preview-count');
const btnPreviewSave = document.getElementById('btn-preview-save');
const btnPreviewDiscard = document.getElementById('btn-preview-discard');

// --- Communication with service worker ---

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// --- Tab loading ---

async function loadTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    allTabs = tabs
      .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
      .map(t => ({
        tabId: t.id,
        title: t.title || '',
        url: t.url || '',
        favIconUrl: t.favIconUrl || '',
      }));

    // Get schema info from service worker (with variant lists per domain)
    try {
      const info = await sendMessage({ type: 'get-schema-info' });
      schemaInfo = info?.schemas || {};
      schemasLoaded = Object.keys(schemaInfo);
    } catch {
      schemaInfo = {};
      schemasLoaded = [];
    }

    // Restore persisted dropdown selections
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY_MODE);
      extractionMode = stored?.[STORAGE_KEY_MODE] || {};
    } catch {
      extractionMode = {};
    }

    renderTabs();
  } catch (err) {
    tabList.innerHTML = `<div class="empty-state">Error loading tabs: ${err.message}</div>`;
  }
}

function persistExtractionMode() {
  try {
    chrome.storage.local.set({ [STORAGE_KEY_MODE]: extractionMode });
  } catch {
    // best-effort
  }
}

/**
 * Resolve a domain group's UI selection into extractor options.
 * Selections: "raw" → forceRaw, "schema" → default schema, "variant:<n>" → variant.
 */
function modeToOptions(mode) {
  if (!mode || mode === 'raw') return { forceRaw: true };
  if (mode === 'schema') return {};
  if (mode.startsWith('variant:')) return { variant: mode.slice('variant:'.length) };
  return { forceRaw: true };
}

/**
 * Default mode for a domain group: raw if no schema, raw (per spec) if schema.
 * Ryan's request: raw is the default everywhere; user opts into a schema/variant.
 */
function defaultModeFor(domain) {
  return 'raw';
}

// --- Check connection status ---

async function checkStatus() {
  try {
    const result = await sendMessage({ type: 'get-status' });
    if (result?.connected) {
      statusEl.textContent = 'Connected';
      statusEl.className = 'status connected';
      serverConnected = true;
    } else {
      statusEl.textContent = 'Server offline';
      statusEl.className = 'status disconnected';
      serverConnected = false;
    }
  } catch {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status disconnected';
    serverConnected = false;
  }
  updateSaveButton();
}

// --- Rendering ---

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function getBaseDomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length > 2) {
    return parts.slice(-2).join('.');
  }
  return hostname;
}

function hasDomainSchema(hostname) {
  const base = getBaseDomain(hostname);
  return schemasLoaded.some(d => d === hostname || d === base);
}

/**
 * Look up the matched schema entry for a domain (handles www. prefix etc).
 */
function getSchemaForDomain(hostname) {
  const base = getBaseDomain(hostname);
  return schemaInfo[hostname] || schemaInfo[base] || null;
}

/**
 * Resolve the canonical domain key used by the schema registry, so that
 * the persisted dropdown selection survives www-prefix variation.
 */
function getSchemaKey(hostname) {
  const base = getBaseDomain(hostname);
  if (schemaInfo[hostname]) return hostname;
  if (schemaInfo[base]) return base;
  return hostname;
}

function renderTabs() {
  // Group by base domain
  const groups = new Map();
  for (const tab of allTabs) {
    const domain = getDomain(tab.url);
    const base = getBaseDomain(domain);
    if (!groups.has(base)) {
      groups.set(base, { domain: base, tabs: [] });
    }
    groups.get(base).tabs.push(tab);
  }

  // Sort by tab count (most tabs first)
  const sorted = Array.from(groups.values()).sort((a, b) => b.tabs.length - a.tabs.length);

  if (sorted.length === 0) {
    tabList.innerHTML = '<div class="empty-state">No open tabs</div>';
    return;
  }

  tabList.innerHTML = '';

  for (const group of sorted) {
    const groupEl = document.createElement('div');
    groupEl.className = 'domain-group';

    const schemaKey = getSchemaKey(group.domain);
    const schema = getSchemaForDomain(group.domain);
    const hasSchema = !!schema;
    const allSelected = group.tabs.every(t => selectedIds.has(t.tabId));
    const currentMode = extractionMode[schemaKey] || defaultModeFor(schemaKey);

    // Build dropdown options: Raw is always default, then full schema, then variants
    const options = [{ value: 'raw', label: 'Raw' }];
    if (hasSchema) {
      options.push({ value: 'schema', label: 'Schema (full)' });
      for (const v of (schema.variants || [])) {
        options.push({
          value: `variant:${v.name}`,
          label: v.name,
          title: v.description || v.name,
        });
      }
    }

    // Domain header
    const header = document.createElement('div');
    header.className = 'domain-header';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'domain-checkbox';
    checkbox.checked = allSelected;
    header.appendChild(checkbox);

    const nameEl = document.createElement('span');
    nameEl.className = 'domain-name';
    nameEl.textContent = group.domain;
    header.appendChild(nameEl);

    const select = document.createElement('select');
    select.className = `mode-select ${hasSchema ? 'has-schema' : 'no-schema'}`;
    for (const opt of options) {
      const optEl = document.createElement('option');
      optEl.value = opt.value;
      optEl.textContent = opt.label;
      if (opt.title) optEl.title = opt.title;
      if (opt.value === currentMode) optEl.selected = true;
      select.appendChild(optEl);
    }
    select.addEventListener('change', (e) => {
      e.stopPropagation();
      extractionMode[schemaKey] = select.value;
      persistExtractionMode();
    });
    select.addEventListener('click', (e) => e.stopPropagation());
    header.appendChild(select);

    const countEl = document.createElement('span');
    countEl.className = 'domain-count';
    countEl.textContent = group.tabs.length;
    header.appendChild(countEl);

    const domainCheckbox = checkbox;
    domainCheckbox.addEventListener('change', () => {
      for (const tab of group.tabs) {
        if (domainCheckbox.checked) {
          selectedIds.add(tab.tabId);
        } else {
          selectedIds.delete(tab.tabId);
        }
      }
      renderTabs();
      updateSaveButton();
    });

    groupEl.appendChild(header);

    // Tab items
    for (const tab of group.tabs) {
      const item = document.createElement('div');
      item.className = 'tab-item';

      const checked = selectedIds.has(tab.tabId) ? 'checked' : '';
      item.innerHTML = `
        <input type="checkbox" data-tab-id="${tab.tabId}" ${checked}>
        <span class="tab-title" title="${tab.url}">${tab.title || tab.url}</span>
      `;

      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedIds.add(tab.tabId);
        } else {
          selectedIds.delete(tab.tabId);
        }
        // Update domain checkbox state
        const allNowSelected = group.tabs.every(t => selectedIds.has(t.tabId));
        domainCheckbox.checked = allNowSelected;
        updateSaveButton();
      });

      // Click anywhere on row to toggle
      item.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });

      groupEl.appendChild(item);
    }

    tabList.appendChild(groupEl);
  }
}

/**
 * The footer primary button is mode-aware:
 *   - server offline + idle  → "Launch Local Server"
 *   - server offline + busy  → "Launching server…" (disabled)
 *   - server connected + 0   → "Save Selected (0)" (disabled)
 *   - server connected + N   → "Save Selected (N)" (enabled)
 *
 * Phase 14: when the server is unreachable we repurpose the otherwise-useless
 * disabled save button into the launcher action, so the UI flow stays the
 * same and there's never an idle dead button.
 */
function updateSaveButton() {
  const count = selectedIds.size;

  if (!serverConnected) {
    if (launchInFlight) {
      btnSave.textContent = 'Launching server…';
      btnSave.disabled = true;
      btnSave.classList.add('btn-launch');
    } else {
      btnSave.textContent = 'Launch Local Server';
      btnSave.disabled = false;
      btnSave.classList.add('btn-launch');
    }
    if (lastLaunchError) {
      progressEl.classList.remove('hidden');
      progressFill.style.width = '0%';
      progressText.textContent = lastLaunchError;
    }
    return;
  }

  btnSave.classList.remove('btn-launch');
  btnSave.textContent = `Save Selected (${count})`;
  btnSave.disabled = count === 0;
  if (lastLaunchError) {
    lastLaunchError = '';
    progressEl.classList.add('hidden');
    progressText.textContent = '';
  }
}

async function launchServer() {
  const now = Date.now();
  if (launchInFlight) return;
  if (now - lastLaunchClickAt < LAUNCH_DEBOUNCE_MS) {
    // UI-side debounce mirroring the service worker's cooldown so the user
    // can't hammer the button. The 5s window is generous because launch +
    // first WebSocket reconnect typically resolves in 1-2s.
    return;
  }
  lastLaunchClickAt = now;
  launchInFlight = true;
  lastLaunchError = '';
  updateSaveButton();

  try {
    const result = await sendMessage({ type: 'launch-server' });
    if (result?.ok) {
      // Connection-state polling already runs every few seconds; force a
      // status refresh now so the green pill appears immediately.
      await checkStatus();
      if (!serverConnected) {
        // ok:true with cooldown:true means another tab/click is mid-launch;
        // wait briefly and re-check.
        await new Promise((r) => setTimeout(r, 1500));
        await checkStatus();
      }
    } else {
      lastLaunchError = formatLaunchError(result);
    }
  } catch (err) {
    lastLaunchError = `Launch failed: ${err.message || err}`;
  } finally {
    launchInFlight = false;
    updateSaveButton();
  }
}

function formatLaunchError(result) {
  if (!result) return 'Launch failed: no response from extension.';
  switch (result.stage) {
    case 'protocol-launch':
      return (
        `Windows protocol launch failed: ${result.details || result.error}\n\n` +
        'Recovery: run page-save install-launcher, reload the extension, and accept the browser prompt to open Page Save.'
      );
    case 'native-messaging':
      // Show the actual rejection reason from chrome.runtime.lastError so we
      // can distinguish "host not found" (registry/path issue) from "host
      // forbidden" (extension ID mismatch in manifest) from "host exited
      // with code N" (.bat crashed). Recovery hint follows.
      return (
        `Native messaging failed: ${result.details || result.error}\n\n` +
        'Recovery: in a terminal:\n' +
        '  page-save install-launcher\n' +
        `  page-save install-launcher --extension-id ${chrome.runtime.id}\n\n` +
        'Then reload the extension. If Chrome/Brave was already open when the host was registered, fully quit and reopen the browser once.'
      );
    case 'port-conflict':
      return result.error || 'Port 7224 is already in use.';
    case 'connect-timeout':
      return (
        `${result.error || "Page Save didn't accept connections in time."}\n\n` +
        'If the browser shows an "Open Page Save?" prompt, accept it. Otherwise run page-save install-launcher to refresh the URL protocol and PageSaveLocalServer task.'
      );
    case 'native-response':
      return `Launcher error: ${result.error}`;
    default:
      return result.error || 'Launch failed for an unknown reason.';
  }
}

// --- Save action (now routes through preview) ---

async function saveSelected() {
  const tabIds = Array.from(selectedIds);
  if (tabIds.length === 0) return;

  btnSave.disabled = true;
  btnSave.textContent = 'Extracting...';
  progressEl.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = `Extracting ${tabIds.length} page(s)...`;

  // Build per-tab extractor options based on each tab's domain → mode mapping
  const perTabOptions = {};
  for (const tab of allTabs) {
    if (!selectedIds.has(tab.tabId)) continue;
    const hostname = getDomain(tab.url);
    const schemaKey = getSchemaKey(hostname);
    const mode = extractionMode[schemaKey] || defaultModeFor(schemaKey);
    perTabOptions[tab.tabId] = modeToOptions(mode);
  }

  try {
    progressFill.style.width = '30%';

    // Extract via service worker but get results back for preview
    const result = await sendMessage({
      type: 'preview-extract',
      tabIds,
      perTabOptions,
    });

    progressFill.style.width = '100%';
    progressEl.classList.add('hidden');

    if (result?.error) {
      progressText.textContent = `Error: ${result.error}`;
      progressEl.classList.remove('hidden');
      setTimeout(() => { btnSave.disabled = false; updateSaveButton(); }, 1500);
      return;
    }

    if (result?.results) {
      showPreview(result.results);
    }
  } catch (err) {
    progressText.textContent = `Error: ${err.message}`;
    setTimeout(() => { btnSave.disabled = false; updateSaveButton(); }, 1500);
  }
}

// --- Preview Mode ---

function showPreview(results) {
  previewResults = results;
  previewIncluded = new Set(results.map((_, i) => i));

  // Hide tab list, show preview
  tabList.classList.add('hidden');
  document.getElementById('controls').classList.add('hidden');
  document.querySelector('footer').classList.add('hidden');
  previewPane.classList.remove('hidden');

  renderPreview();
}

function hidePreview() {
  previewResults = [];
  previewIncluded.clear();

  previewPane.classList.add('hidden');
  tabList.classList.remove('hidden');
  document.getElementById('controls').classList.remove('hidden');
  document.querySelector('footer').classList.remove('hidden');

  btnSave.disabled = false;
  updateSaveButton();
}

function renderPreview() {
  previewList.innerHTML = '';
  const included = previewIncluded.size;
  const total = previewResults.length;
  previewCount.textContent = `${included}/${total} included`;

  for (let i = 0; i < previewResults.length; i++) {
    const result = previewResults[i];
    const isIncluded = previewIncluded.has(i);

    const item = document.createElement('div');
    item.className = `preview-item${isIncluded ? '' : ' excluded'}`;

    const title = result.title || result.domain || 'untitled';
    const type = result.type === 'structured' ? result.pageType : 'raw';
    const itemCount = result.data?.items ? `${result.data.items.length} items` :
                      result.data?.item ? '1 item' :
                      result.text ? `${result.text.length} chars` : '';

    item.innerHTML = `
      <div class="preview-item-header">
        <input type="checkbox" data-idx="${i}" ${isIncluded ? 'checked' : ''}>
        <span class="preview-item-title" title="${result.url || ''}">${title}</span>
        <span class="preview-item-meta">${type} ${itemCount}</span>
      </div>
      <div class="preview-item-content">${getPreviewContent(result)}</div>
    `;

    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        previewIncluded.add(i);
        item.classList.remove('excluded');
      } else {
        previewIncluded.delete(i);
        item.classList.add('excluded');
      }
      previewCount.textContent = `${previewIncluded.size}/${total} included`;
    });

    const header = item.querySelector('.preview-item-header');
    header.addEventListener('click', (e) => {
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });

    previewList.appendChild(item);
  }
}

function getPreviewContent(result) {
  if (result.type === 'structured' && result.data?.items) {
    const sample = result.data.items.slice(0, 3);
    return sample.map(item => {
      const fields = Object.entries(item)
        .filter(([_, v]) => v !== null && v !== false)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 50) : v}`)
        .join(' | ');
      return fields;
    }).join('\n');
  }
  if (result.type === 'structured' && result.data?.item) {
    return Object.entries(result.data.item)
      .filter(([_, v]) => v !== null && v !== false)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 80) : v}`)
      .join('\n');
  }
  if (result.type === 'raw' && result.text) {
    return result.text.slice(0, 300) + (result.text.length > 300 ? '...' : '');
  }
  return '(no content)';
}

async function savePreview() {
  const filtered = previewResults.filter((_, i) => previewIncluded.has(i));
  if (filtered.length === 0) {
    hidePreview();
    return;
  }

  btnPreviewSave.disabled = true;
  btnPreviewSave.textContent = 'Saving...';

  try {
    const result = await sendMessage({
      type: 'batch-extract-save',
      results: filtered,
    });

    hidePreview();

    if (result?.sessionDir) {
      lastSessionEl.classList.remove('hidden');
      sessionInfoEl.textContent = `${result.structured || 0} structured, ${result.raw || 0} raw → ${result.sessionDir}`;
    }

    selectedIds.clear();
    renderTabs();
    updateSaveButton();
  } catch (err) {
    btnPreviewSave.textContent = `Error: ${err.message}`;
  }

  setTimeout(() => {
    btnPreviewSave.disabled = false;
    btnPreviewSave.textContent = 'Save Selected';
  }, 2000);
}

// --- Event listeners ---

btnRefresh.addEventListener('click', () => {
  loadTabs();
  checkStatus();
});

btnSelectAll.addEventListener('click', () => {
  for (const tab of allTabs) {
    selectedIds.add(tab.tabId);
  }
  renderTabs();
  updateSaveButton();
});

btnDeselectAll.addEventListener('click', () => {
  selectedIds.clear();
  renderTabs();
  updateSaveButton();
});

btnSave.addEventListener('click', () => {
  if (!serverConnected) {
    launchServer();
  } else {
    saveSelected();
  }
});
btnPreviewSave.addEventListener('click', savePreview);
btnPreviewDiscard.addEventListener('click', hidePreview);

// --- Init ---

loadTabs();
checkStatus();

// Refresh when tabs change
chrome.tabs.onUpdated.addListener(() => loadTabs());
chrome.tabs.onRemoved.addListener(() => loadTabs());

// Periodic status refresh — picks up server start/stop without user action so
// the footer button transitions from "Launch" → "Save" automatically when the
// server comes online (whether triggered from the button or started manually
// via `page-save serve`). 4s cadence is fast enough to feel responsive
// without flooding the service worker.
setInterval(checkStatus, 4000);
