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

const LOG_PREFIX = "[ClaudeMeter]";
const ALARM_NAME = "claudemeter-refresh-check";
const USAGE_ENDPOINT_PATTERN = /\/api\/organizations\/[^/]+\/usage(?:[/?]|$)/;
// A "before" reading this fresh is reused rather than re-fetched when a message is sent.
const BEFORE_MAX_AGE_MS = 20_000;
// The usage endpoint lags the end of a reply slightly; wait before the "after" reading.
const AFTER_SETTLE_MS = 1500;

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
  await updateBadge(snapshot);
  await updateModelHint();
}

// ------------------------------------------------------------- model hint --

async function updateModelHint() {
  const { history, settings } = await getAll();
  const hint =
    settings.modelHintPercent > 0 ? modelSwitchHint(history, { minPercent: settings.modelHintPercent }) : null;
  await setModelHint(hint);
}

// ------------------------------------------------------------------ badge --

async function updateBadge(snapshot) {
  const pct = snapshot?.session?.percentUsed;
  if (pct == null) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  chrome.action.setBadgeText({ text: `${pct}%` });
  chrome.action.setBadgeBackgroundColor({ color: pct >= 95 ? "#e5484d" : pct >= 80 ? "#e5a02e" : "#3fb950" });
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

// ------------------------------------------------------------------- alarm --

async function ensureAlarm() {
  const settings = await getSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshIntervalMinutes });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log(LOG_PREFIX, "extension installed");
  ensureAlarm();
  applyActionSurface();
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
  }
});
