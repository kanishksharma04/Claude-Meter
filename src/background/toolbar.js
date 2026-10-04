// The toolbar icon: the gauge drawn on it, its badge, its hover text, and
// what a click on it opens.

import { getAll, getSettings, updateSettings } from "../lib/storage.js";
import { formatMoney } from "../lib/extra-usage.js";
import { gaugeImageData } from "../lib/gauge-icon.js";
import { severityColor } from "../lib/severity.js";
import { formatDuration } from "../lib/time-format.js";
import { BADGE_FLASH_MS, DEFAULT_ICON } from "./shared.js";

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
export async function updateToolbar(snapshot) {
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

export async function togglePrivacyMode() {
  const { privacyMode } = await updateSettings((settings) => ({ privacyMode: !settings.privacyMode }));
  return privacyMode;
}

// ------------------------------------------------------------ action surface --

/** Point the toolbar icon at the popup or the side panel, per the user's setting. */
export async function applyActionSurface() {
  const settings = await getSettings();
  const usePanel = settings.actionOpens === "sidePanel" && Boolean(chrome.sidePanel?.setPanelBehavior);

  // Both are needed: a registered popup would otherwise still win the click.
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: usePanel });
  await chrome.action.setPopup({ popup: usePanel ? "" : chrome.runtime.getURL("src/popup/popup.html") });
}

// --------------------------------------------------------------- shortcuts --
// Declared under "commands" in the manifest; rebindable at chrome://extensions/shortcuts.
/**
 * A shortcut fires with no window of ours open, so the only place to confirm
 * it did something is the toolbar badge: show a mark briefly, then put back
 * whatever the icon style normally shows.
 */
let badgeFlashing = false;

export async function flashBadge(text, color) {
  // Toggling a setting repaints the toolbar; without this flag that repaint would wipe the flash at once.
  badgeFlashing = true;
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    await new Promise((resolve) => setTimeout(resolve, BADGE_FLASH_MS));
  } finally {
    badgeFlashing = false;
  }
  const { latestSnapshot } = await getAll({ logs: false });
  await updateToolbar(latestSnapshot);
}
