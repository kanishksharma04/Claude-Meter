// Window-start optimiser: when to send the first message of the day.
//
// The 5-hour session window opens with the first message after the previous
// one lapsed, and resets five hours later. Start at 9:00 with a 9-to-5 day and
// the reset comes at 14:00 — five hours on one allowance, three on the next.
// Open the window an hour earlier (any short message will do) and the reset
// lands at 13:00, mid-workday, with four hours either side. With a real hourly
// profile the same search finds the start that puts the reset in the middle of
// the heaviest stretch, so no single window has to carry it all.

import { averageBySlot, weekdayIndex } from "./heatmap.js";
import { MIN_PROFILE_DAYS } from "./forecast.js";
import { formatTimeOfDay, formatHour } from "./time-format.js";

const WINDOW_MIN = 5 * 60;
const DAY_MIN = 24 * 60;
const STEP_MIN = 30;

/** An hour counts as "in use" from this many session points (or, for assumed hours, any at all). */
const ACTIVE_POINTS = 0.5;
/** A different start is only worth suggesting if the heaviest window gets this much lighter. */
const WORTH_POINTS = 10; // learnt profile: %-points of a session
const WORTH_SHARE = 0.1; // assumed hours: share of the heaviest window

/** Demand in [from, to), both in minutes since midnight, from 24 per-hour figures. */
function load(demand, from, to) {
  let total = 0;
  for (let hour = Math.floor(from / 60); hour < 24 && hour * 60 < to; hour++) {
    const overlap = Math.min(to, (hour + 1) * 60) - Math.max(from, hour * 60);
    total += (demand[hour] * overlap) / 60;
  }
  return total;
}

/** The first minute at or after `minute` with any demand — when the next window would open. */
function nextActive(demand, minute) {
  if (minute < DAY_MIN && demand[Math.floor(minute / 60)] >= ACTIVE_POINTS) return minute;
  for (let hour = Math.floor(minute / 60) + 1; hour < 24; hour++) {
    if (demand[hour] >= ACTIVE_POINTS) return hour * 60;
  }
  return Infinity;
}

/** The day's windows if the first message goes out at `start`. */
function planFrom(demand, start) {
  const windows = [];
  for (let t = start; t < DAY_MIN; t = nextActive(demand, t + WINDOW_MIN)) {
    windows.push({ start: t, end: t + WINDOW_MIN, load: load(demand, t, Math.min(t + WINDOW_MIN, DAY_MIN)) });
  }
  return {
    start,
    windows,
    peak: Math.max(...windows.map((w) => w.load)),
    overflow: windows.reduce((sum, w) => sum + Math.max(0, w.load - 100), 0),
  };
}

/**
 * @param {number[]} demand - 24 per-hour figures: typical session points, or 1/0 for assumed working hours
 * @returns {{ natural: object, best: object, worthIt: boolean } | null} null when the day has no demand.
 *   `natural` is the plan when the first message is simply the first one of the working day.
 */
export function optimiseStart(demand, { worth = WORTH_POINTS } = {}) {
  const first = nextActive(demand, 0);
  if (first === Infinity) return null;

  const natural = planFrom(demand, first);
  let best = natural;
  // Starting more than a window ahead would only let that window lapse unused.
  for (let start = Math.max(0, first - WINDOW_MIN + STEP_MIN); start < first; start += STEP_MIN) {
    const plan = planFrom(demand, start);
    // Fewer points lost to a full window first, then the lightest heaviest window; later starts win ties.
    if (plan.overflow < best.overflow || (plan.overflow === best.overflow && plan.peak <= best.peak)) best = plan;
  }

  const worthIt = natural.peak - best.peak >= worth;
  return { natural, best: worthIt ? best : natural, worthIt };
}

