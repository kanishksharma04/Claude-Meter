import {
  getAll,
  getSettings,
  getOrgCache,
  setLatestSnapshot,
  setLastError,
  pushDebugCapture,
} from "../lib/storage.js";
import { fetchUsageSnapshot, UsageApiError } from "../lib/usage-api.js";
import { normalizeUsageResponse } from "../lib/normalize-usage.js";

const LOG_PREFIX = "[ClaudeMeter]";
const ALARM_NAME = "claudemeter-refresh-check";
const USAGE_ENDPOINT_PATTERN = /\/api\/organizations\/[^/]+\/usage(?:[/?]|$)/;

// ---------------------------------------------------------------- messages --

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CLAUDEMETER_CAPTURE") {
    handlePassiveCapture(message.capture, sender);
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
        await setLatestSnapshot(snapshot);
        await updateBadge(snapshot);
        console.log(LOG_PREFIX, "updated snapshot from passive capture");
      }
    }
  } catch (err) {
    console.error(LOG_PREFIX, "failed to handle passive capture", err);
  }
}

// ------------------------------------------------------------------ fetch --

async function refreshUsage() {
  try {
    const { latestSnapshot: previous } = await getAll();
    const snapshot = await fetchUsageSnapshot();
    await setLatestSnapshot(snapshot);
    await updateBadge(snapshot);
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

// ------------------------------------------------------------------- alarm --

async function ensureAlarm() {
  const settings = await getSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshIntervalMinutes });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log(LOG_PREFIX, "extension installed");
  ensureAlarm();
  refreshUsage(); // best-effort initial fetch; silently no-ops if not logged in
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
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
  }
});
