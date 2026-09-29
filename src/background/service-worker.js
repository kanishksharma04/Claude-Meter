import {
  getAll,
  getSettings,
  getOrgCache,
  setLatestSnapshot,
  setLastError,
  pushDebugCapture,
  setPendingMessage,
  takePendingMessage,
  pushMessageCost,
  setModelHint,
  pushLimitHit,
} from "../lib/storage.js";
import { fetchUsageSnapshot, UsageApiError } from "../lib/usage-api.js";
import { normalizeUsageResponse } from "../lib/normalize-usage.js";
import { computeMessageCost } from "../lib/message-cost.js";
import { modelSwitchHint } from "../lib/burn-rate.js";
import { resolveResetsAt } from "../lib/limit-hits.js";
import { gaugeImageData } from "../lib/gauge-icon.js";
import { severityColor } from "../lib/severity.js";
import { buildSuggestions, resolveCommand } from "../lib/omnibox.js";
import { formatDuration } from "../lib/time-format.js";

const LOG_PREFIX = "[ClaudeMeter]";
const ALARM_NAME = "claudemeter-refresh-check";
const USAGE_ENDPOINT_PATTERN = /\/api\/organizations\/[^/]+\/usage(?:[/?]|$)/;
// A "before" reading this fresh is reused rather than re-fetched when a message is sent.
const BEFORE_MAX_AGE_MS = 20_000;
// The usage endpoint lags the end of a reply slightly; wait before the "after" reading.
const AFTER_SETTLE_MS = 1500;
const DEFAULT_ICON = {
  16: "/src/icons/icon16.png",
  32: "/src/icons/icon32.png",
  48: "/src/icons/icon48.png",
  128: "/src/icons/icon128.png",
};

// ---------------------------------------------------------------- messages --

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CLAUDEMETER_CAPTURE") {
    handlePassiveCapture(message.capture, sender);
    return false;
  }

  if (message?.type === "CLAUDEMETER_CHAT_EVENT") {
    handleChatEvent(message.event);
    return false;
  }

  if (message?.type === "CLAUDEMETER_OPEN_MINI") {
    openMiniWindow();
    return false;
  }

  if (message?.type === "CLAUDEMETER_REFRESH") {
    refreshUsage().then(sendResponse);
    return true; // keep the message channel open for the async response
  }

  return false;
});

async function handlePassiveCapture(capture, sender) {
  try {
    const settings = await getSettings();

    if (settings.developerMode) {
      await pushDebugCapture({
        ...capture,
        tabId: sender?.tab?.id ?? null,
        pageUrl: sender?.tab?.url ?? sender?.url ?? null,
      });
    }

    // Zero-cost passive update: if the page itself just made this exact
    // request (e.g. user opened claude.ai's own usage panel), reuse that
    // response instead of waiting for the next active refresh.
    if (
      USAGE_ENDPOINT_PATTERN.test(capture.url) &&
      capture.responseBody &&
      typeof capture.responseBody === "object"
    ) {
      const orgCache = await getOrgCache();
      const snapshot = normalizeUsageResponse(capture.responseBody, { orgMeta: orgCache?.raw });
      if (snapshot) {
        await applySnapshot(snapshot);
        console.log(LOG_PREFIX, "updated snapshot from passive capture");
      }
    }
  } catch (err) {
    console.error(LOG_PREFIX, "failed to handle passive capture", err);
  }
}

// ------------------------------------------------------------ message cost --

// In-flight "before" readings, so a reply that ends before its start handler
// has finished still finds its baseline. Lost if the worker is recycled — the
// stored pendingMessages entry covers that case.
const startsInFlight = new Map();

