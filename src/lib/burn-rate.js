// How fast each weekly bucket is filling, worked out from the rolling snapshot
// history, and — from that — whether it's worth suggesting a lighter model.
//
// Model-specific weekly buckets (e.g. "Opus") have a much smaller allowance
// than the shared "All models" one, so heavy use of that model fills its own
// bucket first. Switching model moves the load onto the bigger bucket.

const HOUR_MS = 60 * 60 * 1000;

/** Only look this far back — older readings say little about the current pace. */
export const RATE_WINDOW_MS = 6 * HOUR_MS;
/** Two readings closer together than this are too noisy to call a rate. */
export const MIN_RATE_SPAN_MS = 10 * 60 * 1000;

export const SHARED_WEEKLY_LABEL = "All models";

/**
 * @param {Array<import("./types").UsageSnapshot>} history - oldest first
 * @returns {Array<{ label: string, percentUsed: number, resetsAt: number | null, ratePerHour: number | null }>}
 *   one entry per weekly bucket in the newest snapshot; ratePerHour is null when history is too short
 */
export function weeklyBurnRates(history, now = Date.now()) {
  const latest = history?.at(-1);
  if (!latest) return [];

  return (latest.weekly ?? []).map((bucket) => {
    let points = [];
    for (const snapshot of history) {
      if (now - snapshot.fetchedAt > RATE_WINDOW_MS) continue;
      const match = (snapshot.weekly ?? []).find((b) => b.label === bucket.label);
      if (!match) continue;
      // A drop means the weekly window reset — only the run since then counts.
      if (points.length > 0 && match.percentUsed < points.at(-1).pct) points = [];
      points.push({ t: snapshot.fetchedAt, pct: match.percentUsed });
    }

    const spanMs = points.length >= 2 ? points.at(-1).t - points[0].t : 0;
    const ratePerHour =
      spanMs >= MIN_RATE_SPAN_MS ? ((points.at(-1).pct - points[0].pct) / spanMs) * HOUR_MS : null;

    return { label: bucket.label, percentUsed: bucket.percentUsed, resetsAt: bucket.resetsAt ?? null, ratePerHour };
  });
}

/** Lighter models to suggest when a model-specific bucket is the one under pressure. */
export function lighterModels(label) {
  const lower = String(label).toLowerCase();
  if (lower.includes("opus")) return "Sonnet or Haiku";
  if (lower.includes("sonnet")) return "Haiku";
  return "a lighter model";
}

/**
 * Returns a hint when a model-specific weekly bucket is the fastest-filling one
 * and already at least `minPercent` full, else null.
 *
 * "Fastest" is by measured rate when every bucket has one; with too little
 * history it falls back to whichever bucket is fullest (basis: "level").
 */
export function modelSwitchHint(history, { minPercent = 50, now = Date.now() } = {}) {
  const rates = weeklyBurnRates(history, now);
  if (rates.length === 0) return null;

  const allMeasured = rates.every((r) => r.ratePerHour != null);
  const moving = allMeasured && rates.some((r) => r.ratePerHour > 0);
  const basis = moving ? "rate" : "level";

  const fastest = [...rates].sort((a, b) =>
    moving ? b.ratePerHour - a.ratePerHour || b.percentUsed - a.percentUsed : b.percentUsed - a.percentUsed
  )[0];

  if (fastest.label === SHARED_WEEKLY_LABEL) return null;
  if (fastest.percentUsed < minPercent || fastest.percentUsed >= 100) return null;

  const rate = moving ? Math.round(fastest.ratePerHour * 10) / 10 : null;
  return {
    label: fastest.label,
    percentUsed: fastest.percentUsed,
    resetsAt: fastest.resetsAt,
    basis,
    ratePerHour: rate,
    // Hours until this bucket is full at the current pace.
    hoursLeft: rate > 0 ? Math.round(((100 - fastest.percentUsed) / rate) * 10) / 10 : null,
    suggest: lighterModels(fastest.label),
  };
}
