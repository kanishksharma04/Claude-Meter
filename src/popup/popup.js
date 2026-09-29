import { getAll, onStorageChanged } from "../lib/storage.js";
import { timeAgo, formatDuration } from "../lib/time-format.js";
import { formatCost } from "../lib/message-cost.js";
import { rankConversations } from "../lib/conversation-costs.js";
import { summarizeLimitHits, claimLabel } from "../lib/limit-hits.js";
import { chartSeries, linePath, describeChart } from "../lib/history-chart.js";
import { severityOf, isHexColor } from "../lib/severity.js";

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
const sessionLabel = document.getElementById("sessionLabel");
const sessionPct = document.getElementById("sessionPct");
const sessionFill = document.getElementById("sessionFill");
const sessionResets = document.getElementById("sessionResets");
const lastMessageEl = document.getElementById("lastMessage");
const topChats = document.getElementById("topChats");
const topChatsList = document.getElementById("topChatsList");
const limitHitsEl = document.getElementById("limitHits");
const weeklyList = document.getElementById("weeklyList");
const weeklyRowTemplate = document.getElementById("weeklyRowTemplate");
const sidePanelBtn = document.getElementById("sidePanelBtn");
const historySection = document.getElementById("history");
const historyBody = document.getElementById("historyBody");
const historyChart = document.getElementById("historyChart");
const historyLegend = document.getElementById("historyLegend");
const historyRange = document.getElementById("historyRange");
const historyFrom = document.getElementById("historyFrom");
const historyEmpty = document.getElementById("historyEmpty");

let latestState = null;

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

function renderBucketRow({ labelEl, pctEl, fillEl, subEl }, bucket) {
  labelEl.textContent = bucket.label;
  pctEl.textContent = `${bucket.percentUsed}% used`;
  fillEl.style.width = `${bucket.percentUsed}%`;
  fillEl.className = `progress-fill ${severityClass(bucket.percentUsed)}`.trim();

  const liveLabel = bucket.resetsAt != null ? formatDuration(Date.now(), bucket.resetsAt) : null;
  subEl.textContent = liveLabel ? `Resets in ${liveLabel}` : `Resets in ${bucket.resetsInLabel}`;
}

function renderLastMessage(messageLog) {
  const last = messageLog.findLast((m) => m.session != null);
  lastMessageEl.hidden = !last;
  if (!last) return;
  const approx = last.shared ? "about " : "";
  lastMessageEl.textContent = `Last message: ${approx}${formatCost(last.session)} of session · ${timeAgo(last.at)}`;
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

  if (latestSnapshot.session) {
    renderBucketRow(
      { labelEl: sessionLabel, pctEl: sessionPct, fillEl: sessionFill, subEl: sessionResets },
      latestSnapshot.session
    );
  } else {
    sessionPct.textContent = "not available";
    sessionFill.style.width = "0%";
    sessionResets.textContent = "";
  }
  renderLastMessage(settings.messageCost ? messageLog : []);
  renderTopChats(settings.messageCost ? messageLog : []);
  renderLimitHits(limitHits);
  renderHistory(history);

  weeklyList.innerHTML = "";
  if (latestSnapshot.weekly.length === 0) {
    const p = document.createElement("p");
    p.className = "usage-sub";
    p.textContent = "No weekly limit data available.";
    weeklyList.appendChild(p);
  } else {
    for (const bucket of latestSnapshot.weekly) {
      const node = weeklyRowTemplate.content.cloneNode(true);
      renderBucketRow(
        {
          labelEl: node.querySelector(".usage-label"),
          pctEl: node.querySelector(".usage-pct"),
          fillEl: node.querySelector(".progress-fill"),
          subEl: node.querySelector(".usage-sub"),
        },
        bucket
      );
      weeklyList.appendChild(node);
    }
  }

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
