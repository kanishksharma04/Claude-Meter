import {
  getAll,
  getSettings,
  setSettings,
  getOrgCache,
  setLatestSnapshot,
  setLastError,
  pushDebugCapture,
  setPendingMessage,
  takePendingMessage,
  pushMessageCost,
  setModelHint,
  pushLimitHit,
  noteFullBuckets,
  recordSpike,
  noteLocalActivity,
  setExtraUsage,
  recordWebhookResults,
  setSnoozeUntil,
  setDemoState,
} from "../lib/storage.js";
import { fetchUsageSnapshot, UsageApiError } from "../lib/usage-api.js";
import { normalizeUsageResponse, normalizeExtraUsage } from "../lib/normalize-usage.js";
import { formatMoney } from "../lib/extra-usage.js";
import { computeMessageCost } from "../lib/message-cost.js";
import { modelSwitchHint } from "../lib/burn-rate.js";
import { resolveResetsAt } from "../lib/limit-hits.js";
import { gaugeImageData } from "../lib/gauge-icon.js";
import { severityColor } from "../lib/severity.js";
import { buildSuggestions, resolveCommand } from "../lib/omnibox.js";
import { buildDemoState } from "../lib/demo-data.js";
import { formatDuration, formatClock } from "../lib/time-format.js";
import { SNOOZE_OPTIONS, DEFAULT_SNOOZE, snoozeEnd, isSnoozed } from "../lib/snooze.js";
import { describeSpike } from "../lib/spikes.js";
import { tokensOf } from "../lib/value.js";
import { crossedThreshold } from "../lib/thresholds.js";
import { paceAlert, describePace } from "../lib/pace.js";
import { resetsToAnnounce, nextResetCheck, describeReset } from "../lib/reset-alert.js";
import { deliverWebhooks } from "../lib/webhooks.js";

