// The Options page. This file is the page's entry: the settings that are one
// control and one line each, filling every control in when the page opens,
// and keeping the page in step when something changes elsewhere. The cards
// with more to them have a module each:
//
//   orgs.js         which organisation is the main one, and which are followed alongside
//   api-spend.js    the Admin API key and the Console cost report
//   claude-code.js  the companion: switches, its state, the install command
//   alerts.js       the reset calendar, quiet hours and webhooks
//   data.js         the archive, backups and restore, clearing data and the full reset

import { getAll, getSettings, setSettings, updateSettings, setSnoozeUntil, onStorageChanged } from "../lib/storage.js";
import { describePlan } from "../lib/refresh-plan.js";
import { LANGUAGES, localizePage } from "../lib/i18n.js";
import { formatClock, formatHour } from "../lib/time-format.js";
import { SOUNDS } from "../lib/sounds.js";
import { toTimeValue, fromTimeValue } from "../lib/quiet-hours.js";
import { isSnoozed } from "../lib/snooze.js";
import { drawGauge } from "../lib/gauge-icon.js";
import { normalizeCutoffs, severityColor, severityColors } from "../lib/severity.js";
import { ACCENTS, applyTheme, onSystemThemeChange } from "../lib/theme.js";
import { normalizeThresholds, thresholdProblem, addThreshold, removeThreshold, MAX_THRESHOLDS } from "../lib/thresholds.js";
import { renderCalendar, renderQuietHours, renderWebhooks } from "./alerts.js";
import { renderApiSpend } from "./api-spend.js";
import { BROWSER, renderClaudeCode } from "./claude-code.js";
import { renderBackup } from "./data.js";
import { renderOrgs } from "./orgs.js";

const refreshIntervalSlider = document.getElementById("refreshIntervalSlider");

const refreshIntervalValue = document.getElementById("refreshIntervalValue");

const notificationsToggle = document.getElementById("notificationsToggle");

const thresholdsRow = document.getElementById("thresholdsRow");

const thresholdList = document.getElementById("thresholdList");

const thresholdForm = document.getElementById("thresholdForm");

const thresholdInput = document.getElementById("thresholdInput");

const thresholdNote = document.getElementById("thresholdNote");

const paceAlertSelect = document.getElementById("paceAlertSelect");

const resetAlertSelect = document.getElementById("resetAlertSelect");

const digestToggle = document.getElementById("digestToggle");

const digestTimeInput = document.getElementById("digestTimeInput");

const soundToggle = document.getElementById("soundToggle");

const soundSelect = document.getElementById("soundSelect");

const soundVolume = document.getElementById("soundVolume");

const soundNote = document.getElementById("soundNote");

const inlinePillToggle = document.getElementById("inlinePillToggle");

const tabIndicatorSelect = document.getElementById("tabIndicatorSelect");

const preSendWarnSelect = document.getElementById("preSendWarnSelect");

const modelHintSelect = document.getElementById("modelHintSelect");

const longContextSelect = document.getElementById("longContextSelect");

const attachmentWarnSelect = document.getElementById("attachmentWarnSelect");

const lockoutOverlayToggle = document.getElementById("lockoutOverlayToggle");

const messageCostToggle = document.getElementById("messageCostToggle");

const weeklyBudgetToggle = document.getElementById("weeklyBudgetToggle");

const forecastSelect = document.getElementById("forecastSelect");

const workdayStartSelect = document.getElementById("workdayStartSelect");

const workdayEndSelect = document.getElementById("workdayEndSelect");

const planSelect = document.getElementById("planSelect");

const spikeSelect = document.getElementById("spikeSelect");

const planPriceInput = document.getElementById("planPriceInput");

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

const demoModeToggle = document.getElementById("demoModeToggle");

const demoLabelToggle = document.getElementById("demoLabelToggle");

const developerModeToggle = document.getElementById("developerModeToggle");

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
  const { latestSnapshot, settings } = await getAll({ logs: false });
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

/** Start offers 0:00–23:00, end 1:00–24:00; the end is always kept after the start. */
function renderWorkday(settings) {
  const option = (hour) => new Option(formatHour(hour % 24), String(hour));
  workdayStartSelect.replaceChildren(...Array.from({ length: 24 }, (_, hour) => option(hour)));
  workdayEndSelect.replaceChildren(...Array.from({ length: 24 }, (_, index) => option(index + 1)));
  workdayStartSelect.value = String(settings.workdayStart);
  workdayEndSelect.value = String(settings.workdayEnd);
}

