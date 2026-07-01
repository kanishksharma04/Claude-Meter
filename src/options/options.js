import { getSettings, setSettings, clearAllData } from "../lib/storage.js";

const developerModeToggle = document.getElementById("developerModeToggle");
const clearDataBtn = document.getElementById("clearDataBtn");

async function init() {
  const settings = await getSettings();
  developerModeToggle.checked = settings.developerMode;
}

developerModeToggle.addEventListener("change", async () => {
  await setSettings({ developerMode: developerModeToggle.checked });
});

clearDataBtn.addEventListener("click", async () => {
  if (!confirm("Clear all stored ClaudeMeter data (captures + usage snapshot)?")) return;
  await clearAllData();
  clearDataBtn.textContent = "Cleared!";
  setTimeout(() => (clearDataBtn.textContent = "Clear stored data"), 1200);
});

init();
