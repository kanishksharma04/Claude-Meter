import { getAll, setSettings, onStorageChanged } from "../lib/storage.js";
import { timeAgo, formatDuration } from "../lib/time-format.js";
import { formatCost } from "../lib/message-cost.js";
import { rankConversations } from "../lib/conversation-costs.js";
import { summarizeLimitHits, claimLabel } from "../lib/limit-hits.js";
import { chartSeries, linePath, describeChart } from "../lib/history-chart.js";
import { severityOf, isHexColor } from "../lib/severity.js";
import { arrangeBuckets, moveBucket, togglePinned, toggleHidden } from "../lib/bucket-prefs.js";

// This page serves more than one surface: the toolbar popup, and — as
// popup.html?view=panel — the side panel (or a full tab), which gets the
// room for the dashboard extras.
const VIEW = new URLSearchParams(location.search).get("view") ?? "popup";
document.documentElement.dataset.view = VIEW;

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_WIDTH = 320;
const CHART_HEIGHT = 120;

const emptyState = document.getElementById("emptyState");
const loadingState = document.getElementById("loadingState");
const dataState = document.getElementById("dataState");
const errorBanner = document.getElementById("errorBanner");
const planBadge = document.getElementById("planBadge");
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

let latestState = null;
let arranging = false; // the popup's "reorder / pin / hide" mode
let refocus = null; // { id, action } — the tool button to put focus back on after a re-render

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
  row.querySelector(".usage-label").textContent = name;
  row.querySelector(".usage-pct").textContent = `${bucket.percentUsed}% used`;

  const fill = row.querySelector(".progress-fill");
  fill.style.width = `${bucket.percentUsed}%`;
  fill.className = `progress-fill ${severityClass(bucket.percentUsed)}`.trim();

  const liveLabel = bucket.resetsAt != null ? formatDuration(Date.now(), bucket.resetsAt) : null;
  row.querySelector(".usage-sub").textContent = `Resets in ${liveLabel ?? bucket.resetsInLabel}`;

  const lastMessage = kind === "session" ? lastMessageText(messageLog) : null;
  if (lastMessage) {
    const line = document.createElement("p");
    line.className = "usage-sub";
    line.id = "lastMessage";
    line.textContent = lastMessage;
    row.querySelector(".bucket-tools").before(line);
  }

  if (arranging) {
    const tools = row.querySelector(".bucket-tools");
    tools.hidden = false;
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

  restGroup.hidden = groups.rest.length === 0 && noWeekly.hidden;
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
    last.attempts > 1 ? `${last.attempts} messages were sent into that lockout.` : "Detected from claude.ai's response.";
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function renderHistory(history) {
  historySection.hidden = VIEW !== "panel";
  if (historySection.hidden) return;

  const chart = chartSeries(history);
  const drawable = chart.series.filter((s) => s.points.length >= 2);
  const box = { from: chart.from, to: chart.to, width: CHART_WIDTH, height: CHART_HEIGHT };

  historyEmpty.hidden = drawable.length > 0;
  historyBody.hidden = drawable.length === 0;
  historyRange.textContent = drawable.length > 0 ? `last ${formatDuration(chart.from, chart.to)}` : "";
  historyFrom.textContent = timeAgo(chart.from);
  historyChart.setAttribute("aria-label", describeChart({ series: drawable }));

  historyChart.replaceChildren(
    // Gridlines at 0 / 50 / 100%.
    ...[0, 0.5, 1].map((f) =>
      svgEl("line", { class: "grid", x1: 0, x2: CHART_WIDTH, y1: f * CHART_HEIGHT, y2: f * CHART_HEIGHT })
    ),
    ...drawable.map((series, index) =>
      svgEl("path", { class: `series series-${index % 5}`, d: linePath(series.points, box) })
    )
  );

  historyLegend.replaceChildren(
    ...drawable.map((series, index) => {
      const swatch = document.createElement("span");
      swatch.className = `swatch series-${index % 5}`;
      const item = document.createElement("li");
      item.append(swatch, `${series.label} · ${series.points.at(-1).pct}%`);
      return item;
    })
  );
}

function render(state) {
  latestState = state;
  const { latestSnapshot, settings, lastError, messageLog, limitHits, history } = state;

  applyTheme(settings.theme);
  applySeverityColors(settings);

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

  renderBuckets(latestSnapshot, settings, settings.messageCost ? messageLog : []);
  renderTopChats(settings.messageCost ? messageLog : []);
  renderLimitHits(limitHits);
  renderHistory(history);

  lastUpdatedEl.textContent = `Last updated: ${timeAgo(latestSnapshot.fetchedAt)}`;

  const errorIsNewer = lastError && lastError.timestamp > latestSnapshot.fetchedAt;
  if (errorIsNewer) {
    errorBanner.hidden = false;
    errorBanner.textContent = `Couldn't refresh — showing data from ${timeAgo(latestSnapshot.fetchedAt)}`;
  } else {
    errorBanner.hidden = true;
  }
}

function applyTheme(theme) {
  const effective = theme === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = effective;
}

async function loadAndRender() {
  const state = await getAll();
  render(state);
  return state;
}

async function refresh({ silent } = {}) {
  if (!silent) {
    refreshBtn.classList.add("spinning");
  } else if (!latestState?.latestSnapshot) {
    loadingState.hidden = false;
    emptyState.hidden = true;
    dataState.hidden = true;
  }

  try {
    await chrome.runtime.sendMessage({ type: "CLAUDEMETER_REFRESH" });
  } catch (err) {
    console.warn("[ClaudeMeter] refresh message failed", err);
  }

  await loadAndRender();
  refreshBtn.classList.remove("spinning");
}

refreshBtn.addEventListener("click", () => refresh({ silent: false }));

document.getElementById("openClaudeBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://claude.ai" });
});

function setArranging(on) {
  arranging = on;
  if (latestState) render(latestState);
}

arrangeBtn.addEventListener("click", () => setArranging(!arranging));
document.getElementById("showHiddenBtn").addEventListener("click", () => {
  setArranging(true);
  arrangeBtn.focus();
});
dataState.addEventListener("click", onBucketTool);

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

// "…/popup.html?view=panel#history" (e.g. opened in a tab) lands on the chart.
if (location.hash === "#history") {
  requestAnimationFrame(() => historySection.scrollIntoView());
}

onStorageChanged((changes) => {
  if (changes.latestSnapshot || changes.settings || changes.lastError || changes.messageLog || changes.limitHits) {
    loadAndRender();
  }
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
