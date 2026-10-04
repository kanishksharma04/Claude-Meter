// The archive: every reading ever taken, kept in IndexedDB — and, beside it,
// the two records worked out from the readings as they arrive.
//
// chrome.storage rewrites a key whole on every change and hands the old and
// new values to every page that is listening, so it is kept for what is small
// and wanted everywhere: the latest reading, the settings. What grows lives
// here instead, a record at a time, in three stores of one database:
//
//   readings  one small record per reading, appended and never pruned, so the
//             chart can go back months or years. A reading every five minutes
//             is about a hundred thousand a year, roughly ten megabytes. The
//             most recent few hundred of these are "the history".
//   hours     the hourly usage log (lib/usage-log.js), eight weeks deep
//   windows   the 5-hour session windows (lib/session-windows.js), eight weeks deep
//
// A new reading touches one record in each: it is added to `readings`, and
// the current hour and the current window are folded and written back.
//
// Records are compact, and filed by organisation so that switching the main
// one never mixes two histories:
//
//   Record = {
//     o: string,                 // organisation id ("" when unknown)
//     t: number,                 // epoch ms the reading was taken
//     s: number | null,          // session %
//     sr: number | null,         // when the session resets
//     w: Array<[string, number, number | null]>,   // weekly limits: [label, %, resets at]
//     e?: number,                // session points that rose elsewhere (lib/attribution.js)
//     h?: 1,                     // not a reading but an hour from the usage log (see seedRecords)
//   }

import { foldSnapshot } from "./usage-log.js";
import { foldWindow } from "./session-windows.js";

const DB_NAME = "claudemeter";
const DB_VERSION = 2; // 1: readings. 2: hours and windows, moved here from chrome.storage
const STORE = "readings";
const HOURS = "hours";
const WINDOWS = "windows";

/** How far back the hourly log and the list of session windows are kept. */
export const LOG_DEPTH_MS = 8 * 7 * 24 * 60 * 60 * 1000;
/** How many of the latest readings count as "the history" the day chart and the comparisons work from. */
export const RECENT_READINGS = 500;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A chart is a few hundred pixels wide: more points than this only cost time. */
export const MAX_CHART_POINTS = 600;

/** The chart's longer ranges, the ones drawn from the archive. `null` is everything there is. */
export const ARCHIVE_RANGES = { month: 30 * DAY_MS, year: 365 * DAY_MS, all: null };

// ------------------------------------------------------------------ pure --

/** One snapshot as an archive record. */
export function toRecord(snapshot, orgId = "") {
  const record = {
    o: orgId ?? "",
    t: snapshot.fetchedAt,
    s: snapshot.session?.percentUsed ?? null,
    sr: snapshot.session?.resetsAt ?? null,
    w: (snapshot.weekly ?? []).map((bucket) => [bucket.label, bucket.percentUsed, bucket.resetsAt ?? null]),
  };
  if (snapshot.elsewhere > 0) record.e = snapshot.elsewhere;
  return record;
}

/**
 * An archive record as the snapshot it was made from — as much of it as was
 * kept. The plan badge and the extra-usage block aren't, and aren't needed:
 * this is for the chart and for comparing one reading with the next.
 */
export function fromRecord(record) {
  const snapshot = {
    fetchedAt: record.t,
    session: record.s != null ? { label: "Current session", percentUsed: record.s, resetsAt: record.sr ?? null } : null,
    weekly: (record.w ?? []).map(([label, percentUsed, resetsAt]) => ({ label, percentUsed, resetsAt: resetsAt ?? null })),
  };
  if (record.e > 0) snapshot.elsewhere = record.e;
  return snapshot;
}

/** A record that is a real reading: taken, not filled in from the hourly log, and with a limit in it. */
function isReading(record) {
  return !record.h && (record.s != null || (record.w ?? []).length > 0);
}

/**
 * What to put in an empty archive so the chart doesn't start from nothing: the
 * readings still in storage, and before the first of those, the hourly usage
 * log — coarser (one record an hour, the session's peak in it) but weeks deep.
 *
 * @param {{ history?: object[], usageLog?: object[] }} stored
 */
export function seedRecords({ history = [], usageLog = [] }, orgId = "") {
  const readings = (history ?? []).filter((snapshot) => snapshot?.fetchedAt).map((snapshot) => toRecord(snapshot, orgId));
  const firstReading = readings[0]?.t ?? Infinity;
  const hours = (usageLog ?? [])
    .filter((record) => record.t + HOUR_MS <= firstReading)
    .map((record) => ({
      o: orgId ?? "",
      t: record.t + HOUR_MS, // where things stood at the end of the hour
      s: record.peak ?? null,
      sr: null,
      w: Object.entries(record.weekly ?? {}).map(([label, { pct }]) => [label, pct, null]),
      h: 1,
    }));
  return [...hours, ...readings];
}

