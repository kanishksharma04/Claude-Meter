// Claude Code usage, from the logs it keeps on disk.
//
// Claude Code writes every conversation to ~/.claude/projects/<project>/<session>.jsonl,
// one JSON object per line. Assistant lines carry the API's own token counts,
// so unlike the claude.ai side — where all there is to go on is a percentage —
// this is exact: tokens in, tokens out, cache reads and writes, per message.
//
// The browser can't read those files. A small companion program does
// (companion/claudemeter-agent.mjs), and hands what it finds to this module,
// which is pure: it turns parsed lines into records and records into a summary.
// It is deliberately tolerant — the line format is not a published one and
// drifts between Claude Code releases.

import { priceFor, CACHE_WRITE_MULTIPLIER } from "./value.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The native-messaging host the extension asks the browser to start (see companion/). */
export const COMPANION_HOST = "com.claudemeter.agent";

export const SESSION_WINDOW_MS = 5 * HOUR_MS;
/** How far back the summary looks. */
export const SUMMARY_DAYS = 7;

function count(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * One parsed log line as a usage record, or null when the line carries no
 * token usage (prompts, tool results, titles, snapshots).
 *
 *   Record = {
 *     ts: number,             // epoch ms the reply was written
 *     key: string | null,     // identifies the API response; the same one can appear on several lines
 *     model: string,
 *     sessionId: string | null,
 *     cwd: string | null,     // the directory Claude Code was working in
 *     input, output, cacheRead, cacheWrite5m, cacheWrite1h: number,   // tokens
 *   }
 */
export function parseUsageLine(line) {
  const usage = line?.message?.usage;
  if (!usage || typeof usage !== "object") return null;

  const ts = Date.parse(line.timestamp);
  if (Number.isNaN(ts)) return null;

  // Newer logs split cache writes by how long the entry is kept; older ones give one figure.
  const split = usage.cache_creation && typeof usage.cache_creation === "object" ? usage.cache_creation : null;
  const cacheWrite1h = count(split?.ephemeral_1h_input_tokens);
  const cacheWrite5m = split ? count(split.ephemeral_5m_input_tokens) : count(usage.cache_creation_input_tokens);

  const record = {
    ts,
    key: line.message.id && line.requestId ? `${line.message.id}:${line.requestId}` : null,
    model: typeof line.message.model === "string" ? line.message.model : "unknown",
    sessionId: typeof line.sessionId === "string" ? line.sessionId : null,
    cwd: typeof line.cwd === "string" ? line.cwd : null,
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite5m,
    cacheWrite1h,
  };
  // A line for a synthetic message (an error placeholder, say) has a usage block of zeros.
  return tokensOf(record) > 0 ? record : null;
}

export function tokensOf(record) {
  return record.input + record.output + record.cacheRead + record.cacheWrite5m + record.cacheWrite1h;
}

/** What the record's tokens cost at API list prices, in US$. */
export function costOf(record) {
  const price = priceFor(record.model);
  return (
    (record.input * price.input +
      record.output * price.output +
      record.cacheRead * price.cacheRead +
      record.cacheWrite5m * price.input * CACHE_WRITE_MULTIPLIER.fiveMinutes +
      record.cacheWrite1h * price.input * CACHE_WRITE_MULTIPLIER.oneHour) /
    1_000_000
  );
}

/**
 * Claude Code writes one line per content block, so a single API response —
 * and its one usage figure — turns up on several lines. Keep the last line
 * for each response: it is the one written when the reply was complete.
 */
export function dedupeRecords(records) {
  const byKey = new Map();
  const unkeyed = [];
  for (const record of records ?? []) {
    if (record.key) byKey.set(record.key, record);
    else unkeyed.push(record);
  }
  return [...byKey.values(), ...unkeyed].sort((a, b) => a.ts - b.ts);
}

const emptyTotals = () => ({ tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 });

function addTo(totals, record) {
  totals.tokens += tokensOf(record);
  totals.input += record.input;
  totals.output += record.output;
  totals.cacheRead += record.cacheRead;
  totals.cacheWrite += record.cacheWrite5m + record.cacheWrite1h;
  totals.cost += costOf(record);
  totals.messages += 1;
}

function startOfDay(epochMs) {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * The 5-hour window `now` falls in, worked out from the activity alone: a
 * window opens with the first message after the previous one ran out. Used
 * when the extension can't supply the real window from claude.ai.
 */
export function currentWindow(records, now) {
  let start = null;
  for (const record of records) {
    if (record.ts > now) break;
    if (start == null || record.ts >= start + SESSION_WINDOW_MS) start = record.ts;
  }
  return start != null && now < start + SESSION_WINDOW_MS ? { from: start, to: start + SESSION_WINDOW_MS } : null;
}

/**
 * @param {Array<object>} records - Records, in any order, duplicates and all
 * @param {object} [options]
 * @param {number} [options.sessionResetsAt] - when the claude.ai session resets, if the extension knows;
 *   Claude Code draws on the same 5-hour allowance, so that is its window too
 * @returns {{ generatedAt: number, session: object, today: object, week: object,
 *   models: Array<{ model: string, tokens: number, cost: number }> }}
 *   `session`, `today` and `week` are totals ({ tokens, input, output, cacheRead, cacheWrite, cost, messages });
 *   `session` also has `from` / `to`, null when no window is open
 */
export function summarizeClaudeCode(records, { now = Date.now(), sessionResetsAt = null } = {}) {
  const all = dedupeRecords(records).filter((record) => record.ts <= now && record.ts > now - SUMMARY_DAYS * DAY_MS);

  const window =
    sessionResetsAt != null && sessionResetsAt > now
      ? { from: sessionResetsAt - SESSION_WINDOW_MS, to: sessionResetsAt }
      : currentWindow(all, now);
  const dayStart = startOfDay(now);

  const session = { from: window?.from ?? null, to: window?.to ?? null, ...emptyTotals() };
  const today = emptyTotals();
  const week = emptyTotals();
  const models = new Map();

  for (const record of all) {
    addTo(week, record);
    if (record.ts >= dayStart) addTo(today, record);
    if (window && record.ts >= window.from) addTo(session, record);

    const model = models.get(record.model) ?? { model: record.model, tokens: 0, cost: 0 };
    model.tokens += tokensOf(record);
    model.cost += costOf(record);
    models.set(record.model, model);
  }

  return {
    generatedAt: now,
    session,
    today,
    week,
    models: [...models.values()].sort((a, b) => b.cost - a.cost),
  };
}

/**
 * The browser's reasons for not reaching the companion, in words that say what to do about it.
 * @param {string} message - the error from chrome.runtime.sendNativeMessage / connectNative
 * @returns {{ code: "not-installed" | "forbidden" | "crashed" | "unknown", text: string }}
 */
export function companionProblem(message) {
  const error = String(message ?? "");
  if (/host not found/i.test(error)) {
    return { code: "not-installed", text: "The companion isn't installed for this browser yet. Run the command below, then check again." };
  }
  if (/forbidden/i.test(error)) {
    return {
      code: "forbidden",
      text: "The companion is installed for a different extension id. Run the command below again: it has this copy's id in it.",
    };
  }
  if (/has exited|failed to start|error when communicating/i.test(error)) {
    return {
      code: "crashed",
      text: "The companion started but stopped at once. Check that Node.js 18 or newer is installed and that the ClaudeMeter folder hasn't moved, then run the command below again.",
    };
  }
  return { code: "unknown", text: `Couldn't reach the companion: ${error || "no reason given"}.` };
}
