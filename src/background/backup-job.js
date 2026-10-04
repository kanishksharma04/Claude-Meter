// The scheduled backup: the whole history as one gzipped file in the
// Downloads folder (what goes in it is lib/backup.js's business).

import { getSettings, getOrgCache } from "../lib/storage.js";
import { readWholeArchive, readLogs } from "../lib/archive.js";
import {
  BACKUP_ALARM_NAME,
  LOG_KEYS,
  buildBackup,
  backupFilename,
  backupProblem,
  nextBackupAt,
  pruneBackups,
  logBackup,
  gzip,
  toDataUrl,
} from "../lib/backup.js";
import { LOG_PREFIX } from "./shared.js";

// ------------------------------------------------------------------ backup --
// The whole history as one gzipped file in the Downloads folder, on a schedule
// (lib/backup.js). Needs the "downloads" permission, which is asked for in
// Options when backups are switched on, so chrome.downloads may not be there.
const BACKUP_TIMEOUT_MS = 60_000;

let backupRunning = null;

/** Resolves when the browser has finished writing a download, or rejects with why it didn't. */
function downloadFinished(id) {
  return new Promise((resolve, reject) => {
    const settle = (error) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve();
    };
    const onChanged = (delta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === "complete") settle();
      else if (delta.state?.current === "interrupted") settle(new Error(delta.error?.current ?? "interrupted"));
    };
    const timer = setTimeout(() => settle(new Error("timed out")), BACKUP_TIMEOUT_MS);
    chrome.downloads.onChanged.addListener(onChanged);
    // A small file can be done before anyone is listening.
    chrome.downloads.search({ id }).then(([item]) => {
      if (item?.state === "complete") settle();
      else if (item?.state === "interrupted") settle(new Error(item.error ?? "interrupted"));
    });
  });
}

async function writeBackup() {
  const now = Date.now();
  try {
    if (!chrome.downloads) throw new Error("chrome.downloads is undefined");
    const { backupKeep } = await getSettings();
    const readings = await readWholeArchive();
    // The hourly log and the session windows are the main organisation's, read from the archive; the rest is in storage.
    const logsOrg = (await getOrgCache())?.orgId ?? "";
    const { usageLog, sessionWindows } = await readLogs(logsOrg, { recent: 0 });
    const logs = { ...(await chrome.storage.local.get(LOG_KEYS)), usageLog, sessionWindows };
    const backup = buildBackup({ now, extensionVersion: chrome.runtime.getManifest().version, readings, logs, logsOrg });
    const bytes = await gzip(JSON.stringify(backup));
    const filename = backupFilename(now);

    // An event page (Firefox) can hand the browser a blob; a service worker has to spell the file out in the address.
    const blobUrl = typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([bytes], { type: "application/gzip" })) : null;
    let id;
    try {
      id = await chrome.downloads.download({ url: blobUrl ?? toDataUrl(bytes), filename, conflictAction: "overwrite", saveAs: false });
      await downloadFinished(id);
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }

    const { backupLog } = await chrome.storage.local.get("backupLog");
    const { kept, removed } = pruneBackups(logBackup(backupLog, { id, filename, at: now }), backupKeep);
    for (const old of removed) {
      // Gone already, moved or renamed by the user: then it isn't ours to tidy.
      await chrome.downloads.removeFile(old.id).catch(() => {});
      await chrome.downloads.erase({ id: old.id }).catch(() => {});
    }
    await chrome.storage.local.set({ backupLog: kept, backupStatus: { ok: true, at: now, filename, bytes: bytes.length, readings: readings.length } });
    console.log(LOG_PREFIX, "backup written:", filename);
    return { ok: true, filename };
  } catch (err) {
    const problem = backupProblem(err?.message ?? err);
    console.warn(LOG_PREFIX, "backup failed:", err?.message ?? err);
    await chrome.storage.local.set({ backupStatus: { ok: false, at: now, problem } });
    return { ok: false, problem };
  } finally {
    await scheduleBackup();
  }
}

/** One at a time: the alarm and the "Back up now" button can land together. */
export function runBackup() {
  backupRunning ??= writeBackup().finally(() => (backupRunning = null));
  return backupRunning;
}

export async function scheduleBackup() {
  const { autoBackup } = await getSettings();
  const { backupStatus } = await chrome.storage.local.get("backupStatus");
  const when = nextBackupAt({ frequency: autoBackup, status: backupStatus });
  if (when == null) return chrome.alarms.clear(BACKUP_ALARM_NAME);
  // Overdue (never run, or the browser was closed when it fell due) means now, give or take a moment.
  chrome.alarms.create(BACKUP_ALARM_NAME, { when: Math.max(when, Date.now() + 2000) });
}
