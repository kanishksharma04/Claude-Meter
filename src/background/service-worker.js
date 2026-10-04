// The background service worker's entry point: the listeners that wake it —
// a message from a page, an alarm, a setting changing, the browser starting —
// and nothing else. Each hands over to the module whose job it is:
//
//   refresh.js      asking claude.ai for usage, and everything a new reading sets off
//   page-events.js  what the page script on claude.ai reports: its own usage requests, messages, limit hits
//   alerts.js       notifications, webhooks, sounds, the daily digest
//   toolbar.js      the icon, its badge and its hover text
//   surfaces.js     the icon's menu, keyboard shortcuts, the address-bar keyword, the mini window
//   companion.js    Claude Code usage, through the native-messaging companion
//   backup-job.js   the scheduled backup to Downloads
//   shared.js       names and addresses they all use
//
// Listeners have to be registered while the worker first runs, or the browser
// won't wake it for them. Importing a module runs it, so the ones registered in
// the modules above (the menu, shortcuts, the address bar, windows,
// notification clicks) are in place by the time this file's own are.

import { getAll, setSnoozeUntil } from "../lib/storage.js";
import { fetchOrgs, UsageApiError } from "../lib/usage-api.js";
import { BACKUP_ALARM_NAME } from "../lib/backup.js";
import { scheduleDigest, sendDigest, playAlertSound, sendToWebhooks, scheduleResetCheck } from "./alerts.js";
import { runBackup, scheduleBackup } from "./backup-job.js";
import { tellCompanionPlan, syncCompanion, tellCompanionWindow, refreshClaudeCode, companionConnected } from "./companion.js";
import { handlePassiveCapture, handleChatEvent } from "./page-events.js";
import {
  refreshUsage,
  applyDemoMode,
  refreshOtherOrgs,
  switchMainOrg,
  refreshApiSpend,
  updateModelHint,
  scheduleRefresh,
  ensureAlarm,
  migrate,
} from "./refresh.js";
import { LOG_PREFIX, ALARM_NAME, SNOOZE_ALARM_NAME, RESET_ALARM_NAME, DIGEST_ALARM_NAME } from "./shared.js";
import { createContextMenu, syncSnooze, openMiniWindow } from "./surfaces.js";
import { updateToolbar, applyActionSurface } from "./toolbar.js";

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

  if (message?.type === "CLAUDEMETER_LIST_ORGS") {
    fetchOrgs().then(
      (orgs) => sendResponse({ ok: true, orgs }),
      (err) => sendResponse({ ok: false, error: { code: err instanceof UsageApiError ? err.code : "UNKNOWN_ERROR" } })
    );
    return true;
  }

  if (message?.type === "CLAUDEMETER_REFRESH_API_SPEND") {
    refreshApiSpend({ force: true })
      .catch(() => ({ ok: false }))
      .then(sendResponse);
    return true;
  }

  if (message?.type === "CLAUDEMETER_REFRESH_CLAUDE_CODE") {
    refreshClaudeCode({ force: true })
      .catch(() => ({ ok: false })) // whoever asked is waiting for an answer, whatever it is
      .then(sendResponse);
    return true;
  }

  if (message?.type === "CLAUDEMETER_BACKUP_NOW") {
    runBackup().then(sendResponse);
    return true;
  }

  if (message?.type === "CLAUDEMETER_TEST_SOUND") {
    playAlertSound(message.sound, message.volume).then(sendResponse);
    return true;
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

chrome.runtime.onInstalled.addListener((details) => {
  console.log(LOG_PREFIX, "extension installed");
  migrate();
  ensureAlarm();
  scheduleDigest();
  scheduleBackup();
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
  scheduleDigest();
  scheduleBackup();
  applyActionSurface(); // action.setPopup() doesn't survive a browser restart
  syncSnooze(); // a snooze may have run out while the browser was closed
  refreshUsage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SNOOZE_ALARM_NAME) setSnoozeUntil(0);
  if (alarm.name === ALARM_NAME || alarm.name === RESET_ALARM_NAME) refreshUsage();
  if (alarm.name === DIGEST_ALARM_NAME) sendDigest();
  if (alarm.name === BACKUP_ALARM_NAME) runBackup();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.snoozeUntil) syncSnooze();

  if (areaName === "local" && changes.settings) {
    if (changes.settings.oldValue?.autoBackup !== changes.settings.newValue?.autoBackup) scheduleBackup();
    const paceKeys = (settings) => `${settings?.refreshIntervalMinutes}:${settings?.adaptiveRefresh !== false}`;
    if (paceKeys(changes.settings.oldValue) !== paceKeys(changes.settings.newValue)) scheduleRefresh();

    if (changes.settings.oldValue?.modelHintPercent !== changes.settings.newValue?.modelHintPercent) {
      updateModelHint();
    }
    if (!changes.settings.oldValue?.apiSpend && changes.settings.newValue?.apiSpend) refreshApiSpend({ force: true });
    if ((changes.settings.oldValue?.primaryOrg ?? null) !== (changes.settings.newValue?.primaryOrg ?? null)) {
      switchMainOrg(changes.settings.newValue?.primaryOrg ?? null);
    } else if (JSON.stringify(changes.settings.oldValue?.trackedOrgs ?? []) !== JSON.stringify(changes.settings.newValue?.trackedOrgs ?? [])) {
      refreshOtherOrgs({ force: true });
    }
    const companionKeys = (settings) => `${Boolean(settings?.claudeCode)}:${settings?.claudeCodeLive !== false}:${Boolean(settings?.demoMode)}`;
    if (companionKeys(changes.settings.oldValue) !== companionKeys(changes.settings.newValue)) {
      syncCompanion().then(() => refreshClaudeCode({ force: true }));
    }
    const digestKeys = (settings) => `${Boolean(settings?.dailyDigest)}@${settings?.digestTime}`;
    if (digestKeys(changes.settings.oldValue) !== digestKeys(changes.settings.newValue)) scheduleDigest();
    if (changes.settings.oldValue?.resetAlertPercent !== changes.settings.newValue?.resetAlertPercent) {
      getAll({ logs: false }).then(({ latestSnapshot }) => latestSnapshot && scheduleResetCheck(latestSnapshot));
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
      chrome.contextMenus?.update("privacy", { checked }).catch(() => {});
    }
    // What the terminal shows follows privacy mode and the warning levels too.
    const planKeys = (settings) =>
      JSON.stringify([settings?.privacyMode, settings?.warnAt, settings?.dangerAt, settings?.statusFile !== false]);
    if (planKeys(changes.settings.oldValue) !== planKeys(changes.settings.newValue)) {
      // Connected, it hears at once; when polling, ask now rather than leave the file wrong until the next refresh.
      if (companionConnected()) tellCompanionPlan().then(() => tellCompanionWindow({ force: true }));
      else refreshClaudeCode({ force: true });
    }
    const toolbarKeys = ["iconStyle", "warnAt", "dangerAt", "severityColors", "privacyMode"];
    const pick = (settings) => JSON.stringify(toolbarKeys.map((key) => settings?.[key]));
    if (pick(changes.settings.oldValue) !== pick(changes.settings.newValue)) {
      getAll({ logs: false }).then(({ latestSnapshot }) => updateToolbar(latestSnapshot));
    }
  }
});
