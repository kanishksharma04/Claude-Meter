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
