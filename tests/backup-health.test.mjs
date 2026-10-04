// Backups (src/lib/backup.js) and the health page's reasoning (src/lib/health.js).

import test from "node:test";
import assert from "node:assert/strict";
import { buildBackup, checkBackup, logsOrgOf, logsToRestore, nextBackupAt, pruneBackups, logBackup, gzip, readBackupFile, toDataUrl, LOG_KEYS } from "../src/lib/backup.js";
import { buildChecks, buildDiagnostics, describeUsageError, redactText, redactSettings, issueUrl, formatDiagnostics, MAX_ISSUE_URL } from "../src/lib/health.js";
import { DEFAULT_SETTINGS } from "../src/lib/storage.js";

test("a backup round-trips through gzip, and says whose logs it carries", async () => {
  const backup = buildBackup({ now: 5, extensionVersion: "1.0.0", readings: [{ o: "a", t: 1, s: 2, sr: null, w: [] }], logs: { usageLog: [{ t: 1 }], nonsense: [1] }, logsOrg: "a" });
  assert.deepEqual(Object.keys(backup.logs), LOG_KEYS);
  const bytes = await gzip(JSON.stringify(backup));
  assert.deepEqual([bytes[0], bytes[1]], [0x1f, 0x8b]);
  const checked = checkBackup(await readBackupFile(bytes));
  assert.equal(checked.ok, true);
  assert.equal(checked.backup.logsOrg, "a");
  assert.deepEqual(await readBackupFile(new TextEncoder().encode(JSON.stringify(backup))), backup, "an unpacked file reads too");
  assert.match(toDataUrl(bytes), /^data:application\/gzip;base64,H4sI/);
});

test("what isn't a backup is turned away with a reason", () => {
  assert.equal(checkBackup({ format: "something" }).ok, false);
  assert.match(checkBackup({ format: "claudemeter-backup", version: 99, readings: [] }).problem, /newer version/);
  assert.match(checkBackup({ format: "claudemeter-backup", version: 1 }).problem, /damaged/);
});

test("the logs are filed under the organisation the backup names, else the one here, else its readings'", () => {
  const readings = [{ o: "x" }, { o: "y" }, { o: "y" }];
  assert.equal(logsOrgOf({ logsOrg: "named", readings }, "here"), "named");
  assert.equal(logsOrgOf({ readings }, "here"), "here");
  assert.equal(logsOrgOf({ readings }, null), "y");
  assert.equal(logsOrgOf({ readings: [] }, null), "");
});

test("a restore fills in only what this browser has none of, and merges notes by id", () => {
  const mine = { usageLog: [{ t: 1 }], limitHits: [], annotations: [{ id: "a", at: 2, text: "mine" }] };
  const theirs = { usageLog: [{ t: 9 }], limitHits: [{ at: 1 }], annotations: [{ id: "a", at: 2, text: "same" }, { id: "b", at: 1, text: "theirs" }] };
  const restored = logsToRestore(mine, theirs);
  assert.deepEqual(Object.keys(restored).sort(), ["annotations", "limitHits"]);
  assert.deepEqual(restored.annotations.map((note) => note.id), ["b", "a"]);
});

test("the schedule: at once the first time, an hour after a failure, an interval after a success", () => {
  const now = 1_000_000_000;
  assert.equal(nextBackupAt({ frequency: "off", status: null, now }), null);
  assert.equal(nextBackupAt({ frequency: "daily", status: null, now }), now);
  assert.equal(nextBackupAt({ frequency: "daily", status: { ok: false, at: now }, now }), now + 3600e3);
  assert.equal(nextBackupAt({ frequency: "weekly", status: { ok: true, at: now }, now }), now + 7 * 86400e3);
  const log = logBackup(logBackup([{ id: 1, filename: "a", at: 1 }], { id: 2, filename: "b", at: 2 }), { id: 3, filename: "b", at: 3 });
  assert.deepEqual(log.map((entry) => entry.id), [1, 3]);
  assert.deepEqual(pruneBackups(log, 1).removed.map((entry) => entry.id), [1]);
  assert.equal(pruneBackups(log, 0).removed.length, 0);
});

