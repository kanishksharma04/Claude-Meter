// Thin wrapper around chrome.storage.local with schema defaults.
// Shared by the background worker, popup, options, and debug pages.

import { appendMessage, prunePending } from "./message-cost.js";
import { addLimitHit, observeFullBuckets } from "./limit-hits.js";
import { DEFAULT_BUCKET_PREFS } from "./bucket-prefs.js";
import { buildDemoState, buildDemoAnalytics } from "./demo-data.js";
import { foldSnapshot, buildUsageLog } from "./usage-log.js";
import { foldWindow, buildWindows } from "./session-windows.js";
import { addAnnotation, removeAnnotation } from "./annotations.js";
import { detectSpike, addSpike } from "./spikes.js";
import { noteActivity, elsewherePoints } from "./attribution.js";
import { foldExtraUsage } from "./extra-usage.js";
import { DEFAULT_WEBHOOKS } from "./webhooks.js";
import { DEFAULT_QUIET_HOURS, normalizeQuietHours } from "./quiet-hours.js";

export const MAX_DEBUG_CAPTURES = 20;
// Enough for the dashboard chart to cover about a day at the default refresh interval.
export const MAX_HISTORY = 500;

export const DEFAULT_SETTINGS = {
  refreshIntervalMinutes: 5,
  notificationsEnabled: false,
  notifyThresholds: [80, 95], // any whole percentages, up to eight (lib/thresholds.js)
  paceAlertFactor: 2, // alert when today runs at this many times the usual pace; 0 = off (lib/pace.js)
  resetAlertPercent: 90, // announce a reset only for a limit that had reached this level; 0 = off (lib/reset-alert.js)
  quietHours: DEFAULT_QUIET_HOURS, // per-weekday windows in which alerts stay silent (lib/quiet-hours.js)
  soundAlerts: false, // play a sound with each alert, through the offscreen document (lib/sounds.js)
  soundName: "chime", // which one: a key of SOUNDS
  soundVolume: 60, // 0–100
  webhooks: DEFAULT_WEBHOOKS, // { slack | discord | ntfy: { enabled, url } } — alerts also sent there (lib/webhooks.js)
  theme: "auto", // "auto" | "light" | "dark" | "contrast"
  accent: "clay", // preset name from lib/theme.js
  warnAt: 80, // meters turn amber at this %…
  dangerAt: 95, // …and red at this one (see lib/severity.js)
  severityColors: { ok: null, warn: null, danger: null }, // hex overrides; null = each surface's default
  bucketPrefs: DEFAULT_BUCKET_PREFS, // popup order / hidden / pinned buckets (lib/bucket-prefs.js)
  iconStyle: "gauge", // toolbar icon: "gauge" ring | "badge" text | "both" | "plain"
  privacyMode: false, // blur/hide every number, for screen sharing
  actionOpens: "popup", // what a click on the toolbar icon opens: "popup" | "sidePanel"
  developerMode: false,
  demoMode: false, // show made-up usage everywhere and fetch nothing (lib/demo-data.js)
  demoLabel: true, // mark the popup with a "Demo" badge while demo mode is on
  inlinePill: true, // usage pill next to claude.ai's composer (src/content/page-ui.js)
  tabIndicator: "title", // usage % on the claude.ai tab: "off" | "title" | "favicon" | "both"
  preSendWarnPercent: 80, // warn above the composer while drafting at/above this %; 0 = off
  modelHintPercent: 50, // suggest a lighter model once a model-specific weekly bucket is this full; 0 = off
  longContextTokens: 40000, // nudge towards a new chat once the thread is about this long; 0 = off
  attachmentWarnTokens: 25000, // warn when a draft's attachments (or project knowledge) are about this heavy; 0 = off
  lockoutOverlay: true, // live "back at 4:30 PM" countdown on claude.ai while a limit is exhausted
  messageCost: true, // measure session % before/after each reply (two extra usage fetches per message)
  weeklyBudget: true, // "12% a day until reset · 9% used today" under each weekly limit (lib/budget.js)
  forecast: "profile", // where each limit is heading: "profile" (your usual week) | "linear" | "off" (lib/forecast.js)
  workdayStart: 9, // assumed working hours (0–24), for the window-start suggestion until the
  workdayEnd: 17, // usage log has a week to learn from (lib/window-start.js)
  plan: "auto", // for the plan-fit adviser: "auto" (detect) | "pro" | "max5" | "max20" (lib/plan-fit.js)
  planPrice: 0, // what the subscription costs a month in US$, for the value readout; 0 = the plan's list price
  spikePercent: 15, // flag a limit that jumps this many points within five minutes; 0 = off (lib/spikes.js)
  chartRange: "day", // the dashboard chart's span: "day" (raw readings) | "week" (hourly log)
  chartCompare: false, // overlay the same stretch one week earlier on the chart
};