async function handleChatEvent(event) {
  try {
    if (event?.kind === "limit_hit") return await recordLimitHit(event);

    const settings = await getSettings();
    if (!settings.messageCost || !event?.requestId) return;

    if (event.kind === "completion_start") {
      const started = recordMessageStart(event);
      startsInFlight.set(event.requestId, started);
      await started;
      startsInFlight.delete(event.requestId);
    } else if (event.kind === "completion_end") {
      await startsInFlight.get(event.requestId);
      await recordMessageEnd(event);
    }
  } catch (err) {
    console.error(LOG_PREFIX, "failed to handle chat event", err);
  }
}

async function recordMessageStart(event) {
  let { latestSnapshot: before } = await getAll();
  if (!before || Date.now() - before.fetchedAt > BEFORE_MAX_AGE_MS) {
    const result = await refreshUsage();
    if (result.ok) before = result.snapshot;
  }
  if (!before) return;

  await setPendingMessage(event.requestId, {
    startedAt: event.timestamp ?? Date.now(),
    conversationId: event.conversationId ?? null,
    model: event.model ?? null,
    before,
  });
}

async function recordMessageEnd(event) {
  const { pending, othersInFlight } = await takePendingMessage(event.requestId);
  // A request that never produced a reply (HTTP error, network failure) cost nothing.
  if (!pending || !event.ok) return;

  await new Promise((resolve) => setTimeout(resolve, AFTER_SETTLE_MS));
  const result = await refreshUsage();
  if (!result.ok) return;

  const cost = computeMessageCost(pending.before, result.snapshot);
  await pushMessageCost({
    id: event.requestId,
    at: Date.now(),
    conversationId: pending.conversationId,
    title: event.title ?? null,
    model: pending.model,
    session: cost.session,
    weekly: cost.weekly,
    durationMs: event.durationMs ?? null,
    // Another reply was streaming at the same time, so the delta is split between them.
    shared: othersInFlight,
  });
}

// -------------------------------------------------------------- limit hits --

async function recordLimitHit(event) {
  // Refresh first: a hit usually means the numbers we hold are behind, and the
  // fresh reading can supply a reset time the response didn't carry.
  const result = await refreshUsage();
  const snapshot = result.ok ? result.snapshot : (await getAll()).latestSnapshot;

  const hit = {
    at: event.timestamp ?? Date.now(),
    source: event.source ?? "rejected", // "rejected" = message refused, "reply" = last reply before the lockout
    claim: event.claim ?? null,
    resetsAt: event.resetsAt ?? null,
    conversationId: event.conversationId ?? null,
    model: event.model ?? null,
  };
  hit.resetsAt = resolveResetsAt(hit, snapshot);

  await pushLimitHit(hit);
  console.log(LOG_PREFIX, "logged limit hit", hit.claim ?? "(unnamed limit)");
}

// ------------------------------------------------------------------ fetch --

async function refreshUsage() {
  try {
    const { latestSnapshot: previous } = await getAll();
    const snapshot = await fetchUsageSnapshot();
    await applySnapshot(snapshot);
    await maybeNotify(previous, snapshot);
    console.log(LOG_PREFIX, "refreshed usage snapshot");
    return { ok: true, snapshot };
  } catch (err) {
    const code = err instanceof UsageApiError ? err.code : "UNKNOWN_ERROR";
    const message = err?.message ?? String(err);
    await setLastError({ code, message, timestamp: Date.now() });
    console.warn(LOG_PREFIX, "refresh failed:", code, message);
    return { ok: false, error: { code, message } };
  }
}

/** Everything that has to happen whenever a new reading lands, whichever way it arrived. */
async function applySnapshot(snapshot) {
  await setLatestSnapshot(snapshot);
  await updateToolbar(snapshot);
  await updateModelHint();
}

// ------------------------------------------------------------- model hint --

async function updateModelHint() {
  const { history, settings } = await getAll();
  const hint =
    settings.modelHintPercent > 0 ? modelSwitchHint(history, { minPercent: settings.modelHintPercent }) : null;
  await setModelHint(hint);
}

// ---------------------------------------------------------------- toolbar --

