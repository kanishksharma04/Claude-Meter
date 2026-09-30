// The weekly report: one week of usage boiled down to the figures worth
// reading — how high things got, how much was used and on which day, how often
// a limit ran out — with the week before alongside for comparison.
//
// A report week is seven calendar days, ending today for the current one, so
// its days line up with the ones you remember rather than with "168 hours ago".

import { lockoutsBetween } from "./lockout-stats.js";
import { weekdayIndex } from "./heatmap.js";

function startOfDay(epochMs) {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Midnight `days` calendar days from the day `epochMs` falls on — by the clock, so daylight saving can't skew it. */
function shiftDays(epochMs, days) {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** [from, to) of the report week `weeksAgo` weeks back; week 0 ends at the coming midnight. */
export function reportWeek(now = Date.now(), weeksAgo = 0) {
  const from = shiftDays(now, -6 - 7 * weeksAgo);
  return { from, to: shiftDays(from, 7) };
}

/** The figures for one span, without the comparison. */
function summarize({ usageLog, sessionWindows, limitHits, spikes, annotations }, { from, to }, now) {
  const records = (usageLog ?? []).filter((record) => record.t >= from && record.t < to);

  const days = Array.from({ length: 7 }, (_, index) => ({ dayStart: shiftDays(from, index), burn: 0, peak: null }));
  const hours = new Array(24).fill(0);
  const weekly = new Map(); // label -> { peak, end }
  let burn = 0;
  let elsewhere = 0;

  for (const record of records) {
    const used = (record.burn ?? 0) + (record.unseen ?? 0);
    const day = days.findLast((d) => d.dayStart <= record.t);
    day.burn += used;
    if (record.peak != null) day.peak = Math.max(day.peak ?? 0, record.peak);
    hours[new Date(record.t).getHours()] += record.burn ?? 0;
    burn += used;
    elsewhere += (record.away ?? 0) + (record.unseen ?? 0);
    for (const [label, { pct }] of Object.entries(record.weekly ?? {})) {
      weekly.set(label, { peak: Math.max(weekly.get(label)?.peak ?? 0, pct), end: pct });
    }
  }

  const windows = (sessionWindows ?? []).filter((w) => w.start >= from && w.start < to);
  const observed = days.filter((day) => day.dayStart <= now && records.some((r) => startOfDay(r.t) === day.dayStart));
  const fastest = [...days].sort((a, b) => b.burn - a.burn)[0];
  const busiestHour = hours.indexOf(Math.max(...hours));
  const lockouts = lockoutsBetween(limitHits, from, to, now);
  const peaks = days.map((day) => day.peak).filter((peak) => peak != null);

  return {
    from,
    to,
    days,
    daysObserved: observed.length,
    burn,
    // Per day actually on record, so a week ClaudeMeter only half saw isn't made to look quiet.
    averagePerDay: observed.length > 0 ? burn / observed.length : null,
    sessionPeak: peaks.length > 0 ? Math.max(...peaks) : null,
    windows: windows.length,
    averageWindowPeak:
      windows.length > 0 ? Math.round(windows.reduce((sum, w) => sum + w.peak, 0) / windows.length) : null,
    fullWindows: windows.filter((w) => w.peak >= 100).length,
    fastestDay: fastest.burn > 0 ? fastest : null,
    busiestHour: hours[busiestHour] > 0 ? busiestHour : null,
    weekly: [...weekly].map(([label, { peak, end }]) => ({ label, peak, end })),
    lockouts: { count: lockouts.count, blockedMs: lockouts.blockedMs },
    elsewhereShare: burn > 0 ? elsewhere / burn : null,
    spikes: (spikes ?? []).filter((spike) => spike.at >= from && spike.at < to),
    notes: (annotations ?? []).filter((note) => note.at >= from && note.at < to),
  };
}

/**
 * @param {object} state - what getAll() returns (lib/storage.js)
 * @param {object} [options]
 * @param {number} [options.weeksAgo] - 0 for the week ending today
 * @returns {object} the week's figures, plus `previous` (the week before, same shape minus its own `previous`)
 *   and `change` — this week's session points against last week's, as a fraction, or null when either is empty
 */
export function buildWeeklyReport(state, { now = Date.now(), weeksAgo = 0 } = {}) {
  const week = summarize(state, reportWeek(now, weeksAgo), now);
  const previous = summarize(state, reportWeek(now, weeksAgo + 1), now);
  return {
    ...week,
    weeksAgo,
    previous,
    change: week.burn > 0 && previous.burn > 0 ? (week.burn - previous.burn) / previous.burn : null,
  };
}

/** How many weeks back there is anything to report on (0 = only the current week). */
export function weeksOnRecord(usageLog, now = Date.now(), max = 7) {
  const first = usageLog?.[0]?.t;
  if (first == null) return 0;
  for (let weeksAgo = max; weeksAgo > 0; weeksAgo--) {
    if (first < reportWeek(now, weeksAgo).to) return weeksAgo;
  }
  return 0;
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function weekdayName(epochMs) {
  return WEEKDAY_NAMES[weekdayIndex(new Date(epochMs))];
}

/** A two-or-three sentence summary of the week, for the top of the report. */
export function describeWeek(report) {
  if (report.burn === 0 && report.sessionPeak == null) return "Nothing on record for this week.";

  const parts = [];
  if (report.fastestDay) {
    parts.push(
      `${weekdayName(report.fastestDay.dayStart)} was the fastest-burning day, using about ` +
        `${Math.round(report.fastestDay.burn)}% of a session's allowance in all.`
    );
  }
  if (report.change != null) {
    const percent = Math.round(Math.abs(report.change) * 100);
    parts.push(
      percent < 5
        ? "Overall usage was about the same as the week before."
        : `Overall usage was ${percent}% ${report.change > 0 ? "higher" : "lower"} than the week before.`
    );
  }
  parts.push(
    report.lockouts.count === 0
      ? "No limit ran out."
      : `A limit ran out ${{ 1: "once", 2: "twice" }[report.lockouts.count] ?? `${report.lockouts.count} times`}.`
  );
  return parts.join(" ");
}
