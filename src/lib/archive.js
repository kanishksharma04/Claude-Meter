// The archive: every reading ever taken, kept in IndexedDB.
//
// chrome.storage holds what the extension works from day to day — the last
// 500 readings, eight weeks of hourly figures — and is rewritten whole on
// every change, which is why it is kept small. The archive is the long memory:
// one small record per reading, appended and never pruned, so the chart can go
// back months or years. A reading every five minutes is about a hundred
// thousand a year, roughly ten megabytes.
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

const DB_NAME = "claudemeter";
const DB_VERSION = 1;
const STORE = "readings";

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
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: ["o", "t"] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

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
  await withStore("readwrite", (store) => store.clear());
}
