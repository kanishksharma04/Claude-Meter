import { getAll, getSettings, setSettings, setSnoozeUntil, clearAllData, onStorageChanged } from "../lib/storage.js";
import { formatClock, formatHour, timeAgo } from "../lib/time-format.js";
import { SERVICES, checkWebhookUrl } from "../lib/webhooks.js";
import { SOUNDS } from "../lib/sounds.js";
import { buildResetCalendar, weeklyResets, reminderLabel, REMINDER_OPTIONS, CALENDAR_FILENAME } from "../lib/ics.js";
import {
  isQuiet,
  quietUntil,
  addWindow,
  removeWindow,
  updateWindow,
  copyToAllDays,
  toTimeValue,
  fromTimeValue,
  windowNote,
  MAX_WINDOWS_PER_DAY,
} from "../lib/quiet-hours.js";
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

// -------------------------------------------------------------- claude code --

const claudeCodeToggle = document.getElementById("claudeCodeToggle");
const claudeCodeLiveToggle = document.getElementById("claudeCodeLiveToggle");
const statusFileToggle = document.getElementById("statusFileToggle");
const claudeCodeStatusNote = document.getElementById("claudeCodeStatus");
const INSTALL_COMMAND = `node companion/install.mjs ${chrome.runtime.id}`;

/** Says how the companion is doing, and keeps the install steps in view until it answers. */
async function renderClaudeCode() {
  const { settings, claudeCodeStatus, claudeCode } = await getAll();
  claudeCodeToggle.checked = settings.claudeCode;
  claudeCodeLiveToggle.checked = settings.claudeCodeLive;
  claudeCodeLiveToggle.disabled = !settings.claudeCode;
  document.getElementById("claudeCodeLiveRow").classList.toggle("disabled", !settings.claudeCode);
  document.getElementById("installCommand").textContent = INSTALL_COMMAND;

  const working = settings.claudeCode && claudeCodeStatus?.ok;
  document.getElementById("claudeCodeSetup").hidden = working;
  statusFileToggle.checked = settings.statusFile;
  statusFileToggle.disabled = !settings.claudeCode;
  document.getElementById("statusFileRow").classList.toggle("disabled", !settings.claudeCode);

  // Where the file is, in the companion's own words, once it has said.
  const terminal = document.getElementById("claudeCodeTerminal");
  const file = claudeCodeStatus?.statusFile;
  terminal.hidden = !working || settings.demoMode || !settings.statusFile || !file;
  if (!terminal.hidden) {
    const code = (text) => Object.assign(document.createElement("code"), { textContent: text });
    terminal.replaceChildren(
      "Writing ",
      code(file),
      " (and status.txt beside it). In a terminal, ",
      code("claudemeter status"),
      " prints a line such as ",
      code("5h 62% · wk 71%"),
      "; companion/examples has scripts for Raycast and the menu bar."
    );
  }
  claudeCodeStatusNote.classList.toggle("problem", settings.claudeCode && claudeCodeStatus?.ok === false);
  claudeCodeStatusNote.textContent = !settings.claudeCode
    ? ""
    : settings.demoMode
      ? "Demo mode is on, so these are made-up figures and the companion isn't being asked."
      : !claudeCodeStatus
        ? "Asking the companion…"
        : claudeCodeStatus.ok
          ? `Connected to the companion (version ${claudeCodeStatus.version}). ` +
            (claudeCodeStatus.live
              ? `Live: watching ${claudeCode?.files ?? 0} log file${claudeCode?.files === 1 ? "" : "s"}` +
                (claudeCodeStatus.watching === "polling" ? ", checked every 15 seconds." : " for changes.")
              : `Read ${claudeCode?.files ?? 0} log file${claudeCode?.files === 1 ? "" : "s"} ${timeAgo(claudeCodeStatus.at)}; asked again at each refresh.`)
          : claudeCodeStatus.problem.text;
}

claudeCodeToggle.addEventListener("change", async () => {
  await setSettings({ claudeCode: claudeCodeToggle.checked });
  renderClaudeCode();
});

