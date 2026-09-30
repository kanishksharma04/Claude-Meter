// The dashboard's analytics sections. They only appear in the side panel /
// full-tab view (popup.html?view=panel) — the toolbar popup has no room for
// them — and each hides itself until there is enough data to say something.

import { buildHeatmap, describeHeatmap, describeSlot, WEEKDAYS } from "../lib/heatmap.js";
import { nextStart, describeStart } from "../lib/window-start.js";
import { lockoutStats } from "../lib/lockout-stats.js";
import { planFit, describePlanFit } from "../lib/plan-fit.js";
import { timelineDays, summarizeWindows } from "../lib/session-windows.js";
import { severityOf } from "../lib/severity.js";
import { recentSpikes, describeSpike, spikeSource } from "../lib/spikes.js";
import { formatHour, formatDuration, formatClock, formatMoment } from "../lib/time-format.js";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A length of time in words — "2 hr 40 min". */
const span = (ms) => (ms < 60_000 ? "under a minute" : formatDuration(0, ms));

/** "24 Sep – 30 Sep" for a span of days; `to` is exclusive. */
function dateRange(from, to) {
  const format = (epochMs) => new Date(epochMs).toLocaleDateString([], { day: "numeric", month: "short" });
  return `${format(from)} – ${format(to - 1)}`;
}

// ---------------------------------------------------------------- heatmap --

/** Hours that get a label along the top of the grid. */
const HEATMAP_TICKS = [0, 6, 12, 18];

function renderHeatmap({ usageLog }) {
  const grid = buildHeatmap(usageLog);
  const section = $("heatmapSection");
  section.hidden = grid.max === 0;
  if (section.hidden) return;

  $("heatmapNote").textContent = `average per hour · ${plural(grid.days, "day")}`;
  $("heatmapSummary").textContent = describeHeatmap(grid);

  const cells = [el("span")]; // the corner above the weekday labels
  for (let hour = 0; hour < 24; hour++) {
    cells.push(el("span", { className: "heat-tick" }, HEATMAP_TICKS.includes(hour) ? formatHour(hour) : ""));
  }
  grid.cells.forEach((row, day) => {
    cells.push(el("span", { className: "heat-day" }, WEEKDAYS[day]));
    row.forEach((value, hour) => {
      const cell = el("span", { className: "heat-cell", title: describeSlot(day, hour, value) });
      // Square-root scale: one very heavy hour shouldn't wash every other slot out to nothing.
      if (value > 0) cell.style.setProperty("--heat", `${Math.round(15 + 85 * Math.sqrt(value / grid.max))}%`);
      cells.push(cell);
    });
  });

  const heatmap = $("heatmap");
  heatmap.setAttribute("aria-label", `Usage by weekday and hour. ${describeHeatmap(grid)}`);
  heatmap.replaceChildren(...cells);
}

// ----------------------------------------------------------- window start --

function renderWindowStart({ usageLog, settings }) {
  const suggestion = nextStart(usageLog, settings);
  const section = $("startSection");
  section.hidden = !suggestion;
  if (!suggestion) return;

  const { lead, windows, basis } = describeStart(suggestion);
  $("startNote").textContent = `${suggestion.when} · ${WEEKDAYS[suggestion.day]}`;
  $("startLead").textContent = lead;
  $("startPlan").replaceChildren(...windows.map((text) => el("li", {}, text)));
  $("startBasis").textContent = basis;
}

// ------------------------------------------------------ session timeline --

function renderTimeline({ sessionWindows, settings }) {
  const summary = summarizeWindows(sessionWindows);
  const section = $("timelineSection");
  section.hidden = summary.count === 0;
  if (section.hidden) return;

  $("timelineNote").textContent = `${plural(summary.count, "window")} in 7 days`;
  $("timelineSummary").textContent =
    `About ${summary.perDay} a day, peaking at ${summary.averagePeak}% on average` +
    (summary.full > 0 ? ` · ${summary.full} reached 100%` : "") +
    ". Each bar is one 5-hour session, from its first message to its reset.";

  const clock = (epochMs) => new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("timelineTicks").replaceChildren(...HEATMAP_TICKS.map((hour) => el("span", {}, formatHour(hour))));
  $("timeline").replaceChildren(
    ...timelineDays(sessionWindows).map((row) => {
      const day = new Date(row.dayStart).toLocaleDateString([], { weekday: "short", day: "numeric" });
      const track = el("div", { className: "timeline-track", ariaHidden: "true" });
      const spoken = [];

      for (const bar of row.bars) {
        const node = el("span", {
          className: `timeline-bar ${severityOf(bar.peak, settings)}${bar.live ? " live" : ""}`,
          title: `${formatClock(bar.start)} – ${formatClock(bar.resetsAt)} · peaked at ${bar.peak}%`,
        });
        node.style.left = `${bar.left}%`;
        node.style.width = `${bar.width}%`;
        // The figure only goes on bars wide enough to hold it — the stub of a window that crossed midnight isn't.
        if (bar.width > 9) node.textContent = `${bar.peak}%`;
        track.append(node);
        spoken.push(`${clock(bar.start)} to ${clock(bar.resetsAt)}, ${bar.live ? "at" : "peaked at"} ${bar.peak}%`);
      }

      return el(
        "li",
        {},
        el("span", { className: "timeline-day", ariaHidden: "true" }, day),
        track,
        el("span", { className: "sr-only" }, `${day}: ${spoken.length > 0 ? spoken.join("; ") : "no sessions"}.`)
      );
    })
  );
}

