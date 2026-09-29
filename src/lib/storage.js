// Thin wrapper around chrome.storage.local with schema defaults.
// Shared by the background worker, popup, options, and debug pages.

import { appendMessage, prunePending } from "./message-cost.js";
import { addLimitHit } from "./limit-hits.js";

export const MAX_DEBUG_CAPTURES = 20;
// Enough for the dashboard chart to cover about a day at the default refresh interval.
export const MAX_HISTORY = 500;

export const DEFAULT_SETTINGS = {
  refreshIntervalMinutes: 5,
  notificationsEnabled: false,
  notifyThresholds: [80, 95],
  theme: "auto",
  actionOpens: "popup", // what a click on the toolbar icon opens: "popup" | "sidePanel"
  developerMode: false,
  inlinePill: true, // usage pill next to claude.ai's composer (src/content/page-ui.js)
  tabIndicator: "title", // usage % on the claude.ai tab: "off" | "title" | "favicon" | "both"
  preSendWarnPercent: 80, // warn above the composer while drafting at/above this %; 0 = off
  modelHintPercent: 50, // suggest a lighter model once a model-specific weekly bucket is this full; 0 = off
  longContextTokens: 40000, // nudge towards a new chat once the thread is about this long; 0 = off
  attachmentWarnTokens: 25000, // warn when a draft's attachments (or project knowledge) are about this heavy; 0 = off
  lockoutOverlay: true, // live "back at 4:30 PM" countdown on claude.ai while a limit is exhausted
  messageCost: true, // measure session % before/after each reply (two extra usage fetches per message)
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
};

export async function getAll() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  return {
    latestSnapshot: stored.latestSnapshot ?? DEFAULT_STATE.latestSnapshot,
    history: stored.history ?? DEFAULT_STATE.history,
    settings: { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) },
    __debug_captures: stored.__debug_captures ?? DEFAULT_STATE.__debug_captures,
    orgCache: stored.orgCache ?? DEFAULT_STATE.orgCache,
    lastError: stored.lastError ?? DEFAULT_STATE.lastError,
    modelHint: stored.modelHint ?? DEFAULT_STATE.modelHint,
    messageLog: stored.messageLog ?? DEFAULT_STATE.messageLog,
    pendingMessages: stored.pendingMessages ?? DEFAULT_STATE.pendingMessages,
    limitHits: stored.limitHits ?? DEFAULT_STATE.limitHits,
  };
}

/** Stores a new snapshot as the latest, and appends it to the capped rolling history. */
export async function setLatestSnapshot(snapshot) {
  const { history = [] } = await chrome.storage.local.get("history");
  const nextHistory = [...history, snapshot].slice(-MAX_HISTORY);
  await chrome.storage.local.set({ latestSnapshot: snapshot, history: nextHistory, lastError: null });
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

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
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
  });
}

export function onStorageChanged(callback) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") callback(changes);
  });
}
