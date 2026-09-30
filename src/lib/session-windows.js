// A log of the 5-hour session windows themselves: when each one opened, when it
// reset, and how full it got. Built from the same readings as everything else
// — a window is identified by its reset time — and drawn by the dashboard as a
// timeline, one row per day.
//
//   SessionWindow = {
//     start: number,      // epoch ms the window opened (its reset time minus five hours)
//     resetsAt: number,   // epoch ms it reset
//     firstSeen: number,  // first and last readings taken inside it
//     lastSeen: number,
//     peak: number,       // highest session % seen in it
//   }

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const WINDOW_LENGTH_MS = 5 * HOUR_MS;
/** About eight weeks' worth at five windows a day. */
export const MAX_WINDOWS = 300;
/** Reset times this close together are the same window; the endpoint's wobble a little. */
const SAME_WINDOW_MS = 5 * 60 * 1000;

/** Folds one reading into the list of windows and returns the new list. */
export function foldWindow(list, snapshot, max = MAX_WINDOWS) {
  const windows = list ?? [];
  const session = snapshot?.session;
  // An untouched session has no window yet: it opens with the first message.
  if (!session || session.resetsAt == null || session.percentUsed <= 0) return windows;

  const last = windows.at(-1);
  if (last && Math.abs(last.resetsAt - session.resetsAt) <= SAME_WINDOW_MS) {
    return [
      ...windows.slice(0, -1),
      { ...last, lastSeen: snapshot.fetchedAt, peak: Math.max(last.peak, session.percentUsed) },
    ];
  }
  if (last && session.resetsAt < last.resetsAt) return windows; // an out-of-order reading

  return [
    ...windows,
    {
      start: session.resetsAt - WINDOW_LENGTH_MS,
      resetsAt: session.resetsAt,
      firstSeen: snapshot.fetchedAt,
      lastSeen: snapshot.fetchedAt,
      peak: session.percentUsed,
    },
  ].slice(-max);
}

/** Builds the list from a run of readings — used once, to seed it from the existing history. */
export function buildWindows(history) {
  return (history ?? []).reduce((windows, snapshot) => foldWindow(windows, snapshot), []);
}

function startOfDay(epochMs) {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * The last `days` days as timeline rows, today first. Each bar is the part of
 * a window that falls on that day, as a share of the day: a window that
 * crosses midnight shows up on both.
 * @returns {Array<{ dayStart: number, bars: Array<{ left: number, width: number, peak: number, start: number, resetsAt: number, live: boolean }> }>}
 */
export function timelineDays(windows, { now = Date.now(), days = 7 } = {}) {
  const rows = [];
  let dayStart = startOfDay(now);
  for (let index = 0; index < days; index++) {
    // Midnight to midnight by the clock, so a daylight-saving day is still one row.
    const dayEnd = startOfDay(dayStart + DAY_MS + 2 * HOUR_MS);
    const length = dayEnd - dayStart;
    rows.push({
      dayStart,
      bars: (windows ?? [])
        .filter((w) => w.resetsAt > dayStart && w.start < dayEnd)
        .map((w) => {
          const from = Math.max(w.start, dayStart);
          const to = Math.min(w.resetsAt, dayEnd);
          return {
            left: ((from - dayStart) / length) * 100,
            width: ((to - from) / length) * 100,
            peak: w.peak,
            start: w.start,
            resetsAt: w.resetsAt,
            live: w.resetsAt > now,
          };
        }),
    });
    dayStart = startOfDay(dayStart - 2 * HOUR_MS);
  }
  return rows;
}

/**
 * @returns {{ count: number, averagePeak: number | null, full: number, perDay: number }}
 *   for the windows that opened in the last `days` days
 */
export function summarizeWindows(windows, { now = Date.now(), days = 7 } = {}) {
  const recent = (windows ?? []).filter((w) => w.start > now - days * DAY_MS && w.start <= now);
  return {
    count: recent.length,
    averagePeak: recent.length > 0 ? Math.round(recent.reduce((sum, w) => sum + w.peak, 0) / recent.length) : null,
    full: recent.filter((w) => w.peak >= 100).length,
    perDay: Math.round((recent.length / days) * 10) / 10,
  };
}
