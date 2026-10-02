// Reads Claude Code's logs off disk and turns them into usage records.
// Read-only: nothing under ~/.claude is ever written, moved or deleted.

import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseUsageLine, parseTitleLine, SUMMARY_DAYS } from "../src/lib/claude-code.js";

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

/**
 * @param {string} text - one log file
 * @param {string} fileSessionId - the session the file is named after
 * @param {Record<string, string>} titles - filled in as title lines are met; a later title replaces an earlier one
 */
function parseLines(text, fileSessionId, titles) {
  const records = [];
  for (const line of text.split("\n")) {
    // Cheap pre-checks: most lines are long, and only a few kinds are of any use here.
    const usage = line.includes('"usage"');
    const title = !usage && (line.includes('"ai-title"') || line.includes('"summary"'));
    if (!usage && !title) continue;
    try {
      const parsed = JSON.parse(line);
      if (usage) {
        const record = parseUsageLine(parsed);
        if (record) records.push(record);
      } else {
        const named = parseTitleLine(parsed, fileSessionId);
        if (named) titles[named.sessionId] = named.title;
      }
    } catch {
      // A half-written last line, or one that isn't JSON: skip it.
    }
  }
  return records;
}

/** Reads a file from byte `from` to its end. */
async function readFrom(path, from) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    if (size <= from) return Buffer.alloc(0);
    const buffer = Buffer.alloc(size - from);
    await file.read(buffer, 0, buffer.length, from);
    return buffer;
  } finally {
    await file.close();
  }
}

/**
 * A reader that remembers what it has already read. Claude Code only ever
 * appends to a log, so after the first pass a changed file costs just its new
 * lines — which is what makes it cheap to re-read on every change while
 * watching (see watch-logs.mjs).
 *
 * @returns {(claudeDirectory: string, now?: number) => Promise<{ records: object[], titles: Record<string, string>, files: number }>}
 *   every usage record from the logs touched in the last week or so, and the titles of the sessions in them
 */
export function createLogReader() {
  /** path -> { consumed: bytes read through the last complete line, mtimeMs, records, titles } */
  const seen = new Map();

  async function update(log) {
    let entry = seen.get(log.path);
    if (entry && entry.mtimeMs === log.mtimeMs && entry.consumed <= log.size) return entry;
    // Shorter than what was read before: the file was replaced, not appended to. Start it again.
    if (!entry || log.size < entry.consumed) entry = { consumed: 0, mtimeMs: 0, records: [], titles: {} };

    const added = await readFrom(log.path, entry.consumed).catch(() => Buffer.alloc(0));
    // Stop at the last newline: a line still being written is left for next time.
    const end = added.lastIndexOf(0x0a) + 1;
    entry.records.push(...parseLines(added.subarray(0, end).toString("utf8"), basename(log.path, ".jsonl"), entry.titles));
    entry.consumed += end;
    entry.mtimeMs = log.mtimeMs;
    seen.set(log.path, entry);
    return entry;
  }

  return async function read(claudeDirectory, now = Date.now()) {
    // A day's margin: a file last touched just outside the window can still hold lines inside it.
    const logs = await findLogs(join(claudeDirectory, "projects"), now - (SUMMARY_DAYS + 1) * DAY_MS);
    const current = new Set(logs.map((log) => log.path));
    for (const path of seen.keys()) if (!current.has(path)) seen.delete(path); // aged out, or deleted

    const records = [];
    const titles = {};
    // Oldest first, so that where two files title the same session the newer one wins.
    for (const log of [...logs].reverse()) {
      const entry = await update(log);
      records.push(...entry.records);
      Object.assign(titles, entry.titles);
    }
    return { records, titles, files: logs.length };
  };
}

/** One read, with nothing remembered — for a single request. */
export function readUsage(claudeDirectory, now = Date.now()) {
  return createLogReader()(claudeDirectory, now);
}