claudeCodeLiveToggle.addEventListener("change", async () => {
  await setSettings({ claudeCodeLive: claudeCodeLiveToggle.checked });
  renderClaudeCode();
});

statusFileToggle.addEventListener("change", async () => {
  await setSettings({ statusFile: statusFileToggle.checked });
  renderClaudeCode();
});

document.getElementById("claudeCodeCheckBtn").addEventListener("click", async () => {
  claudeCodeStatusNote.textContent = "Asking the companion…";
  claudeCodeStatusNote.classList.remove("problem");
  await chrome.runtime.sendMessage({ type: "CLAUDEMETER_REFRESH_CLAUDE_CODE" }).catch(() => null);
  renderClaudeCode();
});

document.getElementById("copyInstallBtn").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(INSTALL_COMMAND).catch(() => {});
  event.target.textContent = "Copied";
  setTimeout(() => (event.target.textContent = "Copy"), 1500);
});

// ---------------------------------------------------------- reset calendar --

const calendarReminderSelect = document.getElementById("calendarReminderSelect");
const calendarNote = document.getElementById("calendarNote");

function renderCalendar(settings) {
  calendarReminderSelect.replaceChildren(
    ...REMINDER_OPTIONS.map((minutes) => new Option(reminderLabel(minutes), String(minutes)))
  );
  calendarReminderSelect.value = String(settings.calendarReminder);
}

calendarReminderSelect.addEventListener("change", async () => {
  await setSettings({ calendarReminder: Number(calendarReminderSelect.value) });
});

document.getElementById("calendarBtn").addEventListener("click", async () => {
  const { latestSnapshot, settings } = await getAll();
  const calendar = buildResetCalendar(latestSnapshot, { reminderMinutes: settings.calendarReminder });
  if (!calendar) {
    calendarNote.textContent = "No weekly reset time is known yet. Sign in to claude.ai, then try again.";
    return;
  }

  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  link.download = CALENDAR_FILENAME;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);

  const [next] = weeklyResets(latestSnapshot);
  const when = new Date(next.resetsAt).toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" });
  calendarNote.textContent = `Saved ${CALENDAR_FILENAME} to your downloads: every week on ${when}. Open it to add it to your calendar.`;
});

// ------------------------------------------------------------- quiet hours --

const quietToggle = document.getElementById("quietToggle");
const quietDays = document.getElementById("quietDays");
const quietStatus = document.getElementById("quietStatus");
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function renderQuietStatus(quietHours) {
  const until = quietUntil(quietHours);
  quietStatus.textContent = !quietHours.enabled
    ? ""
    : isQuiet(quietHours)
      ? until
        ? `Quiet now, until ${formatClock(until)}.`
        : "Quiet now, and all week — no alert will get through."
      : "Not in a quiet window right now.";
}