export const DEFAULT_STATE = {
  latestSnapshot: null,
  history: [],
  settings: DEFAULT_SETTINGS,
  __debug_captures: [],
  orgCache: null,
  lastError: null,
  modelHint: null, // see modelSwitchHint() in lib/burn-rate.js
  messageLog: [], // per-message cost entries, oldest first (see lib/message-cost.js)
  pendingMessages: {}, // requestId -> { before snapshot, ... } for replies still streaming
  limitHits: [], // "limit reached" events, oldest first (see lib/limit-hits.js)
  snoozeUntil: 0, // epoch ms until which alerts are paused; 0 = not snoozed (see lib/snooze.js)
  usageLog: [], // one compact record per hour, eight weeks deep (see lib/usage-log.js)
  sessionWindows: [], // past 5-hour session windows, oldest first (see lib/session-windows.js)
  annotations: [], // the user's notes on the chart, oldest first (see lib/annotations.js)
  spikes: [], // sudden jumps in usage, oldest first (see lib/spikes.js)
  extraUsage: null, // latest extra-usage spend and cap, when the account has it (see lib/extra-usage.js)
  extraUsageLog: [], // that spend's running total, one entry per day
};

export async function getAll() {
  const stored = await chrome.storage.local.get([...Object.keys(DEFAULT_STATE), "demoState"]);
  const settings = withDefaults(stored.settings);
  // Demo mode swaps made-up readings in here, at read time. The real ones stay
  // in storage untouched, so switching it off shows exactly what was there before.
  const data = settings.demoMode ? { ...stored, ...demoData(stored.demoState) } : stored;
  return {
    latestSnapshot: data.latestSnapshot ?? DEFAULT_STATE.latestSnapshot,
    history: data.history ?? DEFAULT_STATE.history,
    settings,
    __debug_captures: stored.__debug_captures ?? DEFAULT_STATE.__debug_captures,
    orgCache: stored.orgCache ?? DEFAULT_STATE.orgCache,
    lastError: data.lastError ?? DEFAULT_STATE.lastError,
    modelHint: data.modelHint ?? DEFAULT_STATE.modelHint,
    messageLog: data.messageLog ?? DEFAULT_STATE.messageLog,
    pendingMessages: stored.pendingMessages ?? DEFAULT_STATE.pendingMessages,
    limitHits: data.limitHits ?? DEFAULT_STATE.limitHits,
    snoozeUntil: stored.snoozeUntil ?? DEFAULT_STATE.snoozeUntil,
    usageLog: data.usageLog ?? DEFAULT_STATE.usageLog,
    sessionWindows: data.sessionWindows ?? DEFAULT_STATE.sessionWindows,
    spikes: data.spikes ?? DEFAULT_STATE.spikes,
    extraUsage: data.extraUsage ?? DEFAULT_STATE.extraUsage,
    extraUsageLog: data.extraUsageLog ?? DEFAULT_STATE.extraUsageLog,
    // The user's own words, not a reading — so they are the real ones in demo mode too.
    annotations: stored.annotations ?? DEFAULT_STATE.annotations,
  };
}