/** Hover text for the toolbar icon — the exact numbers the gauge can only hint at. */
function toolbarTitle(snapshot) {
  const parts = [];
  if (snapshot?.session) {
    const resetsIn = formatDuration(Date.now(), snapshot.session.resetsAt);
    parts.push(`Session ${snapshot.session.percentUsed}%` + (resetsIn ? ` (resets in ${resetsIn})` : ""));
  }
  for (const bucket of snapshot?.weekly ?? []) parts.push(`${bucket.label} ${bucket.percentUsed}%`);
  return parts.length > 0 ? `ClaudeMeter — ${parts.join(" · ")}` : "ClaudeMeter";
}

/** Paints the toolbar icon for the session %: a drawn gauge, badge text, both, or neither. */
async function updateToolbar(snapshot) {
  const settings = await getSettings();
  const { iconStyle } = settings;
  const pct = snapshot?.session?.percentUsed ?? null;
  const showGauge = pct != null && (iconStyle === "gauge" || iconStyle === "both");
  const showBadge = pct != null && (iconStyle === "badge" || iconStyle === "both");

  await chrome.action.setBadgeText({ text: showBadge ? `${pct}%` : "" });
  if (showBadge) await chrome.action.setBadgeBackgroundColor({ color: severityColor(pct, settings) });

  if (showGauge) {
    await chrome.action.setIcon({ imageData: gaugeImageData(pct, severityColor(pct, settings)) });
  } else {
    await chrome.action.setIcon({ path: DEFAULT_ICON });
  }
  await chrome.action.setTitle({ title: toolbarTitle(snapshot) });
}

// ------------------------------------------------------------ notifications --

function bucketsOf(snapshot) {
  if (!snapshot) return [];
  const buckets = [...(snapshot.weekly ?? [])];
  if (snapshot.session) buckets.push({ ...snapshot.session, label: snapshot.session.label ?? "Current session" });
  return buckets;
}

