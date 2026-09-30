// Weekly budget planner: what is left of a weekly limit, spread evenly over the
// days until it resets, set against what today has used so far.
//
// The daily figure is worked out from where the limit stood at the start of
// today (local midnight), so it holds still through the day instead of
// shrinking with every message — "12% a day; 9% used today" stays comparable.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function startOfDay(epochMs) {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Where a weekly limit stood when today began, from the hourly usage log:
 * the last level recorded before midnight, else the level just before today's
 * first reading. null when the log can't say.
 */
function levelAtStartOfDay(label, usageLog, dayStart, windowStart) {
  let level = null;
  for (const record of usageLog ?? []) {
    const entry = record.weekly?.[label];
    if (!entry || record.t + HOUR_MS <= windowStart) continue; // belongs to the previous weekly window
    if (record.t < dayStart) {
      level = entry.pct;
    } else {
      return level ?? Math.max(0, entry.pct - entry.burn);
    }
  }
  return level;
}

/**
 * @param {{ label: string, percentUsed: number, resetsAt: number | null }} bucket - a weekly bucket
 * @param {Array<object>} usageLog - HourRecords (lib/usage-log.js)
 * @returns {{ perDay: number, usedToday: number | null, over: number, daysLeft: number, left: number } | null}
 *   all in %-points of the limit; null when the bucket has no future reset time
 */
export function weeklyBudget(bucket, usageLog, now = Date.now()) {
  if (!bucket || bucket.resetsAt == null || bucket.resetsAt <= now) return null;

  const dayStart = startOfDay(now);
  const windowStart = bucket.resetsAt - WEEK_MS;
  const left = Math.max(0, 100 - bucket.percentUsed);

  // A window that opened today started from zero; otherwise ask the log.
  const startLevel = windowStart > dayStart ? 0 : levelAtStartOfDay(bucket.label, usageLog, dayStart, windowStart);
  if (startLevel == null || startLevel > bucket.percentUsed) {
    // No idea where today started: budget from now on, and say nothing about today.
    const daysLeft = Math.max(1, (bucket.resetsAt - now) / DAY_MS);
    return { perDay: left / daysLeft, usedToday: null, over: 0, daysLeft, left };
  }

  const daysLeft = Math.max(1, (bucket.resetsAt - Math.max(dayStart, windowStart)) / DAY_MS);
  const perDay = (100 - startLevel) / daysLeft;
  const usedToday = bucket.percentUsed - startLevel;
  return { perDay, usedToday, over: Math.max(0, usedToday - perDay), daysLeft, left };
}

/** Whole points, or one decimal when the figure is small enough for that to matter. */
export function formatPoints(points) {
  const rounded = points >= 5 ? Math.round(points) : Math.round(points * 10) / 10;
  return `${rounded}%`;
}

/** "Budget: 12% a day until reset · 9% used today" */
export function describeBudget(budget) {
  if (!budget) return null;
  if (budget.left === 0) return "Budget: nothing left until reset";

  const daily = `Budget: ${formatPoints(budget.perDay)} a day until reset`;
  if (budget.usedToday == null) return daily;
  const today = `${formatPoints(budget.usedToday)} used today`;
  return budget.over >= 0.5 ? `${daily} · ${today}, ${formatPoints(budget.over)} over` : `${daily} · ${today}`;
}
