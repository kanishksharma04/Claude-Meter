// The ways in that aren't a page: the menu on the toolbar icon, keyboard
// shortcuts, the "cm" keyword in the address bar, and the mini window.

import { getAll, getSettings, setSettings, setSnoozeUntil } from "../lib/storage.js";
import { buildSuggestions, resolveCommand } from "../lib/omnibox.js";
import { formatClock } from "../lib/time-format.js";
import { SNOOZE_OPTIONS, DEFAULT_SNOOZE, snoozeEnd, isSnoozed } from "../lib/snooze.js";
import { refreshUsage } from "./refresh.js";
import { LOG_PREFIX, SNOOZE_ALARM_NAME, DASHBOARD_URL, REPORT_URL, HEALTH_URL, openUrl } from "./shared.js";
import { togglePrivacyMode, flashBadge } from "./toolbar.js";

// ------------------------------------------------------------ context menu --
// Right-clicking the toolbar icon. Chrome allows six top-level items here.
const MENU_CONTEXTS = ["action"];

export async function createContextMenu() {
  if (!chrome.contextMenus) return;
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
  else if (chrome.sidebarAction?.open) add({ id: "sidepanel", title: "Open sidebar" }); // Firefox's equivalent
  add({ id: "mini", title: "Open mini window" });
  add({ id: "health", title: "Health check" });
  const { privacyMode } = await getSettings();
  add({ id: "privacy", type: "checkbox", title: "Privacy mode (hide numbers)", checked: privacyMode });

  await syncSnooze();
}

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);

  if (id === "sidepanel") {
    // Must be called straight from the click — an await first would drop the user gesture.
    const opening = chrome.sidePanel?.open ? chrome.sidePanel.open({ windowId: tab.windowId }) : chrome.sidebarAction.open();
    opening.catch((err) => console.warn(LOG_PREFIX, "side panel:", err));
  } else if (id === "refresh") {
    refreshUsage();
  } else if (id === "history") {
    openUrl(`${DASHBOARD_URL}#history`);
  } else if (id === "health") {
    openUrl(HEALTH_URL);
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
export async function syncSnooze() {
  const { snoozeUntil } = await getAll({ logs: false });
  const snoozed = isSnoozed(snoozeUntil);

  // An alarm, not a timer: the worker won't be alive when a 4-hour snooze runs out.
  if (snoozed) chrome.alarms.create(SNOOZE_ALARM_NAME, { when: snoozeUntil });
  else chrome.alarms.clear(SNOOZE_ALARM_NAME);

  try {
    await chrome.contextMenus?.update("snooze", {
      title: snoozed ? `Alerts snoozed until ${formatClock(snoozeUntil)}` : "Snooze alerts",
    });
    await chrome.contextMenus?.update("snooze:off", { enabled: snoozed });
  } catch {
    // The menu isn't built yet (first run before onInstalled) — createContextMenu() calls back here.
  }
}

chrome.commands?.onCommand.addListener(async (command) => {
  if (command === "refresh-usage") {
    const result = await refreshUsage();
    await flashBadge(result.ok ? "\u2713" : "!", result.ok ? "#3fb950" : "#e5484d");
  } else if (command === "toggle-snooze") {
    const { snoozeUntil } = await getAll({ logs: false });
    const resuming = isSnoozed(snoozeUntil);
    await setSnoozeUntil(resuming ? 0 : snoozeEnd(DEFAULT_SNOOZE));
    await flashBadge(resuming ? "on" : "zz", "#7d8ba0");
  } else if (command === "toggle-privacy") {
    const hidden = await togglePrivacyMode();
    await flashBadge(hidden ? "hide" : "show", "#7d8ba0");
  }
});

// (Safari has no address-bar keywords, hence the "?." on each of these.)
chrome.omnibox?.onInputStarted.addListener(() => {
  // The numbers in the dropdown should be current by the time the user has typed the space.
  refreshUsage();
});

chrome.omnibox?.onInputChanged.addListener(async (text, suggest) => {
  const { latestSnapshot, settings } = await getAll({ logs: false });
  const { defaultDescription, suggestions } = buildSuggestions(text, latestSnapshot, {
    concealed: settings.privacyMode,
  });
  chrome.omnibox.setDefaultSuggestion({ description: defaultDescription });
  suggest(suggestions);
});

chrome.omnibox?.onInputEntered.addListener(async (text, disposition) => {
  const { latestSnapshot } = await getAll({ logs: false });
  const command = resolveCommand(text, Boolean(latestSnapshot));

  if (command === "refresh") await refreshUsage();
  else if (command === "report") await openUrl(REPORT_URL, disposition);
  else if (command === "health") await openUrl(HEALTH_URL, disposition);
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

export async function openMiniWindow() {
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

// Firefox doesn't report window moves, so there the mini window opens at its default size and place each time.
chrome.windows.onBoundsChanged?.addListener(async (win) => {
  const { miniWindowId } = await chrome.storage.session.get("miniWindowId");
  if (win.id !== miniWindowId) return;
  const { left, top, width, height } = win;
  await chrome.storage.local.set({ miniWindowBounds: { left, top, width, height } });
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { miniWindowId } = await chrome.storage.session.get("miniWindowId");
  if (windowId === miniWindowId) await chrome.storage.session.remove("miniWindowId");
});
