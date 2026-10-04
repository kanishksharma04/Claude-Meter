// chrome.storage has no transactions; lib/storage.js makes up for it with
// locks. These are the losses that happened before it did.

import test from "node:test";
import assert from "node:assert/strict";
import { installChrome } from "./helpers.mjs";

const data = installChrome();
const storage = await import("../src/lib/storage.js");

test("withLock runs one at a time, hands back the result, and lets go after an error", async () => {
  const order = [];
  const slow = storage.withLock("test", async () => {
    await new Promise((done) => setTimeout(done, 20));
    order.push("slow");
    return "first";
  });
  const quick = storage.withLock("test", () => order.push("quick"));
  assert.equal(await slow, "first");
  await quick;
  assert.deepEqual(order, ["slow", "quick"]);
  await assert.rejects(storage.withLock("test", () => { throw new Error("no"); }), /no/);
  assert.equal(await storage.withLock("test", () => "still works"), "still works");
});

test("without Web Locks it is still one at a time", async () => {
  const navigatorWas = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
  try {
    const order = [];
    await Promise.all([
      storage.withLock("fallback", async () => { await new Promise((done) => setTimeout(done, 10)); order.push(1); }),
      storage.withLock("fallback", () => order.push(2)),
    ]);
    assert.deepEqual(order, [1, 2]);
    await assert.rejects(storage.withLock("fallback", () => { throw new Error("no"); }));
    assert.equal(await storage.withLock("fallback", () => 3), 3);
  } finally {
    if (navigatorWas) Object.defineProperty(globalThis, "navigator", navigatorWas);
  }
});

test("settings changed at once from three places all stick", async () => {
  await storage.setSettings({ privacyMode: false, notificationsEnabled: false, soundAlerts: false });
  await Promise.all([
    storage.setSettings({ privacyMode: true }),
    storage.setSettings({ notificationsEnabled: true }),
    storage.updateSettings((settings) => ({ soundAlerts: !settings.soundAlerts })),
  ]);
  const settings = await storage.getSettings();
  assert.deepEqual([settings.privacyMode, settings.notificationsEnabled, settings.soundAlerts], [true, true, true]);
});

test("settings come back with defaults under whatever is stored", async () => {
  await storage.setSettings({ webhooks: { slack: { enabled: true, url: "https://hooks.slack.com/services/x" } } });
  const settings = await storage.getSettings();
  assert.equal(settings.refreshIntervalMinutes, 5);
  assert.equal(settings.webhooks.slack.enabled, true);
  assert.deepEqual(settings.webhooks.ntfy, { enabled: false, url: "" });
});

test("ten entries pushed to a log at once are ten entries", async () => {
  await Promise.all(Array.from({ length: 10 }, (_, index) => storage.pushMessageCost({ id: `m${index}`, at: index })));
  assert.equal(data.messageLog.length, 10);
  await Promise.all([storage.addNote("one", 1), storage.addNote("two", 2), storage.addNote("  ", 3)]);
  assert.equal(data.annotations.length, 2);
  await Promise.all([storage.pushLimitHit({ at: 1, resetsAt: 5e12, source: "rejected" }), storage.pushLimitHit({ at: 2, resetsAt: 9e12, source: "rejected" })]);
  assert.equal(data.limitHits.length, 2);
});

test("a pending message is taken once, and says whether others were in flight", async () => {
  const before = { fetchedAt: Date.now(), session: { percentUsed: 10 }, weekly: [] };
  await Promise.all([storage.setPendingMessage("a", { startedAt: Date.now(), before }), storage.setPendingMessage("b", { startedAt: Date.now(), before })]);
  const [first, again] = [await storage.takePendingMessage("a"), await storage.takePendingMessage("a")];
  assert.ok(first.pending);
  assert.equal(first.othersInFlight, true);
  assert.equal(again.pending, null);
});

test("a reading is stored as the latest even where the archive can't be opened", async () => {
  // Node has no IndexedDB: the filing fails, the reading must not.
  const reading = { fetchedAt: Date.now(), session: { label: "Current session", percentUsed: 40, resetsAt: Date.now() + 3600e3 }, weekly: [] };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await storage.setLatestSnapshot(reading);
    const state = await storage.getAll();
    assert.equal(state.latestSnapshot.session.percentUsed, 40);
    assert.deepEqual([state.history, state.usageLog, state.sessionWindows], [[], [], []]);
  } finally {
    console.warn = warn;
  }
  assert.equal(data.lastError, null);
  assert.ok(!("history" in data) && !("usageLog" in data), "the three logs are not kept in chrome.storage");
});

test("clear stored data takes the key and keeps the settings and the list of backups", async () => {
  Object.assign(data, { adminApiKey: "sk-ant-admin01-x", webhookStatus: { slack: { ok: true } }, paceAlertDay: 1, digestDay: "d", backupLog: [{ id: 1, filename: "f", at: 1 }] });
  await storage.setSettings({ warnAt: 70 });
  await storage.clearAllData();
  for (const key of ["adminApiKey", "webhookStatus", "paceAlertDay", "digestDay", "refreshPace"]) assert.ok(!(key in data), key);
  assert.equal(data.latestSnapshot, null);
  assert.equal(data.settings.warnAt, 70);
  assert.equal(data.backupLog.length, 1);
});

test("reset everything leaves nothing but the marks that there is nothing old to put right", async () => {
  await storage.resetEverything();
  assert.deepEqual(Object.keys(data).sort(), ["capturesScrubbed", "logsMoved"]);
  assert.equal((await storage.getSettings()).warnAt, 80);
});
