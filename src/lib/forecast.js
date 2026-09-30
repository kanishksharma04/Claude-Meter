// Where a limit is heading by the time it resets.
//
// A straight line from the pace so far is wrong in a predictable way: taken at
// 3 PM on a working day it assumes the same pace through the night and the
// weekend. So the forecast walks forward hour by hour instead, adding what is
// *typically* used in that hour of the week — the same averages the heatmap
// draws — and scales the rest of today by how today compares with a usual one.
// Until there is a week of history to learn from, it falls back to the line.

import { averageBySlot, weekdayIndex } from "./heatmap.js";
import { hourStart } from "./usage-log.js";
import { formatClock } from "./time-format.js";

const HOUR_MS = 60 * 60 * 1000;

export const SESSION_LENGTH_MS = 5 * HOUR_MS;
export const WEEK_LENGTH_MS = 7 * 24 * HOUR_MS;

/** Days of history needed before the hourly profile is trusted over a straight line. */
export const MIN_PROFILE_DAYS = 7;

/** How far "today is heavier/lighter than usual" may bend the profile for the rest of today. */
const PACE_RANGE = [0.5, 2];
/** Below this many expected session points so far today, the comparison is too noisy to use. */
const MIN_PACE_BASIS = 5;

function startOfDay(epochMs) {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfNextDay(epochMs) {
  const date = new Date(epochMs);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

/** Adds up the profile's expected points over [from, to), hour by hour, starting from `level`. */
function walk(profile, from, to, level, paceUntil, pace) {
  let fullAt = null;
  for (let t = from; t < to; ) {
    const end = Math.min(hourStart(t) + HOUR_MS, to);
    const date = new Date(t);
    const perHour = profile.cells[weekdayIndex(date)][date.getHours()] * (t < paceUntil ? pace : 1);
    const add = (perHour * (end - t)) / HOUR_MS;
    if (fullAt == null && add > 0 && level + add >= 100) fullAt = t + ((100 - level) / add) * (end - t);
    level += add;
    t = end;
  }
  return { projected: level, fullAt };
}

/**
 * How today compares with a usual one, within PACE_RANGE: session points used
 * in the hours on record today against what those same hours typically see.
 * Session points are used whichever limit is being forecast — they are the
 * finest-grained measure of how heavy a day is.
 */
export function paceToday(usageLog, now = Date.now()) {
  const typical = averageBySlot(usageLog, (record) => record.burn);
  const dayStart = startOfDay(now);
  let actual = 0;
  let expected = 0;
  for (const record of usageLog ?? []) {
    if (record.t < dayStart) continue;
    const date = new Date(record.t);
    // The hour still running has only had part of its usual share.
    const share = Math.max(0, Math.min(1, (now - record.t) / HOUR_MS));
    expected += typical.cells[weekdayIndex(date)][date.getHours()] * share;
    actual += record.burn ?? 0;
  }
  if (expected < MIN_PACE_BASIS) return 1;
  return Math.max(PACE_RANGE[0], Math.min(PACE_RANGE[1], actual / expected));
}

function linearForecast(bucket, windowMs, now) {
  const elapsed = now - (bucket.resetsAt - windowMs);
  // Too early in the window for its pace to mean anything.
  if (elapsed < windowMs * 0.02) return null;
  const perMs = bucket.percentUsed / elapsed;
  const projected = bucket.percentUsed + perMs * (bucket.resetsAt - now);
  return {
    method: "linear",
    projected,
    fullAt: projected >= 100 && perMs > 0 ? now + (100 - bucket.percentUsed) / perMs : null,
  };
}

/**
 * @param {{ percentUsed: number, resetsAt: number | null }} bucket
 * @param {object} options
 * @param {Array<object>} options.usageLog - HourRecords (lib/usage-log.js)
 * @param {(record: object) => number} options.pick - this bucket's points used in one record
 * @param {number} options.windowMs - SESSION_LENGTH_MS or WEEK_LENGTH_MS
 * @param {"profile" | "linear"} [options.mode] - "linear" forces the straight line
 * @returns {{ method: "profile" | "linear", projected: number, fullAt: number | null, days?: number, pace?: number } | null}
 *   `projected` is the level expected at the reset (it can pass 100); `fullAt`
 *   is when it would hit 100, if that comes first. null when there's nothing to say.
 */
export function forecastBucket(bucket, { usageLog, pick, windowMs, mode = "profile", now = Date.now() }) {
  if (!bucket || bucket.resetsAt == null || bucket.resetsAt <= now || bucket.percentUsed >= 100) return null;

  const profile = mode === "profile" ? averageBySlot(usageLog, pick) : null;
  if (!profile || profile.days < MIN_PROFILE_DAYS) return linearForecast(bucket, windowMs, now);

  const pace = paceToday(usageLog, now);
  const { projected, fullAt } = walk(profile, now, bucket.resetsAt, bucket.percentUsed, startOfNextDay(now), pace);
  return { method: "profile", projected, fullAt, days: profile.days, pace };
}

export function forecastSession(snapshot, usageLog, options = {}) {
  return forecastBucket(snapshot?.session, {
    ...options,
    usageLog,
    pick: (record) => record.burn,
    windowMs: SESSION_LENGTH_MS,
  });
}

export function forecastWeekly(bucket, usageLog, options = {}) {
  return forecastBucket(bucket, {
    ...options,
    usageLog,
    pick: (record) => record.weekly?.[bucket.label]?.burn,
    windowMs: WEEK_LENGTH_MS,
  });
}

/** "on course for 84%" or "full around Thu 3:10 PM" — made to follow "Resets in … · ". */
export function describeForecast(forecast, now = Date.now()) {
  if (!forecast) return null;
  if (forecast.fullAt != null) return `full around ${formatClock(forecast.fullAt, now)}`;
  return `on course for ${Math.min(99, Math.round(forecast.projected))}%`;
}

/** The longer explanation behind the short phrase, for a tooltip. */
export function explainForecast(forecast) {
  if (!forecast) return "";
  if (forecast.method === "linear") {
    return "Straight-line forecast from the pace so far in this window.";
  }
  const pace = Math.round(forecast.pace * 10) / 10;
  const today = pace === 1 ? "" : ` Today is running at ${pace}× your usual, so the rest of today is scaled to match.`;
  return `Forecast from what you typically use in each hour of the week (${forecast.days} days of history).${today}`;
}