const facts = (over = {}) => ({
  now: Date.now(),
  manifest: { version: "1.0.0", permissions: ["storage"], host_permissions: ["https://claude.ai/*"] },
  granted: { permissions: ["storage"], origins: ["https://claude.ai/*"] },
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  settings: { ...DEFAULT_SETTINGS },
  alarm: { scheduledTime: Date.now() + 60e3, periodInMinutes: 5 },
  storageBytes: 2048,
  archive: { count: 10, first: Date.now() - 86400e3 },
  logs: { hours: 24, windows: 5 },
  notifications: "granted",
  hasAdminKey: false,
  ...over,
  state: { latestSnapshot: { fetchedAt: Date.now() - 60e3, session: { percentUsed: 42 }, weekly: [{ label: "All models", percentUsed: 31 }] }, lastError: null, refreshPace: { mode: "normal", minutes: 5, failures: 0 }, orgCache: { orgId: "o" }, snoozeUntil: 0, ...(over.state ?? {}) },
});
const check = (list, id) => list.find((entry) => entry.id === id);

test("a healthy install checks out", () => {
  const checks = buildChecks(facts());
  assert.deepEqual(checks.filter((entry) => entry.status === "fail" || entry.status === "warn"), []);
});

test("an answer with no reading in it is a failure, in words that say so", () => {
  const error = { code: "UNPARSEABLE_RESPONSE", message: "x", timestamp: Date.now() };
  const endpoint = check(buildChecks(facts({ state: { lastError: error } })), "endpoint");
  assert.equal(endpoint.status, "fail");
  assert.match(endpoint.detail, /API has probably changed/);
  assert.match(describeUsageError("NO_LIMITS"), /no session or weekly limit/);
  assert.match(describeUsageError("HTTP_503"), /server error/);
});

test("a stored reading with no limits in it fails the check, and so does an archive that won't open", () => {
  const empty = { fetchedAt: Date.now(), session: null, weekly: [] };
  assert.equal(check(buildChecks(facts({ state: { latestSnapshot: empty } })), "endpoint").status, "fail");
  assert.equal(check(buildChecks(facts({ archive: null })), "storage").status, "fail");
});

test("diagnostics carry no names, ids, keys, addresses or figures", () => {
  const settings = { ...DEFAULT_SETTINGS, primaryOrg: "11111111-2222-3333-4444-555555555555", webhooks: { ...DEFAULT_SETTINGS.webhooks, slack: { enabled: true, url: "https://hooks.slack.com/services/T000/B000/SECRETSECRET" } } };
  const error = { code: "HTTP_500", message: "GET https://claude.ai/api/organizations/11111111-2222-3333-4444-555555555555/usage failed for bob@example.com sk-ant-admin01-abc", timestamp: Date.now() };
  const text = formatDiagnostics(buildDiagnostics(facts({ settings, hasAdminKey: true, state: { lastError: error, orgCache: { orgId: "o", orgName: "Acme Secret Org" } } })));
  for (const leak of ["11111111", "SECRETSECRET", "bob@example.com", "sk-ant-", "Acme", "42"]) assert.ok(!text.includes(leak), `${leak} in:\n${text}`);
  assert.match(text, /usageLogHours: 24/);
  assert.equal(redactSettings(settings).webhooks.slack, "on");
  assert.equal(redactText("/Users/kanishk/x and C:\\Users\\kanishk\\y"), "/Users/<user>/x and C:\\Users\\<user>\\y");
});

test("the bug-report link always fits", () => {
  const checks = buildChecks(facts());
  const long = Array.from({ length: 2000 }, (_, index) => `line ${index}: some diagnostic text`).join("\n");
  const { url, truncated } = issueUrl(checks, long);
  assert.equal(truncated, true);
  assert.ok(url.length <= MAX_ISSUE_URL);
  assert.equal(issueUrl(checks, "short").truncated, false);
});