const LOG_PREFIX = "[ClaudeMeter]";
const ALARM_NAME = "claudemeter-refresh-check";
const SNOOZE_ALARM_NAME = "claudemeter-snooze-end";
const RESET_ALARM_NAME = "claudemeter-reset-check";
// How long a keyboard shortcut's confirmation stays on the toolbar badge.
const BADGE_FLASH_MS = 1500;
const USAGE_ENDPOINT_PATTERN = /\/api\/organizations\/[^/]+\/usage(?:[/?]|$)/;
// claude.ai's settings page reads the extra-usage spend and cap from here.
const SPEND_LIMIT_ENDPOINT_PATTERN = /\/api\/organizations\/[^/]+\/overage_spend_limit(?:[/?]|$)/;
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

  if (message?.type === "CLAUDEMETER_TEST_WEBHOOK") {
    sendToWebhooks("This is a test alert from ClaudeMeter. Real ones tell you when a limit is close.", [message.service])
      .then(([result]) => sendResponse(result ?? { ok: false, detail: "Unknown service." }));
    return true;
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
      !settings.demoMode &&
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

    // Same idea for extra usage: when the page loads its own spend-limit data, read it over its shoulder.
    if (!settings.demoMode && capture.method === "GET" && SPEND_LIMIT_ENDPOINT_PATTERN.test(capture.url)) {
      const extraUsage = normalizeExtraUsage(capture.responseBody);
      if (extraUsage) await setExtraUsage(extraUsage, capture.timestamp ?? Date.now());
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
let activityWrites = Promise.resolve();

async function handleChatEvent(event) {
  try {
    const settings = await getSettings();
    // Demo mode shows made-up numbers; measuring real messages against them would be nonsense.
    if (settings.demoMode) return;
    if (event?.kind === "limit_hit") return await recordLimitHit(event);

    // Whatever else is switched off, remember that this browser was in use: it is
    // how a rise in usage gets told apart from one that happened on another device.
    if (event?.kind === "completion_start" || event?.kind === "completion_end") {
      // One at a time — a start and an end landing together must not overwrite each other.
      activityWrites = activityWrites.then(() => noteLocalActivity(event)).catch(() => {});
      await activityWrites;
    }

    if (!settings.messageCost) return;
    if (event?.kind === "conversation_loaded") return await setThreadChars(event.conversationId, event.chars ?? 0);
    if (!event?.requestId) return;

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

// How long each open chat's thread is, in characters, so a message's input can
// be sized: every message re-sends the whole thread. Kept in storage.session —
// it is only good for as long as the tabs it describes.
const MAX_TRACKED_THREADS = 50;

async function threadChars(conversationId) {
  const { threadChars: sizes = {} } = await chrome.storage.session.get("threadChars");
  return sizes[conversationId] ?? 0;
}

async function setThreadChars(conversationId, chars) {
  if (!conversationId) return;
  const { threadChars: sizes = {} } = await chrome.storage.session.get("threadChars");
  delete sizes[conversationId]; // re-insert, so the least recently touched chat is the one dropped
  const entries = [...Object.entries(sizes), [conversationId, chars]].slice(-MAX_TRACKED_THREADS);
  await chrome.storage.session.set({ threadChars: Object.fromEntries(entries) });
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
    // What went in: the thread as it stood, plus this message.
    promptChars: event.promptChars ?? 0,
    inputChars: (await threadChars(event.conversationId)) + (event.promptChars ?? 0),
    before,
  });
}

async function recordMessageEnd(event) {
  const { pending, othersInFlight } = await takePendingMessage(event.requestId);
  // A request that never produced a reply (HTTP error, network failure) cost nothing.
  if (!pending || !event.ok) return;

  // The thread is now longer by this exchange, whatever the next reading says.
  const exchanged = (pending.promptChars ?? 0) + (event.replyChars ?? 0);
  await setThreadChars(pending.conversationId, (await threadChars(pending.conversationId)) + exchanged);

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
    // Rough token counts, for pricing the message at API rates (lib/value.js).
    inputTokens: pending.inputChars != null ? tokensOf(pending.inputChars) : null,
    outputTokens: tokensOf(event.replyChars),
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
    if ((await getSettings()).demoMode) return await refreshDemo();

    const snapshot = await fetchUsageSnapshot();
    await applySnapshot(snapshot);
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

/**
 * Demo mode's stand-in for a refresh: rebuild the made-up dataset around the
 * current time (so "resets in…" and "last updated" stay fresh) and repaint.
 * Nothing is fetched, and none of the real stored readings are touched.
 */
async function refreshDemo() {
  const demo = buildDemoState();
  await setDemoState(demo);
  await updateToolbar(demo.latestSnapshot);
  return { ok: true, snapshot: demo.latestSnapshot, demo: true };
}

/** Called when the demoMode setting flips. */
async function applyDemoMode(on) {
  if (on) return refreshDemo();
  await setDemoState(null);
  // Back to reality: show what was stored before, then try for a fresh reading.
  await updateToolbar((await getAll()).latestSnapshot);
  await refreshUsage();
}

/** Everything that has to happen whenever a new reading lands, whichever way it arrived. */
async function applySnapshot(snapshot) {
  const { latestSnapshot: previous = null } = await chrome.storage.local.get("latestSnapshot");
  await setLatestSnapshot(snapshot);
  if (snapshot.extraUsage) await setExtraUsage(snapshot.extraUsage, snapshot.fetchedAt);
  await noteFullBuckets(snapshot);
  await updateToolbar(snapshot);
  await updateModelHint();

  // Alerts, each comparing this reading with what came before it.
  await maybeNotify(previous, snapshot);
  await announceResets(previous, snapshot);
  await watchForSpike(snapshot);
  await watchPace();
  await scheduleResetCheck(snapshot);
}

// ------------------------------------------------------------- model hint --

async function updateModelHint() {
  const { history, settings } = await getAll();
  if (settings.demoMode) return; // the demo dataset brings its own hint; don't overwrite the real one from it
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
  const extra = snapshot?.extraUsage;
  if (extra?.enabled && extra.used != null) {
    const cap = extra.limit != null ? ` of ${formatMoney(extra.limit, extra.currency)}` : "";
    parts.push(`Extra usage ${formatMoney(extra.used, extra.currency)}${cap}`);
  }
  return parts.length > 0 ? `ClaudeMeter — ${parts.join(" · ")}` : "ClaudeMeter";
}

/** Paints the toolbar icon for the session %: a drawn gauge, badge text, both, or neither. */
async function updateToolbar(snapshot) {
  const settings = await getSettings();
  const { iconStyle, privacyMode } = settings;
  const pct = snapshot?.session?.percentUsed ?? null;
  const showGauge = pct != null && (iconStyle === "gauge" || iconStyle === "both");
  // Privacy mode: no badge text, an empty gauge, and a hover title with no figures in it.
  const showBadge = pct != null && !privacyMode && (iconStyle === "badge" || iconStyle === "both");

  // A shortcut's confirmation owns the badge for a moment; flashBadge() repaints when it's done.
  if (!badgeFlashing) {
    await chrome.action.setBadgeText({ text: showBadge ? `${pct}%` : "" });
    if (showBadge) await chrome.action.setBadgeBackgroundColor({ color: severityColor(pct, settings) });
  }

  if (showGauge) {
    const imageData = privacyMode ? gaugeImageData(null) : gaugeImageData(pct, severityColor(pct, settings));
    await chrome.action.setIcon({ imageData });
  } else {
    await chrome.action.setIcon({ path: DEFAULT_ICON });
  }
  await chrome.action.setTitle({
    title: privacyMode ? "ClaudeMeter — numbers hidden (privacy mode)" : toolbarTitle(snapshot),
  });
}

async function togglePrivacyMode() {
  const { privacyMode } = await getSettings();
  await setSettings({ privacyMode: !privacyMode });
  return !privacyMode;
}

// ------------------------------------------------------------ notifications --

function bucketsOf(snapshot) {
  if (!snapshot) return [];
  const buckets = [...(snapshot.weekly ?? [])];
  if (snapshot.session) buckets.push({ ...snapshot.session, label: snapshot.session.label ?? "Current session" });
  // The monthly extra-usage cap is alerted on like any other limit.
  const extra = snapshot.extraUsage;
  if (extra?.enabled && extra.percentUsed != null) {
    buckets.push({ label: "Extra usage", percentUsed: extra.percentUsed, subject: "Extra usage", of: " of this month's cap" });
  }
  return buckets;
}

/**
 * The one way an alert leaves the extension. It decides whether the user wants
 * to hear anything right now, and words it for the room: `discreet` is what
 * goes out in privacy mode, where a notification over a shared screen must
 * carry no figures.
 * @returns {Promise<boolean>} whether it was sent
 */
async function sendAlert({ id, message, discreet }) {
  const { settings, snoozeUntil } = await getAll();
  if (!settings.notificationsEnabled || isSnoozed(snoozeUntil)) return false;

  const text = settings.privacyMode ? discreet : message;
  chrome.notifications.create(`claudemeter-${id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("src/icons/icon128.png"),
    title: "ClaudeMeter",
    message: text,
    priority: 1,
  });
  // Awaited, so the worker isn't put to sleep with a delivery half sent.
  await sendToWebhooks(text);
  return true;
}

/**
 * Sends a line of text to the webhooks the user has switched on (or, for the
 * test button, to the ones named) and remembers how each delivery went.
 */
async function sendToWebhooks(text, only = null) {
  const { webhooks } = await getSettings();
  const results = await deliverWebhooks(webhooks, { title: "ClaudeMeter", message: text }, fetch, only);
  await recordWebhookResults(results);
  for (const result of results.filter((r) => !r.ok)) console.warn(LOG_PREFIX, "webhook", result.service, result.detail);
  return results;
}

async function maybeNotify(previousSnapshot, snapshot) {
  const { settings } = await getAll();
  // Skip the very first successful fetch — there's no prior reading to
  // compare against, so "crossing" a threshold isn't meaningful yet.
  if (!previousSnapshot) return;

  const previousByLabel = new Map(bucketsOf(previousSnapshot).map((b) => [b.label, b.percentUsed]));

  for (const bucket of bucketsOf(snapshot)) {
    const before = previousByLabel.get(bucket.label) ?? 0;
    const crossed = crossedThreshold(settings.notifyThresholds, before, bucket.percentUsed);
    if (crossed == null) continue;

    await sendAlert({
      id: `${bucket.label}-${crossed}`,
      message: `${bucket.subject ?? `${bucket.label} usage`} just crossed ${crossed}%${bucket.of ?? ""} (now ${bucket.percentUsed}%).`,
      discreet: "A usage alert you set has been reached.",
    });
  }
}

/** Logs a sudden jump in any limit and, if alerts are on, says so. */
async function watchForSpike(snapshot) {
  const spike = await recordSpike(snapshot, (await getSettings()).spikePercent);
  if (!spike) return;
  console.log(LOG_PREFIX, "spike:", spike.label, describeSpike(spike));
  await sendAlert({
    id: `spike-${spike.at}`,
    message: `${spike.label} jumped: ${describeSpike(spike)}.`,
    discreet: "A sudden jump in usage was detected.",
  });
}

/** "Your session has reset" — for limits that were near their ceiling, and only when it just happened (lib/reset-alert.js). */
async function announceResets(previousSnapshot, snapshot) {
  if (!previousSnapshot) return;
  const { resetAlertPercent } = await getSettings();
  const resets = resetsToAnnounce(bucketsOf(previousSnapshot), bucketsOf(snapshot), {
    percent: resetAlertPercent,
    gapMs: snapshot.fetchedAt - previousSnapshot.fetchedAt,
    at: snapshot.fetchedAt,
  });
  for (const reset of resets) {
    await sendAlert({
      id: `reset-${reset.label}-${snapshot.fetchedAt}`,
      message: describeReset(reset),
      discreet: "A usage limit has reset.",
    });
  }
}

/**
 * A limit that is high enough to be announced gets a refresh timed for just
 * after it resets — otherwise the news waits for the next scheduled one.
 */
async function scheduleResetCheck(snapshot) {
  const { resetAlertPercent } = await getSettings();
  const when = nextResetCheck(bucketsOf(snapshot), { percent: resetAlertPercent });
  if (when) chrome.alarms.create(RESET_ALARM_NAME, { when });
  else chrome.alarms.clear(RESET_ALARM_NAME);
}

/** Says so, once a day, when today is running well above a usual one (lib/pace.js). */
async function watchPace() {
  const { settings, usageLog } = await getAll();
  const { paceAlertDay } = await chrome.storage.local.get("paceAlertDay");
  const alert = paceAlert(usageLog, { factor: settings.paceAlertFactor, lastAlertDay: paceAlertDay });
  if (!alert) return;

  const sent = await sendAlert({
    id: `pace-${alert.day}`,
    message: describePace(alert),
    discreet: "You're using Claude well above your usual pace today.",
  });
  // Only a delivered alert uses up the day's one: if alerts were snoozed, it can still come later.
  if (sent) await chrome.storage.local.set({ paceAlertDay: alert.day });
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

// ------------------------------------------------------------ context menu --
// Right-clicking the toolbar icon. Chrome allows six top-level items here.

const MENU_CONTEXTS = ["action"];

async function createContextMenu() {
  await chrome.contextMenus.removeAll();
  const add = (properties) => chrome.contextMenus.create({ contexts: MENU_CONTEXTS, ...properties });

  add({ id: "refresh", title: "Refresh now" });
  add({ id: "snooze", title: "Snooze alerts" });
  for (const option of SNOOZE_OPTIONS) {
    add({ id: `snooze:${option.id}`, parentId: "snooze", title: option.label });
  }
  add({ id: "snooze:separator", parentId: "snooze", type: "separator" });
  add({ id: "snooze:off", parentId: "snooze", title: "Resume alerts", enabled: false });
  add({ id: "history", title: "Open history" });
  if (chrome.sidePanel?.open) add({ id: "sidepanel", title: "Open side panel" });
  add({ id: "mini", title: "Open mini window" });
  const { privacyMode } = await getSettings();
  add({ id: "privacy", type: "checkbox", title: "Privacy mode (hide numbers)", checked: privacyMode });

  await syncSnooze();
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);

  if (id === "sidepanel") {
    // Must be called straight from the click — an await first would drop the user gesture.
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => console.warn(LOG_PREFIX, "side panel:", err));
  } else if (id === "refresh") {
    refreshUsage();
  } else if (id === "history") {
    openUrl(`${DASHBOARD_URL}#history`);
  } else if (id === "mini") {
    openMiniWindow();
  } else if (id === "privacy") {
    setSettings({ privacyMode: Boolean(info.checked) });
  } else if (id === "snooze:off") {
    setSnoozeUntil(0);
  } else if (id.startsWith("snooze:")) {
    setSnoozeUntil(snoozeEnd(id.slice("snooze:".length)));
  }
});

// ------------------------------------------------------------------ snooze --

/** Brings the menu and the wake-up alarm in line with the stored snooze. Runs whenever it changes. */
async function syncSnooze() {
  const { snoozeUntil } = await getAll();
  const snoozed = isSnoozed(snoozeUntil);

  // An alarm, not a timer: the worker won't be alive when a 4-hour snooze runs out.
  if (snoozed) chrome.alarms.create(SNOOZE_ALARM_NAME, { when: snoozeUntil });
  else chrome.alarms.clear(SNOOZE_ALARM_NAME);

  try {
    await chrome.contextMenus.update("snooze", {
      title: snoozed ? `Alerts snoozed until ${formatClock(snoozeUntil)}` : "Snooze alerts",
    });
    await chrome.contextMenus.update("snooze:off", { enabled: snoozed });
  } catch {
    // The menu isn't built yet (first run before onInstalled) — createContextMenu() calls back here.
  }
}

// --------------------------------------------------------------- shortcuts --
// Declared under "commands" in the manifest; rebindable at chrome://extensions/shortcuts.

/**
 * A shortcut fires with no window of ours open, so the only place to confirm
 * it did something is the toolbar badge: show a mark briefly, then put back
 * whatever the icon style normally shows.
 */
let badgeFlashing = false;

async function flashBadge(text, color) {
  // Toggling a setting repaints the toolbar; without this flag that repaint would wipe the flash at once.
  badgeFlashing = true;
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    await new Promise((resolve) => setTimeout(resolve, BADGE_FLASH_MS));
  } finally {
    badgeFlashing = false;
  }
  const { latestSnapshot } = await getAll();
  await updateToolbar(latestSnapshot);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "refresh-usage") {
    const result = await refreshUsage();
    await flashBadge(result.ok ? "\u2713" : "!", result.ok ? "#3fb950" : "#e5484d");
  } else if (command === "toggle-snooze") {
    const { snoozeUntil } = await getAll();
    const resuming = isSnoozed(snoozeUntil);
    await setSnoozeUntil(resuming ? 0 : snoozeEnd(DEFAULT_SNOOZE));
    await flashBadge(resuming ? "on" : "zz", "#7d8ba0");
  } else if (command === "toggle-privacy") {
    const hidden = await togglePrivacyMode();
    await flashBadge(hidden ? "hide" : "show", "#7d8ba0");
  }
});