/** One row per weekday: its windows as pairs of time fields, with add, remove and copy-to-all. */
function renderQuietHours(quietHours, refocus = null) {
  quietToggle.checked = quietHours.enabled;
  quietDays.classList.toggle("disabled", !quietHours.enabled);
  renderQuietStatus(quietHours);

  const button = (text, action, label, disabled = false) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = text;
    node.dataset.action = action;
    node.setAttribute("aria-label", label);
    node.disabled = disabled || !quietHours.enabled;
    return node;
  };
  const time = (minutes, end, label) => {
    const input = document.createElement("input");
    input.type = "time";
    input.value = toTimeValue(minutes);
    input.dataset.end = end;
    input.setAttribute("aria-label", label);
    input.disabled = !quietHours.enabled;
    return input;
  };

  quietDays.replaceChildren(
    ...quietHours.days.map((windows, day) => {
      const name = DAY_NAMES[day];
      const list = document.createElement("ul");
      list.className = "quiet-windows";
      list.setAttribute("aria-label", `${name}'s quiet windows`);
      list.append(
        ...windows.map((window, index) => {
          const item = document.createElement("li");
          item.dataset.index = String(index);
          const ordinal = windows.length > 1 ? ` ${index + 1}` : "";
          item.append(
            time(window.from, "from", `${name} window${ordinal} starts`),
            "to",
            time(window.to, "to", `${name} window${ordinal} ends`),
            button("\u00d7", "remove", `Remove ${name} window${ordinal}`)
          );
          const note = document.createElement("span");
          note.className = "quiet-note";
          note.textContent = windowNote(window);
          item.lastChild.before(note);
          return item;
        })
      );

      // Under the windows: what can be done with the day, led by a word when it has none.
      const actions = document.createElement("div");
      actions.className = "quiet-day-actions";
      if (windows.length === 0) {
        const none = document.createElement("span");
        none.className = "none";
        none.textContent = "No quiet time";
        actions.append(none);
      }
      actions.append(
        button("Add", "add", `Add a quiet window on ${name}`, windows.length >= MAX_WINDOWS_PER_DAY),
        button("Copy to all", "copy", `Give every day ${name}'s windows`)
      );

      const body = document.createElement("div");
      body.className = "quiet-day-body";
      body.append(list, actions);

      const row = document.createElement("div");
      row.className = "quiet-day";
      row.dataset.day = String(day);
      const heading = document.createElement("span");
      heading.className = "quiet-day-name";
      heading.textContent = name.slice(0, 3);
      heading.title = name;
      row.append(heading, body);
      return row;
    })
  );

  // The row was rebuilt under the button that was pressed; put focus back somewhere sensible in it.
  if (refocus) quietDays.querySelector(`[data-day="${refocus.day}"] [data-action="${refocus.action}"]:not(:disabled)`)?.focus();
}

async function saveQuietHours(quietHours, refocus) {
  renderQuietHours((await setSettings({ quietHours })).quietHours, refocus);
}

quietToggle.addEventListener("change", async () => {
  const { quietHours } = await getSettings();
  await saveQuietHours({ ...quietHours, enabled: quietToggle.checked });
});

quietDays.addEventListener("click", async (event) => {
  const action = event.target.closest("button")?.dataset.action;
  if (!action) return;
  const day = Number(event.target.closest(".quiet-day").dataset.day);
  const { quietHours } = await getSettings();

  if (action === "add") return saveQuietHours(addWindow(quietHours, day), { day, action: "add" });
  if (action === "copy") return saveQuietHours(copyToAllDays(quietHours, day), { day, action: "copy" });
  const index = Number(event.target.closest("li").dataset.index);
  await saveQuietHours(removeWindow(quietHours, day, index), { day, action: "add" });
});

quietDays.addEventListener("change", async (event) => {
  if (!event.target.matches('input[type="time"]')) return;
  const minutes = fromTimeValue(event.target.value);
  const { quietHours } = await getSettings();
  // A cleared field isn't a time: put back what was there.
  if (minutes == null) return renderQuietHours(quietHours);
  const day = Number(event.target.closest(".quiet-day").dataset.day);
  const index = Number(event.target.closest("li").dataset.index);
  await saveQuietHours(updateWindow(quietHours, day, index, { [event.target.dataset.end]: minutes }));
});

// "Quiet now, until…" goes stale by itself as the clock moves.
setInterval(async () => renderQuietStatus((await getSettings()).quietHours), 30_000);

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
  digestToggle.checked = settings.dailyDigest;
  digestTimeInput.value = toTimeValue(settings.digestTime);
  soundSelect.replaceChildren(...Object.entries(SOUNDS).map(([id, { label }]) => new Option(label, id)));
  soundToggle.checked = settings.soundAlerts;
  soundSelect.value = settings.soundName;
  soundVolume.value = settings.soundVolume;
  soundVolume.setAttribute("aria-valuetext", `${settings.soundVolume}%`);
  renderThresholds(settings.notifyThresholds);
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
  if (changes.claudeCodeStatus || changes.claudeCode) renderClaudeCode();
  if (changes.snoozeUntil) renderSnooze();
  // Demo data changes what the gauge preview should show.
  if (changes.demoState || changes.settings) renderGaugePreview();
  // Privacy mode can also be flipped from the popup, the shortcut or the icon's menu.
  if (changes.settings) privacyModeToggle.checked = Boolean(changes.settings.newValue?.privacyMode);
});

init();
