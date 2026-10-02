// The status file: the one thing the companion writes. It holds the plan usage
// the extension last reported — the figures that otherwise exist only inside
// the browser — so that things outside it can read them: the `claudemeter`
// command first of all.
//
// It lives in the companion's own folder (never under ~/.claude) and is
// replaced whole each time, by writing a neighbour and renaming it over the
// old one, so a reader never sees half a file.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./paths.mjs";

export const STATUS_FILE = "status.json";

export function statusPath(directory = dataDir()) {
  return join(directory, STATUS_FILE);
}

/**
 * What goes in the file, from what the extension sent.
 * @param {object} plan - { fetchedAt, tier, session, weekly, thresholds, hidden } as the extension reports it
 */
export function buildStatus(plan, now = Date.now()) {
  const bucket = (b) => (b ? { percent: b.percent, resetsAt: b.resetsAt ?? null } : null);
  return {
    updatedAt: now,
    plan: {
      // When the extension last heard from claude.ai — older than `updatedAt` if a refresh failed.
      fetchedAt: plan?.fetchedAt ?? null,
      tier: plan?.tier ?? null,
      // Privacy mode is on in the browser: the figures are withheld here too.
      hidden: Boolean(plan?.hidden),
      session: plan?.hidden ? null : bucket(plan?.session),
      weekly: plan?.hidden ? [] : (plan?.weekly ?? []).map((b) => ({ label: b.label, ...bucket(b) })),
      thresholds: { warnAt: plan?.thresholds?.warnAt ?? 80, dangerAt: plan?.thresholds?.dangerAt ?? 95 },
    },
  };
}

export async function writeStatus(status, directory = dataDir()) {
  await mkdir(directory, { recursive: true });
  const path = statusPath(directory);
  const draft = `${path}.${process.pid}.tmp`;
  await writeFile(draft, JSON.stringify(status, null, 2) + "\n");
  await rename(draft, path);
  return path;
}

/** @returns {Promise<object | null>} null when there is no file yet, or it can't be read */
export async function readStatus(directory = dataDir()) {
  try {
    return JSON.parse(await readFile(statusPath(directory), "utf8"));
  } catch {
    return null;
  }
}
