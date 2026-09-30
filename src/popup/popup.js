import { getAll, setSettings, setSnoozeUntil, onStorageChanged } from "../lib/storage.js";
import { timeAgo, formatDuration, formatClock } from "../lib/time-format.js";
import { isSnoozed } from "../lib/snooze.js";
import { formatCost } from "../lib/message-cost.js";
import { rankConversations } from "../lib/conversation-costs.js";
import { summarizeLimitHits, claimLabel } from "../lib/limit-hits.js";
import {
  chartSeries,
  weekSeries,
  logSeries,
  linePath,
  describeChart,
  WEEK_WINDOW_MS,
  LOG_GAP_MS,
} from "../lib/history-chart.js";
import { severityOf, isHexColor } from "../lib/severity.js";
import { arrangeBuckets, moveBucket, togglePinned, toggleHidden } from "../lib/bucket-prefs.js";
import { applyTheme, onSystemThemeChange } from "../lib/theme.js";
import { shareRows, buildShareText, shareCardSize, drawShareCard } from "../lib/share.js";
import { weeklyBudget, describeBudget } from "../lib/budget.js";
import { forecastSession, forecastWeekly, describeForecast, explainForecast } from "../lib/forecast.js";
import { renderInsights } from "./insights.js";

// This page serves more than one surface: the toolbar popup; as
// popup.html?view=panel the side panel (or a full tab), which gets the room
// for the dashboard extras; and as ?view=mini a small detached window that
// shows just the pinned limits.
const PARAMS = new URLSearchParams(location.search);
const VIEW = PARAMS.get("view") ?? "popup";
document.documentElement.dataset.view = VIEW;

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_WIDTH = 320;
const CHART_HEIGHT = 120;

const emptyState = document.getElementById("emptyState");
const loadingState = document.getElementById("loadingState");
const dataState = document.getElementById("dataState");
const errorBanner = document.getElementById("errorBanner");
const srStatus = document.getElementById("srStatus");
const privacyBtn = document.getElementById("privacyBtn");
const shareBtn = document.getElementById("shareBtn");
const shareMenu = document.getElementById("shareMenu");
const shareStatus = document.getElementById("shareStatus");
const snoozeBanner = document.getElementById("snoozeBanner");
const snoozeText = document.getElementById("snoozeText");
const mainEl = document.getElementById("main");
const planBadge = document.getElementById("planBadge");
const demoBadge = document.getElementById("demoBadge");
const lastUpdatedEl = document.getElementById("lastUpdated");
const refreshBtn = document.getElementById("refreshBtn");
const pinnedList = document.getElementById("pinnedList");
const restList = document.getElementById("restList");
const hiddenList = document.getElementById("hiddenList");
const restGroup = document.getElementById("restGroup");
const restDivider = document.getElementById("restDivider");
const restTitle = document.getElementById("restTitle");
const hiddenGroup = document.getElementById("hiddenGroup");
const hiddenNote = document.getElementById("hiddenNote");
const hiddenCount = document.getElementById("hiddenCount");
const sessionMissing = document.getElementById("sessionMissing");
const noWeekly = document.getElementById("noWeekly");
const arrangeBtn = document.getElementById("arrangeBtn");
const bucketRowTemplate = document.getElementById("bucketRowTemplate");
const topChats = document.getElementById("topChats");
const topChatsList = document.getElementById("topChatsList");
const limitHitsEl = document.getElementById("limitHits");
const sidePanelBtn = document.getElementById("sidePanelBtn");
const historySection = document.getElementById("history");
const historyBody = document.getElementById("historyBody");
const historyChart = document.getElementById("historyChart");
const historyLegend = document.getElementById("historyLegend");
const historyRange = document.getElementById("historyRange");
const historyFrom = document.getElementById("historyFrom");
const historyEmpty = document.getElementById("historyEmpty");
const historyRangeButtons = [...document.querySelectorAll("#historyControls [data-range]")];
const historyCompare = document.getElementById("historyCompare");
const historyCompareNote = document.getElementById("historyCompareNote");
const insights = document.getElementById("insights");

