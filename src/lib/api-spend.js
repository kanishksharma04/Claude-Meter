// Anthropic Console API spend: what the organisation's API keys have cost, from
// the Console's own cost report.
//
// This is a different account from the claude.ai plan the rest of ClaudeMeter
// watches — pay-as-you-go API usage, billed in dollars — and a different door:
// the Admin API (GET /v1/organizations/cost_report), which takes an Admin API
// key rather than the browser's sign-in. The report is daily, in UTC, with
// each amount a decimal string in cents.
//
// This module is the pure part: building the request, reading the response,
// and summing it up. lib/console-api.js does the fetching.

const DAY_MS = 24 * 60 * 60 * 1000;

export const COST_REPORT_URL = "https://api.anthropic.com/v1/organizations/cost_report";
/** The most daily buckets one request may ask for; also how far back the panel looks. */
export const REPORT_DAYS = 31;

/** Midnight UTC of the day `epochMs` falls in — the report's days are UTC days. */
export function utcDayStart(epochMs) {
  return Math.floor(epochMs / DAY_MS) * DAY_MS;
}

/** The request for the last REPORT_DAYS days up to and including today, optionally continuing from `page`. */
export function costReportRequest(now = Date.now(), page = null) {
  const url = new URL(COST_REPORT_URL);
  url.searchParams.set("starting_at", new Date(utcDayStart(now) - (REPORT_DAYS - 1) * DAY_MS).toISOString());
  url.searchParams.set("ending_at", new Date(utcDayStart(now) + DAY_MS).toISOString());
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.append("group_by[]", "description");
  url.searchParams.set("limit", String(REPORT_DAYS));
  if (page) url.searchParams.set("page", page);
  return url.toString();
}

/** "123.45" cents -> 1.2345 dollars; anything unreadable counts as nothing. */
function dollars(amount) {
  const cents = Number(amount);
  return Number.isFinite(cents) ? cents / 100 : 0;
}

/** What a cost item is filed under: its model, or for non-token costs what kind of cost it is. */
function lineOf(result) {
  if (result.model) return result.model;
  if (result.cost_type === "web_search") return "Web search";
  if (result.cost_type === "code_execution") return "Code execution";
  if (result.cost_type === "session_usage") return "Session usage";
  return result.description || "Other";
}

/**
 * The report's time buckets (from one page or several) as days.
 * @param {Array<object>} buckets - `data` from the cost report
 * @returns {Array<{ day: number, total: number, lines: Record<string, number> }>} oldest first;
 *   `day` is the bucket's start (midnight UTC), amounts are US dollars
 */
export function parseCostReport(buckets) {
  const days = new Map();
  for (const bucket of buckets ?? []) {
    const day = Date.parse(bucket?.starting_at);
    if (Number.isNaN(day)) continue;
    const entry = days.get(day) ?? { day, total: 0, lines: {} };
    for (const result of bucket.results ?? []) {
      const amount = dollars(result?.amount);
      entry.total += amount;
      const line = lineOf(result ?? {});
      entry.lines[line] = (entry.lines[line] ?? 0) + amount;
    }
    days.set(day, entry);
  }
  return [...days.values()].sort((a, b) => a.day - b.day);
}

/**
 * @param {Array<object>} days - from parseCostReport()
 * @returns {{ today: number, yesterday: number, last7: number, last30: number, monthToDate: number,
 *   projectedMonth: number | null, daily: Array<{ day: number, total: number }>, lines: Array<{ name: string, total: number }> }}
 *   `daily` is the last 30 days with gaps filled; `lines` is where the month's money went, largest first;
 *   `projectedMonth` extends the month so far at its daily average, null on the 1st
 */
export function summarizeSpend(days, now = Date.now()) {
  const today = utcDayStart(now);
  const byDay = new Map((days ?? []).map((entry) => [entry.day, entry]));
  const since = (from) => (days ?? []).filter((entry) => entry.day >= from && entry.day <= today);
  const sum = (entries) => entries.reduce((total, entry) => total + entry.total, 0);

  const date = new Date(now);
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const month = since(monthStart);
  const monthToDate = sum(month);
  // Days fully behind us this month: today's bill is still growing, so it would drag the average down.
  const complete = Math.round((today - monthStart) / DAY_MS);
  const completeTotal = sum(month.filter((entry) => entry.day < today));

  const lines = new Map();
  for (const entry of month) {
    for (const [name, amount] of Object.entries(entry.lines)) lines.set(name, (lines.get(name) ?? 0) + amount);
  }

  return {
    today: byDay.get(today)?.total ?? 0,
    yesterday: byDay.get(today - DAY_MS)?.total ?? 0,
    last7: sum(since(today - 6 * DAY_MS)),
    last30: sum(since(today - 29 * DAY_MS)),
    monthToDate,
    projectedMonth: complete > 0 ? monthToDate + (completeTotal / complete) * (daysInMonth - complete - 1) : null,
    daily: Array.from({ length: 30 }, (_, index) => {
      const day = today - (29 - index) * DAY_MS;
      return { day, total: byDay.get(day)?.total ?? 0 };
    }),
    lines: [...lines]
      .map(([name, total]) => ({ name, total }))
      .filter((line) => line.total > 0)
      .sort((a, b) => b.total - a.total),
  };
}

/** Does this look like an Admin API key? A workspace key (sk-ant-api…) can't read the cost report. */
export function isAdminKey(value) {
  return /^sk-ant-admin[\w-]{20,}$/.test(String(value ?? "").trim());
}

/** A key as it can be shown: enough to tell which one it is, not enough to use. */
export function maskKey(key) {
  const text = String(key ?? "");
  return text.length > 20 ? `${text.slice(0, 14)}…${text.slice(-4)}` : "…";
}

/**
 * The API's reasons for refusing, in words that say what to do about it.
 * @param {number} status - HTTP status, or 0 when the request never got an answer
 * @returns {{ code: string, text: string }}
 */
export function spendProblem(status) {
  if (status === 401) return { code: "bad-key", text: "Anthropic didn't accept that key. Check it was copied whole, and that it hasn't been deleted in the Console." };
  if (status === 403) {
    return { code: "not-admin", text: "That key isn't allowed to read cost reports. It needs to be an Admin API key (sk-ant-admin…), which only an organisation's admins can create." };
  }
  if (status === 404) return { code: "unavailable", text: "This organisation has no cost report. The Admin API isn't available to individual accounts." };
  if (status === 429) return { code: "rate-limited", text: "Anthropic asked ClaudeMeter to slow down. It will try again later." };
  if (status === 0) return { code: "network", text: "Couldn't reach api.anthropic.com. Check your connection, and that the browser was allowed to contact it." };
  return { code: "http", text: `Anthropic answered with an error (HTTP ${status}).` };
}
