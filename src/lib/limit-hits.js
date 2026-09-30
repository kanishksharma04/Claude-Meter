// A log of the times a limit ran out. Most are claude.ai actually saying "limit
// reached" — by rejecting a message (HTTP 429) or by flagging the reply that
// used up the last of the allowance — detected in the page by
// src/content/inject-hook.js. The rest are "observed": a refresh found a limit
// at 100% with nothing refused in this browser (it ran out somewhere else, or
// you stopped in time).

export const MAX_LIMIT_HITS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hits with no reset time are folded into the previous one if they're this close together. */
const SAME_LOCKOUT_MS = 10 * 60 * 1000;
const RESET_TOLERANCE_MS = 60 * 1000;
/** The usage endpoint's reset times wobble more than the page's do. */
const OBSERVED_TOLERANCE_MS = 5 * 60 * 1000;

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
      // A refused message says more about the lockout than having merely seen the limit full.
      source: previous.source === "observed" ? hit.source : previous.source,
      claim: previous.claim ?? hit.claim,
      resetsAt: previous.resetsAt ?? hit.resetsAt,
      attempts: previous.attempts + 1,
      lastAt: hit.at,
    };
    return hits;
  }

  hits.push({ ...hit, attempts: 1, lastAt: hit.at });
  return hits.slice(-max);
}

/** The usage-endpoint key a bucket came from — the same names claude.ai uses for its claims. */
function claimFor(label, isSession) {
  if (isSession) return "five_hour";
  return label === "All models" ? "seven_day" : `seven_day_${label.toLowerCase().replace(/\s+/g, "_")}`;
}

/**
 * Logs a lockout for every limit the snapshot shows at 100% that isn't in the
 * list yet (matched by reset time). Returns the same array when nothing is new.
 */
export function observeFullBuckets(list, snapshot, max = MAX_LIMIT_HITS) {
  let hits = list ?? [];
  const buckets = [
    ...(snapshot?.session ? [{ ...snapshot.session, claim: claimFor(null, true) }] : []),
    ...(snapshot?.weekly ?? []).map((bucket) => ({ ...bucket, claim: claimFor(bucket.label, false) })),
  ];

  for (const bucket of buckets) {
    if (bucket.percentUsed < 100 || bucket.resetsAt == null || bucket.resetsAt <= snapshot.fetchedAt) continue;
    const known = hits.some(
      (hit) => hit.resetsAt != null && Math.abs(hit.resetsAt - bucket.resetsAt) <= OBSERVED_TOLERANCE_MS
    );
    if (known) continue;

    hits = [
      ...hits,
      {
        at: snapshot.fetchedAt,
        lastAt: snapshot.fetchedAt,
        attempts: 0, // nothing was refused — the limit was simply found full
        source: "observed",
        claim: bucket.claim,
        resetsAt: bucket.resetsAt,
        conversationId: null,
        model: null,
      },
    ].slice(-max);
  }
  return hits;
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
