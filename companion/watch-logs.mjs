// Watches Claude Code's log directory and says when something in it changed —
// the "push" in live push. The agent re-reads the logs when told.

import { watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** After a change, wait for this long a lull before reporting it… */
export const SETTLE_MS = 1_000;
/** …but while changes keep coming (a reply streaming in), report at least this often. */
export const MAX_WAIT_MS = 5_000;
/** Where the system can't watch a directory tree, look for changes this often instead. */
export const POLL_MS = 15_000;

/** The newest modification time anywhere under `dir`, two levels down — enough to notice a new or growing log. */
async function newestChange(dir, depth = 0) {
  let newest = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth < 2) newest = Math.max(newest, await newestChange(path, depth + 1));
    else if (entry.name.endsWith(".jsonl")) newest = Math.max(newest, (await stat(path).catch(() => null))?.mtimeMs ?? 0);
  }
  return newest;
}

/**
 * Calls `onChange` when the logs under `directory` change: once things have
 * been quiet for SETTLE_MS, or every MAX_WAIT_MS while they keep changing.
 *
 * @param {string} directory - ~/.claude/projects
 * @param {() => void} onChange
 * @returns {{ mode: "events" | "polling", close: () => void }} how it is watching, and how to stop
 */
export function watchLogs(directory, onChange) {
  let settle = null;
  let firstPending = 0;

  const report = () => {
    clearTimeout(settle);
    settle = null;
    firstPending = 0;
    onChange();
  };
  const changed = () => {
    const now = Date.now();
    firstPending ||= now;
    clearTimeout(settle);
    if (now - firstPending >= MAX_WAIT_MS) return report();
    settle = setTimeout(report, Math.min(SETTLE_MS, MAX_WAIT_MS - (now - firstPending)));
  };

  try {
    // One watcher for the whole tree. Not every platform or Node version can do that; those fall through to polling.
    const watcher = watch(directory, { recursive: true }, (_event, filename) => {
      if (!filename || String(filename).endsWith(".jsonl")) changed();
    });
    watcher.on("error", () => {}); // a watched folder being removed is not worth crashing over
    return { mode: "events", close: () => (clearTimeout(settle), watcher.close()) };
  } catch {
    let last = 0;
    const timer = setInterval(async () => {
      const newest = await newestChange(directory);
      if (newest > last) {
        if (last !== 0) report();
        last = newest;
      }
    }, POLL_MS);
    newestChange(directory).then((newest) => (last = newest));
    return { mode: "polling", close: () => (clearTimeout(settle), clearInterval(timer)) };
  }
}