let latestState = null;
let arranging = false; // the popup's "reorder / pin / hide" mode
let refocus = null; // { id, action } — the tool button to put focus back on after a re-render
let rowSerial = 0; // makes each rendered row's label/description ids unique

/** Says something through the polite live region — for changes a sighted user would simply see. */
function announce(message) {
  // Clearing first makes a repeated message ("Opus moved up" twice) get read again.
  srStatus.textContent = "";
  requestAnimationFrame(() => (srStatus.textContent = message));
}

function severityClass(pct) {
  const severity = severityOf(pct, latestState?.settings);
  return severity === "ok" ? "" : severity;
}

/** A colour the user picked replaces the theme's; anything unset falls back to the stylesheet. */
function applySeverityColors(settings) {
  const style = document.documentElement.style;
  for (const [level, property] of [["ok", "--ok-fill"], ["warn", "--warn"], ["danger", "--danger"]]) {
    const custom = settings.severityColors?.[level];
    if (isHexColor(custom)) style.setProperty(property, custom);
    else style.removeProperty(property);
  }
}

/** "Last message: 3% of session · 2 min ago", or null when there's nothing to say. */
function lastMessageText(messageLog) {
  const last = messageLog.findLast((m) => m.session != null);
  if (!last) return null;
  const approx = last.shared ? "about " : "";
  return `Last message: ${approx}${formatCost(last.session)} of session · ${timeAgo(last.at)}`;
}

/** Where this bucket is heading by its reset, per the forecast setting; null when off or unknowable. */
function bucketForecast(kind, bucket) {
  const { settings, usageLog, latestSnapshot } = latestState;
  if (settings.forecast === "off") return null;
  const options = { mode: settings.forecast };
  return kind === "session"
    ? forecastSession(latestSnapshot, usageLog, options)
    : forecastWeekly(bucket, usageLog, options);
}

/**
 * One bucket row. `group` is where it is being shown ("pinned" | "rest" | "hidden"),
 * `position` its index and group size — both only matter for the arrange tools.
 */
