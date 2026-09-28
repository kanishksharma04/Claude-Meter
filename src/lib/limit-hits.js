// A log of the times claude.ai actually said "limit reached" — either by
// rejecting a message (HTTP 429) or by flagging the reply that used up the
// last of the allowance. Detected in the page by src/content/inject-hook.js.

export const MAX_LIMIT_HITS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hits with no reset time are folded into the previous one if they're this close together. */
const SAME_LOCKOUT_MS = 10 * 60 * 1000;
const RESET_TOLERANCE_MS = 60 * 1000;

/** claude.ai names the exhausted limit after the usage endpoint's bucket keys ("five_hour", "seven_day_opus"). */
export function claimLabel(claim) {
  if (typeof claim !== "string" || !claim) return null;
  if (/^five_hour/i.test(claim)) return "Current session";
  if (!/^seven_day/i.test(claim)) return null;
  const suffix = claim.replace(/^seven_day_?/i, "").replace(/_/g, " ").trim();
  return suffix ? suffix.replace(/\b\w/g, (c) => c.toUpperCase()) : "All models";
}

/**
 * When the page couldn't read a reset time out of the response, borrow it from
 * the usage snapshot: the named bucket if there is one, else whichever bucket is full.
 */
export function resolveResetsAt(hit, snapshot) {
  if (hit.resetsAt != null) return hit.resetsAt;

  const buckets = [snapshot?.session, ...(snapshot?.weekly ?? [])].filter(Boolean);
  const label = claimLabel(hit.claim);
  const named = label && buckets.find((b) => b.label === label);
  const full = buckets.filter((b) => b.percentUsed >= 100).sort((a, b) => (b.resetsAt ?? 0) - (a.resetsAt ?? 0))[0];
  return (named ?? full)?.resetsAt ?? null;
}

function sameLockout(previous, hit) {
  if (!previous) return false;
  if (previous.resetsAt != null && hit.resetsAt != null) {
    return Math.abs(previous.resetsAt - hit.resetsAt) <= RESET_TOLERANCE_MS;
  }
  return hit.at - previous.lastAt <= SAME_LOCKOUT_MS;
}

/**
 * Appends a hit, or — if it belongs to the lockout already at the end of the
 * list (same reset time) — just counts it as another blocked attempt.
 */
export function addLimitHit(list, hit, max = MAX_LIMIT_HITS) {
  const hits = [...(list ?? [])];
  const previous = hits.at(-1);

  if (sameLockout(previous, hit)) {
    hits[hits.length - 1] = {
      ...previous,
      resetsAt: previous.resetsAt ?? hit.resetsAt,
      attempts: previous.attempts + 1,
      lastAt: hit.at,
    };
    return hits;
  }

  hits.push({ ...hit, attempts: 1, lastAt: hit.at });
  return hits.slice(-max);
}

/**
 * @returns {{ total: number, last7Days: number, last: object | null, active: object | null }}
 *   `active` is the most recent hit whose reset time is still in the future.
 */
export function summarizeLimitHits(list, now = Date.now()) {
  const hits = list ?? [];
  const last = hits.at(-1) ?? null;
  return {
    total: hits.length,
    last7Days: hits.filter((h) => now - h.at <= 7 * DAY_MS).length,
    last,
    active: last && last.resetsAt != null && last.resetsAt > now ? last : null,
  };
}