function renderDemo(settings) {
  demoModeToggle.checked = settings.demoMode;
  demoLabelToggle.checked = settings.demoLabel;
  demoLabelToggle.disabled = !settings.demoMode;
  document.getElementById("demoLabelRow").classList.toggle("disabled", !settings.demoMode);
}

async function renderSnooze() {
  const { snoozeUntil } = await getAll({ logs: false });
  document.getElementById("snoozeRow").hidden = !isSnoozed(snoozeUntil);
  document.getElementById("snoozeInfo").textContent = `Alerts are snoozed until ${formatClock(snoozeUntil)}`;
}

/** Lists the manifest's commands with whatever keys Chrome actually bound — it may have dropped a clash. */
async function renderShortcuts() {
  const commands = (await chrome.commands?.getAll()) ?? [];
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
  // Everything that only matters while alerts are on: really disabled, not just
  // dimmed — otherwise the keyboard can still reach and change it.
  for (const row of [thresholdsRow, ...document.querySelectorAll(".alert-option")]) {
    row.classList.toggle("disabled", !enabled);
    for (const control of row.querySelectorAll("input, button, select")) control.disabled = !enabled;
  }
}

/** One chip per threshold, each with its own remove button. */
function renderThresholds(list) {
  const thresholds = normalizeThresholds(list);
  thresholdList.replaceChildren(
    ...thresholds.map((value) => {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "\u00d7";
      remove.dataset.remove = String(value);
      remove.setAttribute("aria-label", `Remove the ${value}% threshold`);
      remove.title = `Remove ${value}%`;

      const chip = document.createElement("li");
      chip.append(`${value}%`, remove);
      return chip;
    })
  );
  if (thresholds.length === 0) thresholdNote.textContent = "No thresholds: nothing will alert until you add one.";
  updateThresholdsRowState(notificationsToggle.checked);
}

const THRESHOLD_PROBLEMS = {
  invalid: "Enter a whole number from 1 to 100.",
  duplicate: "That threshold is already in the list.",
  full: `That's the most there can be (${MAX_THRESHOLDS}). Remove one first.`,
};

const adaptiveRefreshToggle = document.getElementById("adaptiveRefreshToggle");

/** What the adaptive pace is doing just now, and when the next reading is due. */
async function renderRefreshPace() {
  const { settings, refreshPace } = await getAll({ logs: false });
  const info = document.getElementById("refreshPaceInfo");
  // Demo mode fetches nothing, and a fixed interval needs no explaining.
  info.hidden = !settings.adaptiveRefresh || settings.demoMode || !refreshPace?.minutes || refreshPace.mode === "fixed";
  if (info.hidden) return;
  const next = refreshPace.nextAt > Date.now() ? ` Next at ${formatClock(refreshPace.nextAt)}.` : "";
  info.textContent = `Now: ${describePlan(refreshPace).replace(/^./, (letter) => letter.toLowerCase())}${next}`;
}

adaptiveRefreshToggle.addEventListener("change", () => setSettings({ adaptiveRefresh: adaptiveRefreshToggle.checked }));

function describeInterval(minutes) {
  return `${minutes} minute${Number(minutes) === 1 ? "" : "s"}`;
}

