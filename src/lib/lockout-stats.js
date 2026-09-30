// Lockout statistics: how often a limit ran out and how long that left you
// blocked, week by week, from the limit-hit log (lib/limit-hits.js).
//
// A lockout runs from the moment it was first seen to its reset time. Time
// blocked is the union of those spans — a session and a weekly limit that are
// both exhausted at once block you once, not twice.

import { claimLabel } from "./limit-hits.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Sorted, non-overlapping [start, end] spans covering the same time as `spans`. */
function mergeSpans(spans) {
  const merged = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * @param {Array<object>} limitHits - LimitHit entries, oldest first
 * @returns {{ weeks: Array<{ from: number, to: number, count: number, blockedMs: number }>, total: number, blockedMs: number, most: { label: string, count: number } | null }}
 *   `weeks` are back-to-back 7-day spans ending now, newest first. A lockout is
 *   counted in the week it began; its blocked time goes to whichever weeks it covers.
 */
export function lockoutStats(limitHits, { now = Date.now(), weeks = 4 } = {}) {
  const periods = Array.from({ length: weeks }, (_, index) => ({
    from: now - (index + 1) * WEEK_MS,
    to: now - index * WEEK_MS,
    count: 0,
    blockedMs: 0,
  }));
  const earliest = periods.at(-1).from;
  const recent = (limitHits ?? []).filter((hit) => hit.at > earliest && hit.at <= now);

  const byLabel = new Map();
  for (const hit of recent) {
    periods.find((period) => hit.at > period.from && hit.at <= period.to).count += 1;
    const label = claimLabel(hit.claim) ?? "Unnamed limit";
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }

  // A lockout that is still running has only blocked you up to now.
  const spans = (limitHits ?? [])
    .filter((hit) => hit.resetsAt != null && hit.resetsAt > hit.at)
    .map((hit) => [hit.at, Math.min(hit.resetsAt, now)]);
  for (const [start, end] of mergeSpans(spans)) {
    for (const period of periods) {
      period.blockedMs += Math.max(0, Math.min(end, period.to) - Math.max(start, period.from));
    }
  }

  const [most] = [...byLabel].sort((a, b) => b[1] - a[1]);
  return {
    weeks: periods,
    total: recent.length,
    blockedMs: periods.reduce((sum, period) => sum + period.blockedMs, 0),
    most: most ? { label: most[0], count: most[1] } : null,
  };
}
