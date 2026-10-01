// Smart reset alert: "your limit has reset" — but only when that is news.
//
// A reset matters if you were waiting for it. So the alert only goes out for a
// limit that was near or at its ceiling when its window rolled over, and only
// if the roll-over just happened: opening the browser in the morning to a
// session that reset overnight is not worth a notification.

const MINUTE_MS = 60 * 1000;

/** A reset time this much later than before means a new window; less is the endpoint's wobble. */
const RESET_MOVED_MS = 5 * MINUTE_MS;
/** How long after the fact a reset is still worth announcing. */
export const FRESH_RESET_MS = 15 * MINUTE_MS;
/** For a limit with no reset time (the monthly extra-usage cap): the two readings must be this close. */
const FRESH_READING_GAP_MS = 90 * MINUTE_MS;
/** How long past a reset time to wait before checking: the endpoint needs a moment to roll over. */
export const RESET_CHECK_DELAY_MS = 10 * 1000;

/**
 * Did this limit's window roll over between the two readings, and recently?
 * @param {{ percentUsed: number, resetsAt?: number | null }} before
 * @param {{ percentUsed: number, resetsAt?: number | null }} after
 * @param {number} gapMs - time between the two readings
 * @param {number} at - when the later reading was taken
 */
function justReset(before, after, gapMs, at) {
  if (before.resetsAt == null) {
    // No reset time to go by: a drop between two nearby readings is the reset.
    return after.percentUsed < before.percentUsed && gapMs <= FRESH_READING_GAP_MS;
  }
  if (at - before.resetsAt > FRESH_RESET_MS) return false; // it reset a while ago; old news
  const moved = after.resetsAt != null && after.resetsAt - before.resetsAt > RESET_MOVED_MS;
  // A lower figure only counts once the old window's time was up — the endpoint does revise a figure down now and then.
  const lapsed = after.percentUsed < before.percentUsed && before.resetsAt <= at + MINUTE_MS;
  return moved || lapsed;
}

/**
 * The limits whose reset is worth announcing.
 * @param {Array<{ label: string, percentUsed: number, resetsAt?: number | null }>} before - buckets of the previous reading
 * @param {Array<object>} after - buckets of the new one
 * @param {object} options
 * @param {number} options.percent - only limits that had reached this level; 0 turns the alert off
 * @param {number} options.gapMs - time between the two readings
 * @param {number} options.at - when the new reading was taken
 * @returns {Array<{ label: string, was: number, now: number }>}
 */
export function resetsToAnnounce(before, after, { percent, gapMs, at }) {
  if (!(percent > 0)) return [];
  const resets = [];
  for (const old of before ?? []) {
    if (old.percentUsed < percent) continue;
    const current = (after ?? []).find((bucket) => bucket.label === old.label);
    // A limit missing from the new reading can't be said to have reset.
    if (!current || !justReset(old, current, gapMs, at)) continue;
    resets.push({ label: old.label, was: old.percentUsed, now: current.percentUsed });
  }
  return resets;
}

/**
 * When to look again so a reset is noticed as it happens: just after the
 * soonest reset among the limits that are high enough to be announced.
 * @returns {number | null} epoch ms, or null when no such limit has a reset ahead
 */
export function nextResetCheck(buckets, { percent, now = Date.now() }) {
  if (!(percent > 0)) return null;
  const times = (buckets ?? [])
    .filter((bucket) => bucket.percentUsed >= percent && bucket.resetsAt != null && bucket.resetsAt > now)
    .map((bucket) => bucket.resetsAt);
  return times.length > 0 ? Math.min(...times) + RESET_CHECK_DELAY_MS : null;
}

/** "Current session has reset — it was at 96%." / "…— it was used up, and you're back." */
export function describeReset({ label, was }) {
  const subject = label === "Current session" ? "Your session" : label === "Extra usage" ? "Extra usage" : `The ${label} weekly limit`;
  return was >= 100 ? `${subject} has reset — it was used up, and you're back.` : `${subject} has reset — it was at ${was}%.`;
}
