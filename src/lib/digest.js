// The daily digest: one notification at a time of the user's choosing that
// sums the day up — how much was used, how high it got, where the weekly
// limits stand — for people who would rather hear once than be pinged at every
// threshold.

import { lockoutsBetween } from "./lockout-stats.js";
import { todayAgainstUsual, MIN_PROFILE_DAYS } from "./forecast.js";
import { formatDuration } from "./time-format.js";

function startOfDay(epochMs) {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * The next time the clock reads `minutes` past midnight: later today if that
 * is still ahead, otherwise tomorrow.
 */
export function nextDigestAt(minutes, now = Date.now()) {
  const at = new Date(now);
  at.setHours(0, minutes, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  // Set again by the clock, so a daylight-saving change overnight doesn't shift it by an hour.
  at.setHours(0, minutes, 0, 0);
  return at.getTime();
}

/**
 * Today so far, as figures.
 * @param {object} state - what getAll() returns (lib/storage.js)
 * @returns {{ day: number, used: number, peak: number | null, sessions: number, lockouts: number,
 *   pace: number | null, weekly: Array<{ label: string, percentUsed: number, resetsAt: number | null }> } | null}
 *   null when there is no reading to report on
 */
export function summarizeToday({ latestSnapshot, usageLog, sessionWindows, limitHits }, now = Date.now()) {
  if (!latestSnapshot) return null;
  const day = startOfDay(now);
  const records = (usageLog ?? []).filter((record) => record.t >= day && record.t <= now);
  const peaks = records.map((record) => record.peak).filter((peak) => peak != null);
  const usual = todayAgainstUsual(usageLog, now);

  return {
    day,
    used: records.reduce((sum, record) => sum + (record.burn ?? 0) + (record.unseen ?? 0), 0),
    peak: peaks.length > 0 ? Math.max(...peaks) : null,
    sessions: (sessionWindows ?? []).filter((w) => w.resetsAt > day && w.start <= now).length,
    lockouts: lockoutsBetween(limitHits, day, now, now).count,
    // Only worth a mention once there is a week of history behind "usual".
    pace: usual.days >= MIN_PROFILE_DAYS ? usual.ratio : null,
    weekly: latestSnapshot.weekly ?? [],
  };
}

/** "about the same as", "40% more than", "half" … a usual day so far. */
function paceWords(pace) {
  if (pace >= 0.9 && pace <= 1.1) return "about the same as a usual day so far";
  const percent = Math.round(Math.abs(pace - 1) * 100);
  return `${percent}% ${pace > 1 ? "more" : "less"} than a usual day so far`;
}

/**
 * The digest as notification text.
 * @returns {{ message: string, discreet: string } | null}
 */
export function buildDigest(state, now = Date.now()) {
  const today = summarizeToday(state, now);
  if (!today) return null;

  const parts = [];
  if (today.used < 1) {
    // A level with no rise behind it: the browser only saw the day's usage after the fact.
    parts.push(today.peak > 0 ? `Today: the session got to ${today.peak}%, with almost none of that on record here.` : "Today: nothing used.");
  } else {
    let line = `Today: about ${Math.round(today.used)}% of a session's allowance`;
    if (today.sessions > 0) line += ` over ${today.sessions} session${today.sessions === 1 ? "" : "s"}`;
    if (today.peak != null) line += `, peaking at ${today.peak}%`;
    parts.push(`${line}.`);
    if (today.pace != null) parts.push(`That is ${paceWords(today.pace)}.`);
  }

  if (today.weekly.length > 0) {
    const levels = today.weekly.map((bucket) => `${bucket.label} ${bucket.percentUsed}%`).join(", ");
    const resetsIn = formatDuration(now, today.weekly[0].resetsAt);
    parts.push(`Weekly: ${levels}${resetsIn && resetsIn !== "now" ? ` (resets in ${resetsIn})` : ""}.`);
  }
  if (today.lockouts > 0) parts.push(`A limit ran out ${{ 1: "once", 2: "twice" }[today.lockouts] ?? `${today.lockouts} times`}.`);

  return { message: parts.join(" "), discreet: "Your daily usage summary is ready. Open ClaudeMeter to see it." };
}
