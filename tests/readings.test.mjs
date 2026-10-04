// What is worked out from one reading and the one before it: the hourly log,
// the session windows, the archive's records, spikes, resets, message costs.

import test from "node:test";
import assert from "node:assert/strict";
import { foldSnapshot, pointsUsed, hourStart, MAX_READING_GAP_MS } from "../src/lib/usage-log.js";
import { foldWindow, WINDOW_LENGTH_MS } from "../src/lib/session-windows.js";
import { toRecord, fromRecord, seedRecords, archiveSeries } from "../src/lib/archive.js";
import { detectSpike } from "../src/lib/spikes.js";
import { resetsToAnnounce, nextResetCheck } from "../src/lib/reset-alert.js";
import { computeMessageCost, prunePending } from "../src/lib/message-cost.js";
import { elsewherePoints, noteActivity } from "../src/lib/attribution.js";

const HOUR = 3600e3;
const base = hourStart(Date.now() - 6 * HOUR) + 10 * 60e3; // ten past an hour, so a few readings fit inside it
const reading = (at, session, { resetsAt = base + 4 * HOUR, weekly = 20 } = {}) => ({
  fetchedAt: at,
  session: { label: "Current session", percentUsed: session, resetsAt },
  weekly: [{ label: "All models", percentUsed: weekly, resetsAt: base + 72 * HOUR }],
});

test("points used: a rise, and everything in the new window after a reset", () => {
  assert.equal(pointsUsed({ percentUsed: 40, resetsAt: 1 }, { percentUsed: 46, resetsAt: 1 }), 6);
  assert.equal(pointsUsed({ percentUsed: 90, resetsAt: 1 }, { percentUsed: 4, resetsAt: 1 + 5 * HOUR }), 4);
  assert.equal(pointsUsed(null, { percentUsed: 30 }), 0);
});

test("the hourly log gathers an hour's readings into one record", () => {
  let log = foldSnapshot([], null, reading(base, 40));
  log = foldSnapshot(log, reading(base, 40), reading(base + 5 * 60e3, 46, { weekly: 22 }));
  assert.equal(log.length, 1);
  assert.deepEqual({ n: log[0].n, peak: log[0].peak, burn: log[0].burn }, { n: 2, peak: 46, burn: 6 });
  assert.deepEqual(log[0].weekly["All models"], { pct: 22, burn: 2 });
  log = foldSnapshot(log, reading(base + 5 * 60e3, 46), reading(base + HOUR, 50));
  assert.equal(log.length, 2);
  assert.equal(log[1].burn, 4);
});

test("usage across a long gap is not pinned on an hour", () => {
  const after = reading(base + MAX_READING_GAP_MS + HOUR, 70);
  const log = foldSnapshot(foldSnapshot([], null, reading(base, 40)), reading(base, 40), after);
  assert.equal(log.at(-1).burn, 0);
});

test("folding the last record alone gives the same record as folding the whole log", () => {
  // This is how the archive does it: one record read, one written.
  const readings = [reading(base, 10), reading(base + 20 * 60e3, 14), reading(base + 40 * 60e3, 20), reading(base + HOUR, 26)];
  let whole = [];
  let last = [];
  readings.forEach((snapshot, index) => {
    whole = foldSnapshot(whole, readings[index - 1] ?? null, snapshot);
    last = [foldSnapshot(last.slice(-1), readings[index - 1] ?? null, snapshot).at(-1)];
  });
  assert.deepEqual(last[0], whole.at(-1));
});

test("a session window is recognised by its reset time and keeps its peak", () => {
  let windows = foldWindow([], reading(base, 10));
  windows = foldWindow(windows, reading(base + 600e3, 30, { resetsAt: base + 4 * HOUR + 60e3 })); // the reset time wobbles
  assert.equal(windows.length, 1);
  assert.equal(windows[0].peak, 30);
  assert.equal(windows[0].start, base + 4 * HOUR - WINDOW_LENGTH_MS);
  windows = foldWindow(windows, reading(base + 5 * HOUR, 5, { resetsAt: base + 10 * HOUR }));
  assert.equal(windows.length, 2);
  assert.deepEqual(foldWindow(windows, reading(base + 6 * HOUR, 0, { resetsAt: base + 20 * HOUR })), windows, "an untouched session opens no window");
});

