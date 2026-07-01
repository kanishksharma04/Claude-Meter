import { pushDebugCapture, getSettings } from "../lib/storage.js";

const LOG_PREFIX = "[ClaudeMeter:discovery]";
const ALARM_NAME = "claudemeter-refresh-check";

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "CLAUDEMETER_CAPTURE") {
    handleCapture(message.capture, sender);
  }
  // No async sendResponse needed — callers only .catch() send failures.
  return false;
});

async function handleCapture(capture, sender) {
  try {
    const enriched = {
      ...capture,
      tabId: sender?.tab?.id ?? null,
      pageUrl: sender?.tab?.url ?? sender?.url ?? null,
    };
    await pushDebugCapture(enriched);
    console.log(LOG_PREFIX, "stored capture:", enriched.method, enriched.url);
  } catch (err) {
    console.error(LOG_PREFIX, "failed to store capture", err);
  }
}

// --- Alarm skeleton -------------------------------------------------------
// Phase 1 only wires up a periodic alarm on the configured interval; it does
// not act on it yet. Active refresh — asking an open claude.ai tab to
// re-trigger its own usage fetch — is Phase 2 work, once the real endpoint
// and response shape are known and there's a UsageSnapshot to refresh into.

async function ensureAlarm() {
  const settings = await getSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshIntervalMinutes });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log(LOG_PREFIX, "extension installed, discovery mode active");
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  console.log(LOG_PREFIX, "refresh alarm fired (no-op until Phase 2 wires up active refresh)");
});
