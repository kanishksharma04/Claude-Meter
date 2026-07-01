// Normalizes the raw response from
//   GET https://claude.ai/api/organizations/{org_id}/usage
// into the UsageSnapshot shape the rest of the extension consumes.
//
// The endpoint is undocumented — this file must never throw on a response
// shape it doesn't fully recognize. Anything it can't confidently parse is
// simply omitted rather than crashing the caller.
//
// Known shape (reverse-engineered, confirmed against multiple open-source
// claude.ai usage extensions as of mid-2026):
//   {
//     "five_hour":       { "utilization": <0-1 or 0-100>, "resets_at": "<ISO8601>" },
//     "seven_day":       { "utilization": ..., "resets_at": ... },
//     "seven_day_opus":  { "utilization": ..., "resets_at": ... },
//     // possibly other "seven_day_<model>" keys
//   }
// with "utilization_pct" / "reset_at" as seen fallback field names.

import { formatDuration } from "./time-format.js";

const SESSION_KEY_PATTERN = /^five_hour/i;
const WEEKLY_KEY_PATTERN = /^seven_day/i;
const PLAN_FIELD_CANDIDATES = ["rate_limit_tier", "plan_tier", "plan", "subscription_tier", "tier"];

function toPercent(rawValue) {
  if (typeof rawValue !== "number" || Number.isNaN(rawValue)) return null;
  const pct = rawValue <= 1 ? rawValue * 100 : rawValue;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function toEpochMs(rawValue) {
  if (!rawValue) return null;
  const parsed = Date.parse(rawValue);
  return Number.isNaN(parsed) ? null : parsed;
}

function humanizeWeeklyLabel(key) {
  if (key === "seven_day") return "All models";
  const suffix = key.replace(/^seven_day_?/i, "").replace(/_/g, " ").trim();
  if (!suffix) return "All models";
  return suffix.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalize one { utilization, resets_at } style block. Returns null if unusable. */
function normalizeBucket(block, fetchedAt, label) {
  if (!block || typeof block !== "object") return null;

  const percentUsed = toPercent(block.utilization ?? block.utilization_pct ?? block.percent_used ?? null);
  const resetsAt = toEpochMs(block.resets_at ?? block.reset_at ?? block.resetsAt ?? null);

  if (percentUsed == null) return null;

  const resetsInLabel = resetsAt != null ? formatDuration(fetchedAt, resetsAt) ?? "unknown" : "unknown";

  return { label, percentUsed, resetsAt, resetsInLabel };
}

// Only surface a badge when the raw value actually names a known plan —
// fields like rate_limit_tier can hold internal defaults (e.g.
// "DEFAULT_CLAUDE_AI") that aren't a plan name and would just confuse users.
const KNOWN_PLAN_KEYWORDS = ["free", "pro", "max", "team", "enterprise"];

function humanizePlanTier(raw) {
  const lower = raw.toLowerCase();
  const matched = KNOWN_PLAN_KEYWORDS.find((kw) => lower.includes(kw));
  if (!matched) return null;
  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function detectPlanTier(orgMeta) {
  if (!orgMeta || typeof orgMeta !== "object") return null;
  for (const field of PLAN_FIELD_CANDIDATES) {
    if (typeof orgMeta[field] === "string" && orgMeta[field].trim()) {
      const humanized = humanizePlanTier(orgMeta[field].trim());
      if (humanized) return humanized;
    }
  }
  return null;
}

/**
 * @param {unknown} raw - parsed JSON body from the usage endpoint
 * @param {{ orgMeta?: object }} [context] - extra data (e.g. org record) for fields the usage endpoint itself doesn't carry
 * @returns {import("./types").UsageSnapshot | null} null only if raw is unusable (not an object at all)
 */
export function normalizeUsageResponse(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  const fetchedAt = Date.now();
  const keys = Object.keys(raw);

  const sessionKey = keys.find((k) => SESSION_KEY_PATTERN.test(k));
  const session = sessionKey
    ? normalizeBucket(raw[sessionKey], fetchedAt, "Current session")
    : null;

  const weekly = keys
    .filter((k) => WEEKLY_KEY_PATTERN.test(k))
    .map((k) => normalizeBucket(raw[k], fetchedAt, humanizeWeeklyLabel(k)))
    .filter(Boolean);

  return {
    fetchedAt,
    planTier: detectPlanTier(context.orgMeta),
    // null when the session bucket couldn't be parsed — callers should
    // render a "not available" state rather than assuming 0% used.
    session,
    weekly,
  };
}