function buildBucketRow(entry, group, position, messageLog) {
  const { id, kind, bucket } = entry;
  const row = bucketRowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.bucketId = id;
  row.classList.toggle("is-hidden", group === "hidden");

  // "Opus" on its own is ambiguous once it sits above the "Weekly limits" heading.
  const name = kind === "weekly" && group !== "rest" ? `${bucket.label} · weekly` : bucket.label;
  const label = row.querySelector(".usage-label");
  label.textContent = name;
  row.querySelector(".usage-pct").textContent = `${bucket.percentUsed}% used`;

  const fill = row.querySelector(".progress-fill");
  fill.style.width = `${bucket.percentUsed}%`;
  fill.className = `progress-fill ${severityClass(bucket.percentUsed)}`.trim();

  const liveLabel = bucket.resetsAt != null ? formatDuration(Date.now(), bucket.resetsAt) : null;
  const sub = row.querySelector(".usage-sub");
  sub.textContent = `Resets in ${liveLabel ?? bucket.resetsInLabel}`;

  // "Resets in 3 days 6 hr · on course for 84%"
  const forecast = bucketForecast(kind, bucket);
  if (forecast) {
    const phrase = document.createElement("span");
    phrase.className = "forecast";
    phrase.classList.toggle("full", forecast.fullAt != null);
    phrase.textContent = describeForecast(forecast);
    phrase.title = explainForecast(forecast);
    sub.append(" · ", phrase);
  }

  // The bar is the meter: name it after its label, give it a spoken value, and
  // hang the reset time off it as its description.
  const serial = ++rowSerial;
  label.id = `bucket-label-${serial}`;
  sub.id = `bucket-sub-${serial}`;
  const track = row.querySelector(".progress-track");
  track.setAttribute("aria-labelledby", label.id);
  track.setAttribute("aria-describedby", sub.id);
  track.setAttribute("aria-valuenow", String(bucket.percentUsed));
  track.setAttribute("aria-valuetext", `${bucket.percentUsed}% used`);

  const lastMessage = kind === "session" ? lastMessageText(messageLog) : null;
  if (lastMessage) {
    const line = document.createElement("p");
    line.className = "usage-sub";
    line.id = "lastMessage";
    line.textContent = lastMessage;
    row.querySelector(".bucket-tools").before(line);
  }

  const { settings, usageLog } = latestState;
  const budget = kind === "weekly" && settings.weeklyBudget ? weeklyBudget(bucket, usageLog) : null;
  if (budget) {
    const line = document.createElement("p");
    line.className = "usage-sub budget-line";
    line.classList.toggle("over", budget.over >= 0.5);
    line.textContent = describeBudget(budget);
    row.querySelector(".bucket-tools").before(line);
  }

  if (arranging) {
    const tools = row.querySelector(".bucket-tools");
    tools.hidden = false;
    tools.setAttribute("aria-label", `Arrange ${name}`);
    const pinned = group === "pinned";
    const hidden = group === "hidden";
    const set = (action, { text, label, disabled = false, pressed }) => {
      const button = tools.querySelector(`[data-action="${action}"]`);
      if (text) button.textContent = text;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.disabled = disabled;
      if (pressed != null) button.setAttribute("aria-pressed", String(pressed));
    };
    set("up", { label: `Move ${name} up`, disabled: position.index === 0 });
    set("down", { label: `Move ${name} down`, disabled: position.index === position.count - 1 });
    set("pin", {
      text: pinned ? "Unpin" : "Pin",
      label: pinned ? `Unpin ${name}` : `Pin ${name} to the top`,
      disabled: hidden,
      pressed: pinned,
    });
    set("hide", { text: hidden ? "Show" : "Hide", label: hidden ? `Show ${name}` : `Hide ${name}`, pressed: hidden });
  }

  return row;
}

function renderBuckets(snapshot, settings, messageLog) {
  const groups = arrangeBuckets(snapshot, settings.bucketPrefs);
  const fill = (container, group) =>
    container.replaceChildren(
      ...groups[group].map((entry, index) =>
        buildBucketRow(entry, group, { index, count: groups[group].length }, messageLog)
      )
    );

  fill(pinnedList, "pinned");
  fill(restList, "rest");
  fill(hiddenList, "hidden");

  // Say so when the session reading is missing, rather than silently dropping its row.
  sessionMissing.hidden = Boolean(snapshot.session);
  noWeekly.hidden = snapshot.weekly.length > 0;

  // The mini window is the pinned block and nothing else — unless nothing is pinned.
  const pinnedOnly = VIEW === "mini" && groups.pinned.length > 0;
  restGroup.hidden = pinnedOnly || (groups.rest.length === 0 && noWeekly.hidden);
  restDivider.hidden = groups.pinned.length === 0 && sessionMissing.hidden;
  restTitle.textContent = groups.rest.some((entry) => entry.kind === "session") ? "Limits" : "Weekly limits";

  hiddenGroup.hidden = !arranging || groups.hidden.length === 0;
  hiddenNote.hidden = arranging || groups.hidden.length === 0;
  hiddenCount.textContent = `${groups.hidden.length} limit${groups.hidden.length === 1 ? "" : "s"} hidden ·`;

  arrangeBtn.setAttribute("aria-pressed", String(arranging));
  arrangeBtn.classList.toggle("active", arranging);

  if (refocus) {
    document.querySelector(`[data-bucket-id="${CSS.escape(refocus.id)}"] [data-action="${refocus.action}"]`)?.focus();
    refocus = null;
  }
}

