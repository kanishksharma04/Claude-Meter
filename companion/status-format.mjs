// Turns the status file into one short line for a terminal: the Claude Code
// status line, a tmux status bar, a shell prompt. Pure — the command in
// claudemeter.mjs does the reading and printing.

const MINUTE_MS = 60 * 1000;

/** What `claudemeter status` prints when no --format is given. */
export const DEFAULT_FORMAT = "5h {session} · wk {weekly}";
export const DEFAULT_FORMAT_WITH_RESETS = "5h {session} ({session_reset}) · wk {weekly} ({weekly_reset})";

/** Older than this, the figures are marked as stale: the browser is probably closed. */
export const DEFAULT_MAX_AGE_MINUTES = 15;

/** A time still to come, as briefly as it can be said: "45m", "2h14m", "3d6h". */
export function shortDuration(ms) {
  if (ms == null) return "?";
  const minutes = Math.max(0, Math.round(ms / MINUTE_MS));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d${hours % 24}h` : `${days}d`;
}

function severity(percent, { warnAt, dangerAt }) {
  return percent >= dangerAt ? "danger" : percent >= warnAt ? "warn" : "ok";
}

const PAINT = {
  none: (text) => text,
  ansi: (text, level) => `\x1b[${{ ok: 32, warn: 33, danger: 31 }[level]}m${text}\x1b[0m`,
  tmux: (text, level) => `#[fg=${{ ok: "green", warn: "yellow", danger: "red" }[level]}]${text}#[default]`,
};

/**
 * @param {object | null} status - the status file's contents
 * @param {object} [options]
 * @param {string} [options.format] - a template; see PLACEHOLDERS in the command's help
 * @param {"none" | "ansi" | "tmux"} [options.color]
 * @param {number} [options.maxAgeMinutes] - 0 never marks anything stale
 * @returns {{ text: string, ok: boolean }} `ok` is false when there was nothing to show
 */
export function formatStatus(status, { format = DEFAULT_FORMAT, color = "none", maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES, now = Date.now() } = {}) {
  const plan = status?.plan;
  if (!plan) return { text: "ClaudeMeter: no data yet", ok: false };
  if (plan.hidden) return { text: "usage hidden", ok: true };
  if (!plan.session && plan.weekly.length === 0) return { text: "ClaudeMeter: no data yet", ok: false };

  // Stale figures are still the best there is, so they are shown — marked, not withheld.
  const stale = maxAgeMinutes > 0 && now - (plan.fetchedAt ?? status.updatedAt) > maxAgeMinutes * MINUTE_MS;
  const paint = PAINT[color] ?? PAINT.none;
  const percent = (bucket) => {
    if (!bucket) return "–";
    // A window whose reset time has passed is over, whatever the last reading said.
    const lapsed = bucket.resetsAt != null && bucket.resetsAt <= now;
    const value = lapsed ? 0 : bucket.percent;
    return paint(`${stale && !lapsed ? "~" : ""}${value}%`, severity(value, plan.thresholds));
  };
  const reset = (bucket) => (bucket?.resetsAt != null && bucket.resetsAt > now ? shortDuration(bucket.resetsAt - now) : "–");

  // "The weekly limit" in one figure is the fullest of them, as the pill on claude.ai has it.
  const fullest = [...plan.weekly].sort((a, b) => b.percent - a.percent)[0] ?? null;
  const named = (label) => plan.weekly.find((bucket) => bucket.label.toLowerCase() === label.trim().toLowerCase()) ?? null;

  const text = format.replace(/\{([a-z_]+)(?::([^}]*))?\}/g, (whole, key, argument) => {
    if (key === "session") return percent(plan.session);
    if (key === "session_reset") return reset(plan.session);
    if (key === "weekly") return percent(argument ? named(argument) : fullest);
    if (key === "weekly_reset") return reset(argument ? named(argument) : fullest);
    if (key === "weekly_label") return fullest?.label ?? "–";
    if (key === "tier") return plan.tier ?? "";
    if (key === "age") return shortDuration(now - (plan.fetchedAt ?? status.updatedAt));
    return whole; // not one of ours: left as written
  });
  return { text, ok: true };
}
