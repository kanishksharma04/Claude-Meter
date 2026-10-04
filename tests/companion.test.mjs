// The Claude Code companion: reading its logs, and installing it so that a
// browser can start it.

import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installPlan, isExtensionId, launcherScript, stableNodePath, stableNodeCandidates } from "../companion/install.mjs";
import { parseUsageLine, dedupeRecords, summarizeClaudeCode, modelLabel, companionProblem, planForCompanion } from "../src/lib/claude-code.js";
import { buildStatus } from "../companion/status-file.mjs";

const brew = "/opt/homebrew/Cellar/node/26.0.0/bin/node";
const links = { "/opt/homebrew/bin/node": brew, [brew]: brew, "/usr/local/bin/node": "/usr/local/bin/node" };
const machine = {
  platform: "darwin",
  home: "/Users/x",
  exists: (path) => path in links,
  realpath: (path) => {
    if (!(path in links)) throw new Error("ENOENT");
    return links[path];
  },
};

test("the launcher names a Node path that outlives an upgrade, where there is one", () => {
  assert.equal(stableNodePath(brew, machine), "/opt/homebrew/bin/node");
  assert.equal(stableNodePath("/usr/local/bin/node", machine), "/usr/local/bin/node");
  const nvm = "/Users/x/.nvm/versions/node/v22.1.0/bin/node";
  assert.equal(stableNodePath(nvm, machine), nvm, "no lasting link to the same Node: keep what there is");
  const volta = "/Users/x/.volta/tools/image/node/20.0.0/bin/node";
  assert.equal(stableNodePath(volta, machine), volta, "a lasting link to a different Node is not taken");
  assert.ok(stableNodeCandidates("win32", "C:\\Users\\x", { ProgramFiles: "C:\\Program Files" })[0].endsWith("nodejs\\node.exe"));
});

test("the launcher runs the companion, and finds another Node when its own has gone", { skip: process.platform === "win32" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "claudemeter launcher's "));
  const target = join(directory, "target $x.mjs"); // a space, a quote and a dollar: the script must survive all three
  writeFileSync(target, 'console.log("ran with " + process.argv.slice(2).join(","))');
  const run = (nodePath) => {
    const file = join(directory, "launch");
    writeFileSync(file, launcherScript({ platform: process.platform, home: process.env.HOME ?? directory, nodePath, target }));
    chmodSync(file, 0o755);
    return execFileSync(file, ["a b", "c"], { encoding: "utf8", env: { HOME: process.env.HOME ?? directory, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` } }).trim();
  };
  assert.equal(run(process.execPath), "ran with a b,c");
  assert.equal(run("/opt/gone/node-99/bin/node"), "ran with a b,c");
});

test("the Windows launcher falls back to PATH and Program Files", () => {
  const script = launcherScript({ platform: "win32", home: "C:\\Users\\x", env: { ProgramFiles: "C:\\Program Files" }, nodePath: "C:\\nvm\\v22\\node.exe", target: "C:\\cm\\agent.mjs" });
  assert.match(script, /set "NODE=C:\\nvm\\v22\\node\.exe"/);
  assert.match(script, /if not exist "%NODE%" for %%I in \(node\.exe\)/);
  assert.match(script, /C:\\Program Files\\nodejs\\node\.exe/);
  assert.ok(script.includes("\r\n"));
});

test("the install plan: a launcher, the terminal command and a manifest per browser", () => {
  assert.equal(isExtensionId("a".repeat(32)), true);
  assert.equal(isExtensionId("not-an-id"), false);
  const plan = installPlan({ platform: "darwin", home: "/Users/x", env: {}, extensionId: "a".repeat(32), nodePath: "/opt/homebrew/bin/node", agentPath: "/r/companion/claudemeter-agent.mjs", cliPath: "/r/companion/claudemeter.mjs", exists: (path) => path.includes("Google/Chrome") });
  assert.deepEqual(plan.browsers, ["Chrome", "Chrome Beta"]);
  const manifest = JSON.parse(plan.files.at(-1).content);
  assert.equal(manifest.path, plan.launcher);
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${"a".repeat(32)}/`]);
  const firefox = installPlan({ platform: "linux", home: "/home/x", env: {}, extensionId: "", nodePath: "/usr/bin/node", agentPath: "/r/a.mjs", firefox: true });
  assert.ok(JSON.parse(firefox.files.at(-1).content).allowed_extensions[0].includes("@"));
  const windows = installPlan({ platform: "win32", home: "C:\\Users\\x", env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, extensionId: "a".repeat(32), nodePath: "C:\\node.exe", agentPath: "C:\\r\\a.mjs" });
  assert.ok(windows.registry.length >= 4 && windows.launcher.endsWith(".cmd"));
});

const line = (over = {}) => ({
  timestamp: new Date(Date.now() - 60e3).toISOString(),
  requestId: "req_1",
  sessionId: "s1",
  cwd: "/Users/x/project",
  message: { id: "msg_1", model: "claude-sonnet-5-5", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 } } },
  ...over,
});

test("a log line becomes a usage record; lines without tokens don't", () => {
  const record = parseUsageLine(line());
  assert.deepEqual([record.input, record.output, record.cacheRead, record.cacheWrite5m, record.key], [100, 50, 1000, 200, "msg_1:req_1"]);
  assert.equal(parseUsageLine({ type: "user", message: { content: "hi" } }), null);
  assert.equal(parseUsageLine(line({ message: { id: "m", model: "x", usage: { input_tokens: 0, output_tokens: 0 } } })), null);
  assert.equal(parseUsageLine(line({ timestamp: "not a date" })), null);
});

test("one API response written on several lines is counted once", () => {
  const records = [parseUsageLine(line()), parseUsageLine(line()), parseUsageLine(line({ requestId: "req_2", message: { ...line().message, id: "msg_2" } }))];
  assert.equal(dedupeRecords(records).length, 2);
  const summary = summarizeClaudeCode(records);
  assert.equal(summary.week.messages, 2);
  assert.equal(summary.projects[0].name, "project");
  assert.ok(summary.week.cost > 0);
});

test("model names, companion problems and the plan for the terminal", () => {
  assert.equal(modelLabel("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelLabel("claude-3-7-sonnet-20250219"), "Sonnet 3.7");
  assert.equal(companionProblem("Specified native messaging host not found.").code, "not-installed");
  assert.equal(companionProblem("Native host has exited.").code, "crashed");
  const snapshot = { fetchedAt: 1, planTier: "Max 5x", session: { percentUsed: 42, resetsAt: 9 }, weekly: [{ label: "All models", percentUsed: 31, resetsAt: 99 }] };
  assert.equal(planForCompanion(snapshot, { privacyMode: true }).session, null);
  const status = buildStatus(planForCompanion(snapshot, { privacyMode: false, warnAt: 70 }), null, 5);
  assert.equal(status.plan.session.percent, 42);
  assert.equal(status.plan.thresholds.warnAt, 70);
  assert.equal(typeof status.display.line, "string");
});
