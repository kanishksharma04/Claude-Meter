// Turns the rolling snapshot history — and, for the longer view and the
// week-over-week comparison, the hourly usage log — into line-chart geometry
// for the dashboard's "usage over time" chart. Pure — no DOM — so the page only
// has to wrap the result in SVG elements.

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

/** The longer view, and how far back a comparison reaches: the same stretch one week earlier. */
export const WEEK_WINDOW_MS = 7 * 24 * HOUR_MS;

/** Hourly points further apart than this aren't joined — the browser wasn't running in between. */
export const LOG_GAP_MS = 2.5 * HOUR_MS;

/**
 * The same kind of series, drawn from the hourly usage log (lib/usage-log.js)
 * instead of the raw readings — coarser, but it reaches back weeks.
 *
 * `shiftMs` moves an older stretch forward onto the [from, to] axis: with a
 * shift of one week, what happened at this time last week is plotted "now".
 * That is how the week-over-week comparison is drawn.
 */
export function logSeries(usageLog, { from, to, shiftMs = 0 }) {
  const byId = new Map();
  const add = (id, label, t, pct) => {
    if (typeof pct !== "number") return;
    if (!byId.has(id)) byId.set(id, { id, label, points: [] });
    byId.get(id).points.push({ t, pct });
  };

  for (const record of usageLog ?? []) {
    // A record holds where things stood at the end of its hour (or now, for the hour still running).
    const t = Math.min(record.t + HOUR_MS + shiftMs, to);
    if (t < from || record.t + shiftMs > to) continue;
    add("session", "Session", t, record.peak);
    for (const [label, { pct }] of Object.entries(record.weekly ?? {})) {
      add(`weekly:${label}`, `${label} (weekly)`, t, pct);
    }
  }

  return { from, to, series: [...byId.values()] };
}

/**
 * The last week from the usage log. When the log doesn't reach back that far,
 * `from` is the first point actually plotted, as in chartSeries().
 */
export function weekSeries(usageLog, { now = Date.now(), windowMs = WEEK_WINDOW_MS } = {}) {
  const chart = logSeries(usageLog, { from: now - windowMs, to: now });
  const first = Math.min(...chart.series.map((s) => s.points[0].t));
  return { ...chart, from: first - chart.from > LOG_GAP_MS && Number.isFinite(first) ? first : chart.from };
}

/**
 * SVG path data for one series, scaled into a width × height box with 0% at
 * the bottom. With `gapMs`, the line is broken wherever two points are further
 * apart than that.
 */
export function linePath(points, { from, to, width, height, gapMs = Infinity }) {
  const span = Math.max(1, to - from);
  return points
    .map(({ t, pct }, index) => {
      const x = ((t - from) / span) * width;
      const y = height - (Math.max(0, Math.min(100, pct)) / 100) * height;
      const jump = index === 0 || t - points[index - 1].t > gapMs;
      return `${jump ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * One-sentence description of the chart for screen readers. `compare`, when
 * given, is the same series a week earlier.
 */
export function describeChart({ series }, compare = null) {
  const parts = series
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const before = compare?.series.find((c) => c.id === s.id)?.points.at(-1);
      const earlier = before ? ` (${before.pct}% at this point a week earlier)` : "";
      return `${s.label} went from ${s.points[0].pct}% to ${s.points.at(-1).pct}%${earlier}`;
    });
  return parts.length > 0 ? `Usage over time: ${parts.join("; ")}.` : "No usage history yet.";
}
