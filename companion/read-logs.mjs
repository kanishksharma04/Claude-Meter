// Reads Claude Code's logs off disk and turns them into usage records.
// Read-only: nothing under ~/.claude is ever written, moved or deleted.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseUsageLine, SUMMARY_DAYS } from "../src/lib/claude-code.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Limits, so a huge or runaway log directory can't stall the browser's request. */
const MAX_FILES = 800;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 6;

/** Every .jsonl under `dir` touched since `since`, newest first. */
async function findLogs(dir, since, depth = 0, found = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found; // no such directory, or not ours to read
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) await findLogs(path, since, depth + 1, found);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs >= since && info.size <= MAX_FILE_BYTES) found.push({ path, mtimeMs: info.mtimeMs, size: info.size });
    }
  }
  return depth === 0 ? found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_FILES) : found;
}

function parseLines(text) {
  const records = [];
  for (const line of text.split("\n")) {
    // Cheap pre-check: only lines with a usage block can become a record, and most lines are long.
    if (!line.includes('"usage"')) continue;
    try {
      const record = parseUsageLine(JSON.parse(line));
      if (record) records.push(record);
    } catch {
      // A half-written last line, or one that isn't JSON: skip it.
    }
  }
  return records;
}

/**
 * @param {string} claudeDirectory - usually ~/.claude
 * @returns {Promise<{ records: object[], files: number }>} every usage record from the
 *   logs touched in the last week or so
 */
export async function readUsage(claudeDirectory, now = Date.now()) {
  // A day's margin: a file last touched just outside the window can still hold lines inside it.
  const logs = await findLogs(join(claudeDirectory, "projects"), now - (SUMMARY_DAYS + 1) * DAY_MS);
  const records = [];
  for (const log of logs) {
    const text = await readFile(log.path, "utf8").catch(() => "");
    records.push(...parseLines(text));
  }
  return { records, files: logs.length };
}
