// Adaptive refresh (src/lib/refresh-plan.js): how long to wait for the next reading.

import test from "node:test";
import assert from "node:assert/strict";
import { planRefresh, foldOutcome, usageChanged, closestLimit, describePlan } from "../src/lib/refresh-plan.js";

const now = Date.now();
const at = (session, weekly = 10) => ({ session: { percentUsed: session }, weekly: [{ label: "All models", percentUsed: weekly }] });

test("the wait moves around the chosen interval", () => {
  assert.deepEqual(planRefresh({ baseMinutes: 5, snapshot: at(40), lastChangeAt: now - 60e3, now }), { minutes: 5, mode: "normal" });
  assert.deepEqual(planRefresh({ baseMinutes: 5, snapshot: at(80), lastChangeAt: now - 60e3, now }), { minutes: 2.5, mode: "fast" });
  assert.deepEqual(planRefresh({ baseMinutes: 5, snapshot: at(93), lastChangeAt: now - 60e3, now }), { minutes: 1.5, mode: "fast" });
  assert.deepEqual(planRefresh({ baseMinutes: 5, snapshot: at(93), lastChangeAt: now - 40 * 60e3, now }), { minutes: 10, mode: "slow" });
  assert.deepEqual(planRefresh({ baseMinutes: 5, snapshot: at(40), lastChangeAt: now - 3 * 3600e3, now }), { minutes: 20, mode: "slow" });
});

test("failures double the wait, up to an hour, and never go below a minute", () => {
  assert.deepEqual([1, 2, 3, 4, 9].map((failures) => planRefresh({ baseMinutes: 5, failures }).minutes), [10, 20, 40, 60, 60]);
  assert.equal(planRefresh({ baseMinutes: 1, snapshot: at(95), lastChangeAt: now, now }).minutes, 1);
});

test("a limit that is full can't get closer", () => {
  assert.equal(closestLimit(at(100, 60)), 60);
  assert.equal(closestLimit({ session: { percentUsed: 100 }, weekly: [] }), null);
});

test("an attempt's outcome is folded into the pace", () => {
  const failed = foldOutcome(foldOutcome(null, { ok: false, code: "HTTP_500" }), { ok: false, code: "UNPARSEABLE_RESPONSE" });
  assert.deepEqual(failed, { failures: 2, errorCode: "UNPARSEABLE_RESPONSE", lastChangeAt: null });
  assert.deepEqual(foldOutcome(failed, { ok: true, changed: true, at: 7 }), { failures: 0, errorCode: null, lastChangeAt: 7 });
  assert.deepEqual(foldOutcome(failed), failed);
});

test("usage has changed when any limit stands somewhere else", () => {
  assert.equal(usageChanged(null, at(1)), true);
  assert.equal(usageChanged(at(40), at(40)), false);
  assert.equal(usageChanged(at(40, 10), at(40, 11)), true);
  assert.match(describePlan({ minutes: 20, mode: "backoff", failures: 2 }), /last 2 attempts failed/);
});