test("a reading survives the trip into the archive and back", () => {
  const snapshot = { ...reading(base, 42), planTier: "Max 5x", elsewhere: 3, extraUsage: null };
  const record = toRecord(snapshot, "org-1");
  assert.deepEqual(record, { o: "org-1", t: base, s: 42, sr: base + 4 * HOUR, w: [["All models", 20, base + 72 * HOUR]], e: 3 });
  const back = fromRecord(record);
  assert.equal(back.fetchedAt, base);
  assert.deepEqual(back.session, snapshot.session);
  assert.deepEqual(back.weekly, snapshot.weekly);
  assert.equal(back.elsewhere, 3);
});

test("seeding an archive: the readings, and the hourly log before the first of them", () => {
  const usageLog = [{ t: base - 3 * HOUR, peak: 10, weekly: { "All models": { pct: 5 } } }, { t: base + HOUR, peak: 99, weekly: {} }];
  const records = seedRecords({ history: [reading(base, 40)], usageLog }, "o");
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], { o: "o", t: base - 2 * HOUR, s: 10, sr: null, w: [["All models", 5, null]], h: 1 });
});

test("thinning for a chart keeps a spike", () => {
  const records = Array.from({ length: 1000 }, (_, index) => ({ t: base + index * 60e3, s: index === 500 ? 97 : 10, w: [["All models", 20, null]] }));
  const chart = archiveSeries(records, { from: base, to: base + 1000 * 60e3, maxPoints: 50 });
  const session = chart.series.find((series) => series.id === "session");
  assert.ok(session.points.length <= 50);
  assert.equal(Math.max(...session.points.map((point) => point.pct)), 97);
});

test("a spike is a jump within five minutes, measured from the low point, and not across a reset", () => {
  const history = [reading(base, 40), reading(base + 60e3, 42)];
  assert.deepEqual(detectSpike(history, reading(base + 120e3, 66), { percent: 15 }).rise, 26);
  assert.equal(detectSpike(history, reading(base + 120e3, 50), { percent: 15 }), null);
  assert.equal(detectSpike([reading(base, 90)], reading(base + 60e3, 30, { resetsAt: base + 9 * HOUR }), { percent: 15 }), null);
  assert.equal(detectSpike(history, reading(base + 120e3, 66), { percent: 0 }), null);
});

test("a reset is announced only for a limit that was high, and only when it has just happened", () => {
  const now = base + 5 * HOUR;
  const before = [{ label: "Current session", percentUsed: 95, resetsAt: now - 20e3 }];
  const after = [{ label: "Current session", percentUsed: 0, resetsAt: now + 5 * HOUR }];
  assert.equal(resetsToAnnounce(before, after, { percent: 90, gapMs: 300e3, at: now }).length, 1);
  assert.equal(resetsToAnnounce([{ ...before[0], percentUsed: 50 }], after, { percent: 90, gapMs: 300e3, at: now }).length, 0);
  assert.equal(resetsToAnnounce([{ ...before[0], resetsAt: now - 8 * HOUR }], after, { percent: 90, gapMs: 300e3, at: now }).length, 0, "it reset long ago");
  assert.equal(resetsToAnnounce(before, after, { percent: 0, gapMs: 300e3, at: now }).length, 0);
  assert.equal(nextResetCheck([{ percentUsed: 95, resetsAt: now + HOUR }], { percent: 90, now }), now + HOUR + 10_000);
});

test("a message's cost is the rise between two readings, and unknown across a reset", () => {
  const cost = computeMessageCost(reading(base, 40, { weekly: 20 }), reading(base + 30e3, 43, { weekly: 21 }));
  assert.deepEqual(cost, { session: 3, weekly: [{ label: "All models", delta: 1 }] });
  assert.equal(computeMessageCost(reading(base, 90), reading(base + 30e3, 2)).session, null);
  assert.deepEqual(Object.keys(prunePending({ old: { startedAt: 0 }, fresh: { startedAt: Date.now() } })), ["fresh"]);
});

test("a rise with nothing sent from this browser happened elsewhere", () => {
  const before = reading(base, 40);
  const after = reading(base + 5 * 60e3, 48);
  assert.equal(elsewherePoints(before, after, null), 8);
  const active = noteActivity(null, { kind: "completion_end", requestId: "r", timestamp: base + 2 * 60e3 });
  assert.equal(elsewherePoints(before, after, active), 0);
});
