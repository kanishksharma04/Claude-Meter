// The dashboard's analytics sections. They only appear in the side panel /
// full-tab view (popup.html?view=panel) — the toolbar popup has no room for
// them — and each hides itself until there is enough data to say something.

import { buildHeatmap, describeHeatmap, describeSlot, WEEKDAYS } from "../lib/heatmap.js";
import { formatHour } from "../lib/time-format.js";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

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

// ------------------------------------------------------------------------

export function renderInsights(state) {
  renderHeatmap(state);
}