/**
 * Chart series from archive records: the same shape lib/history-chart.js
 * produces, thinned to at most `maxPoints` per line. Each stretch of time
 * becomes one point — the session's peak in it, and where each weekly limit
 * stood at its end — so a spike survives the thinning.
 *
 * @param {Array<object>} records - oldest first
 * @returns {{ from: number, to: number, stepMs: number, series: Array<{ id: string, label: string, latest: number, points: Array<{ t: number, pct: number }> }> }}
 *   `from` is the first reading plotted; `stepMs` the stretch one point stands for; `latest` where the
 *   series stood at its last reading, which for the session need not be its last point (a peak)
 */
export function archiveSeries(records, { from, to, maxPoints = MAX_CHART_POINTS }) {
  const inRange = (records ?? []).filter((record) => record.t >= from && record.t <= to);
  const start = inRange[0]?.t ?? from;
  const stepMs = Math.max(1, Math.ceil((to - start + 1) / maxPoints)); // +1: the last reading belongs to the last stretch, not a new one
  const byId = new Map();
  const point = (id, label, slot, pct, keep) => {
    if (typeof pct !== "number") return;
    if (!byId.has(id)) byId.set(id, { id, label, slots: new Map() });
    byId.get(id).latest = pct;
    const slots = byId.get(id).slots;
    slots.set(slot, slots.has(slot) ? keep(slots.get(slot), pct) : pct);
  };

  for (const record of inRange) {
    const slot = Math.floor((record.t - start) / stepMs);
    point("session", "Session", slot, record.s, Math.max);
    for (const [label, pct] of record.w ?? []) point(`weekly:${label}`, `${label} (weekly)`, slot, pct, (_, latest) => latest);
  }

  return {
    from: start,
    to,
    stepMs,
    series: [...byId.values()].map(({ id, label, latest, slots }) => ({
      id,
      label,
      latest,
      // A point sits at the end of the stretch it sums up, like the hourly series does.
      points: [...slots].sort((a, b) => a[0] - b[0]).map(([slot, pct]) => ({ t: Math.min(start + (slot + 1) * stepMs, to), pct })),
    })),
  };
}

/** "12,480 readings since 3 Jul 2026", or what to say when there are none. */
export function describeArchive({ count, first }, locale = []) {
  if (!count) return "Nothing archived yet.";
  const since = new Date(first).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return `${count.toLocaleString(locale)} reading${count === 1 ? "" : "s"} since ${since}`;
}

// ------------------------------------------------------------- IndexedDB --

let opening = null;

/** Opens the database, creating it the first time. One connection is shared by everything on the page. */
function open() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: ["o", "t"] });
      if (!db.objectStoreNames.contains(HOURS)) db.createObjectStore(HOURS, { keyPath: ["o", "t"] });
      if (!db.objectStoreNames.contains(WINDOWS)) db.createObjectStore(WINDOWS, { keyPath: ["o", "start"] });
    };
    request.onsuccess = () => {
      // Another page opening a newer version must not be kept waiting by this one's connection.
      request.result.onversionchange = () => {
        request.result.close();
        opening = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      opening = null; // so the next call tries again
      reject(request.error);
    };
  });
  return opening;
}

/** Runs `work` against several stores in one transaction and resolves, once it has committed, to what `work` returned. */
async function withStores(names, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
    result = work(...names.map((name) => transaction.objectStore(name)));
  });
}

const ofOrg = (orgId, from = 0, to = Number.MAX_SAFE_INTEGER) => IDBKeyRange.bound([orgId ?? "", from], [orgId ?? "", to]);
const withoutOrg = ({ o, ...rest }) => rest;

/** Runs `work` against the store in one transaction and resolves when it has committed. */
async function withStore(mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
    result = work(transaction.objectStore(STORE));
  });
}

const settled = (request) => new Promise((resolve, reject) => ((request.onsuccess = () => resolve(request.result)), (request.onerror = () => reject(request.error))));

/** Adds readings. One already there (same organisation, same moment) is replaced, so seeding twice does no harm. */
export async function archiveReadings(snapshots, orgId = "") {
  const records = (snapshots ?? []).filter((snapshot) => snapshot?.fetchedAt).map((snapshot) => toRecord(snapshot, orgId));
  if (records.length > 0) await withStore("readwrite", (store) => records.forEach((record) => store.put(record)));
  return records.length;
}

/** Puts records back as they are — for restoring a backup. */
export async function restoreRecords(records) {
  const valid = (records ?? []).filter((record) => typeof record?.t === "number" && typeof record.o === "string" && Array.isArray(record.w));
  if (valid.length > 0) await withStore("readwrite", (store) => valid.forEach((record) => store.put(record)));
  return valid.length;
}

/** One organisation's records between two moments, oldest first. */
export async function readArchive(orgId = "", from = 0, to = Date.now()) {
  let request;
  await withStore("readonly", (store) => (request = store.getAll(IDBKeyRange.bound([orgId ?? "", from], [orgId ?? "", to]))));
  return request.result;
}

/** Everything, for every organisation — for a backup. */
export async function readWholeArchive() {
  let request;
  await withStore("readonly", (store) => (request = store.getAll()));
  return request.result;
}

/**
 * How much one organisation has archived, and since when — or, with `null`
 * (the main organisation isn't known yet), how much there is altogether.
 */
