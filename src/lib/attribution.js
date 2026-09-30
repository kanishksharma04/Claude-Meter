// Other-device attribution: how much of the usage came from somewhere other
// than this browser — another computer, the desktop or mobile app, Claude Code.
//
// The usage endpoint doesn't say where usage came from, so this works by
// elimination. The page hook reports every message sent from a claude.ai tab
// here; if a limit rose between two readings and nothing was being sent or
// answered in this browser at the time, that rise happened elsewhere. So did
// anything that built up while the browser wasn't running at all.

import { pointsUsed, MAX_READING_GAP_MS } from "./usage-log.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A reply's cost can reach the usage endpoint a little after the reply ends. */
export const ACTIVITY_GRACE_MS = 2 * 60 * 1000;
/** A message that never reported its end (tab closed mid-reply) stops counting as in flight after this. */
const STALE_REQUEST_MS = 30 * 60 * 1000;

/**
 * Updates the record of this browser's own activity with one chat event.
 * @param {{ lastAt: number, open: Record<string, number> } | null} activity
 * @param {{ kind: string, requestId?: string, timestamp?: number }} event - from src/content/inject-hook.js
 */
export function noteActivity(activity, event, now = Date.now()) {
  const at = event.timestamp ?? now;
  const open = Object.fromEntries(
    Object.entries(activity?.open ?? {}).filter(([, startedAt]) => at - startedAt < STALE_REQUEST_MS)
  );
  if (event.kind === "completion_start" && event.requestId) open[event.requestId] = at;
  if (event.kind === "completion_end") delete open[event.requestId];
  return { lastAt: Math.max(activity?.lastAt ?? 0, at), open };
}

/** Was a message being sent or answered in this browser at any point in [from, to]? */
export function wasActive(activity, from, to) {
  if (!activity) return false;
  if (activity.lastAt >= from - ACTIVITY_GRACE_MS && activity.lastAt <= to) return true;
  return Object.values(activity.open ?? {}).some((startedAt) => startedAt <= to && to - startedAt < STALE_REQUEST_MS);
}

/**
 * Session %-points that rose since the previous reading without this browser
 * having had a hand in it. 0 when the rise is explained, or there was none.
 */
export function elsewherePoints(previous, snapshot, activity) {
  if (!previous || !snapshot) return 0;
  const points = pointsUsed(previous.session, snapshot.session);
  if (points <= 0) return 0;
  // Readings this far apart mean the browser wasn't running in between.
  if (snapshot.fetchedAt - previous.fetchedAt > MAX_READING_GAP_MS) return points;
  return wasActive(activity, previous.fetchedAt, snapshot.fetchedAt) ? 0 : points;
}

/**
 * The split over the last `days` days, from the hourly usage log.
 * @returns {{ total: number, here: number, elsewhere: number, share: number | null }}
 *   in session %-points; `share` is elsewhere / total, null when nothing was used
 */
export function attribution(usageLog, { now = Date.now(), days = 7 } = {}) {
  let seen = 0; // points pinned on an hour
  let elsewhere = 0;
  for (const record of usageLog ?? []) {
    if (record.t <= now - days * DAY_MS || record.t > now) continue;
    seen += record.burn ?? 0;
    // `away` is part of `burn`; `unseen` (built up across a gap in the readings) is on top of it.
    elsewhere += (record.away ?? 0) + (record.unseen ?? 0);
    seen += record.unseen ?? 0;
  }
  return { total: seen, here: seen - elsewhere, elsewhere, share: seen > 0 ? elsewhere / seen : null };
}

/**
 * The stretches of a chart during which usage rose elsewhere, as [from, to] spans.
 * @param {{ from: number, to: number }} chart
 * @param {object} source - `history` (readings) for the fine view, or `usageLog` (hour records) for the long one
 */
export function elsewhereSpans(chart, { history, usageLog }) {
  const spans = [];
  const add = (from, to) => {
    const start = Math.max(from, chart.from);
    const end = Math.min(to, chart.to);
    if (end <= start) return;
    const last = spans.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
  };

  if (history) {
    history.forEach((snapshot, index) => {
      if (index > 0 && snapshot.elsewhere > 0) add(history[index - 1].fetchedAt, snapshot.fetchedAt);
    });
  } else {
    for (const record of usageLog ?? []) {
      if ((record.away ?? 0) + (record.unseen ?? 0) > 0) add(record.t, record.t + HOUR_MS);
    }
  }
  return spans;
}

/** "About a fifth…" style sentence for the dashboard. */
export function describeAttribution({ total, elsewhere, share }, days = 7) {
  if (share == null) return "";
  const percent = Math.round(share * 100);
  if (percent === 0) return `All of the last ${days} days' session usage lines up with messages sent from this browser.`;
  return (
    `About ${percent}% of the last ${days} days' session usage (${Math.round(elsewhere)} of ${Math.round(total)} points) ` +
    "built up while this browser was idle or closed — another device, the desktop or mobile app, or Claude Code."
  );
}
