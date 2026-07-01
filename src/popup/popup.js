import { getAll, onStorageChanged } from "../lib/storage.js";
import { timeAgo, formatDuration } from "../lib/time-format.js";

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
const weeklyList = document.getElementById("weeklyList");
const weeklyRowTemplate = document.getElementById("weeklyRowTemplate");

let latestState = null;

function severityClass(pct) {
  if (pct >= 95) return "danger";
  if (pct >= 80) return "warn";
  return "";
}

function renderBucketRow({ labelEl, pctEl, fillEl, subEl }, bucket) {
  labelEl.textContent = bucket.label;
  pctEl.textContent = `${bucket.percentUsed}% used`;
  fillEl.style.width = `${bucket.percentUsed}%`;
  fillEl.className = `progress-fill ${severityClass(bucket.percentUsed)}`.trim();

  const liveLabel = bucket.resetsAt != null ? formatDuration(Date.now(), bucket.resetsAt) : null;
  subEl.textContent = liveLabel ? `Resets in ${liveLabel}` : `Resets in ${bucket.resetsInLabel}`;
}

function render(state) {
  latestState = state;
  const { latestSnapshot, settings, lastError } = state;

  applyTheme(settings.theme);

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

document.getElementById("settingsLink").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

onStorageChanged((changes) => {
  if (changes.latestSnapshot || changes.settings || changes.lastError) {
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
