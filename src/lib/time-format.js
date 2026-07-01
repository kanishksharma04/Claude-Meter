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