/** Arrange-mode buttons: every one of them is "change bucketPrefs, save, let the storage listener redraw". */
async function onBucketTool(event) {
  const button = event.target.closest(".tool-btn");
  const id = button?.closest("[data-bucket-id]")?.dataset.bucketId;
  if (!id || !latestState?.latestSnapshot) return;

  const prefs = latestState.settings.bucketPrefs;
  const action = button.dataset.action;
  const next =
    action === "up"
      ? moveBucket(latestState.latestSnapshot, prefs, id, -1)
      : action === "down"
        ? moveBucket(latestState.latestSnapshot, prefs, id, 1)
        : action === "pin"
          ? togglePinned(prefs, id)
          : toggleHidden(prefs, id);

  const name = button.closest("[data-bucket-id]").querySelector(".usage-label").textContent;
  const wasOn = button.getAttribute("aria-pressed") === "true";
  announce(
    action === "up"
      ? `${name} moved up`
      : action === "down"
        ? `${name} moved down`
        : action === "pin"
          ? `${name} ${wasOn ? "unpinned" : "pinned to the top"}`
          : `${name} ${wasOn ? "shown" : "hidden"}`
  );

  refocus = { id, action };
  await setSettings({ bucketPrefs: next });
}

function renderTopChats(messageLog) {
  const ranked = rankConversations(messageLog, { limit: 5 });
  topChats.hidden = ranked.length === 0;

  topChatsList.replaceChildren(
    ...ranked.map((chat) => {
      const link = document.createElement("a");
      link.href = `https://claude.ai/chat/${chat.conversationId}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = chat.title ?? "Untitled chat";
      link.title = `Last message ${timeAgo(chat.lastAt)}`;

      const cost = document.createElement("span");
      cost.className = "chat-cost";
      cost.textContent = `${chat.approx ? "~" : ""}${chat.session}% · ${chat.messages} msg${chat.messages === 1 ? "" : "s"}`;

      const item = document.createElement("li");
      item.append(link, cost);
      return item;
    })
  );
}

function renderLimitHits(limitHits) {
  const { last7Days, last } = summarizeLimitHits(limitHits);
  limitHitsEl.hidden = last7Days === 0;
  if (last7Days === 0) return;

  const which = claimLabel(last.claim);
  limitHitsEl.textContent =
    `Limit reached ${last7Days}× in the last 7 days · last ${timeAgo(last.lastAt)}` + (which ? ` (${which})` : "");
  limitHitsEl.title =
    last.attempts > 1
      ? `${last.attempts} messages were sent into that lockout.`
      : last.attempts === 0
        ? "Seen at 100% when usage was refreshed; no message was refused in this browser."
        : "Detected from claude.ai's response.";
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function renderHistory({ history, usageLog, settings }) {
  historySection.hidden = VIEW !== "panel";
  if (historySection.hidden) return;

  const week = settings.chartRange === "week";
  const chart = week ? weekSeries(usageLog) : chartSeries(history);
  const drawable = chart.series.filter((s) => s.points.length >= 2);
  const box = { from: chart.from, to: chart.to, width: CHART_WIDTH, height: CHART_HEIGHT };
  // The same stretch one week earlier, moved forward onto this axis.
  const earlier = settings.chartCompare ? logSeries(usageLog, { ...box, shiftMs: WEEK_WINDOW_MS }) : null;
  const earlierOf = (series) => earlier?.series.find((s) => s.id === series.id && s.points.length >= 2);

  for (const button of historyRangeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.range === (week ? "week" : "day")));
  }
  historyCompare.checked = settings.chartCompare;

  historyEmpty.hidden = drawable.length > 0;
  historyBody.hidden = drawable.length === 0;
  historyRange.textContent = drawable.length > 0 ? `last ${formatDuration(chart.from, chart.to)}` : "";
  historyFrom.textContent = timeAgo(chart.from);
  historyChart.setAttribute("aria-label", describeChart({ series: drawable }, earlier));

  historyChart.replaceChildren(
    // Gridlines at 0 / 50 / 100%.
    ...[0, 0.5, 1].map((f) =>
      svgEl("line", { class: "grid", x1: 0, x2: CHART_WIDTH, y1: f * CHART_HEIGHT, y2: f * CHART_HEIGHT })
    ),
    // Last week's lines go underneath this week's.
    ...drawable.flatMap((series, index) => {
      const before = earlierOf(series);
      const d = before && linePath(before.points, { ...box, gapMs: LOG_GAP_MS });
      return before ? [svgEl("path", { class: `series compare series-${index % 5}`, d })] : [];
    }),
    ...drawable.map((series, index) =>
      svgEl("path", {
        class: `series series-${index % 5}`,
        d: linePath(series.points, { ...box, gapMs: week ? LOG_GAP_MS : Infinity }),
      })
    )
  );

  historyLegend.replaceChildren(
    ...drawable.map((series, index) => {
      const swatch = document.createElement("span");
      swatch.className = `swatch series-${index % 5}`;
      const before = earlierOf(series)?.points.at(-1);
      const item = document.createElement("li");
      item.append(swatch, `${series.label} · ${series.points.at(-1).pct}%` + (before ? ` (was ${before.pct}%)` : ""));
      return item;
    })
  );

  const compared = drawable.some(earlierOf);
  historyCompareNote.hidden = !settings.chartCompare;
  historyCompareNote.textContent = compared
    ? "Dashed: the same stretch a week earlier. \"Was\" is where each limit stood at this point last week."
    : "Nothing on record from a week earlier yet.";
}

function render(state) {
  latestState = state;
  const { latestSnapshot, settings, lastError, messageLog, limitHits, history, snoozeUntil } = state;

  applyTheme(settings);
  applySeverityColors(settings);

  demoBadge.hidden = !(settings.demoMode && settings.demoLabel);
  document.documentElement.dataset.privacy = settings.privacyMode ? "on" : "off";
  privacyBtn.setAttribute("aria-pressed", String(settings.privacyMode));
  privacyBtn.classList.toggle("active", settings.privacyMode);

  const hasData = Boolean(latestSnapshot);
  emptyState.hidden = hasData;
  loadingState.hidden = true;
  dataState.hidden = !hasData;

  if (!hasData) {
    lastUpdatedEl.textContent = "";
    return;
  }

  if (latestSnapshot.planTier) {
    planBadge.hidden = false;
    planBadge.textContent = latestSnapshot.planTier;
  } else {
    planBadge.hidden = true;
  }

  snoozeBanner.hidden = !isSnoozed(snoozeUntil);
  snoozeText.textContent = `Alerts snoozed until ${formatClock(snoozeUntil)}`;

  renderBuckets(latestSnapshot, settings, settings.messageCost ? messageLog : []);
  renderTopChats(settings.messageCost ? messageLog : []);
  renderLimitHits(limitHits);
  renderHistory(state);
  insights.hidden = VIEW !== "panel";
  if (!insights.hidden) renderInsights(state);

  lastUpdatedEl.textContent = `Last updated: ${timeAgo(latestSnapshot.fetchedAt)}`;

  if (VIEW === "mini") {
    // The window title is what shows in the task switcher, so put the number there.
    const pct = settings.privacyMode ? null : latestSnapshot.session?.percentUsed;
    document.title = pct != null ? `${pct}% · ClaudeMeter` : "ClaudeMeter";
    fitMiniWindow();
  }

  const errorIsNewer = lastError && lastError.timestamp > latestSnapshot.fetchedAt;
  if (errorIsNewer) {
    errorBanner.hidden = false;
    errorBanner.textContent = `Couldn't refresh — showing data from ${timeAgo(latestSnapshot.fetchedAt)}`;
  } else {
    errorBanner.hidden = true;
  }
}

let miniFitted = PARAMS.get("fit") !== "1"; // only a first-ever mini window sizes itself

/** Shrink or grow the mini window to its content, once, so it opens without dead space or a scrollbar. */
async function fitMiniWindow() {
  if (miniFitted) return;
  miniFitted = true;
  const frame = window.outerHeight - window.innerHeight;
  const height = Math.ceil(document.body.getBoundingClientRect().height) + frame;
  try {
    const win = await chrome.windows.getCurrent();
    if (Math.abs(win.height - height) > 4) await chrome.windows.update(win.id, { height });
  } catch (err) {
    // Chrome refuses sizes that would push the window off-screen; the default size is fine then.
    console.warn("[ClaudeMeter] could not fit the mini window", err);
  }
}

async function loadAndRender() {
  const state = await getAll();
  render(state);
  return state;
}

async function refresh({ silent } = {}) {
  if (!silent) {
    refreshBtn.classList.add("spinning");
    refreshBtn.setAttribute("aria-busy", "true");
  } else if (!latestState?.latestSnapshot) {
    loadingState.hidden = false;
    emptyState.hidden = true;
    dataState.hidden = true;
    mainEl.setAttribute("aria-busy", "true");
  }

  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ type: "CLAUDEMETER_REFRESH" });
  } catch (err) {
    console.warn("[ClaudeMeter] refresh message failed", err);
  }

  const state = await loadAndRender();
  refreshBtn.classList.remove("spinning");
  refreshBtn.removeAttribute("aria-busy");
  mainEl.removeAttribute("aria-busy");

  // Only a refresh the user asked for gets announced; the quiet one on open would just be noise.
  if (!silent) {
    const pct = state.latestSnapshot?.session?.percentUsed;
    announce(
      result?.ok
        ? `Usage updated.${pct != null ? ` Session ${pct}% used.` : ""}`
        : "Couldn't refresh usage. Showing the last reading."
    );
  }
}

