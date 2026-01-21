const apiInput = document.getElementById("apiUrl");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");

const DEFAULT_API = "http://localhost:8000";

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ apiBaseUrl: DEFAULT_API }, resolve);
  });
}

function setSettings(values) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(values, resolve);
  });
}

async function init() {
  const settings = await getSettings();
  apiInput.value = settings.apiBaseUrl || DEFAULT_API;
}

saveButton.addEventListener("click", async () => {
  const value = apiInput.value.trim() || DEFAULT_API;
  await setSettings({ apiBaseUrl: value });
  statusEl.textContent = "Saved.";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1500);
});

init();