/**
 * The stored demo dataset plus its weeks of made-up analytics. Those are
 * rebuilt on every read rather than stored: they are large, and only extension
 * pages (which can import the generator) ever show them.
 */
function demoData(demoState) {
  const demo = demoState ?? buildDemoState();
  return { ...demo, ...buildDemoAnalytics(demo) };
}

/**
 * The demo dataset is also written to storage (and removed again) so the page
 * script on claude.ai — which can't import lib/demo-data.js — can read it.
 */
export async function setDemoState(demoState) {
  if (demoState) await chrome.storage.local.set({ demoState });
  else await chrome.storage.local.remove("demoState");
}

/**
 * Stores a new snapshot as the latest, appends it to the capped rolling
 * history, and folds it into the long-term records: the hourly usage log and
 * the list of session windows.
 */
export async function setLatestSnapshot(reading) {
  const stored = await chrome.storage.local.get(["history", "usageLog", "sessionWindows", "localActivity"]);
  const history = stored.history ?? [];
  // Mark the reading with whatever part of its rise this browser had no hand in.
  const elsewhere = elsewherePoints(history.at(-1), reading, stored.localActivity);
  const snapshot = elsewhere > 0 ? { ...reading, elsewhere } : reading;
  // First run with either record: seed it from whatever history is already there.
  const usageLog = stored.usageLog ?? buildUsageLog(history);
  const sessionWindows = stored.sessionWindows ?? buildWindows(history);
  await chrome.storage.local.set({
    latestSnapshot: snapshot,
    history: [...history, snapshot].slice(-MAX_HISTORY),
    usageLog: foldSnapshot(usageLog, history.at(-1) ?? null, snapshot),
    sessionWindows: foldWindow(sessionWindows, snapshot),
    lastError: null,
  });
  return snapshot;
}

export async function setLastError(errorInfo) {
  await chrome.storage.local.set({ lastError: errorInfo });
}

export async function getOrgCache() {
  const { orgCache } = await chrome.storage.local.get("orgCache");
  return orgCache ?? null;
}

export async function setOrgCache(orgMeta) {
  await chrome.storage.local.set({ orgCache: orgMeta });
}

/** Stored settings over the defaults, one level deep for the object-valued ones. */
function withDefaults(stored) {
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    severityColors: { ...DEFAULT_SETTINGS.severityColors, ...(stored?.severityColors ?? {}) },
    bucketPrefs: { ...DEFAULT_SETTINGS.bucketPrefs, ...(stored?.bucketPrefs ?? {}) },
    quietHours: normalizeQuietHours(stored?.quietHours),
    webhooks: Object.fromEntries(
      Object.entries(DEFAULT_WEBHOOKS).map(([service, defaults]) => [service, { ...defaults, ...(stored?.webhooks?.[service] ?? {}) }])
    ),
  };
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return withDefaults(settings);
}

export async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function pushDebugCapture(capture) {
  const { __debug_captures = [] } = await chrome.storage.local.get("__debug_captures");
  const next = [capture, ...__debug_captures].slice(0, MAX_DEBUG_CAPTURES);
  await chrome.storage.local.set({ __debug_captures: next });
  return next;
}

/** Writes only when the hint actually changed, so open tabs don't re-render on every refresh. */
export async function setModelHint(hint) {
  const { modelHint = null } = await chrome.storage.local.get("modelHint");
  if (JSON.stringify(modelHint) !== JSON.stringify(hint)) {
    await chrome.storage.local.set({ modelHint: hint });
  }
}

/** Remember the "before" reading for a message whose reply is still streaming. */
export async function setPendingMessage(requestId, pending) {
  const { pendingMessages } = await chrome.storage.local.get("pendingMessages");
  const next = { ...prunePending(pendingMessages), [requestId]: pending };
  await chrome.storage.local.set({ pendingMessages: next });
}

/** Removes and returns a pending message, plus whether other replies were in flight alongside it. */
export async function takePendingMessage(requestId) {
  const { pendingMessages = {} } = await chrome.storage.local.get("pendingMessages");
  const { [requestId]: pending, ...rest } = pendingMessages;
  if (pending) await chrome.storage.local.set({ pendingMessages: rest });
  return { pending: pending ?? null, othersInFlight: Object.keys(prunePending(rest)).length > 0 };
}

