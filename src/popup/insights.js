// The dashboard's analytics sections. They only appear in the side panel /
// full-tab view (popup.html?view=panel) — the toolbar popup has no room for
// them — and each hides itself until there is enough data to say something.

import { buildHeatmap, describeHeatmap, describeSlot, WEEKDAYS } from "../lib/heatmap.js";
import { nextStart, describeStart } from "../lib/window-start.js";
import { lockoutStats } from "../lib/lockout-stats.js";
import { formatHour, formatDuration } from "../lib/time-format.js";

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

// ------------------------------------------------------------------------

export function renderInsights(state) {
  renderHeatmap(state);
  renderWindowStart(state);
  renderLockouts(state);
}
