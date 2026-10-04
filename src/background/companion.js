// Claude Code usage, through the companion (companion/): a native-messaging
// host that reads Claude Code's logs and is told the plan usage in return.

import { getSettings, setClaudeCode } from "../lib/storage.js";
import { COMPANION_HOST, companionProblem, planForCompanion } from "../lib/claude-code.js";
import { LOG_PREFIX } from "./shared.js";

// ------------------------------------------------------------- claude code --
// Claude Code usage comes from the companion (companion/), a native-messaging
// host. There are two ways of using it. Live: one long-lived connection, over
// which the companion — watching the logs under ~/.claude — sends new figures
// the moment something changes. Polled: the browser starts it, asks once, and
// it exits; that happens with each refresh. Live is the default, and falls
// back to polling whenever the connection can't be made or is lost.
/** Readings around a single message arrive seconds apart; when polling, the logs needn't be re-read for each. */
const CLAUDE_CODE_MIN_INTERVAL_MS = 60_000;

let claudeCodeReadAt = 0;

/** The live connection, when there is one, and the session window the companion was last told about. */
let companionPort = null;

let companionWindow = null;

async function sessionResetsAt() {
  const { latestSnapshot } = await chrome.storage.local.get("latestSnapshot");
  // Claude Code draws on the same 5-hour allowance, so claude.ai's window is its window too.
  return latestSnapshot?.session?.resetsAt ?? null;
}

/**
 * Opens the live connection and asks the companion to watch. An open native
 * port also keeps this worker from being put to sleep, which is what lets the
 * pushes arrive at all.
 */
async function connectCompanion() {
  if (companionPort) return;
  const port = chrome.runtime.connectNative(COMPANION_HOST);
  companionPort = port;

  port.onMessage.addListener((message) => {
    if (message?.type === "usage") {
      const status = { ok: true, version: message.version, live: true, watching: message.watching, statusFile: message.statusFile ?? null };
      setClaudeCode(message.data, status);
    } else if (message?.type === "error") {
      console.warn(LOG_PREFIX, "claude code (live):", message.message);
    }
  });

  port.onDisconnect.addListener(async () => {
    const reason = chrome.runtime.lastError?.message;
    if (companionPort === port) companionPort = null;
    companionWindow = null;
    const settings = await getSettings();
    // Closed on purpose (switched off, or to live off): nothing to report.
    if (!settings.claudeCode || !settings.claudeCodeLive || settings.demoMode) return;
    console.warn(LOG_PREFIX, "claude code: live connection lost:", reason);
    // Say so, and carry on by polling; the next refresh tries to reconnect.
    await setClaudeCode(null, { ok: false, problem: companionProblem(reason) });
  });

  companionWindow = await sessionResetsAt();
  port.postMessage({ type: "watch", sessionResetsAt: companionWindow, ...(await companionExtras()) });
}

/**
 * The plan usage, for the companion to put in its status file — which is how
 * the `claudemeter` terminal command gets figures that only the browser has.
 */
async function companionPlan() {
  const { latestSnapshot } = await chrome.storage.local.get("latestSnapshot");
  return planForCompanion(latestSnapshot, await getSettings());
}

/** What rides along on every request: the plan usage, and whether the user wants the status file written at all. */
async function companionExtras() {
  const { statusFile } = await getSettings();
  // With the file switched off there is no reason for the figures to leave the browser.
  return { statusFile, plan: statusFile ? await companionPlan() : null };
}

/** Passes the current plan usage to a connected companion — or, with the status file off, tells it to remove the file. */
export async function tellCompanionPlan() {
  if (!companionPort) return;
  const extras = await companionExtras();
  if (extras.plan || !extras.statusFile) companionPort?.postMessage({ type: "plan", ...extras });
}

function disconnectCompanion() {
  companionPort?.disconnect();
  companionPort = null;
  companionWindow = null;
}

/** Brings the connection in line with the settings. Runs at start-up and when they change. */
export async function syncCompanion() {
  const settings = await getSettings();
  const live = settings.claudeCode && settings.claudeCodeLive && !settings.demoMode;
  if (!live) return disconnectCompanion();
  await connectCompanion();
}

/**
 * Tells a connected companion which session window to count in, when that has
 * changed (or regardless, with `force`). It answers with fresh figures.
 */
export async function tellCompanionWindow({ force = false } = {}) {
  if (!companionPort) return;
  const window = await sessionResetsAt();
  if (!force && window === companionWindow) return;
  companionWindow = window;
  companionPort?.postMessage({ type: "watch", sessionResetsAt: window }); // it may have closed while the window was looked up
}

/** @returns {Promise<{ ok: boolean, problem?: object } | null>} null when switched off or skipped */
export async function refreshClaudeCode({ force = false } = {}) {
  const settings = await getSettings();
  if (!settings.claudeCode || settings.demoMode) return null;

  if (settings.claudeCodeLive) {
    try {
      await connectCompanion(); // a no-op while connected; otherwise this is the retry
      // Nothing to ask for: changes arrive unasked. Only a moved session window, or a forced check, needs saying.
      await tellCompanionWindow({ force });
    } catch {
      // The connection closed while it was being used — no companion to connect to. The one-off request below says why.
    }
    if (companionPort) return { ok: true };
  }

  if (!force && Date.now() - claudeCodeReadAt < CLAUDE_CODE_MIN_INTERVAL_MS) return null;
  claudeCodeReadAt = Date.now();

  try {
    const request = { type: "get", sessionResetsAt: await sessionResetsAt(), ...(await companionExtras()) };
    const reply = await chrome.runtime.sendNativeMessage(COMPANION_HOST, request);
    if (reply?.type !== "usage") throw new Error(reply?.message ?? "The companion sent an unexpected reply.");
    await setClaudeCode(reply.data, { ok: true, version: reply.version, live: false, statusFile: reply.statusFile ?? null });
    return { ok: true };
  } catch (err) {
    const problem = companionProblem(err?.message);
    console.warn(LOG_PREFIX, "claude code:", problem.code, err?.message);
    await setClaudeCode(null, { ok: false, problem });
    return { ok: false, problem };
  }
}

// A worker that was restarted (an update, a reload) has lost its connection; pick it up again.
syncCompanion().catch((err) => console.warn(LOG_PREFIX, "claude code: could not start the live connection", err));

/** Is the live connection up? (Its port is this module's to hold; others only need to know.) */
export function companionConnected() {
  return companionPort != null;
}
