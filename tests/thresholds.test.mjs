// Alert levels, and remembering which have been announced (src/lib/thresholds.js).

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeThresholds, thresholdProblem, addThreshold, removeThreshold, crossedThreshold, alreadyAlerted, noteAlerted, alertWindow } from "../src/lib/thresholds.js";

test("the list is kept tidy", () => {
  assert.deepEqual(normalizeThresholds([95, "80", 80, 0, 101, 50.4, "x"]), [50, 80, 95]);
  assert.equal(normalizeThresholds([1, 2, 3, 4, 5, 6, 7, 8, 9]).length, 8);
  assert.equal(thresholdProblem([80], 80), "duplicate");
  assert.equal(thresholdProblem([80], "8.5"), "invalid");
  assert.equal(thresholdProblem([1, 2, 3, 4, 5, 6, 7, 8], 9), "full");
  assert.deepEqual(addThreshold([80], 60), [60, 80]);
  assert.deepEqual(removeThreshold([60, 80], "60"), [80]);
});

test("a move crosses the highest threshold it clears, once", () => {
  assert.equal(crossedThreshold([80, 95], 70, 85), 80);
  assert.equal(crossedThreshold([80, 95], 70, 99), 95);
  assert.equal(crossedThreshold([80, 95], 85, 90), null);
  assert.equal(crossedThreshold([80, 95], 80, 80), null);
  assert.equal(crossedThreshold([80, 95], 90, 10), null);
});

test("what has been announced is remembered for the window it was said in", () => {
  const at = (percentUsed, resetsAt = 1_000_000_000_000) => ({ label: "Current session", percentUsed, resetsAt });
  let said = {};
  assert.equal(alreadyAlerted(said, at(82), 80), false);
  said = noteAlerted(said, at(82), 80);
  assert.equal(alreadyAlerted(said, at(81, 1_000_000_000_000 + 60_000), 80), true, "the reset time wobbling by a minute is the same window");
  assert.equal(alreadyAlerted(said, at(96), 95), false, "a higher threshold is still to say");
  assert.equal(alreadyAlerted(said, at(82, 1_000_000_000_000 + 5 * 3600e3), 80), false, "a new window starts again");
  assert.equal(alreadyAlerted(said, { label: "Opus", percentUsed: 82, resetsAt: 1_000_000_000_000 }, 80), false, "another limit has its own record");
});

test("a limit with no reset time goes by calendar month", () => {
  const extra = { label: "Extra usage", percentUsed: 85 };
  const october = new Date(2026, 9, 4).getTime();
  const said = noteAlerted({}, extra, 80, october);
  assert.equal(alertWindow(extra, october), "2026-10");
  assert.equal(alreadyAlerted(said, extra, 80, new Date(2026, 9, 28).getTime()), true);
  assert.equal(alreadyAlerted(said, extra, 80, new Date(2026, 10, 2).getTime()), false);
});
