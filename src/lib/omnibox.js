// The "cm" address-bar keyword: type `cm`, a space, and the dropdown shows your
// usage without opening anything. A few words after it run commands.
//
// This module only decides what to show and what an entry means — the service
// worker does the chrome.omnibox calls. Descriptions use the omnibox's small
// XML dialect (<match>, <dim>), so anything interpolated must be escaped.

import { formatDuration } from "./time-format.js";

/**
 * What Enter can do. The first keyword is what gets suggested; the rest are
 * accepted aliases. `enter` finishes the sentence "Enter …" in the top row.
 */
export const COMMANDS = [
  {
    id: "dashboard",
    keywords: ["dashboard", "history", "chart"],
    description: "Open the ClaudeMeter dashboard",
    enter: "opens the dashboard",
  },
  { id: "refresh", keywords: ["refresh", "reload", "update"], description: "Refresh usage now", enter: "refreshes usage" },
  { id: "claude", keywords: ["open", "claude", "chat"], description: "Open claude.ai", enter: "opens claude.ai" },
  { id: "options", keywords: ["options", "settings"], description: "Open ClaudeMeter options", enter: "opens options" },
  {
    id: "privacy",
    keywords: ["privacy", "hide", "blur"],
    description: "Turn privacy mode on or off",
    enter: "toggles privacy mode",
  },
];

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function bucketRows(snapshot, now) {
  const rows = [];
  if (snapshot?.session) rows.push({ name: "Session", bucket: snapshot.session });
  for (const bucket of snapshot?.weekly ?? []) rows.push({ name: `${bucket.label} (weekly)`, bucket });
  return rows.map(({ name, bucket }) => {
    const resetsIn = formatDuration(now, bucket.resetsAt);
    return { name, percentUsed: bucket.percentUsed, resetsIn };
  });
}

/** Which command a typed (or picked) entry means. Empty or unrecognised text is the default action. */
export function resolveCommand(text, hasSnapshot = true) {
  const word = String(text ?? "").trim().toLowerCase().split(/\s+/)[0];
  // Without a reading there is nothing to show on the dashboard — signing in is the useful thing.
  const fallback = hasSnapshot ? "dashboard" : "claude";
  if (!word) return fallback;
  const command = COMMANDS.find((c) => c.keywords.some((keyword) => keyword.startsWith(word)));
  return command?.id ?? fallback;
}

/**
 * @returns {{ defaultDescription: string, suggestions: Array<{ content: string, description: string }> }}
 *   `defaultDescription` is the top row — the one Enter acts on; `suggestions` are the rows under it.
 */
export function buildSuggestions(text, snapshot, { now = Date.now(), concealed = false } = {}) {
  const typed = String(text ?? "").trim().toLowerCase();
  const action = COMMANDS.find((c) => c.id === resolveCommand(typed, Boolean(snapshot)));
  // In privacy mode the address bar is as visible to an audience as anything else.
  const rows = concealed ? [] : bucketRows(snapshot, now);

  const summary = rows.map((row) => `${escapeXml(row.name)} <match>${row.percentUsed}%</match>`).join(" <dim>·</dim> ");
  const lead = concealed ? "Usage hidden (privacy mode)" : rows.length ? summary : "No usage reading yet";
  const defaultDescription = `${lead} <dim>— Enter ${escapeXml(action.enter)}</dim>`;

  // One row per limit with its reset time (picking one opens the dashboard)…
  const usage = rows.map((row) => ({
    content: `dashboard ${row.name.toLowerCase()}`,
    description:
      `${escapeXml(row.name)} <match>${row.percentUsed}% used</match>` +
      (row.resetsIn ? ` <dim>· resets in ${escapeXml(row.resetsIn)}</dim>` : ""),
  }));
  // …then the commands, narrowed to what has been typed so far.
  const commands = COMMANDS.filter((c) => !typed || c.keywords.some((keyword) => keyword.startsWith(typed))).map(
    (c) => ({ content: c.keywords[0], description: `<match>${c.keywords[0]}</match> <dim>— ${escapeXml(c.description)}</dim>` })
  );

  // Once the user is typing a command, lead with the matches; the usage rows are in the top line anyway.
  return { defaultDescription, suggestions: typed ? [...commands, ...usage] : [...usage, ...commands] };
}