async function init() {
  const settings = await getSettings();
  await localizePage(settings);

  refreshIntervalSlider.value = settings.refreshIntervalMinutes;
  refreshIntervalSlider.setAttribute("aria-valuetext", describeInterval(settings.refreshIntervalMinutes));
  refreshIntervalValue.textContent = `${settings.refreshIntervalMinutes} min`;
  adaptiveRefreshToggle.checked = settings.adaptiveRefresh;
  renderRefreshPace();

  notificationsToggle.checked = settings.notificationsEnabled;
  updateThresholdsRowState(settings.notificationsEnabled);
  renderSnooze();

  paceAlertSelect.value = String(settings.paceAlertFactor);
  resetAlertSelect.value = String(settings.resetAlertPercent);
  digestToggle.checked = settings.dailyDigest;
  digestTimeInput.value = toTimeValue(settings.digestTime);
  soundSelect.replaceChildren(...Object.entries(SOUNDS).map(([id, { label }]) => new Option(label, id)));
  soundToggle.checked = settings.soundAlerts;
  soundSelect.value = settings.soundName;
  soundVolume.value = settings.soundVolume;
  soundVolume.setAttribute("aria-valuetext", `${settings.soundVolume}%`);
  renderThresholds(settings.notifyThresholds);
  renderOrgs();
  renderApiSpend();
  renderClaudeCode();
  renderCalendar(settings);
  renderQuietHours(settings.quietHours);
  renderWebhooks();

  inlinePillToggle.checked = settings.inlinePill;
  tabIndicatorSelect.value = settings.tabIndicator;
  preSendWarnSelect.value = String(settings.preSendWarnPercent);
  modelHintSelect.value = String(settings.modelHintPercent);
  longContextSelect.value = String(settings.longContextTokens);
  attachmentWarnSelect.value = String(settings.attachmentWarnTokens);
  lockoutOverlayToggle.checked = settings.lockoutOverlay;
  messageCostToggle.checked = settings.messageCost;

  weeklyBudgetToggle.checked = settings.weeklyBudget;
  forecastSelect.value = settings.forecast;
  renderWorkday(settings);
  planSelect.value = settings.plan;
  spikeSelect.value = String(settings.spikePercent);
  planPriceInput.value = settings.planPrice > 0 ? settings.planPrice : "";

  iconStyleSelect.value = settings.iconStyle;
  renderGaugePreview();

  renderSeverity(settings);

  actionOpensSelect.value = settings.actionOpens;
  // Older Chromium builds have no side panel; don't offer what can't work.
  actionOpensSelect.querySelector('[value="sidePanel"]').disabled = !chrome.sidePanel;

  // Each language under its own name, so it can be found by someone who can't read the current one.
  const languageSelect = document.getElementById("languageSelect");
  languageSelect.replaceChildren(
    new Option(`Auto (${LANGUAGES[document.documentElement.lang.replace("-", "_")] ?? "English"})`, "auto"),
    ...Object.entries(LANGUAGES).map(([code, name]) => new Option(name, code))
  );
  languageSelect.value = settings.language;
  languageSelect.addEventListener("change", async () => {
    await setSettings({ language: languageSelect.value });
    location.reload(); // the page was translated as it loaded; load it again in the new language
  });

  themeSelect.value = settings.theme;
  buildAccentSwatches(settings.accent);
  applyTheme(settings);
  privacyModeToggle.checked = settings.privacyMode;
  renderDemo(settings);

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

paceAlertSelect.addEventListener("change", async () => {
  await setSettings({ paceAlertFactor: Number(paceAlertSelect.value) });
});

resetAlertSelect.addEventListener("change", async () => {
  await setSettings({ resetAlertPercent: Number(resetAlertSelect.value) });
});

digestToggle.addEventListener("change", async () => {
  await setSettings({ dailyDigest: digestToggle.checked });
});

digestTimeInput.addEventListener("change", async () => {
  const minutes = fromTimeValue(digestTimeInput.value);
  // A cleared field isn't a time: put back what was there.
  if (minutes == null) return (digestTimeInput.value = toTimeValue((await getSettings()).digestTime));
  await setSettings({ digestTime: minutes });
});

soundToggle.addEventListener("change", async () => {
  await setSettings({ soundAlerts: soundToggle.checked });
});

/** Plays the chosen sound the way an alert would: worker, offscreen document and all. */
async function previewSound() {
  soundNote.textContent = "";
  const result = await chrome.runtime
    .sendMessage({ type: "CLAUDEMETER_TEST_SOUND", sound: soundSelect.value, volume: Number(soundVolume.value) })
    .catch(() => null);
  soundNote.textContent = result?.ok ? "" : `Couldn't play it: ${result?.detail ?? "no answer from the extension."}`;
}

soundSelect.addEventListener("change", async () => {
  await setSettings({ soundName: soundSelect.value });
  previewSound(); // choosing a sound without hearing it is guesswork
});

soundVolume.addEventListener("change", async () => {
  soundVolume.setAttribute("aria-valuetext", `${soundVolume.value}%`);
  await setSettings({ soundVolume: Number(soundVolume.value) });
  previewSound();
});

document.getElementById("soundTestBtn").addEventListener("click", previewSound);

thresholdForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { notifyThresholds } = await getSettings();
  const problem = thresholdProblem(notifyThresholds, thresholdInput.value);
  if (problem) {
    thresholdNote.textContent = THRESHOLD_PROBLEMS[problem];
    return thresholdInput.focus();
  }

  const value = Number(thresholdInput.value);
  thresholdNote.textContent = `Added ${value}%.`;
  renderThresholds((await setSettings({ notifyThresholds: addThreshold(notifyThresholds, value) })).notifyThresholds);
  thresholdInput.value = "";
  thresholdInput.focus();
});

