// The status file: the one thing the companion writes, and ClaudeMeter's way
// out of the browser. It holds the plan usage the extension last reported —
// figures that otherwise exist only inside the browser — and a digest of the
// Claude Code usage read from the logs, as plain JSON that anything can read:
// the `claudemeter` command, a Raycast script, a Stream Deck key, a menu-bar
// tool. Its shape is described in status.schema.json and is meant to stay put;
// `schema` goes up if it ever can't.
//
// Next to it goes status.txt, the same thing as one line of text, for tools
// that can show a file's contents but not pick a value out of JSON.
//
// Both live in the companion's own folder (never under ~/.claude) and are
// replaced whole each time, by writing a neighbour and renaming it over the
// old one, so a reader never sees half a file.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./paths.mjs";
import { formatStatus } from "./status-format.mjs";

export const STATUS_FILE = "status.json";
export const STATUS_TEXT_FILE = "status.txt";
/** Raised only for a change that would break a reader; new fields don't count. */
export const STATUS_SCHEMA = 1;

export function statusPath(directory = dataDir()) {
  return join(directory, STATUS_FILE);
}

const iso = (epochMs) => (epochMs != null ? new Date(epochMs).toISOString() : null);

/** The part of a Claude Code summary worth handing on: totals, not the lists behind them. */
function digestClaudeCode(usage) {
  if (!usage) return null;
  const totals = (t) => ({ cost: Math.round(t.cost * 100) / 100, tokens: t.tokens, messages: t.messages });
  return {
    generatedAt: usage.generatedAt,
    // Null when no 5-hour window is open.
    session: usage.session.from != null ? { ...totals(usage.session), from: usage.session.from, to: usage.session.to } : null,
    today: totals(usage.today),
    week: totals(usage.week),
    cacheHitRate: usage.cache?.week.hitRate != null ? Math.round(usage.cache.week.hitRate * 1000) / 1000 : null,
    topProject: usage.projects?.[0] ? { name: usage.projects[0].name, cost: Math.round(usage.projects[0].cost * 100) / 100 } : null,
  };
}

/**
 * What goes in the file.
 * @param {object | null} plan - { fetchedAt, tier, session, weekly, thresholds, hidden } as the extension reports it
 * @param {object | null} [usage] - a Claude Code summary (lib/claude-code.js), when the companion has one
 */
export function buildStatus(plan, usage = null, now = Date.now()) {
  const bucket = (b) => (b ? { percent: b.percent, resetsAt: b.resetsAt ?? null, resetsAtIso: iso(b.resetsAt) } : null);
  const hidden = Boolean(plan?.hidden);
  const status = {
    schema: STATUS_SCHEMA,
    updatedAt: now,
    updatedAtIso: iso(now),
    plan: {
      // When the extension last heard from claude.ai — older than `updatedAt` if a refresh failed.
      fetchedAt: plan?.fetchedAt ?? null,
      tier: plan?.tier ?? null,
      // Privacy mode is on in the browser: the figures are withheld here too.
      hidden,
      session: hidden ? null : bucket(plan?.session),
      weekly: hidden ? [] : (plan?.weekly ?? []).map((b) => ({ label: b.label, ...bucket(b) })),
      thresholds: { warnAt: plan?.thresholds?.warnAt ?? 80, dangerAt: plan?.thresholds?.dangerAt ?? 95 },
    },
    // Dollars are API list prices for the tokens in Claude Code's logs, not money charged.
    claudeCode: hidden ? null : digestClaudeCode(usage),
  };
  // The line `claudemeter status` would print, for tools that just want something to show.
  status.display = { line: formatStatus(status, { now, maxAgeMinutes: 0 }).text };
  return status;
}

async function replace(path, content) {
  const draft = `${path}.${process.pid}.tmp`;
  await writeFile(draft, content);
  await rename(draft, path);
}

export async function writeStatus(status, directory = dataDir()) {
  await mkdir(directory, { recursive: true });
  const path = statusPath(directory);
  await replace(path, JSON.stringify(status, null, 2) + "\n");
  await replace(join(directory, STATUS_TEXT_FILE), status.display.line + "\n");
  return path;
}

/** Takes both files away — for when the user has switched the output off: no file is better than a stale one. */
export async function removeStatus(directory = dataDir()) {
  await rm(statusPath(directory), { force: true });
  await rm(join(directory, STATUS_TEXT_FILE), { force: true });
}

/** @returns {Promise<object | null>} null when there is no file yet, or it can't be read */
export async function readStatus(directory = dataDir()) {
  try {
    return JSON.parse(await readFile(statusPath(directory), "utf8"));
  } catch {
    return null;
  }
}
