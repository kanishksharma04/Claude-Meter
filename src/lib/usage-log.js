// The long-term record behind the analytics: one small entry per clock hour,
// kept for eight weeks. The snapshot history (lib/storage.js) holds every
// reading but only about a day of them; this keeps far less per hour — how much
// was used and where each limit stood — so it can reach back far enough to show
// habits.
//
//   HourRecord = {
//     t: number,             // epoch ms of the start of the (local) hour
//     n: number,             // readings folded into it
//     peak: number | null,   // highest session % seen during the hour
//     burn: number,          // session %-points used during the hour
//     weekly: { [label]: { pct: number, burn: number } },  // level at the last reading, points used
//     away?: number,         // the part of `burn` that rose while this browser was idle (lib/attribution.js)
//     unseen?: number,       // session points that built up across a gap in the readings — not in `burn`
//   }

const HOUR_MS = 60 * 60 * 1000;

export const MAX_LOG_HOURS = 8 * 7 * 24;

/**
 * Two readings further apart than this (browser closed, laptop asleep) say how
 * much was used in between but not when, so that usage isn't pinned on an hour.
 */
export const MAX_READING_GAP_MS = 90 * 60 * 1000;

const SESSION_RESET_TOLERANCE_MS = 5 * 60 * 1000;
const WEEKLY_RESET_TOLERANCE_MS = HOUR_MS;

/** Start of the local clock hour containing `epochMs` — not every time zone is a whole hour from UTC. */
export function hourStart(epochMs) {
  const date = new Date(epochMs);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

/**
 * %-points a bucket used between two readings. When its window rolled over in
 * between (a later reset time, or a lower reading), everything in the new
 * window was used since.
 */
export function pointsUsed(before, after, toleranceMs = SESSION_RESET_TOLERANCE_MS) {
  if (!before || !after) return 0;
  const rolled =
    after.percentUsed < before.percentUsed ||
    (before.resetsAt != null && after.resetsAt != null && after.resetsAt - before.resetsAt > toleranceMs);
  return rolled ? after.percentUsed : after.percentUsed - before.percentUsed;
}

/**
 * Folds one reading into the log and returns the new log.
 * @param {Array<object>} log - HourRecords, oldest first
 * @param {import("./types").UsageSnapshot | null} previous - the reading before this one, if any
 * @param {import("./types").UsageSnapshot} snapshot
 */
export function foldSnapshot(log, previous, snapshot, max = MAX_LOG_HOURS) {
  const records = [...(log ?? [])];
  if (!snapshot?.fetchedAt) return records;

  const t = hourStart(snapshot.fetchedAt);
  const last = records.at(-1);
  if (last && t < last.t) return records; // the clock went backwards; leave what's there alone

  const gap = previous ? snapshot.fetchedAt - previous.fetchedAt : Infinity;
  const baseline = gap >= 0 && gap <= MAX_READING_GAP_MS ? previous : null;

  const record = last?.t === t ? { ...records.pop(), weekly: { ...last.weekly } } : { t, n: 0, peak: null, burn: 0, weekly: {} };
  record.n += 1;

  if (snapshot.session) {
    record.peak = Math.max(record.peak ?? 0, snapshot.session.percentUsed);
    record.burn += pointsUsed(baseline?.session, snapshot.session);
  }
  // The reading says how much of its rise happened elsewhere; with no baseline that rise isn't in `burn` at all.
  if (snapshot.elsewhere > 0) {
    const field = baseline ? "away" : "unseen";
    record[field] = (record[field] ?? 0) + snapshot.elsewhere;
  }

  for (const bucket of snapshot.weekly ?? []) {
    const before = (baseline?.weekly ?? []).find((b) => b.label === bucket.label);
    record.weekly[bucket.label] = {
      pct: bucket.percentUsed,
      burn: (record.weekly[bucket.label]?.burn ?? 0) + pointsUsed(before, bucket, WEEKLY_RESET_TOLERANCE_MS),
    };
  }

  records.push(record);
  return records.slice(-max);
}

/** Builds a log from scratch out of a run of readings — used once, to seed it from the existing history. */
export function buildUsageLog(history) {
  let log = [];
  let previous = null;
  for (const snapshot of history ?? []) {
    log = foldSnapshot(log, previous, snapshot);
    previous = snapshot;
  }
  return log;
}
