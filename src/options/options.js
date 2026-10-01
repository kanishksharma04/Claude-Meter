import { getAll, getSettings, setSettings, setSnoozeUntil, clearAllData, onStorageChanged } from "../lib/storage.js";
import { formatClock, formatHour, timeAgo } from "../lib/time-format.js";
import { SERVICES, checkWebhookUrl } from "../lib/webhooks.js";
import { isSnoozed } from "../lib/snooze.js";
import { drawGauge } from "../lib/gauge-icon.js";
import { normalizeCutoffs, severityColor, severityColors } from "../lib/severity.js";
import { ACCENTS, applyTheme, onSystemThemeChange } from "../lib/theme.js";
import { normalizeThresholds, thresholdProblem, addThreshold, removeThreshold, MAX_THRESHOLDS } from "../lib/thresholds.js";

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

/** Start offers 0:00–23:00, end 1:00–24:00; the end is always kept after the start. */
function renderWorkday(settings) {
  const option = (hour) => new Option(formatHour(hour % 24), String(hour));
  workdayStartSelect.replaceChildren(...Array.from({ length: 24 }, (_, hour) => option(hour)));
  workdayEndSelect.replaceChildren(...Array.from({ length: 24 }, (_, index) => option(index + 1)));
  workdayStartSelect.value = String(settings.workdayStart);
  workdayEndSelect.value = String(settings.workdayEnd);
}

// ---------------------------------------------------------------- webhooks --

const webhookList = document.getElementById("webhookList");

function setWebhookStatus(service, text, problem = false) {
  const status = webhookList.querySelector(`[data-service="${service}"] .webhook-status`);
  status.textContent = text;
  status.classList.toggle("problem", problem);
}

/** One block per service: a switch, the address, a test button, and how the last delivery went. */
async function renderWebhooks() {
  const { webhooks } = await getSettings();
  const { webhookStatus = {} } = await chrome.storage.local.get("webhookStatus");

  if (webhookList.childElementCount === 0) {
    webhookList.replaceChildren(
      ...Object.entries(SERVICES).map(([service, spec]) => {
        const block = document.createElement("div");
        block.className = "webhook";
        block.dataset.service = service;
        block.innerHTML = `
          <label class="row">
            <span><span class="webhook-name"></span><small></small></span>
            <input type="checkbox" class="webhook-toggle" />
          </label>
          <div class="webhook-url">
            <input type="url" class="webhook-address" spellcheck="false" autocomplete="off" />
            <button type="button" class="secondary inline webhook-test">Send test</button>
          </div>
          <small class="webhook-status" role="status"></small>`;
        block.querySelector(".webhook-name").textContent = spec.label;
        block.querySelector("small").textContent = spec.help;
        const address = block.querySelector(".webhook-address");
        address.placeholder = spec.placeholder;
        address.setAttribute("aria-label", `${spec.label} webhook address`);
        return block;
      })
    );
  }

  for (const [service, { enabled, url }] of Object.entries(webhooks)) {
    const block = webhookList.querySelector(`[data-service="${service}"]`);
    block.querySelector(".webhook-toggle").checked = enabled;
    const address = block.querySelector(".webhook-address");
    if (document.activeElement !== address) address.value = url;
    const last = webhookStatus[service];
    if (last && !block.querySelector(".webhook-status").textContent) {
      setWebhookStatus(service, `Last delivery ${timeAgo(last.at)}: ${last.detail}`, !last.ok);
    }
  }
}

async function saveWebhook(service, change) {
  const { webhooks } = await getSettings();
  await setSettings({ webhooks: { ...webhooks, [service]: { ...webhooks[service], ...change } } });
}

webhookList.addEventListener("change", async (event) => {
  const block = event.target.closest(".webhook");
  const service = block.dataset.service;
  const toggle = block.querySelector(".webhook-toggle");
  const checked = checkWebhookUrl(service, block.querySelector(".webhook-address").value);

  if (event.target.matches(".webhook-address")) {
    // A changed address may be on a different host, which the earlier permission doesn't cover: start again.
    toggle.checked = false;
    await saveWebhook(service, { url: checked.ok ? checked.url : event.target.value.trim(), enabled: false });
    return setWebhookStatus(service, checked.ok ? "Address saved. Switch it on to start sending." : checked.problem, !checked.ok);
  }

  if (!toggle.checked) {
    await saveWebhook(service, { enabled: false });
    if (checked.ok) chrome.permissions.remove({ origins: [checked.origin] }).catch(() => {});
    return setWebhookStatus(service, "Off. Nothing is sent to it.");
  }

  if (!checked.ok) {
    toggle.checked = false;
    return setWebhookStatus(service, checked.problem, true);
  }
  // Asked straight from the click: the browser only shows its prompt in answer to a user's own action.
  const granted = await chrome.permissions.request({ origins: [checked.origin] }).catch(() => false);
  if (!granted) {
    toggle.checked = false;
    return setWebhookStatus(service, `The browser wasn't given permission to contact ${new URL(checked.url).hostname}.`, true);
  }
  await saveWebhook(service, { url: checked.url, enabled: true });
  setWebhookStatus(service, "On. Alerts will be sent here too.");
});

webhookList.addEventListener("click", async (event) => {
  if (!event.target.matches(".webhook-test")) return;
  const service = event.target.closest(".webhook").dataset.service;
  const checked = checkWebhookUrl(service, event.target.closest(".webhook").querySelector(".webhook-address").value);
  if (!checked.ok) return setWebhookStatus(service, checked.problem, true);

  const granted = await chrome.permissions.request({ origins: [checked.origin] }).catch(() => false);
  if (!granted) return setWebhookStatus(service, "The browser wasn't given permission to contact that site.", true);

  await saveWebhook(service, { url: checked.url });
  setWebhookStatus(service, "Sending…");
  const result = await chrome.runtime.sendMessage({ type: "CLAUDEMETER_TEST_WEBHOOK", service }).catch(() => null);
  setWebhookStatus(service, result?.ok ? "Test sent. Check the channel." : `Test failed: ${result?.detail ?? "no answer from the extension."}`, !result?.ok);
});

function renderDemo(settings) {
  demoModeToggle.checked = settings.demoMode;
  demoLabelToggle.checked = settings.demoLabel;
  demoLabelToggle.disabled = !settings.demoMode;
  document.getElementById("demoLabelRow").classList.toggle("disabled", !settings.demoMode);
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

  paceAlertSelect.value = String(settings.paceAlertFactor);
  resetAlertSelect.value = String(settings.resetAlertPercent);
  renderThresholds(settings.notifyThresholds);
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
  if (!confirm("Clear all stored ClaudeMeter data (captures + usage snapshot + history + hourly usage log + session windows + chart notes + spikes + extra-usage record + message costs + limit-hit log)?")) return;
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

demoModeToggle.addEventListener("change", async () => {
  renderDemo(await setSettings({ demoMode: demoModeToggle.checked }));
});

demoLabelToggle.addEventListener("change", async () => {
  await setSettings({ demoLabel: demoLabelToggle.checked });
});

onStorageChanged((changes) => {
  if (changes.snoozeUntil) renderSnooze();
  // Demo data changes what the gauge preview should show.
  if (changes.demoState || changes.settings) renderGaugePreview();
  // Privacy mode can also be flipped from the popup, the shortcut or the icon's menu.
  if (changes.settings) privacyModeToggle.checked = Boolean(changes.settings.newValue?.privacyMode);
});

init();
