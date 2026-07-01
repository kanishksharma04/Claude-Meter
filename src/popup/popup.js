import { getAll } from "../lib/storage.js";

const captureCountEl = document.getElementById("captureCount");

async function init() {
  const { __debug_captures: captures } = await getAll();
  captureCountEl.textContent = String(captures.length);
}

document.getElementById("openClaudeBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://claude.ai" });
});

document.getElementById("debugLink").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("src/debug/debug.html") });
});

document.getElementById("optionsLink").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
