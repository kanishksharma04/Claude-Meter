// Backups: the whole history as one file, written on a schedule.
//
// A browser profile is one disk failure, one "reset settings" or one
// uninstall away from gone, and the archive lives nowhere else. A backup is a
// gzipped JSON file in the Downloads folder (ClaudeMeter/…), one per day it
// runs, with older ones removed past a number the user sets.
//
//   Backup = {
//     format: "claudemeter-backup",
//     version: 1,
//     createdAt: number,
//     extensionVersion: string,
//     logsOrg: string | null,       // the organisation the usageLog and sessionWindows below belong to
//     readings: Array<Record>,      // the archive (lib/archive.js), every organisation
//     logs: {                       // what storage holds besides: eight weeks of hours, windows, events
//       usageLog, sessionWindows, limitHits, spikes, extraUsageLog, messageLog, annotations
//     },
//   }
//
// History only — no settings, so no keys or webhook addresses. It does carry
// the user's chart notes and, in the message log, chat titles: it is their
// file, on their disk.

const DAY_MS = 24 * 60 * 60 * 1000;

export const BACKUP_FORMAT = "claudemeter-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_FOLDER = "ClaudeMeter";
export const BACKUP_ALARM_NAME = "claudemeter-backup";

/** What storage holds that is history and not a reading. */
export const LOG_KEYS = ["usageLog", "sessionWindows", "limitHits", "spikes", "extraUsageLog", "messageLog", "annotations"];

export const FREQUENCIES = { off: 0, daily: DAY_MS, weekly: 7 * DAY_MS };
export const KEEP_OPTIONS = [4, 8, 30, 0]; // 0 = every one
export const DEFAULT_KEEP = 8;

/** A failed backup is tried again this much later, not at the next day or week. */
export const RETRY_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------- content --

export function buildBackup({ now = Date.now(), extensionVersion = "", readings = [], logs = {}, logsOrg = null }) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now,
    extensionVersion,
    // Whose hourly log and session windows these are: the organisation that was the main one.
    // (Readings say so themselves; a backup from before the archive held these doesn't.)
    logsOrg,
    readings,
    logs: Object.fromEntries(LOG_KEYS.map((key) => [key, Array.isArray(logs[key]) ? logs[key] : []])),
  };
}

/** "ClaudeMeter/claudemeter-backup-2026-10-03.json.gz" — by local date, so a day's second backup replaces its first. */
export function backupFilename(now = Date.now()) {
  const date = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `${BACKUP_FOLDER}/claudemeter-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json.gz`;
}

/**
 * Is this parsed file a backup this version can read?
 * @returns {{ ok: true, backup: object } | { ok: false, problem: string }}
 */
export function checkBackup(parsed) {
  if (!parsed || typeof parsed !== "object" || parsed.format !== BACKUP_FORMAT) return { ok: false, problem: "That isn't a ClaudeMeter backup." };
  if (!(parsed.version <= BACKUP_VERSION)) return { ok: false, problem: "That backup was made by a newer version of ClaudeMeter. Update the extension, then restore it." };
  if (!Array.isArray(parsed.readings)) return { ok: false, problem: "That backup is damaged: it has no list of readings." };
  return { ok: true, backup: { ...parsed, logs: buildBackup({ logs: parsed.logs ?? {} }).logs } };
}

/**
 * The organisation a backup's hourly log and session windows should be filed
 * under: the one it names; failing that the main one here; failing that the
 * one most of its readings are for (a new profile, not yet signed in).
 */
