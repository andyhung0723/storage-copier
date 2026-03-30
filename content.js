(() => {
  const readStorage = (type) => {
    const storage = type === 'sessionStorage' ? sessionStorage : localStorage;
    const entries = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      entries[key] = storage.getItem(key);
    }
    return entries;
  };

  const writeStorage = (type, data) => {
    const storage = type === 'sessionStorage' ? sessionStorage : localStorage;
    for (const [key, value] of Object.entries(data)) {
      storage.setItem(key, value);
    }
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'read') {
      const result = {};
      for (const type of msg.types) {
        if (type === 'sessionStorage' || type === 'localStorage') {
          result[type] = readStorage(type);
        }
      }
      sendResponse({ success: true, data: result });
    }

    if (msg.action === 'write') {
      try {
        for (const [type, data] of Object.entries(msg.data)) {
          if (type === 'sessionStorage' || type === 'localStorage') {
            writeStorage(type, data);
          }
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }

    return true; // keep channel open for async sendResponse
  });
})();
