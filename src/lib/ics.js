// Reset calendar export: the weekly limit's reset as an iCalendar (.ics) file,
// so it can sit in the calendar next to everything else it affects. The weekly
// window is seven days long, so the event is exported as repeating weekly from
// the next reset. Limits that reset at the same moment share one event.
//
// The output follows RFC 5545 closely enough for Google Calendar, Apple
// Calendar and Outlook to import it: CRLF line ends, lines folded at 75
// octets, text escaped, times in UTC.

const MINUTE_MS = 60 * 1000;

/** Offered in the UI: minutes before the reset to be reminded; 0 = no reminder. */
export const REMINDER_OPTIONS = [0, 15, 60, 24 * 60];

/** How long the event is shown as lasting — a reset is a moment, but calendars want a span. */
const EVENT_MINUTES = 15;
/** Reset times this close together are one event. */
const SAME_RESET_MS = MINUTE_MS;

export const CALENDAR_FILENAME = "claude-weekly-reset.ics";

/** Epoch ms as an iCalendar UTC date-time, to the minute: 20260930T123000Z. */
export function icsDate(epochMs) {
  const iso = new Date(Math.round(epochMs / MINUTE_MS) * MINUTE_MS).toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Escapes a value for a TEXT property: backslash, semicolon, comma, and newlines. */
export function icsText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds one content line at 75 octets, continuing with a leading space, without splitting a character. */
export function foldLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines start with a space, which counts towards their 75.
    if (bytes + size > 75) {
      parts.push(current);
      current = " ";
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}

/** The weekly limits with a reset still ahead, grouped where they reset together, soonest first. */
export function weeklyResets(snapshot, now = Date.now()) {
  const groups = [];
  const upcoming = (snapshot?.weekly ?? [])
    .filter((bucket) => bucket.resetsAt != null && bucket.resetsAt > now)
    .sort((a, b) => a.resetsAt - b.resetsAt);
  for (const bucket of upcoming) {
    const group = groups.at(-1);
    if (group && bucket.resetsAt - group.resetsAt <= SAME_RESET_MS) group.labels.push(bucket.label);
    else groups.push({ resetsAt: bucket.resetsAt, labels: [bucket.label] });
  }
  return groups;
}

function reminderWords(minutes) {
  if (minutes >= 24 * 60) return `${minutes / (24 * 60)} day${minutes === 24 * 60 ? "" : "s"}`;
  if (minutes >= 60) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

/** "No reminder" / "15 minutes before" — for the menu. */
export function reminderLabel(minutes) {
  return minutes > 0 ? `${reminderWords(minutes)} before` : "No reminder";
}

/**
 * @param {import("./types").UsageSnapshot | null} snapshot
 * @param {object} [options]
 * @param {number} [options.reminderMinutes] - add an alarm this long before each reset; 0 for none
 * @returns {string | null} the .ics file's contents, or null when no weekly reset time is known
 */
export function buildResetCalendar(snapshot, { reminderMinutes = 0, now = Date.now() } = {}) {
  const resets = weeklyResets(snapshot, now);
  if (resets.length === 0) return null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ClaudeMeter//Reset calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Claude usage resets",
  ];

  for (const { resetsAt, labels } of resets) {
    const names = labels.join(", ");
    const summary = `Claude weekly limit resets (${names})`;
    // The same limits always get the same UID, so importing a newer file updates the event instead of adding a second.
    const uid = `weekly-${labels.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-")}@claudemeter`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(resetsAt)}`,
      `DTEND:${icsDate(resetsAt + EVENT_MINUTES * MINUTE_MS)}`,
      "RRULE:FREQ=WEEKLY",
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(
        `Your claude.ai weekly usage limit (${names}) resets at this time each week.\n` +
          "Exported by ClaudeMeter from the reset time claude.ai reported. If claude.ai moves the reset, export again."
      )}`,
      "TRANSP:TRANSPARENT" // it doesn't make you busy
    );
    if (reminderMinutes > 0) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsText(`${summary} in ${reminderWords(reminderMinutes)}`)}`,
        `TRIGGER:-PT${reminderMinutes}M`,
        "END:VALARM"
      );
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
