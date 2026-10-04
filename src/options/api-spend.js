// Options > API spend: the Admin API key, and how reading the Console cost report with it is going.

import { getAll, setSettings, getAdminKey, setAdminKey } from "../lib/storage.js";
import { isAdminKey, maskKey } from "../lib/api-spend.js";
import { timeAgo } from "../lib/time-format.js";

// ---------------------------------------------------------------- api spend --

const apiSpendToggle = document.getElementById("apiSpendToggle");

const adminKeyInput = document.getElementById("adminKeyInput");

const apiSpendStatusNote = document.getElementById("apiSpendStatus");

export const API_ORIGIN = "https://api.anthropic.com/*";

function setApiSpendNote(text, problem = false) {
  apiSpendStatusNote.textContent = text;
  apiSpendStatusNote.classList.toggle("problem", problem);
}

export async function renderApiSpend() {
  const { settings, apiSpendStatus } = await getAll({ logs: false });
  const key = await getAdminKey();
  apiSpendToggle.checked = settings.apiSpend;
  document.getElementById("apiSpendSetup").hidden = !settings.apiSpend;
  document.getElementById("adminKeyRemoveBtn").hidden = !key;
  // A saved key is never shown again, only enough of it to tell which one it is.
  adminKeyInput.placeholder = key ? `Saved: ${maskKey(key)}` : "sk-ant-admin…";

  if (!settings.apiSpend) return setApiSpendNote("");
  if (settings.demoMode) return setApiSpendNote("Demo mode is on, so the figures are made up and Anthropic isn't being asked.");
  if (!key) return setApiSpendNote("Paste an Admin API key above to start.");
  if (!apiSpendStatus) return setApiSpendNote("Reading the cost report…");
  setApiSpendNote(apiSpendStatus.ok ? `Reading the cost report with ${maskKey(key)}. Last read ${timeAgo(apiSpendStatus.at)}.` : apiSpendStatus.problem.text, !apiSpendStatus.ok);
}

apiSpendToggle.addEventListener("change", async () => {
  await setSettings({ apiSpend: apiSpendToggle.checked });
  renderApiSpend();
});

document.getElementById("adminKeySaveBtn").addEventListener("click", async () => {
  const key = adminKeyInput.value.trim();
  if (!isAdminKey(key)) {
    adminKeyInput.focus();
    return setApiSpendNote("That doesn't look like an Admin API key: they start with sk-ant-admin. An ordinary API key can't read cost reports.", true);
  }
  // Asked straight from the click: the browser only shows its prompt in answer to a user's own action.
  const granted = await chrome.permissions.request({ origins: [API_ORIGIN] }).catch(() => false);
  if (!granted) return setApiSpendNote("The browser wasn't given permission to contact api.anthropic.com, so the key wasn't saved.", true);

  await setAdminKey(key);
  adminKeyInput.value = "";
  setApiSpendNote("Reading the cost report…");
  await chrome.runtime.sendMessage({ type: "CLAUDEMETER_REFRESH_API_SPEND" }).catch(() => null);
  renderApiSpend();
});

document.getElementById("adminKeyRemoveBtn").addEventListener("click", async () => {
  await setAdminKey(null);
  chrome.permissions.remove({ origins: [API_ORIGIN] }).catch(() => {});
  renderApiSpend();
});
