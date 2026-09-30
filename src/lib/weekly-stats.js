// Week-by-week summaries of the hourly usage log (lib/usage-log.js): how much
// was used and how high each limit got. "Weeks" are back-to-back 7-day spans
// ending now, newest first — the same spans lib/lockout-stats.js counts in.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {Array<object>} usageLog - HourRecords, oldest first
 * @returns {Array<{ from: number, to: number, days: number, hours: number, burn: number,
 *   sessionPeak: number | null, weeklyPeaks: Record<string, number>, weeklyPeak: number | null }>}
 *   `days` and `hours` say how much of the week ClaudeMeter actually saw;
 *   `burn` is session %-points used; `weeklyPeak` is the fullest any weekly limit got.
 */
export function summarizeWeeks(usageLog, { now = Date.now(), weeks = 4 } = {}) {
  return Array.from({ length: weeks }, (_, index) => {
    const from = now - (index + 1) * WEEK_MS;
    const to = now - index * WEEK_MS;
    const records = (usageLog ?? []).filter((record) => record.t > from && record.t <= to);

    const weeklyPeaks = {};
    for (const record of records) {
      for (const [label, { pct }] of Object.entries(record.weekly ?? {})) {
        weeklyPeaks[label] = Math.max(weeklyPeaks[label] ?? 0, pct);
      }
    }
    const peaks = records.map((record) => record.peak).filter((peak) => peak != null);
    const levels = Object.values(weeklyPeaks);

    return {
      from,
      to,
      days: new Set(records.map((record) => new Date(record.t).toDateString())).size,
      hours: records.length,
      burn: records.reduce((sum, record) => sum + (record.burn ?? 0), 0),
      sessionPeak: peaks.length > 0 ? Math.max(...peaks) : null,
      weeklyPeaks,
      weeklyPeak: levels.length > 0 ? Math.max(...levels) : null,
    };
  });
}
