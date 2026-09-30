// Weekday × hour-of-day heatmap: how much of a session you typically use in
// each slot of the week, averaged over every such weekday in the usage log.

import { formatHour } from "./time-format.js";

/** Rows of the grid, Monday first. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

/** Row index (Monday = 0) of a Date. */
export function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/**
 * @param {Array<object>} log - HourRecords (lib/usage-log.js)
 * @returns {{ cells: number[][], max: number, days: number, busiest: Array<{ day: number, hour: number, value: number }> }}
 *   cells[day][hour] is the average session %-points used in that slot; `days`
 *   is how many calendar days the averages rest on.
 */
export function buildHeatmap(log) {
  const sums = WEEKDAYS.map(() => new Array(24).fill(0));
  const dates = WEEKDAYS.map(() => new Set());

  for (const record of log ?? []) {
    const date = new Date(record.t);
    const day = weekdayIndex(date);
    dates[day].add(date.toDateString());
    sums[day][date.getHours()] += record.burn ?? 0;
  }

  // An hour with no record on a day we did see counts as zero use, not as missing.
  const cells = sums.map((row, day) =>
    row.map((sum) => (dates[day].size > 0 ? Math.round((sum / dates[day].size) * 10) / 10 : 0))
  );

  const slots = cells.flatMap((row, day) => row.map((value, hour) => ({ day, hour, value })));
  return {
    cells,
    max: Math.max(0, ...slots.map((slot) => slot.value)),
    days: dates.reduce((total, set) => total + set.size, 0),
    busiest: slots
      .filter((slot) => slot.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3),
  };
}

/** "Tue 2:00 PM: about 14% of a session" — the hover text for one cell. */
export function describeSlot(day, hour, value) {
  const amount = value > 0 ? `about ${value}% of a session` : "no usage seen";
  return `${WEEKDAYS[day]} ${formatHour(hour)}: ${amount}`;
}

/** One sentence naming the busiest slots, for the caption and for screen readers. */
export function describeHeatmap({ busiest }) {
  if (busiest.length === 0) return "No usage recorded yet.";
  const names = busiest.map((slot) => `${WEEKDAY_NAMES[slot.day]} around ${formatHour(slot.hour)}`);
  return `Busiest: ${names.join(", ")}.`;
}
