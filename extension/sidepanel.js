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

// --- Save action ---

async function saveSelected() {
  const tabIds = Array.from(selectedIds);
  if (tabIds.length === 0) return;

  btnSave.disabled = true;
  btnSave.textContent = 'Saving...';
  progressEl.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = `Extracting ${tabIds.length} page(s)...`;

  try {
    // Simulate progress while waiting (extraction is fast but writing takes a moment)
    progressFill.style.width = '30%';

    const result = await sendMessage({
      type: 'batch-extract',
      tabIds,
    });

    progressFill.style.width = '100%';

    if (result?.error) {
      progressText.textContent = `Error: ${result.error}`;
    } else if (result?.sessionDir) {
      progressText.textContent = 'Done!';
      lastSessionEl.classList.remove('hidden');
      sessionInfoEl.textContent = `${result.structured || 0} structured, ${result.raw || 0} raw → ${result.sessionDir}`;

      // Clear selection after save
      selectedIds.clear();
      renderTabs();
      updateSaveButton();
    } else {
      progressText.textContent = 'Saved (no session info returned)';
    }
  } catch (err) {
    progressText.textContent = `Error: ${err.message}`;
  }

  // Re-enable after a beat
  setTimeout(() => {
    btnSave.disabled = selectedIds.size === 0;
    updateSaveButton();
  }, 1500);

  setTimeout(() => {
    progressEl.classList.add('hidden');
  }, 4000);
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

// --- Init ---

loadTabs();
checkStatus();

// Refresh when tabs change
chrome.tabs.onUpdated.addListener(() => loadTabs());
chrome.tabs.onRemoved.addListener(() => loadTabs());
