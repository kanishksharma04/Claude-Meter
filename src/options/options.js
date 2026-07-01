import { getSettings, setSettings, clearAllData } from "../lib/storage.js";

const refreshIntervalSlider = document.getElementById("refreshIntervalSlider");
const refreshIntervalValue = document.getElementById("refreshIntervalValue");
const notificationsToggle = document.getElementById("notificationsToggle");
const thresholdsRow = document.getElementById("thresholdsRow");
const thresholdChecks = [...document.querySelectorAll(".threshold-check")];
const themeSelect = document.getElementById("themeSelect");
const developerModeToggle = document.getElementById("developerModeToggle");
const clearDataBtn = document.getElementById("clearDataBtn");

function applyTheme(theme) {
  const effective = theme === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = effective;
}

function updateThresholdsRowState(enabled) {
  thresholdsRow.classList.toggle("disabled", !enabled);
}

async function init() {
  const settings = await getSettings();

  refreshIntervalSlider.value = settings.refreshIntervalMinutes;
  refreshIntervalValue.textContent = `${settings.refreshIntervalMinutes} min`;

  notificationsToggle.checked = settings.notificationsEnabled;
  updateThresholdsRowState(settings.notificationsEnabled);

  for (const check of thresholdChecks) {
    check.checked = settings.notifyThresholds.includes(Number(check.value));
  }

  themeSelect.value = settings.theme;
  applyTheme(settings.theme);

  developerModeToggle.checked = settings.developerMode;
}

refreshIntervalSlider.addEventListener("input", () => {
  refreshIntervalValue.textContent = `${refreshIntervalSlider.value} min`;
});

refreshIntervalSlider.addEventListener("change", async () => {
  await setSettings({ refreshIntervalMinutes: Number(refreshIntervalSlider.value) });
});

notificationsToggle.addEventListener("change", async () => {
  updateThresholdsRowState(notificationsToggle.checked);
  await setSettings({ notificationsEnabled: notificationsToggle.checked });
});

for (const check of thresholdChecks) {
  check.addEventListener("change", async () => {
    const thresholds = thresholdChecks.filter((c) => c.checked).map((c) => Number(c.value));
    await setSettings({ notifyThresholds: thresholds });
  });
}

themeSelect.addEventListener("change", async () => {
  applyTheme(themeSelect.value);
  await setSettings({ theme: themeSelect.value });
});

developerModeToggle.addEventListener("change", async () => {
  await setSettings({ developerMode: developerModeToggle.checked });
});

clearDataBtn.addEventListener("click", async () => {
  if (!confirm("Clear all stored ClaudeMeter data (captures + usage snapshot + history)?")) return;
  await clearAllData();
  clearDataBtn.textContent = "Cleared!";
  setTimeout(() => (clearDataBtn.textContent = "Clear stored data"), 1200);
});

init();
