const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const CLIPBOARD_KEY = 'sc_clipboard';

// State
let currentTab = null;
let entries = {}; // { sessionStorage: {}, localStorage: {}, cookies: [] }

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
  }));
}

async function writeCookies(cookies, url) {
  const urlObj = new URL(url);
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
  let count = 0;
  const types = [];
  const { data } = clipboard;

  if (data.sessionStorage && Object.keys(data.sessionStorage).length) {
    const n = Object.keys(data.sessionStorage).length;
    count += n;
    types.push(`sessionStorage (${n})`);
  }
  if (data.localStorage && Object.keys(data.localStorage).length) {
    const n = Object.keys(data.localStorage).length;
    count += n;
    types.push(`localStorage (${n})`);
  }
  if (data.cookies && data.cookies.length) {
    count += data.cookies.length;
    types.push(`cookies (${data.cookies.length})`);
  }

  $('#clipboardCount').textContent = `· ${count} 筆`;
  $('#clipboardTypes').innerHTML = types
    .map((t) => `<span class="paste-type-tag">${t}</span>`)
    .join('');
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

  const hasData =
    Object.keys(selected.sessionStorage).length ||
    Object.keys(selected.localStorage).length ||
    selected.cookies.length;

  if (!hasData) {
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

  const { data } = clipboard;

  // Write sessionStorage / localStorage
  const storageData = {};
  if (data.sessionStorage && Object.keys(data.sessionStorage).length) {
    storageData.sessionStorage = data.sessionStorage;
  }
  if (data.localStorage && Object.keys(data.localStorage).length) {
    storageData.localStorage = data.localStorage;
  }

  if (Object.keys(storageData).length) {
    try {
      const res = await sendToTab(currentTab.id, {
        action: 'write',
        data: storageData,
      });
      if (!res?.success) {
        showToast(`寫入失敗: ${res?.error || 'unknown'}`, 'error');
        return;
      }
    } catch (err) {
      showToast('無法寫入此頁面的 storage', 'error');
      console.error(err);
      return;
    }
  }

  // Write cookies
  if (data.cookies?.length) {
    try {
      await writeCookies(data.cookies, currentTab.url);
    } catch (err) {
      showToast('寫入 cookies 失敗', 'error');
      console.error(err);
      return;
    }
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
})();
