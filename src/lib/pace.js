// Pace alert: a heads-up when today is running well above a usual day.
//
// "Usual" is the hourly profile the forecast uses — what the hours on record
// today typically see on this weekday — so a heavy Monday morning is compared
// with Monday mornings, not with a weekly average. It needs a week of history,
// and enough of the day gone that the comparison isn't one message against
// nothing. One alert a day: it says the day is heavy, it doesn't nag about it.

import { todayAgainstUsual, MIN_PROFILE_DAYS } from "./forecast.js";

/** Offered in Options: how many times the usual pace sets it off. */
export const PACE_FACTORS = [1.5, 2, 3];

/** The usual figure for the day so far must be at least this (session %-points) to compare against… */
export const MIN_USUAL_POINTS = 10;
/** …and today must have used at least this much, so a quiet day can't alert on a technicality. */
export const MIN_ACTUAL_POINTS = 20;

function startOfDay(epochMs) {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * @param {Array<object>} usageLog - HourRecords (lib/usage-log.js)
 * @param {object} options
 * @param {number} options.factor - alert at this many times the usual pace; 0 = off
 * @param {number} [options.lastAlertDay] - start of the day the last pace alert went out
 * @returns {{ ratio: number, actual: number, expected: number, day: number } | null}
 *   the alert to send, or null when there is none (off, already sent today, too little to go on, or on pace)
 */
export function paceAlert(usageLog, { factor, lastAlertDay = 0, now = Date.now() }) {
  if (!(factor > 0)) return null;
  const day = startOfDay(now);
  if (lastAlertDay === day) return null;

  const { actual, expected, ratio, days } = todayAgainstUsual(usageLog, now);
  if (days < MIN_PROFILE_DAYS || expected < MIN_USUAL_POINTS || actual < MIN_ACTUAL_POINTS) return null;
  return ratio >= factor ? { ratio, actual, expected, day } : null;
}

/** "You're using Claude at 2.3× your usual pace today: 84% of a session so far, against a usual 37% by now." */
export function describePace({ ratio, actual, expected }) {
  return (
    `You're using Claude at ${Math.round(ratio * 10) / 10}× your usual pace today: ` +
    `${Math.round(actual)}% of a session so far, against a usual ${Math.round(expected)}% by now.`
  );
}
