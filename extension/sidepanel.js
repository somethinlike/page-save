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
let previewResults = []; // ExtractionResult[] for preview
let previewIncluded = new Set(); // Set<index> of included items

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

    // Get schema info from service worker
    try {
      const schemaInfo = await sendMessage({ type: 'get-schema-domains' });
      schemasLoaded = schemaInfo?.domains || [];
    } catch {
      schemasLoaded = [];
    }

    renderTabs();
  } catch (err) {
    tabList.innerHTML = `<div class="empty-state">Error loading tabs: ${err.message}</div>`;
  }
}

// --- Check connection status ---

async function checkStatus() {
  try {
    const result = await sendMessage({ type: 'get-status' });
    if (result?.connected) {
      statusEl.textContent = 'Connected';
      statusEl.className = 'status connected';
    } else {
      statusEl.textContent = 'Server offline';
      statusEl.className = 'status disconnected';
    }
  } catch {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status disconnected';
  }
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

    const hasSchema = hasDomainSchema(group.domain);
    const allSelected = group.tabs.every(t => selectedIds.has(t.tabId));

    // Domain header
    const header = document.createElement('div');
    header.className = 'domain-header';
    header.innerHTML = `
      <input type="checkbox" class="domain-checkbox" ${allSelected ? 'checked' : ''}>
      <span class="domain-name">${group.domain}</span>
      <span class="schema-badge ${hasSchema ? 'has-schema' : 'no-schema'}">${hasSchema ? 'Schema' : 'Raw'}</span>
      <span class="domain-count">${group.tabs.length}</span>
    `;

    const domainCheckbox = header.querySelector('.domain-checkbox');
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

function updateSaveButton() {
  const count = selectedIds.size;
  btnSave.textContent = `Save Selected (${count})`;
  btnSave.disabled = count === 0;
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

  try {
    progressFill.style.width = '30%';

    // Extract via service worker but get results back for preview
    const result = await sendMessage({
      type: 'preview-extract',
      tabIds,
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

btnSave.addEventListener('click', saveSelected);
btnPreviewSave.addEventListener('click', savePreview);
btnPreviewDiscard.addEventListener('click', hidePreview);

// --- Init ---

loadTabs();
checkStatus();

// Refresh when tabs change
chrome.tabs.onUpdated.addListener(() => loadTabs());
chrome.tabs.onRemoved.addListener(() => loadTabs());
