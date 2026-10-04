// Reading claude.ai's usage response (src/lib/normalize-usage.js).

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUsageResponse, normalizeExtraUsage, hasUsageKeys, wholePercent } from "../src/lib/normalize-usage.js";
import { observeFullBuckets } from "../src/lib/limit-hits.js";
import { crossedThreshold } from "../src/lib/thresholds.js";

const inHours = (hours) => new Date(Date.now() + hours * 3600e3).toISOString();
const session = (utilization) => normalizeUsageResponse({ five_hour: { utilization, resets_at: inHours(2) } })?.session?.percentUsed;

test("a usual response becomes a session and its weekly limits", () => {
  const snapshot = normalizeUsageResponse(
    { five_hour: { utilization: 42, resets_at: inHours(2) }, seven_day: { utilization: 31, resets_at: inHours(72) }, seven_day_opus: { utilization: 55.4, resets_at: inHours(72) }, seven_day_oauth_apps: null },
    { orgMeta: { rate_limit_tier: "default_claude_max_5x" } }
  );
  assert.equal(snapshot.session.percentUsed, 42);
  assert.deepEqual(snapshot.weekly.map((bucket) => [bucket.label, bucket.percentUsed]), [["All models", 31], ["Opus", 55]]);
  assert.equal(snapshot.planTier, "Default Claude Max 5x");
  assert.equal(snapshot.extraUsage, null);
});

test("utilization is a percentage whatever its size, and is full only at 100", () => {
  const table = [[0, 0], [0.2, 0], [0.5, 1], [0.9, 1], [1, 1], [42, 42], [42.5, 43], [99.4, 99], [99.5, 99], [99.99, 99], [100, 100], [137, 100], [-3, 0]];
  for (const [raw, percent] of table) assert.equal(session(raw), percent, `utilization ${raw}`);
  assert.equal(wholePercent(null), null);
  assert.equal(wholePercent("42"), null);
});

test("the start of a window crosses no threshold and 99.6% logs no lockout", () => {
  assert.equal(crossedThreshold([80, 95], 0, session(0.9)), null);
  const nearly = normalizeUsageResponse({ five_hour: { utilization: 99.6, resets_at: inHours(2) } });
  assert.equal(observeFullBuckets([], nearly).length, 0);
  const full = normalizeUsageResponse({ five_hour: { utilization: 100, resets_at: inHours(2) } });
  assert.equal(observeFullBuckets([], full).length, 1);
});

test("an answer with no limit in it is not a reading", () => {
  for (const body of [null, "text", 42, [], {}, { type: "error", error: { type: "rate_limit_error" } }, { limits: [{ used: 0.4 }] }, { five_hour: null, seven_day: null }, { five_hour: { utilization: "lots" } }]) {
    assert.equal(normalizeUsageResponse(body), null, JSON.stringify(body));
  }
});

test("…but one limit that can be read is", () => {
  const snapshot = normalizeUsageResponse({ five_hour: { utilization: 61, resets_at: inHours(1) }, seven_day: "gone" });
  assert.equal(snapshot.session.percentUsed, 61);
  assert.deepEqual(snapshot.weekly, []);
  const weeklyOnly = normalizeUsageResponse({ five_hour: null, seven_day: { utilization: 12, resets_at: null } });
  assert.equal(weeklyOnly.session, null);
  assert.equal(weeklyOnly.weekly[0].resetsAt, null);
});

test("the usual keys, empty, are told apart from an unknown shape", () => {
  assert.equal(hasUsageKeys({ five_hour: null, seven_day: null }), true);
  assert.equal(hasUsageKeys({ limits: [] }), false);
  assert.equal(hasUsageKeys([]), false);
});

test("extra usage: cents to dollars, and a share of the cap that is full only at the cap", () => {
  assert.deepEqual(normalizeExtraUsage({ is_enabled: true, monthly_limit: 5000, used_credits: 1240 }), { enabled: true, used: 12.4, limit: 50, percentUsed: 25, currency: "USD" });
  assert.equal(normalizeExtraUsage({ is_enabled: true, monthly_limit: 5000, used_credits: 4985 }).percentUsed, 99);
  assert.equal(normalizeExtraUsage({ is_enabled: true, monthly_limit: 5000, used_credits: 6000 }).percentUsed, 100);
  assert.equal(normalizeExtraUsage({ is_enabled: false, monthly_limit: null, used_credits: null }).enabled, false);
  assert.equal(normalizeExtraUsage({ something: "else" }), null);
});