refreshBtn.addEventListener("click", () => refresh({ silent: false }));

document.getElementById("openClaudeBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://claude.ai" });
});

function setArranging(on) {
  arranging = on;
  if (latestState) render(latestState);
  announce(on ? "Arranging limits. Each limit now has move, pin and hide buttons." : "Done arranging.");
}

arrangeBtn.addEventListener("click", () => setArranging(!arranging));
document.getElementById("showHiddenBtn").addEventListener("click", () => {
  setArranging(true);
  arrangeBtn.focus();
});
dataState.addEventListener("click", onBucketTool);

// ------------------------------------------------------------------ share --

function setShareMenuOpen(open) {
  shareMenu.hidden = !open;
  shareBtn.setAttribute("aria-expanded", String(open));
  shareBtn.classList.toggle("active", open);
  if (open) {
    shareStatus.textContent = "";
    shareMenu.querySelector("button").focus();
  }
}

/** Draws the card in the popup's current colours and returns it as a PNG blob. */
function renderShareImage() {
  const { latestSnapshot, settings } = latestState;
  const rows = shareRows(latestSnapshot, settings.bucketPrefs);
  const styles = getComputedStyle(document.documentElement);
  const token = (name) => styles.getPropertyValue(name).trim();
  const fills = { ok: token("--ok-fill") || token("--accent"), warn: token("--warn"), danger: token("--danger") };

  const scale = 2;
  const { width, height } = shareCardSize(rows.length);
  // OffscreenCanvas, not a <canvas>: HTMLCanvasElement.toBlob() waits for an idle
  // period and can take over a second when the window isn't being painted.
  const canvas = new OffscreenCanvas(width * scale, height * scale);
  drawShareCard(canvas.getContext("2d"), {
    rows,
    scale,
    palette: {
      bg: token("--bg"),
      border: token("--border"),
      text: token("--text"),
      muted: token("--muted"),
      track: token("--track"),
    },
    fillFor: (pct) => fills[severityOf(pct, settings)],
  });
  return canvas.convertToBlob({ type: "image/png" });
}