export async function archiveInfo(orgId = "") {
  if (orgId == null) return wholeArchiveInfo();
  const range = IDBKeyRange.bound([orgId, 0], [orgId, Number.MAX_SAFE_INTEGER]);
  let count;
  let first;
  await withStore("readonly", (store) => {
    count = store.count(range);
    first = store.openKeyCursor(range); // keys come in order: the first is the oldest
  });
  return { count: count.result, first: first.result?.key[1] ?? null };
}

async function wholeArchiveInfo() {
  let count;
  let first = null;
  await withStore("readonly", (store) => {
    count = store.count();
    // Keys are sorted by organisation, then time: hop from each organisation's oldest to the next one's.
    const cursor = store.openKeyCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      const [org, t] = cursor.result.key;
      first = first == null ? t : Math.min(first, t);
      cursor.result.continue([org, Number.MAX_SAFE_INTEGER]);
    };
  });
  return { count: count.result, first };
}

export async function clearArchive() {
  await withStores([STORE, HOURS, WINDOWS], "readwrite", (...stores) => stores.forEach((store) => store.clear()));
}

// --------------------------------------------------- the working records --

/**
 * Files one new reading: adds it to the readings, and folds it into the hour
 * and the session window it falls in. One transaction, so the three agree.
 *
 * @param {object} snapshot - the reading
 * @param {object | null} previous - the reading before it, which says how much was used in between
 */
export async function fileReading(snapshot, previous, orgId = "") {
  if (!snapshot?.fetchedAt) return;
  const org = orgId ?? "";
  await withStores([STORE, HOURS, WINDOWS], "readwrite", (readings, hours, windows) => {
    readings.put(toRecord(snapshot, org));

    const lastHour = hours.openCursor(ofOrg(org), "prev");
    lastHour.onsuccess = () => {
      const last = lastHour.result?.value;
      const folded = foldSnapshot(last ? [withoutOrg(last)] : [], previous, snapshot).at(-1);
      if (!folded) return;
      hours.put({ o: org, ...folded });
      // Once an hour, when a new record is begun, the ones past the depth are let go.
      if (folded.t !== last?.t) hours.delete(ofOrg(org, 0, snapshot.fetchedAt - LOG_DEPTH_MS));
    };

    const lastWindow = windows.openCursor(ofOrg(org), "prev");
    lastWindow.onsuccess = () => {
      const last = lastWindow.result?.value;
      const folded = foldWindow(last ? [withoutOrg(last)] : [], snapshot).at(-1);
      if (!folded) return;
      windows.put({ o: org, ...folded });
      if (folded.start !== last?.start) windows.delete(ofOrg(org, 0, snapshot.fetchedAt - LOG_DEPTH_MS));
    };
  });
}

/**
 * One organisation's working records: its latest readings as snapshots ("the
 * history"), its hourly log and its session windows, each oldest first.
 * @returns {Promise<{ history: object[], usageLog: object[], sessionWindows: object[] }>}
 */
export async function readLogs(orgId = "", { recent = RECENT_READINGS } = {}) {
  const org = orgId ?? "";
  const history = [];
  let hours;
  let windows;
  await withStores([STORE, HOURS, WINDOWS], "readonly", (readings, hourStore, windowStore) => {
    // Newest first, and only as many as are wanted: the store may hold years.
    const cursor = readings.openCursor(ofOrg(org), "prev");
    cursor.onsuccess = () => {
      if (!cursor.result || history.length >= recent) return;
      if (isReading(cursor.result.value)) history.push(fromRecord(cursor.result.value));
      cursor.result.continue();
    };
    hours = hourStore.getAll(ofOrg(org));
    windows = windowStore.getAll(ofOrg(org));
  });
  return { history: history.reverse(), usageLog: hours.result.map(withoutOrg), sessionWindows: windows.result.map(withoutOrg) };
}

/** The readings of a stretch of time, as snapshots, oldest first — for the comparisons that only look back a little. */
export async function readReadings(orgId = "", from = 0, to = Date.now()) {
  return (await readArchive(orgId, from, to)).filter(isReading).map(fromRecord);
}

/** Puts hour records and session windows in for an organisation, as they are — for a restore, or the move out of chrome.storage. */
export async function putLogs(orgId = "", { usageLog = [], sessionWindows = [] } = {}) {
  const org = orgId ?? "";
  const hours = (usageLog ?? []).filter((record) => typeof record?.t === "number");
  const windows = (sessionWindows ?? []).filter((window) => typeof window?.start === "number");
  if (hours.length + windows.length === 0) return;
  await withStores([HOURS, WINDOWS], "readwrite", (hourStore, windowStore) => {
    for (const record of hours) hourStore.put({ ...record, o: org });
    for (const window of windows) windowStore.put({ ...window, o: org });
  });
}

/** How many hour records and session windows there are, for every organisation together — for the health page. */
export async function logCounts() {
  let hours;
  let windows;
  await withStores([HOURS, WINDOWS], "readonly", (hourStore, windowStore) => {
    hours = hourStore.count();
    windows = windowStore.count();
  });
  return { hours: hours.result, windows: windows.result };
}