async function maybeNotify(previousSnapshot, snapshot) {
  const settings = await getSettings();
  // Skip the very first successful fetch — there's no prior reading to
  // compare against, so "crossing" a threshold isn't meaningful yet.
  if (!settings.notificationsEnabled || !previousSnapshot) return;

  const thresholds = [...settings.notifyThresholds].sort((a, b) => a - b);
  const previousByLabel = new Map(bucketsOf(previousSnapshot).map((b) => [b.label, b.percentUsed]));

  for (const bucket of bucketsOf(snapshot)) {
    const before = previousByLabel.get(bucket.label) ?? 0;
    const crossed = thresholds.find((t) => before < t && bucket.percentUsed >= t);
    if (crossed == null) continue;

    chrome.notifications.create(`claudemeter-${bucket.label}-${crossed}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("src/icons/icon128.png"),
      title: "ClaudeMeter",
      message: `${bucket.label} usage just crossed ${crossed}% (now ${bucket.percentUsed}%).`,
      priority: 1,
    });
  }
}

// ------------------------------------------------------------ action surface --

/** Point the toolbar icon at the popup or the side panel, per the user's setting. */
async function applyActionSurface() {
  const settings = await getSettings();
  const usePanel = settings.actionOpens === "sidePanel" && Boolean(chrome.sidePanel?.setPanelBehavior);

  // Both are needed: a registered popup would otherwise still win the click.
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: usePanel });
  await chrome.action.setPopup({ popup: usePanel ? "" : chrome.runtime.getURL("src/popup/popup.html") });
}

// ----------------------------------------------------------------- omnibox --
// "cm" + space in the address bar: the dropdown shows usage, Enter runs a command.

const DASHBOARD_URL = chrome.runtime.getURL("src/popup/popup.html?view=panel");

function openUrl(url, disposition = "newForegroundTab") {
  if (disposition === "currentTab") return chrome.tabs.update({ url });
  return chrome.tabs.create({ url, active: disposition !== "newBackgroundTab" });
}

chrome.omnibox.onInputStarted.addListener(() => {
  // The numbers in the dropdown should be current by the time the user has typed the space.
  refreshUsage();
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const { latestSnapshot } = await getAll();
  const { defaultDescription, suggestions } = buildSuggestions(text, latestSnapshot);
  chrome.omnibox.setDefaultSuggestion({ description: defaultDescription });
  suggest(suggestions);
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const { latestSnapshot } = await getAll();
  const command = resolveCommand(text, Boolean(latestSnapshot));

  if (command === "refresh") await refreshUsage();
  else if (command === "options") await chrome.runtime.openOptionsPage();
  else if (command === "claude") await openUrl("https://claude.ai/", disposition);
  else await openUrl(DASHBOARD_URL, disposition);
});

// ------------------------------------------------------------- mini window --

// A small detached window that stays open while you work. The open window's
// id lives in storage.session (ids mean nothing after a browser restart); the
// place and size the user last gave it live in storage.local.
const MINI_URL = chrome.runtime.getURL("src/popup/popup.html?view=mini");
const MINI_DEFAULT_SIZE = { width: 320, height: 200 };

async function openMiniWindow() {
  const { miniWindowId } = await chrome.storage.session.get("miniWindowId");
  if (miniWindowId != null) {
    try {
      await chrome.windows.update(miniWindowId, { focused: true });
      return;
    } catch {
      // It was closed without us hearing about it — fall through and open a new one.
    }
  }

  const { miniWindowBounds: bounds } = await chrome.storage.local.get("miniWindowBounds");
  // Until the user has sized it themselves, let the page fit the window to its content.
  const options = { url: bounds ? MINI_URL : `${MINI_URL}&fit=1`, type: "popup", focused: true };
  let created;
  try {
    created = await chrome.windows.create({ ...options, ...MINI_DEFAULT_SIZE, ...bounds });
  } catch {
    // Remembered position is off-screen now (monitor unplugged): keep the size, let Chrome place it.
    created = await chrome.windows.create({ ...options, width: bounds?.width, height: bounds?.height });
  }
  await chrome.storage.session.set({ miniWindowId: created.id });
}

chrome.windows.onBoundsChanged.addListener(async (win) => {
  const { miniWindowId } = await chrome.storage.session.get("miniWindowId");
  if (win.id !== miniWindowId) return;
  const { left, top, width, height } = win;
  await chrome.storage.local.set({ miniWindowBounds: { left, top, width, height } });
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { miniWindowId } = await chrome.storage.session.get("miniWindowId");
  if (windowId === miniWindowId) await chrome.storage.session.remove("miniWindowId");
});

// ------------------------------------------------------------------- alarm --

async function ensureAlarm() {
  const settings = await getSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshIntervalMinutes });
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log(LOG_PREFIX, "extension installed");
  ensureAlarm();
  applyActionSurface();
  // A brand-new install gets the welcome page; updates and reloads don't.
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/onboarding/onboarding.html") });
  }
  refreshUsage(); // best-effort initial fetch; silently no-ops if not logged in
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  applyActionSurface(); // action.setPopup() doesn't survive a browser restart
  refreshUsage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  refreshUsage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.settings) {
    const before = changes.settings.oldValue?.refreshIntervalMinutes;
    const after = changes.settings.newValue?.refreshIntervalMinutes;
    if (before !== after) ensureAlarm();

    if (changes.settings.oldValue?.modelHintPercent !== changes.settings.newValue?.modelHintPercent) {
      updateModelHint();
    }
    if (changes.settings.oldValue?.actionOpens !== changes.settings.newValue?.actionOpens) {
      applyActionSurface();
    }
    const toolbarKeys = ["iconStyle", "warnAt", "dangerAt", "severityColors"];
    const pick = (settings) => JSON.stringify(toolbarKeys.map((key) => settings?.[key]));
    if (pick(changes.settings.oldValue) !== pick(changes.settings.newValue)) {
      getAll().then(({ latestSnapshot }) => updateToolbar(latestSnapshot));
    }
  }
});