/**
 * The suggestion for one weekday.
 * @param {Array<object>} usageLog - HourRecords (lib/usage-log.js)
 * @param {{ workdayStart: number, workdayEnd: number }} settings - assumed working hours, used until the log has a week in it
 * @param {number} day - weekday index, Monday = 0
 * @returns {{ basis: "profile" | "hours", day: number, natural: object, best: object, worthIt: boolean } | null}
 */
export function suggestStart(usageLog, settings, day) {
  const profile = averageBySlot(usageLog, (record) => record.burn);
  if (profile.days >= MIN_PROFILE_DAYS) {
    const plan = optimiseStart(profile.cells[day]);
    return plan && { basis: "profile", day, days: profile.days, ...plan };
  }

  const { workdayStart = 9, workdayEnd = 17 } = settings ?? {};
  const hours = Array.from({ length: 24 }, (_, hour) => (hour >= workdayStart && hour < workdayEnd ? 1 : 0));
  const natural = planFrom(hours, workdayStart * 60);
  const plan = optimiseStart(hours, { worth: natural.peak * WORTH_SHARE });
  return plan && { basis: "hours", day, workdayStart, workdayEnd, ...plan };
}

/**
 * Today's suggestion if its start time is still ahead, otherwise tomorrow's.
 * @returns {{ when: "today" | "tomorrow", ...suggestion } | null}
 */
export function nextStart(usageLog, settings, now = Date.now()) {
  const date = new Date(now);
  const today = suggestStart(usageLog, settings, weekdayIndex(date));
  if (today && date.getHours() * 60 + date.getMinutes() < today.best.start) return { when: "today", ...today };

  const tomorrow = suggestStart(usageLog, settings, (weekdayIndex(date) + 1) % 7);
  return tomorrow && { when: "tomorrow", ...tomorrow };
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const HOURS_OF_WORK = (load) => `${Math.round(load * 10) / 10} hr of work`;

/**
 * The suggestion in words.
 * @returns {{ lead: string, windows: string[], basis: string }}
 */
export function describeStart(suggestion) {
  const { basis, day, natural, best, worthIt } = suggestion;
  const learnt = basis === "profile";
  const start = formatTimeOfDay(best.start);
  const reset = formatTimeOfDay(best.windows[0].end % DAY_MIN);
  const dayName = DAY_NAMES[day];

  let lead;
  if (worthIt && learnt) {
    lead =
      `Send your first message around ${start} — any short one will do. Your session then resets at ${reset}, ` +
      `inside your busiest stretch, and the heaviest window of a usual ${dayName} drops from about ` +
      `${Math.round(natural.peak)}% of a session to ${Math.round(best.peak)}%.`;
  } else if (worthIt) {
    lead =
      `Send your first message around ${start} — any short one will do. Your session then resets at ${reset}, ` +
      `mid-workday, so no single window has to carry more than ${HOURS_OF_WORK(best.peak)} ` +
      `(it would be ${HOURS_OF_WORK(natural.peak)} starting at ${formatTimeOfDay(natural.start)}).`;
  } else if (learnt) {
    lead =
      `Your usual ${start} start already spreads a typical ${dayName} well: the session resets at ${reset} ` +
      `and the heaviest window uses about ${Math.round(best.peak)}% of a session.`;
  } else {
    lead = `Starting at ${start} already puts the reset at ${reset}, near the middle of your working hours.`;
  }

  return {
    lead,
    windows: best.windows.map((w) => {
      const span = `${formatTimeOfDay(w.start)} – ${formatTimeOfDay(w.end % DAY_MIN)}`;
      return learnt ? `${span} · about ${Math.round(w.load)}%` : `${span} · ${HOURS_OF_WORK(w.load)}`;
    }),
    basis: learnt
      ? `From your typical ${dayName} (${suggestion.days} days of history).`
      : `Assumes you work ${formatHour(suggestion.workdayStart)} – ${formatHour(suggestion.workdayEnd % 24)} (set in Options) ` +
        "until ClaudeMeter has a week of your usage to learn from.",
  };
}
