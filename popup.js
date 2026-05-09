const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const CLIPBOARD_KEY = 'sc_clipboard';
const MEMORIES_KEY = 'sc_memories_v1';
const MAX_MEMORIES = 50;

// State
let currentTab = null;
let entries = {}; // { sessionStorage: {}, localStorage: {}, cookies: [] }
let memoriesById = {};

// --- Helpers ---

function showToast(msg, type = 'success') {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2000);
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '—';
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch {
    // Already injected or restricted page
  }
}

async function sendToTab(tabId, message) {
  await injectContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, message);
}

function getSelectedTypes() {
  return $$('.type-selector input:checked').map((el) => el.value);
}

function formatValue(val) {
  if (typeof val !== 'string') return String(val);
  // Try to pretty-print JSON
  try {
    const parsed = JSON.parse(val);
    if (typeof parsed === 'object') return JSON.stringify(parsed, null, 2);
  } catch {
    // not JSON
  }
  return val;
}

function truncate(str, len = 80) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeStorageData(data = {}) {
  return {
    sessionStorage: data.sessionStorage || {},
    localStorage: data.localStorage || {},
    cookies: data.cookies || [],
  };
}

function countStorageData(data) {
  const normalized = normalizeStorageData(data);
  return {
    sessionStorage: Object.keys(normalized.sessionStorage).length,
    localStorage: Object.keys(normalized.localStorage).length,
    cookies: normalized.cookies.length,
  };
}

function getTotalCount(data) {
  const counts = countStorageData(data);
  return counts.sessionStorage + counts.localStorage + counts.cookies;
}

function hasStorageData(data) {
  return getTotalCount(data) > 0;
}