export function logsOrgOf(backup, currentOrgId = null) {
  if (typeof backup?.logsOrg === "string") return backup.logsOrg;
  if (currentOrgId) return currentOrgId;
  const counts = new Map();
  for (const record of backup?.readings ?? []) counts.set(record.o, (counts.get(record.o) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/**
 * What to put back into storage from a backup's logs. The archive merges by
 * itself (a reading is a reading); these don't, so each is restored only where
 * this browser has none of its own — a new profile — except notes, which are
 * the user's and are merged by id.
 *
 * @param {object} current - what storage holds now, by LOG_KEYS
 * @returns {object} the keys to write
 */
export function logsToRestore(current, logs) {
  const out = {};
  for (const key of LOG_KEYS) {
    const mine = Array.isArray(current?.[key]) ? current[key] : [];
    const theirs = Array.isArray(logs?.[key]) ? logs[key] : [];
    if (key === "annotations") {
      const known = new Set(mine.map((note) => note.id));
      const added = theirs.filter((note) => note?.id && typeof note.text === "string" && !known.has(note.id));
      if (added.length > 0) out[key] = [...mine, ...added].sort((a, b) => a.at - b.at);
    } else if (mine.length === 0 && theirs.length > 0) out[key] = theirs;
  }
  return out;
}

// --------------------------------------------------------------- schedule --

/**
 * When the next backup is due: one interval after the last that worked, an
 * hour after one that didn't, and straight away when there has never been one.
 * @returns {number | null} epoch ms, or null when backups are off
 */
export function nextBackupAt({ frequency, status, now = Date.now() }) {
  const every = FREQUENCIES[frequency] ?? 0;
  if (!every) return null;
  if (!status?.at) return now;
  if (!status.ok) return Math.max(now, status.at + RETRY_MS);
  return Math.max(now, status.at + every);
}

/**
 * Which earlier backups to delete so that only the newest `keep` remain.
 * @param {Array<{ id: number, filename: string, at: number }>} log - oldest first
 * @returns {{ kept: Array<object>, removed: Array<object> }}
 */
export function pruneBackups(log, keep) {
  const entries = [...(log ?? [])].sort((a, b) => a.at - b.at);
  if (!keep || entries.length <= keep) return { kept: entries, removed: [] };
  return { kept: entries.slice(-keep), removed: entries.slice(0, -keep) };
}

/** The log with one more backup in it. A file written twice in a day is one entry: the later download replaced the earlier. */
export function logBackup(log, entry) {
  return [...(log ?? []).filter((earlier) => earlier.filename !== entry.filename), entry];
}

// ------------------------------------------------------------------ bytes --

export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** A backup file's text, whether it is still gzipped or someone has unpacked it. */
export async function readBackupFile(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const gzipped = data[0] === 0x1f && data[1] === 0x8b;
  return JSON.parse(gzipped ? await gunzip(data) : new TextDecoder().decode(data));
}

/** For a service worker, which can't make a blob: URL, a data: URL does the same job. */
export function toDataUrl(bytes, type = "application/gzip") {
  let binary = "";
  // In pieces: String.fromCharCode can't take a million arguments at once.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

// ------------------------------------------------------------------ words --

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What went wrong, from what the downloads API said. */
export function backupProblem(reason) {
  const text = String(reason ?? "");
  if (/permission|not allowed|downloads is undefined|No downloads/i.test(text)) return "The browser hasn't allowed ClaudeMeter to save files. Turn backups off and on again to be asked.";
  if (/USER_CANCELED/i.test(text)) return "The save was cancelled. If the browser asks where to save every file, it asks for backups too.";
  if (/FILE_(NO_SPACE|TOO_LARGE)/i.test(text)) return "There wasn't room on the disk for the backup.";
  if (/FILE_ACCESS_DENIED|FILE_FAILED|FILE_BLOCKED/i.test(text)) return "The browser couldn't write to the Downloads folder.";
  if (/timed out/i.test(text)) return "The browser didn't finish saving the file. It may be waiting for you to choose where to put it.";
  return `The backup couldn't be saved: ${text || "no reason given"}.`;
}

/** One line under the setting: how the last backup went. */
export function describeBackup(status, locale = []) {
  if (!status?.at) return "No backup yet.";
  const when = new Date(status.at).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  if (!status.ok) return `Last attempt, ${when}, failed. ${status.problem ?? ""}`.trim();
  const name = String(status.filename ?? "").split("/").pop();
  return `Last backup: ${when} — ${status.readings.toLocaleString(locale)} reading${status.readings === 1 ? "" : "s"}, ${formatSize(status.bytes)}, saved as ${name} in Downloads/${BACKUP_FOLDER}.`;
}
