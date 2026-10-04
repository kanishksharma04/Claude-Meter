// The usage levels that raise an alert. Any whole percentage from 1 to 100 can
// be one — the list is the user's, kept tidy here: whole numbers, no
// duplicates, lowest first, and not so many that every refresh pings.

export const MAX_THRESHOLDS = 8;

/** Whatever was stored or typed, as a clean list. */
export function normalizeThresholds(list) {
  const values = (Array.isArray(list) ? list : [])
    .map((value) => Math.round(Number(value)))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 100);
  return [...new Set(values)].sort((a, b) => a - b).slice(0, MAX_THRESHOLDS);
}

/**
 * Why a value can't be added, or null when it can.
 * @returns {"invalid" | "duplicate" | "full" | null}
 */
export function thresholdProblem(list, value) {
  const number = Number(value);
  if (value === "" || value == null || !Number.isInteger(number) || number < 1 || number > 100) return "invalid";
  const current = normalizeThresholds(list);
  if (current.includes(number)) return "duplicate";
  return current.length >= MAX_THRESHOLDS ? "full" : null;
}

/** The list with `value` added; unchanged (but normalized) when it can't be. */
export function addThreshold(list, value) {
  return thresholdProblem(list, value) ? normalizeThresholds(list) : normalizeThresholds([...list, Number(value)]);
}

export function removeThreshold(list, value) {
  return normalizeThresholds(list).filter((threshold) => threshold !== Number(value));
}

/**
 * The threshold a move from `before`% to `after`% crossed, or null. When one
 * jump clears several, the highest is the one worth mentioning.
 */
export function crossedThreshold(list, before, after) {
  return normalizeThresholds(list).findLast((threshold) => before < threshold && after >= threshold) ?? null;
}

// ------------------------------------------------------------ said already --
// A crossing is "below before, at or above now", which is true once — unless
// the figure dips and comes back (the endpoint does revise one down now and
// then), or the same reading is looked at twice. So what has been said is
// remembered: for each limit, the highest threshold announced in its current
// window. A new window starts again from nothing.
//
//   Alerted = { [label]: { window: number | string, threshold: number } }

/** Reset times for one window wobble by minutes; two windows of any limit are hours apart. */
const SAME_WINDOW_MS = 60 * 60 * 1000;

/** What identifies a limit's current window: its reset time, or — for one with none, the monthly extra-usage cap — the calendar month. */
export function alertWindow(bucket, now = Date.now()) {
  if (bucket?.resetsAt != null) return bucket.resetsAt;
  const date = new Date(now);
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

function sameWindow(a, b) {
  return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= SAME_WINDOW_MS : a === b;
}

/** Has this threshold, or a higher one, been announced for this limit in the window it is in now? */
export function alreadyAlerted(alerted, bucket, threshold, now = Date.now()) {
  const last = alerted?.[bucket.label];
  return Boolean(last) && sameWindow(last.window, alertWindow(bucket, now)) && last.threshold >= threshold;
}

/** The record with one more announcement in it. */
export function noteAlerted(alerted, bucket, threshold, now = Date.now()) {
  return { ...(alerted ?? {}), [bucket.label]: { window: alertWindow(bucket, now), threshold } };
}
