// Thin wrapper around chrome.storage.local with schema defaults.
// Shared by the background worker, popup, options, and debug pages.

export const MAX_DEBUG_CAPTURES = 20;
export const MAX_HISTORY = 50;

export const DEFAULT_SETTINGS = {
  refreshIntervalMinutes: 5,
  notificationsEnabled: false,
  notifyThresholds: [80, 95],
  theme: "auto",
  developerMode: false,
};

export const DEFAULT_STATE = {
  latestSnapshot: null,
  history: [],
  settings: DEFAULT_SETTINGS,
  __debug_captures: [],
  orgCache: null,
  lastError: null,
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
  });
}

export function onStorageChanged(callback) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") callback(changes);
  });
}