thresholdList.addEventListener("click", async (event) => {
  const value = event.target.closest("[data-remove]")?.dataset.remove;
  if (value == null) return;
  const { notifyThresholds } = await getSettings();
  thresholdNote.textContent = `Removed ${value}%.`;
  renderThresholds((await setSettings({ notifyThresholds: removeThreshold(notifyThresholds, value) })).notifyThresholds);
  thresholdInput.focus(); // the button that had focus is gone
});

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

weeklyBudgetToggle.addEventListener("change", async () => {
  await setSettings({ weeklyBudget: weeklyBudgetToggle.checked });
});

forecastSelect.addEventListener("change", async () => {
  await setSettings({ forecast: forecastSelect.value });
});

for (const select of [workdayStartSelect, workdayEndSelect]) {
  select.addEventListener("change", async () => {
    let start = Number(workdayStartSelect.value);
    let end = Number(workdayEndSelect.value);
    // Whichever end was just moved wins; the other steps out of its way.
    if (end <= start) {
      if (select === workdayStartSelect) end = start + 1;
      else start = end - 1;
    }
    renderWorkday(await setSettings({ workdayStart: start, workdayEnd: end }));
  });
}

planPriceInput.addEventListener("change", async () => {
  // Empty, zero or nonsense all mean "use the plan's list price".
  const price = Math.max(0, Math.min(10_000, Number(planPriceInput.value) || 0));
  planPriceInput.value = price > 0 ? price : "";
  await setSettings({ planPrice: price });
});

spikeSelect.addEventListener("change", async () => {
  await setSettings({ spikePercent: Number(spikeSelect.value) });
});

planSelect.addEventListener("change", async () => {
  await setSettings({ plan: planSelect.value });
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
    renderSeverity(await updateSettings(({ severityColors }) => ({ severityColors: { ...severityColors, [input.dataset.level]: input.value } })));
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

document.getElementById("resumeAlertsBtn").addEventListener("click", () => setSnoozeUntil(0));

// Where shortcuts are changed is the browser's own page, and each browser's is somewhere else.
const changeShortcutsBtn = document.getElementById("changeShortcutsBtn");

changeShortcutsBtn.hidden = BROWSER === "safari" || (BROWSER === "firefox" && !chrome.commands?.openShortcutSettings);

changeShortcutsBtn.addEventListener("click", () => {
  if (BROWSER === "firefox") chrome.commands.openShortcutSettings();
  else chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

// Coming back from Chrome's shortcut page should show the new bindings.
window.addEventListener("focus", renderShortcuts);

renderShortcuts();

privacyModeToggle.addEventListener("change", async () => {
  await setSettings({ privacyMode: privacyModeToggle.checked });
});

demoModeToggle.addEventListener("change", async () => {
  renderDemo(await setSettings({ demoMode: demoModeToggle.checked }));
});

demoLabelToggle.addEventListener("change", async () => {
  await setSettings({ demoLabel: demoLabelToggle.checked });
});

onStorageChanged((changes) => {
  if (changes.orgList || changes.orgCache || changes.demoState) renderOrgs();
  if (changes.apiSpendStatus) renderApiSpend();
  if (changes.claudeCodeStatus || changes.claudeCode) renderClaudeCode();
  if (changes.snoozeUntil) renderSnooze();
  if (changes.refreshPace || changes.settings) renderRefreshPace();
  if (changes.backupStatus || changes.settings) renderBackup();
  // Demo data changes what the gauge preview should show.
  if (changes.demoState || changes.settings) renderGaugePreview();
  // Privacy mode can also be flipped from the popup, the shortcut or the icon's menu.
  if (changes.settings) privacyModeToggle.checked = Boolean(changes.settings.newValue?.privacyMode);
});

init();