async function share(kind) {
  const { latestSnapshot, settings } = latestState;
  if (kind === "text") {
    await navigator.clipboard.writeText(buildShareText(latestSnapshot, { bucketPrefs: settings.bucketPrefs }));
    return "Summary copied as text.";
  }

  const image = await renderShareImage();
  if (kind === "image") {
    await navigator.clipboard.write([new ClipboardItem({ [image.type]: image })]);
    return "Summary copied as an image.";
  }

  const link = document.createElement("a");
  link.href = URL.createObjectURL(image);
  link.download = `claudemeter-usage-${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  return "Image saved to your downloads.";
}

shareBtn.addEventListener("click", () => setShareMenuOpen(shareMenu.hidden));

shareMenu.addEventListener("click", async (event) => {
  const kind = event.target.closest("[data-share]")?.dataset.share;
  if (!kind || !latestState?.latestSnapshot) return;

  let message;
  try {
    message = await share(kind);
  } catch (err) {
    console.warn("[ClaudeMeter] share failed", err);
    // The clipboard can refuse (no focus, blocked by policy); saving the file always works.
    message = "Couldn't copy. Try Save image instead.";
  }
  shareStatus.textContent = message;
  announce(message);
});

// Click elsewhere, or Escape, puts the menu away and hands focus back to its button.
document.addEventListener("pointerdown", (event) => {
  if (!shareMenu.hidden && !event.target.closest(".share")) setShareMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !shareMenu.hidden) {
    event.preventDefault();
    setShareMenuOpen(false);
    shareBtn.focus();
  }
});

privacyBtn.addEventListener("click", async () => {
  const { privacyMode } = await setSettings({ privacyMode: !latestState?.settings.privacyMode });
  announce(privacyMode ? "Privacy mode on. Numbers are hidden on screen." : "Privacy mode off.");
});

document.getElementById("resumeBtn").addEventListener("click", async () => {
  await setSnoozeUntil(0);
  announce("Alerts resumed.");
});

document.getElementById("miniBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLAUDEMETER_OPEN_MINI" });
  // The toolbar popup would only sit on top of the window it just opened.
  if (VIEW === "popup") window.close();
});

document.getElementById("settingsLink").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// sidePanel.open() has to run inside the click itself — any await before it
// drops the user gesture — so look the window id up ahead of time.
let hostWindowId = null;
if (VIEW === "popup" && chrome.sidePanel?.open) {
  sidePanelBtn.hidden = false;
  chrome.windows.getCurrent().then((win) => (hostWindowId = win.id));
}

sidePanelBtn.addEventListener("click", () => {
  if (hostWindowId == null) return;
  chrome.sidePanel
    .open({ windowId: hostWindowId })
    .then(() => window.close())
    .catch((err) => console.warn("[ClaudeMeter] could not open the side panel", err));
});

// Teach the shortcut where the button is: "Refresh now (Alt+Shift+R)".
chrome.commands?.getAll().then((commands) => {
  const shortcut = commands.find((command) => command.name === "refresh-usage")?.shortcut;
  if (shortcut) refreshBtn.title = `Refresh now (${shortcut})`;
});

for (const button of historyRangeButtons) {
  button.addEventListener("click", () => setSettings({ chartRange: button.dataset.range }));
}
historyCompare.addEventListener("change", () => setSettings({ chartCompare: historyCompare.checked }));

// "…/popup.html?view=panel#history" (e.g. opened in a tab) lands on the chart.
if (location.hash === "#history") {
  requestAnimationFrame(() => historySection.scrollIntoView());
}

onStorageChanged((changes) => {
  const watched = ["latestSnapshot", "settings", "lastError", "messageLog", "limitHits", "snoozeUntil", "demoState"];
  if (watched.some((key) => key in changes)) {
    loadAndRender();
  }
});

onSystemThemeChange(() => {
  if (latestState) applyTheme(latestState.settings);
});

// Keep "Last updated: X ago" fresh without a full re-fetch.
setInterval(() => {
  if (latestState?.latestSnapshot) render(latestState);
}, 30_000);

loadAndRender().then(() => {
  // Quietly refresh in the background every time the popup opens, so
  // numbers stay current without the user clicking anything.
  refresh({ silent: true });
});
