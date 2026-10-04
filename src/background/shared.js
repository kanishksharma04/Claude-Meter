// Names and addresses the background modules share. Nothing here does anything.

import { REFRESH_ALARM_NAME } from "../lib/refresh-plan.js";

export const LOG_PREFIX = "[ClaudeMeter]";
export const ALARM_NAME = REFRESH_ALARM_NAME;
export const SNOOZE_ALARM_NAME = "claudemeter-snooze-end";
export const RESET_ALARM_NAME = "claudemeter-reset-check";
export const DIGEST_ALARM_NAME = "claudemeter-digest";

// How long a keyboard shortcut's confirmation stays on the toolbar badge.
export const BADGE_FLASH_MS = 1500;

// A "before" reading this fresh is reused rather than re-fetched when a message is sent.
export const BEFORE_MAX_AGE_MS = 20_000;

// The usage endpoint lags the end of a reply slightly; wait before the "after" reading.
export const AFTER_SETTLE_MS = 1500;

export const DEFAULT_ICON = {
  16: "/src/icons/icon16.png",
  32: "/src/icons/icon32.png",
  48: "/src/icons/icon48.png",
  128: "/src/icons/icon128.png",
};

// ----------------------------------------------------------------- omnibox --
// "cm" + space in the address bar: the dropdown shows usage, Enter runs a command.
export const DASHBOARD_URL = chrome.runtime.getURL("src/popup/popup.html?view=panel");
export const REPORT_URL = chrome.runtime.getURL("src/report/report.html");
export const HEALTH_URL = chrome.runtime.getURL("src/health/health.html");

export function openUrl(url, disposition = "newForegroundTab") {
  if (disposition === "currentTab") return chrome.tabs.update({ url });
  return chrome.tabs.create({ url, active: disposition !== "newBackgroundTab" });
}
