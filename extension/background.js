chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "ivqFetch") {
    return;
  }

  (async () => {
    try {
      const headers = new Headers(message.headers || {});
      const response = await fetch(message.url, {
        method: message.method || "GET",
        headers,
        body: message.body || undefined,
      });
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (error) {
        data = text;
      }
      sendResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data,
      });
    } catch (error) {
      sendResponse({
        ok: false,
        status: 0,
        statusText: "fetch_failed",
        error: error ? String(error.message || error) : "fetch_failed",
      });
    }
  })();

  return true;
});