// ----------------------------------------------------------------- omnibox --
// "cm" + space in the address bar: the dropdown shows usage, Enter runs a command.

const DASHBOARD_URL = chrome.runtime.getURL("src/popup/popup.html?view=panel");
const REPORT_URL = chrome.runtime.getURL("src/report/report.html");

function openUrl(url, disposition = "newForegroundTab") {
  if (disposition === "currentTab") return chrome.tabs.update({ url });
  return chrome.tabs.create({ url, active: disposition !== "newBackgroundTab" });
}

chrome.omnibox.onInputStarted.addListener(() => {
  // The numbers in the dropdown should be current by the time the user has typed the space.
  refreshUsage();
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const { latestSnapshot, settings } = await getAll();
  const { defaultDescription, suggestions } = buildSuggestions(text, latestSnapshot, {
    concealed: settings.privacyMode,
  });
  chrome.omnibox.setDefaultSuggestion({ description: defaultDescription });
  suggest(suggestions);
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const { latestSnapshot } = await getAll();
  const command = resolveCommand(text, Boolean(latestSnapshot));

  if (command === "refresh") await refreshUsage();
  else if (command === "report") await openUrl(REPORT_URL, disposition);
  else if (command === "privacy") await togglePrivacyMode();
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
  createContextMenu();
  // A brand-new install gets the welcome page; updates and reloads don't.
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/onboarding/onboarding.html") });
  }
  refreshUsage(); // best-effort initial fetch; silently no-ops if not logged in
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  applyActionSurface(); // action.setPopup() doesn't survive a browser restart
  syncSnooze(); // a snooze may have run out while the browser was closed
  refreshUsage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SNOOZE_ALARM_NAME) setSnoozeUntil(0);
  if (alarm.name === ALARM_NAME || alarm.name === RESET_ALARM_NAME) refreshUsage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.snoozeUntil) syncSnooze();

  if (areaName === "local" && changes.settings) {
    const before = changes.settings.oldValue?.refreshIntervalMinutes;
    const after = changes.settings.newValue?.refreshIntervalMinutes;
    if (before !== after) ensureAlarm();

    if (changes.settings.oldValue?.modelHintPercent !== changes.settings.newValue?.modelHintPercent) {
      updateModelHint();
    }
    if (changes.settings.oldValue?.resetAlertPercent !== changes.settings.newValue?.resetAlertPercent) {
      getAll().then(({ latestSnapshot }) => latestSnapshot && scheduleResetCheck(latestSnapshot));
    }
    if (changes.settings.oldValue?.actionOpens !== changes.settings.newValue?.actionOpens) {
      applyActionSurface();
    }
    if (Boolean(changes.settings.oldValue?.demoMode) !== Boolean(changes.settings.newValue?.demoMode)) {
      applyDemoMode(Boolean(changes.settings.newValue?.demoMode));
    }
    if (changes.settings.oldValue?.privacyMode !== changes.settings.newValue?.privacyMode) {
      // Keep the menu's tick in step when the mode was switched somewhere else.
      const checked = Boolean(changes.settings.newValue?.privacyMode);
      chrome.contextMenus.update("privacy", { checked }).catch(() => {});
    }
    const toolbarKeys = ["iconStyle", "warnAt", "dangerAt", "severityColors", "privacyMode"];
    const pick = (settings) => JSON.stringify(toolbarKeys.map((key) => settings?.[key]));
    if (pick(changes.settings.oldValue) !== pick(changes.settings.newValue)) {
      getAll().then(({ latestSnapshot }) => updateToolbar(latestSnapshot));
    }
  }
});
