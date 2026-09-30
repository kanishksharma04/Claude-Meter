// Small time-formatting helpers shared by popup/options/debug UIs.
// No dependencies — kept tiny on purpose.

/** Format a past epoch-ms timestamp as a relative "X ago" string. */
export function timeAgo(epochMs) {
  if (!epochMs) return "never";
  const diffMs = Date.now() - epochMs;
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/** Wall-clock time of an epoch-ms timestamp — "4:30 PM", or "Tue 8:00 AM" when it isn't today. */
export function formatClock(epochMs, now = Date.now()) {
  const date = new Date(epochMs);
  const sameDay = date.toDateString() === new Date(now).toDateString();
  return date.toLocaleString([], {
    ...(sameDay ? {} : { weekday: "short" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A past moment, as briefly as stays unambiguous: "4:30 PM", "Tue 4:30 PM", or "24 Sep, 4:30 PM". */
export function formatMoment(epochMs, now = Date.now()) {
  if (Math.abs(now - epochMs) < 6 * 24 * 60 * 60 * 1000) return formatClock(epochMs, now);
  return new Date(epochMs).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Minutes since midnight as a clock time in the user's locale — "2:30 PM" or "14:30". */
export function formatTimeOfDay(minutes) {
  return new Date(2026, 0, 1, 0, minutes).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** An hour of the day (0–23) as a clock time — "2:00 PM" or "14:00". */
export function formatHour(hour) {
  return formatTimeOfDay(hour * 60);
}

/** Format the ms until a future epoch-ms timestamp as "X hr Y min" (or "X day Y hr" beyond a day). */
export function formatDuration(fromMs, toMs) {
  if (toMs == null) return null;
  const diffMs = toMs - fromMs;
  if (diffMs <= 0) return "now";
  const totalMin = Math.round(diffMs / 60000);

  if (totalMin >= 24 * 60) {
    const day = Math.floor(totalMin / (24 * 60));
    const hr = Math.floor((totalMin % (24 * 60)) / 60);
    if (hr === 0) return `${day} day${day === 1 ? "" : "s"}`;
    return `${day} day${day === 1 ? "" : "s"} ${hr} hr`;
  }

  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hr === 0) return `${min} min`;
  if (min === 0) return `${hr} hr`;
  return `${hr} hr ${min} min`;
}