function getTypeSummary(data) {
  const counts = countStorageData(data);
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${type} (${count})`);
}

function getDefaultMemoryName() {
  return `${getDomain(currentTab.url)} · ${formatDateTime(Date.now())}`;
}

// --- Cookie helpers ---

async function readCookies(url) {
  const cookies = await chrome.cookies.getAll({ url });
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: c.expirationDate,
    hostOnly: c.hostOnly,
    session: c.session,
    storeId: c.storeId,
    partitionKey: c.partitionKey,
  }));
}

async function writeCookies(cookies, url) {
  for (const c of cookies) {
    const details = {
      url,
      name: c.name,
      value: c.value,
      path: c.path || '/',
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite || 'lax',
    };
    // domain: use target domain, not source domain
    // expirationDate: keep if exists, otherwise session cookie
    if (c.expirationDate) {
      details.expirationDate = c.expirationDate;
    }
    if (c.partitionKey) {
      details.partitionKey = c.partitionKey;
    }
    try {
      await chrome.cookies.set(details);
    } catch (err) {
      console.warn(`Failed to set cookie ${c.name}:`, err);
    }
  }
}

// --- Render entries ---

function renderEntries() {
  const list = $('#entriesList');
  list.innerHTML = '';

  let totalCount = 0;

  for (const [type, data] of Object.entries(entries)) {
    const items = type === 'cookies' ? data : Object.entries(data);
    if (!items.length) continue;

    // Group label
    const label = document.createElement('div');
    label.className = 'entry-group-label';
    label.textContent = type;
    list.appendChild(label);

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const isCookie = type === 'cookies';
      const key = isCookie ? item.name : item[0];
      const value = isCookie ? item.value : item[1];

      const row = document.createElement('div');
      row.className = 'entry-row';
      row.dataset.type = type;
      row.dataset.key = key;
      if (isCookie) row.dataset.index = idx; // cookies can have duplicate names

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', updateSelectAll);

      const content = document.createElement('div');
      content.className = 'entry-content';

      const keyEl = document.createElement('div');
      keyEl.className = 'entry-key';
      keyEl.textContent =
        isCookie && item.domain ? `${key}  (${item.domain})` : key;

      const valEl = document.createElement('div');
      valEl.className = 'entry-value';
      valEl.textContent = truncate(value);
      valEl.title = value;
      valEl.addEventListener('click', () => {
        valEl.classList.toggle('expanded');
        valEl.textContent = valEl.classList.contains('expanded')
          ? formatValue(value)
          : truncate(value);
      });

      content.appendChild(keyEl);
      content.appendChild(valEl);
      row.appendChild(cb);
      row.appendChild(content);
      list.appendChild(row);
      totalCount++;
    }
  }

  $('#entryCount').textContent = `${totalCount} 筆`;
  $('#selectAll').checked = true;
  $('#entriesSection').classList.toggle('hidden', totalCount === 0);

  if (totalCount === 0) {
    showToast('未找到任何資料', 'error');
  }
}

function updateSelectAll() {
  const checkboxes = $$('#entriesList input[type="checkbox"]');
  const allChecked = checkboxes.every((cb) => cb.checked);
  $('#selectAll').checked = allChecked;
}

function getSelectedEntries() {
  const selected = { sessionStorage: {}, localStorage: {}, cookies: [] };
  const rows = $$('#entriesList .entry-row');

  for (const row of rows) {
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb.checked) continue;

    const type = row.dataset.type;
    const key = row.dataset.key;

    if (type === 'cookies') {
      const idx = parseInt(row.dataset.index, 10);
      if (entries.cookies[idx]) selected.cookies.push(entries.cookies[idx]);
    } else {
      selected[type][key] = entries[type][key];
    }
  }

  return selected;
}

async function applyDataToCurrentTab(data) {
  const normalized = normalizeStorageData(data);

  // Write sessionStorage / localStorage
  const storageData = {};
  if (Object.keys(normalized.sessionStorage).length) {
    storageData.sessionStorage = normalized.sessionStorage;
  }
  if (Object.keys(normalized.localStorage).length) {
    storageData.localStorage = normalized.localStorage;
  }

  if (Object.keys(storageData).length) {
    const res = await sendToTab(currentTab.id, {
      action: 'write',
      data: storageData,
    });
    if (!res?.success) {
      throw new Error(res?.error || 'unknown');
    }
  }

  // Write cookies
  if (normalized.cookies.length) {
    await writeCookies(normalized.cookies, currentTab.url);
  }
}

// --- Clipboard (paste section) ---

async function loadClipboard() {
  const result = await chrome.storage.local.get(CLIPBOARD_KEY);
  const clipboard = result[CLIPBOARD_KEY];

  const section = $('#pasteSection');
  const divider = $('#pasteDivider');

  if (!clipboard) {
    section.classList.add('hidden');
    divider.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  divider.classList.remove('hidden');

  $('#clipboardSource').textContent = clipboard.source;

  // Count entries
  const { data } = clipboard;
  const types = getTypeSummary(data);

  $('#clipboardCount').textContent = `· ${getTotalCount(data)} 筆`;
  $('#clipboardTypes').innerHTML = types
    .map((t) => `<span class="paste-type-tag">${t}</span>`)
    .join('');
}

// --- Memories ---

async function loadMemoryState() {
  const result = await chrome.storage.local.get(MEMORIES_KEY);
  const state = result[MEMORIES_KEY];
  if (state?.schemaVersion === 1 && state.items) return state;
  return { schemaVersion: 1, items: {} };
}

async function saveMemoryState(state) {
  await chrome.storage.local.set({ [MEMORIES_KEY]: state });
}

function getSortedMemories(state) {
  return Object.values(state.items).sort((a, b) => b.updatedAt - a.updatedAt);
}

function getSelectedMemory() {
  return memoriesById[$('#memorySelect').value];
}

function setMemoryActionsDisabled(disabled) {
  $('#applyMemoryBtn').disabled = disabled;
  $('#copyMemoryBtn').disabled = disabled;
  $('#deleteMemoryBtn').disabled = disabled;
}

function renderSelectedMemory() {
  const memory = getSelectedMemory();
  const details = $('#memoryDetails');
  const meta = $('#memorySelectedMeta');
  const types = $('#memorySelectedTypes');

  types.innerHTML = '';

  if (!memory) {
    details.classList.add('is-empty');
    meta.textContent = '讀取資料後可將選取項目儲存為記憶';
    setMemoryActionsDisabled(true);
    return;
  }

  details.classList.remove('is-empty');
  meta.textContent = `${memory.source} · ${getTotalCount(memory.data)} 筆 · ${formatDateTime(memory.updatedAt)}`;

  for (const type of getTypeSummary(memory.data)) {
    const tag = document.createElement('span');
    tag.className = 'paste-type-tag';
    tag.textContent = type;
    types.appendChild(tag);
  }

  setMemoryActionsDisabled(false);
}

async function renderMemories() {
  const state = await loadMemoryState();
  const memories = getSortedMemories(state);
  const select = $('#memorySelect');

  memoriesById = Object.fromEntries(memories.map((memory) => [memory.id, memory]));
  select.innerHTML = '';
  $('#memoryCount').textContent = `${memories.length} 筆`;

  if (!memories.length) {
    const option = document.createElement('option');
    option.textContent = '尚無記憶';
    option.value = '';
    select.appendChild(option);
    select.disabled = true;
    renderSelectedMemory();
    return;
  }

  select.disabled = false;
  for (const memory of memories) {
    const option = document.createElement('option');
    option.value = memory.id;
    option.textContent = `${memory.name} · ${memory.source}`;
    select.appendChild(option);
  }

  renderSelectedMemory();
}

async function saveSelectedEntriesAsMemory() {
  const selected = normalizeStorageData(getSelectedEntries());
  if (!hasStorageData(selected)) {
    showToast('請至少勾選一筆資料', 'error');
    return;
  }

  const nameInput = $('#memoryName');
  const name = nameInput.value.trim() || getDefaultMemoryName();
  const now = Date.now();
  const state = await loadMemoryState();

  const memory = {
    id: createId(),
    name,
    source: getDomain(currentTab.url),
    sourceUrl: currentTab.url,
    createdAt: now,
    updatedAt: now,
    counts: countStorageData(selected),
    data: selected,
  };

  state.items[memory.id] = memory;

  const overflow = getSortedMemories(state).slice(MAX_MEMORIES);
  for (const item of overflow) {
    delete state.items[item.id];
  }

  try {
    await saveMemoryState(state);
    nameInput.value = '';
    showToast(`已儲存記憶: ${name}`);
    renderMemories();
  } catch (err) {
    showToast('儲存記憶失敗，可能已超過 storage 容量', 'error');
    console.error(err);
  }
}

// --- Event Handlers ---

$('#readBtn').addEventListener('click', async () => {
  const types = getSelectedTypes();
  if (!types.length) {
    showToast('請先選擇至少一種 storage 類型', 'error');
    return;
  }

  entries = {};

  // Read sessionStorage / localStorage via content script
  const storageTypes = types.filter((t) => t !== 'cookies');
  if (storageTypes.length) {
    try {
      const res = await sendToTab(currentTab.id, {
        action: 'read',
        types: storageTypes,
      });
      if (res?.success) {
        Object.assign(entries, res.data);
      }
    } catch (err) {
      showToast('無法讀取此頁面的 storage', 'error');
      console.error(err);
      return;
    }
  }

  // Read cookies via chrome.cookies API
  if (types.includes('cookies')) {
    try {
      entries.cookies = await readCookies(currentTab.url);
    } catch (err) {
      showToast('無法讀取 cookies', 'error');
      console.error(err);
      return;
    }
  }

  renderEntries();
});

$('#selectAll').addEventListener('change', (e) => {
  $$('#entriesList input[type="checkbox"]').forEach((cb) => {
    cb.checked = e.target.checked;
  });
});

$('#copyBtn').addEventListener('click', async () => {
  const selected = getSelectedEntries();

  if (!hasStorageData(selected)) {
    showToast('請至少勾選一筆資料', 'error');
    return;
  }

  const clipboard = {
    source: getDomain(currentTab.url),
    timestamp: Date.now(),
    data: selected,
  };

  await chrome.storage.local.set({ [CLIPBOARD_KEY]: clipboard });
  showToast('已複製到剪貼簿');
  loadClipboard();
});

$('#pasteBtn').addEventListener('click', async () => {
  const result = await chrome.storage.local.get(CLIPBOARD_KEY);
  const clipboard = result[CLIPBOARD_KEY];
  if (!clipboard) return;

  try {
    await applyDataToCurrentTab(clipboard.data);
  } catch (err) {
    showToast(`寫入失敗: ${err.message}`, 'error');
    console.error(err);
    return;
  }

  // Clear clipboard after paste
  await chrome.storage.local.remove(CLIPBOARD_KEY);
  showToast('已貼上，剪貼簿已清除');
  loadClipboard();
});

$('#clearClipboardBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(CLIPBOARD_KEY);
  showToast('剪貼簿已清除');
  loadClipboard();
});

$('#saveMemoryBtn').addEventListener('click', saveSelectedEntriesAsMemory);

$('#memorySelect').addEventListener('change', renderSelectedMemory);

$('#applyMemoryBtn').addEventListener('click', async () => {
  const memory = getSelectedMemory();
  if (!memory) return;

  try {
    await applyDataToCurrentTab(memory.data);
    showToast('已套用記憶');
  } catch (err) {
    showToast(`套用失敗: ${err.message}`, 'error');
    console.error(err);
  }
});

$('#copyMemoryBtn').addEventListener('click', async () => {
  const memory = getSelectedMemory();
  if (!memory) return;

  await chrome.storage.local.set({
    [CLIPBOARD_KEY]: {
      source: memory.source,
      timestamp: Date.now(),
      data: normalizeStorageData(memory.data),
    },
  });
  showToast('已設為剪貼簿');
  loadClipboard();
});

$('#deleteMemoryBtn').addEventListener('click', async () => {
  const memory = getSelectedMemory();
  if (!memory) return;

  const state = await loadMemoryState();
  delete state.items[memory.id];
  await saveMemoryState(state);
  showToast('記憶已刪除');
  renderMemories();
});

// --- Init ---

function isRestrictedUrl(url) {
  return (
    !url ||
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-search://')
  );
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  $('#currentDomain').textContent = getDomain(tab.url);

  if (isRestrictedUrl(tab.url)) {
    $('#readBtn').disabled = true;
    $('#readBtn').title = '無法在此頁面讀取 storage';
  }

  loadClipboard();
  renderMemories();
})();
