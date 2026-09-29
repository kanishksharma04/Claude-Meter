import { getAll, getSettings, setSettings, setSnoozeUntil, clearAllData, onStorageChanged } from "../lib/storage.js";
import { formatClock } from "../lib/time-format.js";
import { isSnoozed } from "../lib/snooze.js";
import { drawGauge } from "../lib/gauge-icon.js";
import { normalizeCutoffs, severityColor, severityColors } from "../lib/severity.js";
import { ACCENTS, applyTheme, onSystemThemeChange } from "../lib/theme.js";

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
const iconStyleSelect = document.getElementById("iconStyleSelect");
const gaugePreview = document.getElementById("gaugePreview");
const actionOpensSelect = document.getElementById("actionOpensSelect");
const cutoffPreview = document.getElementById("cutoffPreview");
const warnAtInput = document.getElementById("warnAtInput");
const dangerAtInput = document.getElementById("dangerAtInput");
const colorInputs = [...document.querySelectorAll('.color-inputs input[type="color"]')];
const resetSeverityBtn = document.getElementById("resetSeverityBtn");
const themeSelect = document.getElementById("themeSelect");
const accentSwatches = document.getElementById("accentSwatches");
const privacyModeToggle = document.getElementById("privacyModeToggle");
const developerModeToggle = document.getElementById("developerModeToggle");
const clearDataBtn = document.getElementById("clearDataBtn");

/** One radio per accent preset, drawn as a colour swatch. */
function buildAccentSwatches(selected) {
  accentSwatches.replaceChildren(
    ...Object.entries(ACCENTS).map(([id, { label, color }]) => {
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "accent";
      input.value = id;
      input.checked = id === selected;
      input.setAttribute("aria-label", label);

      const swatch = document.createElement("label");
      swatch.title = label;
      swatch.style.setProperty("--swatch", color);
      swatch.append(input);
      return swatch;
    })
  );
}

/** Shows what the gauge icon looks like right now (or a sample reading before there is any data). */
async function renderGaugePreview() {
  const { latestSnapshot, settings } = await getAll();
  const percent = latestSnapshot?.session?.percentUsed ?? 62;
  const color = severityColor(percent, settings);
  drawGauge(gaugePreview.getContext("2d"), gaugePreview.width, { percent, color });
  gaugePreview.setAttribute("aria-label", `Gauge icon preview at ${percent}%`);
  gaugePreview.style.opacity = iconStyleSelect.value === "gauge" || iconStyleSelect.value === "both" ? "1" : "0.35";
}

/** The strip above the cut-off fields: three segments sized by the cut-offs, in the chosen colours. */
function renderSeverity(settings) {
  const { warnAt, dangerAt } = normalizeCutoffs(settings.warnAt, settings.dangerAt);
  const colors = severityColors(settings);
  const widths = { ok: warnAt, warn: dangerAt - warnAt, danger: 100 - dangerAt };

  for (const seg of cutoffPreview.children) {
    seg.style.flex = `${widths[seg.dataset.level]} 0 0`;
    seg.style.background = colors[seg.dataset.level];
  }
  cutoffPreview.setAttribute("aria-label", `Normal below ${warnAt}%, amber from ${warnAt}%, red from ${dangerAt}%`);

  warnAtInput.value = warnAt;
  dangerAtInput.value = dangerAt;
  for (const input of colorInputs) input.value = colors[input.dataset.level];
  renderGaugePreview();
}

async function renderSnooze() {
  const { snoozeUntil } = await getAll();
  document.getElementById("snoozeRow").hidden = !isSnoozed(snoozeUntil);
  document.getElementById("snoozeInfo").textContent = `Alerts are snoozed until ${formatClock(snoozeUntil)}`;
}

/** Lists the manifest's commands with whatever keys Chrome actually bound — it may have dropped a clash. */
async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
  document.getElementById("shortcutList").replaceChildren(
    ...commands.flatMap((command) => {
      const term = document.createElement("dt");
      // Chrome gives the built-in "open the popup" command no description of its own.
      term.textContent = command.description || "Open ClaudeMeter";

      const keys = document.createElement("dd");
      if (command.shortcut) {
        const kbd = document.createElement("kbd");
        kbd.textContent = command.shortcut;
        keys.append(kbd);
      } else {
        keys.className = "unset";
        keys.textContent = "Not set";
      }
      return [term, keys];
    })
  );
}

