import { getSettings, setSettings, clearAllData } from "../lib/storage.js";

const refreshIntervalSlider = document.getElementById("refreshIntervalSlider");
const refreshIntervalValue = document.getElementById("refreshIntervalValue");
const notificationsToggle = document.getElementById("notificationsToggle");
const thresholdsRow = document.getElementById("thresholdsRow");
const thresholdChecks = [...document.querySelectorAll(".threshold-check")];
const inlinePillToggle = document.getElementById("inlinePillToggle");
const tabIndicatorSelect = document.getElementById("tabIndicatorSelect");
const preSendWarnSelect = document.getElementById("preSendWarnSelect");
const modelHintSelect = document.getElementById("modelHintSelect");
const longContextSelect = document.getElementById("longContextSelect");
const attachmentWarnSelect = document.getElementById("attachmentWarnSelect");
const lockoutOverlayToggle = document.getElementById("lockoutOverlayToggle");
const messageCostToggle = document.getElementById("messageCostToggle");
const actionOpensSelect = document.getElementById("actionOpensSelect");
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

  inlinePillToggle.checked = settings.inlinePill;
  tabIndicatorSelect.value = settings.tabIndicator;
  preSendWarnSelect.value = String(settings.preSendWarnPercent);
  modelHintSelect.value = String(settings.modelHintPercent);
  longContextSelect.value = String(settings.longContextTokens);
  attachmentWarnSelect.value = String(settings.attachmentWarnTokens);
  lockoutOverlayToggle.checked = settings.lockoutOverlay;
  messageCostToggle.checked = settings.messageCost;

  actionOpensSelect.value = settings.actionOpens;
  // Older Chromium builds have no side panel; don't offer what can't work.
  actionOpensSelect.querySelector('[value="sidePanel"]').disabled = !chrome.sidePanel;

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

inlinePillToggle.addEventListener("change", async () => {
  await setSettings({ inlinePill: inlinePillToggle.checked });
});

tabIndicatorSelect.addEventListener("change", async () => {
  await setSettings({ tabIndicator: tabIndicatorSelect.value });
});

preSendWarnSelect.addEventListener("change", async () => {
  await setSettings({ preSendWarnPercent: Number(preSendWarnSelect.value) });
});

modelHintSelect.addEventListener("change", async () => {
  await setSettings({ modelHintPercent: Number(modelHintSelect.value) });
});

longContextSelect.addEventListener("change", async () => {
  await setSettings({ longContextTokens: Number(longContextSelect.value) });
});

attachmentWarnSelect.addEventListener("change", async () => {
  await setSettings({ attachmentWarnTokens: Number(attachmentWarnSelect.value) });
});

lockoutOverlayToggle.addEventListener("change", async () => {
  await setSettings({ lockoutOverlay: lockoutOverlayToggle.checked });
});

messageCostToggle.addEventListener("change", async () => {
  await setSettings({ messageCost: messageCostToggle.checked });
});

actionOpensSelect.addEventListener("change", async () => {
  await setSettings({ actionOpens: actionOpensSelect.value });
});

themeSelect.addEventListener("change", async () => {
  applyTheme(themeSelect.value);
  await setSettings({ theme: themeSelect.value });
});

developerModeToggle.addEventListener("change", async () => {
  await setSettings({ developerMode: developerModeToggle.checked });
});

clearDataBtn.addEventListener("click", async () => {
  if (!confirm("Clear all stored ClaudeMeter data (captures + usage snapshot + history + message costs + limit-hit log)?")) return;
  await clearAllData();
  clearDataBtn.textContent = "Cleared!";
  setTimeout(() => (clearDataBtn.textContent = "Clear stored data"), 1200);
});

init();
