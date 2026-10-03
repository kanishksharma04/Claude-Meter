// Adaptive refresh: how long to wait before the next background reading.
//
// The interval in Options is the normal pace. Around it:
//
//   fast     a limit is close and still climbing — the readings that matter most
//   slow     nothing has changed for a while — the next reading will say the same
//   backoff  the last attempts failed — each failure doubles the wait
//
// Pure: the service worker keeps the two things this needs between readings
// (how many attempts in a row have failed, and when usage last moved) and sets
// the alarm to whatever comes out.
//
//   Pace = {
//     failures: number,             // attempts in a row that failed
//     errorCode: string | null,     // why the last one did
//     lastChangeAt: number | null,  // epoch ms usage last moved, or this browser last sent a message
//     minutes: number,              // the wait chosen
//     mode: "normal" | "fast" | "slow" | "backoff" | "fixed",
//     nextAt: number,               // when the alarm is due
//   }

const MINUTE_MS = 60 * 1000;

/** Never more often than this, however small the interval and however close the limit. */
export const MIN_MINUTES = 1;
/** Never less often than this, however long nothing has changed or failed. */
export const MAX_MINUTES = 60;

/** A limit this full (and not yet full) is "close"; this full, "very close". */
export const NEAR_PERCENT = 75;
export const VERY_NEAR_PERCENT = 90;

/** Usage that moved this recently is still moving. */
export const ACTIVE_WINDOW_MS = 15 * MINUTE_MS;
/** Nothing for this long is idle; for this long, long idle. */
export const IDLE_AFTER_MS = 30 * MINUTE_MS;
export const LONG_IDLE_AFTER_MS = 2 * 60 * MINUTE_MS;

const levels = (snapshot) =>
  new Map([
    ...(snapshot?.session ? [["session", snapshot.session.percentUsed]] : []),
    ...(snapshot?.weekly ?? []).map((bucket) => [`weekly:${bucket.label}`, bucket.percentUsed]),
  ]);

/** Did any limit stand somewhere else in this reading than in the one before? A first reading counts. */
export function usageChanged(previous, snapshot) {
  if (!previous) return true;
  const before = levels(previous);
  return [...levels(snapshot)].some(([id, percent]) => before.get(id) !== percent);
}

/** The fullest limit that still has room. One that is full can't get closer, so it doesn't count. */
export function closestLimit(snapshot) {
  const open = [...levels(snapshot).values()].filter((percent) => typeof percent === "number" && percent < 100);
  return open.length > 0 ? Math.max(...open) : null;
}

/** The pace after one more attempt: `outcome` is `{ ok, changed, code, at }`, or nothing when only rescheduling. */
export function foldOutcome(pace, outcome) {
  const kept = { failures: pace?.failures ?? 0, errorCode: pace?.errorCode ?? null, lastChangeAt: pace?.lastChangeAt ?? null };
  if (!outcome) return kept;
  if (!outcome.ok) return { ...kept, failures: kept.failures + 1, errorCode: outcome.code ?? "UNKNOWN_ERROR" };
  return { failures: 0, errorCode: null, lastChangeAt: outcome.changed ? outcome.at : kept.lastChangeAt };
}

const halves = (minutes) => Math.round(minutes * 2) / 2;
const clamp = (minutes) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, halves(minutes)));

/**
 * @param {{ baseMinutes: number, snapshot?: object | null, failures?: number, lastChangeAt?: number | null, now?: number }} input
 * @returns {{ minutes: number, mode: "normal" | "fast" | "slow" | "backoff" }}
 */
export function planRefresh({ baseMinutes, snapshot = null, failures = 0, lastChangeAt = null, now = Date.now() }) {
  const base = clamp(baseMinutes);
  // Whatever is wrong — signed out, offline, claude.ai having a bad hour — asking as often won't mend it.
  if (failures > 0) return { minutes: clamp(base * 2 ** Math.min(failures, 6)), mode: "backoff" };

  const quietFor = lastChangeAt == null ? null : now - lastChangeAt;
  const closest = closestLimit(snapshot);
  if (quietFor != null && quietFor <= ACTIVE_WINDOW_MS && closest != null && closest >= NEAR_PERCENT) {
    return { minutes: clamp(base / (closest >= VERY_NEAR_PERCENT ? 4 : 2)), mode: "fast" };
  }
  if (quietFor != null && quietFor >= IDLE_AFTER_MS) {
    // Never quicker than the normal pace, even when that is already slower than the cap.
    return { minutes: Math.max(base, clamp(base * (quietFor >= LONG_IDLE_AFTER_MS ? 4 : 2))), mode: "slow" };
  }
  return { minutes: base, mode: "normal" };
}

const every = (minutes) => (minutes === 1 ? "every minute" : `every ${minutes} min`);

/** One line for Options and the health page. No figures, so it can be shown in privacy mode. */
export function describePlan(plan) {
  if (!plan?.minutes) return "";
  const pace = every(plan.minutes);
  if (plan.mode === "fast") return `Refreshing ${pace}: a limit is close and still climbing.`;
  if (plan.mode === "slow") return `Refreshing ${pace}: nothing has changed for a while.`;
  if (plan.mode === "backoff") {
    const tries = plan.failures === 1 ? "the last attempt failed" : `the last ${plan.failures} attempts failed`;
    return `Trying again ${pace}: ${tries}.`;
  }
  return `Refreshing ${pace}.`;
}