function updateThresholdsRowState(enabled) {
  thresholdsRow.classList.toggle("disabled", !enabled);
  // Really disabled, not just dimmed — otherwise the keyboard can still reach and flip them.
  for (const check of thresholdChecks) check.disabled = !enabled;
}

function describeInterval(minutes) {
  return `${minutes} minute${Number(minutes) === 1 ? "" : "s"}`;
}

async function init() {
  const settings = await getSettings();

  refreshIntervalSlider.value = settings.refreshIntervalMinutes;
  refreshIntervalSlider.setAttribute("aria-valuetext", describeInterval(settings.refreshIntervalMinutes));
  refreshIntervalValue.textContent = `${settings.refreshIntervalMinutes} min`;

  notificationsToggle.checked = settings.notificationsEnabled;
  updateThresholdsRowState(settings.notificationsEnabled);
  renderSnooze();

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

  iconStyleSelect.value = settings.iconStyle;
  renderGaugePreview();

  renderSeverity(settings);

  actionOpensSelect.value = settings.actionOpens;
  // Older Chromium builds have no side panel; don't offer what can't work.
  actionOpensSelect.querySelector('[value="sidePanel"]').disabled = !chrome.sidePanel;

  themeSelect.value = settings.theme;
  buildAccentSwatches(settings.accent);
  applyTheme(settings);
  privacyModeToggle.checked = settings.privacyMode;

  developerModeToggle.checked = settings.developerMode;
}

refreshIntervalSlider.addEventListener("input", () => {
  refreshIntervalValue.textContent = `${refreshIntervalSlider.value} min`;
  refreshIntervalSlider.setAttribute("aria-valuetext", describeInterval(refreshIntervalSlider.value));
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

iconStyleSelect.addEventListener("change", async () => {
  renderGaugePreview();
  await setSettings({ iconStyle: iconStyleSelect.value });
});

for (const input of [warnAtInput, dangerAtInput]) {
  input.addEventListener("change", async () => {
    // Whichever field was just edited wins; the other one moves out of its way.
    const cutoffs = normalizeCutoffs(warnAtInput.value, dangerAtInput.value, input === warnAtInput ? "warnAt" : "dangerAt");
    renderSeverity(await setSettings(cutoffs));
  });
}

for (const input of colorInputs) {
  input.addEventListener("change", async () => {
    const { severityColors: current } = await getSettings();
    renderSeverity(await setSettings({ severityColors: { ...current, [input.dataset.level]: input.value } }));
  });
}

resetSeverityBtn.addEventListener("click", async () => {
  renderSeverity(
    await setSettings({ warnAt: 80, dangerAt: 95, severityColors: { ok: null, warn: null, danger: null } })
  );
});

actionOpensSelect.addEventListener("change", async () => {
  await setSettings({ actionOpens: actionOpensSelect.value });
});

themeSelect.addEventListener("change", async () => {
  applyTheme(await setSettings({ theme: themeSelect.value }));
});

accentSwatches.addEventListener("change", async (event) => {
  applyTheme(await setSettings({ accent: event.target.value }));
});

onSystemThemeChange(async () => applyTheme(await getSettings()));

developerModeToggle.addEventListener("change", async () => {
  await setSettings({ developerMode: developerModeToggle.checked });
});

clearDataBtn.addEventListener("click", async () => {
  if (!confirm("Clear all stored ClaudeMeter data (captures + usage snapshot + history + message costs + limit-hit log)?")) return;
  await clearAllData();
  clearDataBtn.textContent = "Cleared!";
  document.getElementById("clearStatus").textContent = "Stored data cleared.";
  setTimeout(() => (clearDataBtn.textContent = "Clear stored data"), 1200);
});

document.getElementById("resumeAlertsBtn").addEventListener("click", () => setSnoozeUntil(0));

document.getElementById("changeShortcutsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
// Coming back from Chrome's shortcut page should show the new bindings.
window.addEventListener("focus", renderShortcuts);
renderShortcuts();

privacyModeToggle.addEventListener("change", async () => {
  await setSettings({ privacyMode: privacyModeToggle.checked });
});

onStorageChanged((changes) => {
  if (changes.snoozeUntil) renderSnooze();
  // Privacy mode can also be flipped from the popup, the shortcut or the icon's menu.
  if (changes.settings) privacyModeToggle.checked = Boolean(changes.settings.newValue?.privacyMode);
});

init();