// ----------------------------------------------------------------- spikes --

function renderSpikes({ spikes, messageLog, settings }) {
  const section = $("spikeSection");
  // With detection off there is nothing to report, and "none found" would be a lie.
  section.hidden = !(settings.spikePercent > 0);
  if (section.hidden) return;

  const recent = recentSpikes(spikes);
  $("spikeNote").textContent = `+${settings.spikePercent}% within 5 min`;
  $("spikeLead").textContent =
    recent.length === 0
      ? "No sudden jumps in the last 7 days."
      : `${plural(recent.length, "sudden jump")} in the last 7 days.`;

  $("spikeList").replaceChildren(
    ...recent.slice(0, 6).map((spike) => {
      const source = spikeSource(spike, settings.messageCost ? messageLog : []);
      const cause = source
        ? `during “${source.title}”` + (source.messages > 1 ? ` and ${plural(source.messages - 1, "other message")}` : "")
        : "nothing was sent from this browser";
      return el(
        "li",
        {},
        el("time", { dateTime: new Date(spike.at).toISOString() }, formatMoment(spike.at)),
        el("span", { className: "spike-what" }, `${spike.label} ${describeSpike(spike)}`),
        el("span", { className: "spike-cause" }, cause)
      );
    })
  );
}

// --------------------------------------------------------------- lockouts --

function renderLockouts({ limitHits }) {
  const stats = lockoutStats(limitHits);
  const [thisWeek] = stats.weeks;

  $("lockoutLead").textContent =
    stats.total === 0
      ? "No limit has run out in the last four weeks."
      : thisWeek.count === 0
        ? "No lockouts in the last 7 days."
        : `${plural(thisWeek.count, "lockout")} in the last 7 days, blocked for ${span(thisWeek.blockedMs)} in all.`;

  const table = $("lockoutTable");
  table.hidden = stats.total === 0;
  const longest = Math.max(1, ...stats.weeks.map((week) => week.blockedMs));
  $("lockoutRows").replaceChildren(
    ...stats.weeks.map((week) => {
      const bar = el("span", { className: "lockout-bar" });
      bar.style.width = `${Math.round((week.blockedMs / longest) * 100)}%`;
      return el(
        "tr",
        {},
        el("th", { scope: "row" }, dateRange(week.from, week.to)),
        el("td", {}, week.count === 0 ? "–" : `${week.count}×`),
        el("td", {}, week.blockedMs === 0 ? "–" : span(week.blockedMs)),
        el("td", { className: "lockout-bar-cell", ariaHidden: "true" }, bar)
      );
    })
  );

  $("lockoutNote").textContent =
    stats.total === 0
      ? ""
      : `${plural(stats.total, "lockout")} and ${span(stats.blockedMs)} blocked in four weeks` +
        (stats.most ? ` · most often: ${stats.most.label} (${stats.most.count}×)` : "");
}

// --------------------------------------------------------------- plan fit --

function renderPlanFit({ usageLog, limitHits, latestSnapshot, settings }) {
  const fit = planFit({ usageLog, limitHits, planTier: latestSnapshot?.planTier, plan: settings.plan });
  $("planFitNote").textContent = fit.plan ? `on ${fit.plan.label}` : "plan not detected";
  $("planFitLead").textContent = describePlanFit(fit, fit.blockedMs > 0 ? span(fit.blockedMs) : "");
  $("planFitSection").dataset.verdict = fit.verdict;
}

// ------------------------------------------------------------------------

export function renderInsights(state) {
  renderHeatmap(state);
  renderWindowStart(state);
  renderTimeline(state);
  renderSpikes(state);
  renderLockouts(state);
  renderPlanFit(state);
}
