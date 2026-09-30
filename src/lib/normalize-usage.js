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
//
// Accounts with extra usage (pay-as-you-go past the plan's limits) also get
//     "extra_usage": { "is_enabled": true, "monthly_limit": 5000, "used_credits": 1240, "utilization": 24.8 }
// with the amounts in minor units (cents) and nulls when the feature is off.
// claude.ai's own settings page reads much the same thing from
// .../overage_spend_limit, as "monthly_credit_limit" / "used_credits" / "currency".

import { formatDuration } from "./time-format.js";

const SESSION_KEY_PATTERN = /^five_hour/i;
const WEEKLY_KEY_PATTERN = /^seven_day/i;
const PLAN_FIELD_CANDIDATES = ["rate_limit_tier", "plan_tier", "plan", "subscription_tier", "tier"];

function toPercent(rawValue) {
  if (typeof rawValue !== "number" || Number.isNaN(rawValue)) return null;
  // Below 1 is read as a 0–1 fraction. Exactly 1 is read as 1%, not 100%: on
  // the 0–100 scale the endpoint uses today that's an everyday reading, and
  // calling it "full" would raise a false lockout.
  const pct = rawValue < 1 ? rawValue * 100 : rawValue;
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

const EXTRA_USAGE_KEYS = ["extra_usage", "overage", "overage_spend_limit"];

function firstDefined(block, fields) {
  for (const field of fields) {
    if (block[field] != null) return block[field];
  }
  return null;
}

/** Minor units (cents) -> major units (dollars). */
function toMoney(rawValue) {
  return typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue >= 0 ? Math.round(rawValue) / 100 : null;
}

/**
 * Normalizes an extra-usage block, from the usage endpoint or from the
 * spend-limit one. Returns null when there is nothing recognisable in it, so
 * the UI shows nothing rather than an invented zero.
 * @returns {import("./extra-usage.js").ExtraUsage | null}
 */
export function normalizeExtraUsage(block) {
  if (!block || typeof block !== "object") return null;

  const flag = firstDefined(block, ["is_enabled", "enabled"]);
  const used = toMoney(firstDefined(block, ["used_credits", "used", "spent"]));
  const limit = toMoney(firstDefined(block, ["monthly_limit", "monthly_credit_limit", "spend_limit", "limit"]));
  if (typeof flag !== "boolean" && used == null && limit == null) return null;

  const percentUsed =
    used != null && limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : toPercent(block.utilization);
  return {
    enabled: typeof flag === "boolean" ? flag : true,
    used,
    limit,
    percentUsed: limit != null ? percentUsed : null,
    currency: typeof block.currency === "string" && block.currency ? block.currency.toUpperCase() : "USD",
  };
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
    // null for the many accounts whose response has no such block.
    extraUsage: normalizeExtraUsage(firstDefined(raw, EXTRA_USAGE_KEYS)),
  };
}
