// "Snooze alerts": a pause on everything that nags — desktop notifications and
// the nudge banners on claude.ai — until a chosen time. Stored as one epoch-ms
// value (`snoozeUntil`, 0 = not snoozed) so every surface can check it cheaply.

const HOUR_MS = 60 * 60 * 1000;

/** The hour "until tomorrow morning" means. */
export const MORNING_HOUR = 8;

/** Offered in the toolbar icon's right-click menu, in this order. */
export const SNOOZE_OPTIONS = [
  { id: "1h", label: "For 1 hour" },
  { id: "4h", label: "For 4 hours" },
  { id: "tomorrow", label: "Until tomorrow morning" },
];

/** What a plain "snooze" (keyboard shortcut, no choice offered) uses. */
export const DEFAULT_SNOOZE = "1h";

/** Epoch ms at which a snooze started `now` with the given option ends. */
export function snoozeEnd(optionId, now = Date.now()) {
  if (optionId === "4h") return now + 4 * HOUR_MS;
  if (optionId === "tomorrow") {
    const morning = new Date(now);
    morning.setDate(morning.getDate() + 1);
    morning.setHours(MORNING_HOUR, 0, 0, 0);
    return morning.getTime();
  }
  return now + HOUR_MS;
}

export function isSnoozed(snoozeUntil, now = Date.now()) {
  return typeof snoozeUntil === "number" && snoozeUntil > now;
}
