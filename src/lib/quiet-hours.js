// Quiet hours: stretches of the week in which alerts stay silent — no
// notification, no sound, no webhook. Each weekday has its own list of
// windows, so "nights, plus Wednesday's standing meeting, plus all of Sunday"
// is three kinds of entry rather than a compromise.
//
//   QuietHours = {
//     enabled: boolean,
//     days: Array<Array<{ from: number, to: number }>>,  // seven lists, Monday first
//   }
//
// Times are minutes since local midnight. A window whose end is not after its
// start runs past midnight into the next day (22:00–07:00); one whose end
// equals its start is a full 24 hours.

const MINUTE_MS = 60 * 1000;
const DAY_MIN = 24 * 60;

export const MAX_WINDOWS_PER_DAY = 4;

/** What a newly added window starts as: overnight. */
export const NEW_WINDOW = { from: 22 * 60, to: 7 * 60 };

export const DEFAULT_QUIET_HOURS = { enabled: false, days: Array.from({ length: 7 }, () => []) };

function cleanMinutes(value) {
  const minutes = Math.round(Number(value));
  return Number.isFinite(minutes) && minutes >= 0 && minutes < DAY_MIN ? minutes : null;
}

/** Whatever was stored, as a well-formed QuietHours: seven lists, valid times, earliest first. */
export function normalizeQuietHours(raw) {
  return {
    enabled: Boolean(raw?.enabled),
    days: Array.from({ length: 7 }, (_, day) =>
      (Array.isArray(raw?.days?.[day]) ? raw.days[day] : [])
        .map((window) => ({ from: cleanMinutes(window?.from), to: cleanMinutes(window?.to) }))
        .filter((window) => window.from != null && window.to != null)
        .sort((a, b) => a.from - b.from || a.to - b.to)
        .slice(0, MAX_WINDOWS_PER_DAY)
    ),
  };
}

/** Row index (Monday = 0) and minutes since midnight of a moment, in local time. */
function slotOf(epochMs) {
  const date = new Date(epochMs);
  return { day: (date.getDay() + 6) % 7, minute: date.getHours() * 60 + date.getMinutes() };
}

/** How many minutes a window lasts. */
function lengthOf({ from, to }) {
  return to > from ? to - from : to + DAY_MIN - from;
}

/**
 * The windows covering a moment, each with the minutes it still has to run.
 * Looks at today's windows and at yesterday's that ran past midnight.
 */
function coveringWindows(days, epochMs) {
  const { day, minute } = slotOf(epochMs);
  const covering = [];
  for (const window of days[day]) {
    const elapsed = minute - window.from;
    if (elapsed >= 0 && elapsed < lengthOf(window)) covering.push(lengthOf(window) - elapsed);
  }
  for (const window of days[(day + 6) % 7]) {
    const elapsed = minute + DAY_MIN - window.from;
    if (elapsed < lengthOf(window)) covering.push(lengthOf(window) - elapsed);
  }
  return covering;
}

/** Is `now` inside a quiet window? */
export function isQuiet(quietHours, now = Date.now()) {
  const { enabled, days } = normalizeQuietHours(quietHours);
  return enabled && coveringWindows(days, now).length > 0;
}

/**
 * When the quiet stretch `now` is in comes to an end — following on through
 * any window that starts before the current one is over.
 * @returns {number | null} epoch ms, or null when it isn't quiet now
 */
export function quietUntil(quietHours, now = Date.now()) {
  const { enabled, days } = normalizeQuietHours(quietHours);
  if (!enabled) return null;

  // Work in whole minutes from the start of this one, so a window's last minute isn't cut short.
  let end = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  let covered = false;
  // Windows can chain for at most a week before the pattern repeats.
  for (let step = 0; step < 7 * MAX_WINDOWS_PER_DAY + 1; step++) {
    const remaining = coveringWindows(days, end);
    if (remaining.length === 0) break;
    covered = true;
    end += Math.max(...remaining) * MINUTE_MS;
    if (end - now > 7 * DAY_MIN * MINUTE_MS) return null; // quiet all week: there is no end to name
  }
  return covered ? end : null;
}

/** The same settings with one day's list of windows replaced. */
function withDay(quietHours, day, windows) {
  const next = normalizeQuietHours(quietHours);
  next.days[day] = windows;
  return normalizeQuietHours(next);
}

export function addWindow(quietHours, day, window = NEW_WINDOW) {
  const { days } = normalizeQuietHours(quietHours);
  if (days[day].length >= MAX_WINDOWS_PER_DAY) return normalizeQuietHours(quietHours);
  return withDay(quietHours, day, [...days[day], window]);
}

export function removeWindow(quietHours, day, index) {
  const { days } = normalizeQuietHours(quietHours);
  return withDay(quietHours, day, days[day].filter((_, i) => i !== index));
}

/** Changes one end of one window; `change` is { from } or { to }. */
export function updateWindow(quietHours, day, index, change) {
  const { days } = normalizeQuietHours(quietHours);
  return withDay(quietHours, day, days[day].map((window, i) => (i === index ? { ...window, ...change } : window)));
}

/** Gives every day the same windows as `day`. */
export function copyToAllDays(quietHours, day) {
  const next = normalizeQuietHours(quietHours);
  return normalizeQuietHours({ ...next, days: next.days.map(() => next.days[day].map((window) => ({ ...window }))) });
}

/** Minutes since midnight <-> the "HH:MM" a time field uses. */
export function toTimeValue(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function fromTimeValue(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ""));
  return match ? cleanMinutes(Number(match[1]) * 60 + Number(match[2])) : null;
}

/** What a window amounts to, where that isn't obvious from its two times. Kept short: it sits in a narrow row. */
export function windowNote({ from, to }) {
  if (from === to) return "24 hours";
  return to < from ? "next day" : "";
}
