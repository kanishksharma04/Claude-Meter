// Turns the rolling snapshot history into line-chart geometry for the
// dashboard's "usage over time" chart. Pure — no DOM — so the page only has to
// wrap the result in SVG elements.

const HOUR_MS = 60 * 60 * 1000;

/** How far back the chart looks by default. */
export const CHART_WINDOW_MS = 24 * HOUR_MS;

/**
 * @param {Array<import("./types").UsageSnapshot>} history - oldest first
 * @returns {{ from: number, to: number, series: Array<{ id: string, label: string, points: Array<{ t: number, pct: number }> }> }}
 *   one series per bucket seen in the window; `from` is the first reading actually plotted
 */
export function chartSeries(history, { now = Date.now(), windowMs = CHART_WINDOW_MS } = {}) {
  const earliest = now - windowMs;
  const snapshots = (history ?? []).filter((s) => s?.fetchedAt >= earliest && s.fetchedAt <= now);
  const byId = new Map();

  const add = (id, label, t, pct) => {
    if (typeof pct !== "number") return;
    if (!byId.has(id)) byId.set(id, { id, label, points: [] });
    byId.get(id).points.push({ t, pct });
  };

  for (const snapshot of snapshots) {
    if (snapshot.session) add("session", "Session", snapshot.fetchedAt, snapshot.session.percentUsed);
    for (const bucket of snapshot.weekly ?? []) {
      add(`weekly:${bucket.label}`, `${bucket.label} (weekly)`, snapshot.fetchedAt, bucket.percentUsed);
    }
  }

  return { from: snapshots[0]?.fetchedAt ?? earliest, to: now, series: [...byId.values()] };
}

/** SVG path data for one series, scaled into a width × height box with 0% at the bottom. */
export function linePath(points, { from, to, width, height }) {
  const span = Math.max(1, to - from);
  return points
    .map(({ t, pct }, index) => {
      const x = ((t - from) / span) * width;
      const y = height - (Math.max(0, Math.min(100, pct)) / 100) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** One-sentence description of the chart for screen readers. */
export function describeChart({ series }) {
  const parts = series
    .filter((s) => s.points.length > 0)
    .map((s) => `${s.label} went from ${s.points[0].pct}% to ${s.points.at(-1).pct}%`);
  return parts.length > 0 ? `Usage over time: ${parts.join("; ")}.` : "No usage history yet.";
}