export async function pushMessageCost(entry) {
  const { messageLog } = await chrome.storage.local.get("messageLog");
  const next = appendMessage(messageLog, entry);
  await chrome.storage.local.set({ messageLog: next });
  return next;
}

export async function pushLimitHit(hit) {
  const { limitHits } = await chrome.storage.local.get("limitHits");
  const next = addLimitHit(limitHits, hit);
  await chrome.storage.local.set({ limitHits: next });
  return next;
}

/** Stores the latest extra-usage reading and folds it into the day-by-day record of the spend. */
export async function setExtraUsage(reading, at = Date.now()) {
  const { extraUsageLog = [] } = await chrome.storage.local.get("extraUsageLog");
  await chrome.storage.local.set({
    extraUsage: { ...reading, fetchedAt: at },
    extraUsageLog: foldExtraUsage(extraUsageLog, reading, at),
  });
}

/** Keeps the outcome of the latest delivery to each webhook, for Options to show. */
export async function recordWebhookResults(results, at = Date.now()) {
  if (results.length === 0) return;
  const { webhookStatus = {} } = await chrome.storage.local.get("webhookStatus");
  for (const { service, ok, detail } of results) webhookStatus[service] = { at, ok, detail };
  await chrome.storage.local.set({ webhookStatus });
}

/** Remembers that a message was just sent, or its reply just ended, in this browser (lib/attribution.js). */
export async function noteLocalActivity(event) {
  const { localActivity } = await chrome.storage.local.get("localActivity");
  await chrome.storage.local.set({ localActivity: noteActivity(localActivity, event) });
}

/** Logs a lockout for any limit this snapshot shows as full and the log doesn't know about yet. */
export async function noteFullBuckets(snapshot) {
  const { limitHits = [] } = await chrome.storage.local.get("limitHits");
  const next = observeFullBuckets(limitHits, snapshot);
  if (next !== limitHits) await chrome.storage.local.set({ limitHits: next });
}

/**
 * Checks the reading that just landed against the few before it and logs a
 * spike if it reveals one. Resolves to the spike, or null.
 */
export async function recordSpike(snapshot, percent) {
  const { history = [], spikes = [] } = await chrome.storage.local.get(["history", "spikes"]);
  const spike = detectSpike(history, snapshot, { percent, since: spikes.at(-1)?.at ?? 0 });
  if (spike) await chrome.storage.local.set({ spikes: addSpike(spikes, spike) });
  return spike;
}

/** Pins a note to a moment on the chart. Resolves to whether it was added (empty text isn't). */
export async function addNote(text, at = Date.now()) {
  const { annotations = [] } = await chrome.storage.local.get("annotations");
  const next = addAnnotation(annotations, { at, text });
  if (next === annotations) return false;
  await chrome.storage.local.set({ annotations: next });
  return true;
}

export async function removeNote(id) {
  const { annotations } = await chrome.storage.local.get("annotations");
  await chrome.storage.local.set({ annotations: removeAnnotation(annotations, id) });
}

/** Pause alerts until the given time; 0 resumes them. */
export async function setSnoozeUntil(epochMs) {
  await chrome.storage.local.set({ snoozeUntil: epochMs });
}

export async function clearDebugCaptures() {
  await chrome.storage.local.set({ __debug_captures: [] });
}

export async function clearAllData() {
  await chrome.storage.local.set({
    latestSnapshot: null,
    history: [],
    __debug_captures: [],
    orgCache: null,
    lastError: null,
    modelHint: null,
    messageLog: [],
    pendingMessages: {},
    limitHits: [],
    usageLog: [],
    sessionWindows: [],
    annotations: [],
    spikes: [],
    localActivity: null,
    extraUsage: null,
    extraUsageLog: [],
  });
}

export function onStorageChanged(callback) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") callback(changes);
  });
}
