// Options > Data: how much the archive holds, automatic backups and restoring one,
// clearing what has been stored, and putting everything back as a new install has it.

import { WEBHOOK_ORIGINS } from "../lib/webhooks.js";
import { getAll, setSettings, clearAllData, resetEverything, getOrgCache, restoreLogs } from "../lib/storage.js";
import { archiveInfo, clearArchive, describeArchive, restoreRecords } from "../lib/archive.js";
import { describeBackup, readBackupFile, checkBackup, logsOrgOf, FREQUENCIES, DEFAULT_KEEP } from "../lib/backup.js";
import { API_ORIGIN, renderApiSpend } from "./api-spend.js";
import { BROWSER } from "./claude-code.js";

const clearDataBtn = document.getElementById("clearDataBtn");

/** How much the archive holds for the main organisation, and since when. */
async function renderArchiveInfo() {
  const archiveInfoEl = document.getElementById("archiveInfo");
  try {
    // Asked of storage directly: demo mode never touches the archive, so this is the real one either way.
    // Before the main organisation is known (a fresh profile, or just cleared), count whatever is there.
    archiveInfoEl.textContent = describeArchive(await archiveInfo((await getOrgCache())?.orgId ?? null));
  } catch {
    archiveInfoEl.textContent = "Not available in this window.";
  }
}

renderArchiveInfo();

// ------------------------------------------------------------------ backup --
// The service worker writes the files (lib/backup.js); this is the switch, the
// permission it needs, and the way back in.
const autoBackupSelect = document.getElementById("autoBackupSelect");

const backupKeepSelect = document.getElementById("backupKeepSelect");

const backupInfo = document.getElementById("backupInfo");

const backupNowBtn = document.getElementById("backupNowBtn");

const restoreInfo = document.getElementById("restoreInfo");

const DOWNLOADS = { permissions: ["downloads"] };

export async function renderBackup() {
  const { settings, backupStatus } = await getAll({ logs: false });
  // Safari has no downloads API: nothing to schedule, though a backup made elsewhere can still be restored.
  document.getElementById("backupControls").hidden = backupNowBtn.hidden = BROWSER === "safari";
  autoBackupSelect.value = settings.autoBackup in FREQUENCIES ? settings.autoBackup : "off";
  backupKeepSelect.value = String([...backupKeepSelect.options].some((option) => Number(option.value) === settings.backupKeep) ? settings.backupKeep : DEFAULT_KEEP);
  backupKeepSelect.disabled = settings.autoBackup === "off";
  backupInfo.classList.toggle("problem", backupStatus?.ok === false);
  backupInfo.textContent = settings.autoBackup === "off" && !backupStatus ? "" : describeBackup(backupStatus);
}

/** Must be called straight from a click or a change: the browser only asks while the user's hand is still on it. */
const allowDownloads = () => chrome.permissions.request(DOWNLOADS).catch(() => false);

autoBackupSelect.addEventListener("change", async () => {
  const frequency = autoBackupSelect.value;
  if (frequency !== "off" && !(await allowDownloads())) {
    autoBackupSelect.value = "off";
    backupInfo.classList.add("problem");
    backupInfo.textContent = "Backups need the browser's permission to save files, and it wasn't given.";
    return;
  }
  await setSettings({ autoBackup: frequency });
  // Nothing saves files any more: hand the permission back, as the webhooks do with theirs.
  if (frequency === "off") chrome.permissions.remove(DOWNLOADS).catch(() => {});
  // A first backup follows within moments of switching on; the line above updates when it lands.
  if (frequency !== "off" && !(await getAll({ logs: false })).backupStatus) backupInfo.textContent = "Making the first backup…";
});

backupKeepSelect.addEventListener("change", () => setSettings({ backupKeep: Number(backupKeepSelect.value) }));

backupNowBtn.addEventListener("click", async () => {
  if (!(await allowDownloads())) {
    backupInfo.classList.add("problem");
    backupInfo.textContent = "Backups need the browser's permission to save files, and it wasn't given.";
    return;
  }
  backupNowBtn.disabled = true;
  backupInfo.classList.remove("problem");
  backupInfo.textContent = "Backing up…";
  await chrome.runtime.sendMessage({ type: "CLAUDEMETER_BACKUP_NOW" }).catch(() => null);
  backupNowBtn.disabled = false;
  renderBackup();
});

const restoreBtn = document.getElementById("restoreBtn");

restoreBtn.addEventListener("click", () => document.getElementById("restoreFile").click());

document.getElementById("restoreFile").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  event.target.value = ""; // so picking the same file again is still a change
  if (!file) return;
  restoreBtn.disabled = true; // one at a time: a big file takes a few seconds
  restoreInfo.hidden = false;
  restoreInfo.classList.remove("problem");
  restoreInfo.textContent = "Reading the backup…";
  try {
    const checked = checkBackup(await readBackupFile(await file.arrayBuffer()));
    if (!checked.ok) throw new Error(checked.problem);
    const readings = await restoreRecords(checked.backup.readings);
    const logs = await restoreLogs(checked.backup.logs, logsOrgOf(checked.backup, (await getOrgCache())?.orgId));
    const made = new Date(checked.backup.createdAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
    restoreInfo.textContent =
      `Restored the backup of ${made}: ${readings.toLocaleString()} reading${readings === 1 ? "" : "s"} merged into the archive` +
      (logs.length > 0 ? `, and ${logs.length} of the logs this browser had none of.` : ". The logs this browser already has were left as they are.");
    renderArchiveInfo();
  } catch (error) {
    restoreInfo.classList.add("problem");
    restoreInfo.textContent = error instanceof SyntaxError || error?.name === "TypeError" ? "That file couldn't be read as a backup." : (error?.message ?? "That file couldn't be read as a backup.");
  }
  restoreBtn.disabled = false;
});

renderBackup();

clearDataBtn.addEventListener("click", async () => {
  if (!confirm("Clear all stored ClaudeMeter data (captures + usage snapshot + history + the long-term archive + hourly usage log + session windows + chart notes + spikes + extra-usage record + message costs + limit-hit log + the Admin API key)? Your settings stay.")) return;
  await clearAllData();
  await clearArchive().catch(() => {});
  // The key went with the data, so the panel it fed is switched off and its site given back.
  await setSettings({ apiSpend: false });
  chrome.permissions.remove({ origins: [API_ORIGIN] }).catch(() => {});
  renderApiSpend();
  renderArchiveInfo();
  clearDataBtn.textContent = "Cleared!";
  document.getElementById("clearStatus").textContent = "Stored data cleared.";
  setTimeout(() => (clearDataBtn.textContent = "Clear stored data"), 1200);
});

document.getElementById("resetAllBtn").addEventListener("click", async () => {
  if (!confirm("Reset ClaudeMeter completely? Every reading, log, key and webhook address is removed and every setting goes back to its default, as on a new install. Backup files already in Downloads are left alone. This can't be undone.")) return;
  await resetEverything();
  await clearArchive().catch(() => {});
  // One at a time: asking for several at once fails as a whole if any one of them was never granted.
  for (const origin of [...WEBHOOK_ORIGINS, API_ORIGIN]) await chrome.permissions.remove({ origins: [origin] }).catch(() => {});
  await chrome.permissions.remove(DOWNLOADS).catch(() => {});
  // A first reading for the clean slate, then the page as a new install would show it.
  await chrome.runtime.sendMessage({ type: "CLAUDEMETER_REFRESH" }).catch(() => null);
  location.reload();
});
