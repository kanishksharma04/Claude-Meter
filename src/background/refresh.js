// Asking claude.ai for usage, and everything that has to happen when a
// reading arrives: storing it, comparing it with the one before, setting the
// next alarm. Also the readings that ride along with a refresh — the other
// organisations, the Console's cost report — and the once-only tidying a new
// version does of what an older one stored.

import {
  getAll,
  getSettings,
  getOrgCache,
  setLatestSnapshot,
  setLastError,
  setModelHint,
  noteFullBuckets,
  setExtraUsage,
  getAdminKey,
  setApiSpend,
  setOrgCache,
  setOrgSnapshots,
  swapOrgState,
  setDemoState,
  withLock,
  moveLogsToArchive,
} from "../lib/storage.js";
import { fetchUsageSnapshot, fetchOrgs, fetchOtherOrgs, UsageApiError } from "../lib/usage-api.js";
import { extraOrgs } from "../lib/orgs.js";
import { planRefresh, foldOutcome, usageChanged } from "../lib/refresh-plan.js";
import { modelSwitchHint } from "../lib/burn-rate.js";
import { buildDemoState } from "../lib/demo-data.js";
import { fetchSpend } from "../lib/console-api.js";
import { maybeNotify, watchForSpike, announceResets, scheduleResetCheck, watchPace } from "./alerts.js";
import { tellCompanionPlan, tellCompanionWindow, refreshClaudeCode } from "./companion.js";
import { LOG_PREFIX, ALARM_NAME, AFTER_SETTLE_MS } from "./shared.js";
import { updateToolbar } from "./toolbar.js";

// ------------------------------------------------------------------ fetch --
// Plenty of things ask for a refresh — the alarm, the popup opening, a claude.ai
// tab loading, a message being sent, the address bar — and often at the same
// moment. One request to claude.ai answers them all: whoever asks while a
// refresh is on its way gets that refresh's result.
/** The refresh on its way, if there is one: `{ startedAt, promise }`. */
let refreshInFlight = null;

/** Goes up when the main organisation changes, so a reading fetched for the old one is known for what it is. */
let orgGeneration = 0;

/**
 * @param {object} [options]
 * @param {number} [options.notBefore] - the reading must have been asked for at or after this moment. Whoever
 *   needs to see something that has only just happened (a reply's cost, a limit running out) passes the
 *   present; a refresh that set off earlier is waited for and then followed by a new one.
 * @returns {Promise<{ ok: true, snapshot: object } | { ok: false, error: { code: string, message: string } }>}
 */
export function refreshUsage({ notBefore = 0 } = {}) {
  if (refreshInFlight) {
    if (refreshInFlight.startedAt >= notBefore) return refreshInFlight.promise;
    return refreshInFlight.promise.then(() => refreshUsage({ notBefore }));
  }
  const startedAt = Date.now();
  const promise = fetchAndApply(startedAt).finally(() => {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  });
  refreshInFlight = { startedAt, promise };
  return promise;
}

async function fetchAndApply(startedAt) {
  const generation = orgGeneration;
  try {
    if ((await getSettings()).demoMode) return await refreshDemo();
    refreshApiSpend().catch((err) => console.warn(LOG_PREFIX, "api spend refresh failed", err));
    // Alongside, not after: Claude Code's figures don't depend on being signed in to claude.ai.
    refreshClaudeCode().catch((err) => console.warn(LOG_PREFIX, "claude code refresh failed", err));

    const snapshot = await fetchUsageSnapshot({ primaryOrg: (await getSettings()).primaryOrg });
    const applied = await applySnapshot(snapshot, { generation });
    await refreshOtherOrgs();
    console.log(LOG_PREFIX, applied ? "refreshed usage snapshot" : "a newer reading was already in hand");
    return { ok: true, snapshot };
  } catch (err) {
    const code = err instanceof UsageApiError ? err.code : "UNKNOWN_ERROR";
    const message = err?.message ?? String(err);
    // A failure is only news if nothing has succeeded since it was asked for: a reading that
    // landed in the meantime (the page's own, say) is the truth, and this is already out of date.
    const overtaken = await withLock("reading", async () => {
      const { latestSnapshot } = await chrome.storage.local.get("latestSnapshot");
      if (generation !== orgGeneration || latestSnapshot?.fetchedAt > startedAt) return true;
      await setLastError({ code, message, timestamp: Date.now() });
      return false;
    });
    if (!overtaken) await scheduleRefresh({ ok: false, code });
    console.warn(LOG_PREFIX, "refresh failed:", code, message);
    return { ok: false, error: { code, message } };
  }
}

/**
 * Demo mode's stand-in for a refresh: rebuild the made-up dataset around the
 * current time (so "resets in…" and "last updated" stay fresh) and repaint.
 * Nothing is fetched, and none of the real stored readings are touched.
 */
async function refreshDemo() {
  const demo = buildDemoState();
  await setDemoState(demo);
  await updateToolbar(demo.latestSnapshot);
  await scheduleRefresh();
  return { ok: true, snapshot: demo.latestSnapshot, demo: true };
}

/** Called when the demoMode setting flips. */
export async function applyDemoMode(on) {
  if (on) return refreshDemo();
  await setDemoState(null);
  // Back to reality: show what was stored before, then try for a fresh reading.
  await updateToolbar((await getAll({ logs: false })).latestSnapshot);
  await refreshUsage();
}

/** A stored reading stamped further ahead than this is the clock having been put back, not a newer reading. */
const CLOCK_SLACK_MS = 60_000;

/**
 * Everything that has to happen whenever a new reading lands, whichever way it
 * arrived. One reading at a time, start to finish: each is compared with the
 * one before it (what rose, what was crossed, what reset), and two at once
 * would both be compared with the same one and each say so.
 *
 * @returns {Promise<boolean>} false when the reading was set aside — an older one than is already in hand
 *   (two were on their way and this one lost), or one fetched for an organisation that is no longer the main one
 */
export function applySnapshot(snapshot, { generation = orgGeneration } = {}) {
  return withLock("reading", async () => {
    if (generation !== orgGeneration) return false;
    const { latestSnapshot: previous = null } = await chrome.storage.local.get("latestSnapshot");
    const overtaken = previous && snapshot.fetchedAt <= previous.fetchedAt && previous.fetchedAt <= Date.now() + CLOCK_SLACK_MS;
    if (overtaken) return false;

    await moveLogs(); // only ever does anything once, on the first reading after an update
    await setLatestSnapshot(snapshot);
    if (snapshot.extraUsage) await setExtraUsage(snapshot.extraUsage, snapshot.fetchedAt);
    await noteFullBuckets(snapshot);
    await updateToolbar(snapshot);
    await updateModelHint();

    // Alerts, each comparing this reading with what came before it.
    await maybeNotify(previous, snapshot);
    await announceResets(previous, snapshot);
    await watchForSpike(snapshot);
    await watchPace();
    await scheduleResetCheck(snapshot);
    // This reading may have brought a new session window; Claude Code's figures are counted in the same one.
    await tellCompanionWindow();
    await tellCompanionPlan();
    await scheduleRefresh({ ok: true, changed: usageChanged(previous, snapshot), at: snapshot.fetchedAt });
    return true;
  });
}

// ---------------------------------------------------------------- archive --
// The readings, the hourly log and the session windows are kept in IndexedDB
// (lib/archive.js); lib/storage.js files each reading there as it stores it.
// Versions before that kept all three in chrome.storage, and the first run of
// this one moves them across. Callers hold the "reading" lock.
async function moveLogs() {
  try {
    if (await moveLogsToArchive()) console.log(LOG_PREFIX, "moved the history into the archive");
  } catch (error) {
    // Left where it was, and tried again with the next reading.
    console.warn(LOG_PREFIX, "could not move the history into the archive", error);
  }
}

// ------------------------------------------------------------ other orgs --
// The organisations followed alongside the main one (lib/orgs.js): just their
// current usage, for the side-by-side view. One request each, so not on every
// one of the quick refreshes that happen around a message.
const OTHER_ORGS_MIN_INTERVAL_MS = 60_000;

let otherOrgsReadAt = 0;

export async function refreshOtherOrgs({ force = false } = {}) {
  const { settings, orgList, orgSnapshots } = await getAll({ logs: false });
  const orgCache = await getOrgCache();
  if (settings.demoMode) return;

  let orgs = orgList;
  // Ticked before the list was ever stored (or stored by an older version): fetch it once.
  if (settings.trackedOrgs.length > 0 && orgs.length === 0) orgs = await fetchOrgs().catch(() => []);
  const others = extraOrgs(orgs, orgCache?.orgId, settings.trackedOrgs);
  if (others.length === 0) {
    if (orgSnapshots.length > 0) await setOrgSnapshots([]);
    return;
  }
  if (!force && Date.now() - otherOrgsReadAt < OTHER_ORGS_MIN_INTERVAL_MS) return;
  otherOrgsReadAt = Date.now();

  const fresh = await fetchOtherOrgs(others);
  // A failed read keeps that organisation's last figures on screen, marked with the error.
  const previous = new Map(orgSnapshots.map((entry) => [entry.id, entry]));
  await setOrgSnapshots(fresh.map((entry) => (entry.snapshot ? entry : { ...entry, snapshot: previous.get(entry.id)?.snapshot ?? null })));
}

/**
 * The user picked a different main organisation. Each organisation keeps its
 * own readings and history, so the old one's are set aside and the new one's
 * brought back before anything is fetched.
 */
export async function switchMainOrg(toId) {
  const orgCache = await getOrgCache();
  const { orgList } = await getAll({ logs: false });
  const target = toId ?? orgList.find((org) => org.chat)?.id ?? orgList[0]?.id;
  if (!orgCache || !target || orgCache.orgId === target) return;

  // From here a reading fetched for the old organisation is not this one's, and is set aside when it lands.
  orgGeneration += 1;
  await withLock("reading", async () => {
    await swapOrgState(orgCache.orgId, target);
    await setOrgCache(null); // looked up afresh, as the new choice
  });
  otherOrgsReadAt = 0;
  await updateToolbar((await getAll({ logs: false })).latestSnapshot);
  await refreshUsage({ notBefore: Date.now() });
}

// --------------------------------------------------------------- api spend --
// The Anthropic Console's cost report, read with the user's Admin API key
// (lib/console-api.js). A different account from the claude.ai plan, and a
// report that only changes by the day, so it is read far less often.
const API_SPEND_MIN_INTERVAL_MS = 30 * 60 * 1000;

let apiSpendReadAt = 0;

/** @returns {Promise<{ ok: boolean, problem?: object } | null>} null when switched off, keyless or skipped */
export async function refreshApiSpend({ force = false } = {}) {
  const settings = await getSettings();
  const key = await getAdminKey();
  if (!settings.apiSpend || settings.demoMode || !key) return null;
  if (!force && Date.now() - apiSpendReadAt < API_SPEND_MIN_INTERVAL_MS) return null;
  apiSpendReadAt = Date.now();

  try {
    await setApiSpend(await fetchSpend(key), { ok: true });
    return { ok: true };
  } catch (err) {
    const problem = err?.problem ?? { code: "unknown", text: String(err?.message ?? err) };
    console.warn(LOG_PREFIX, "api spend:", problem.code);
    await setApiSpend(null, { ok: false, problem });
    return { ok: false, problem };
  }
}

// ------------------------------------------------------------- model hint --

export async function updateModelHint() {
  const { history, settings } = await getAll();
  if (settings.demoMode) return; // the demo dataset brings its own hint; don't overwrite the real one from it
  const hint =
    settings.modelHintPercent > 0 ? modelSwitchHint(history, { minPercent: settings.modelHintPercent }) : null;
  await setModelHint(hint);
}

// ------------------------------------------------------------------- alarm --
// When the next background reading happens. The interval in Options is the
// normal pace; with adaptive refresh on, lib/refresh-plan.js moves around it —
// sooner while a limit is close and climbing, later when nothing is changing,
// and later still after each failed attempt. The alarm is re-set after every
// reading and every failure. It repeats at the pace last chosen, so if the
// worker is stopped before it can choose again, readings carry on regardless.
let paceWrites = Promise.resolve();

/** @param {{ ok: boolean, changed?: boolean, code?: string, at?: number }} [outcome] - how the attempt just made went */
export function scheduleRefresh(outcome) {
  // One at a time: a reading and a failure landing together must each be counted.
  paceWrites = paceWrites
    .then(async () => {
      const settings = await getSettings();
      const stored = await chrome.storage.local.get(["refreshPace", "latestSnapshot"]);
      const pace = foldOutcome(stored.refreshPace, outcome);
      const plan =
        settings.adaptiveRefresh && !settings.demoMode
          ? planRefresh({ baseMinutes: settings.refreshIntervalMinutes, snapshot: stored.latestSnapshot, ...pace })
          : { minutes: settings.refreshIntervalMinutes, mode: "fixed" };
      await chrome.alarms.create(ALARM_NAME, { delayInMinutes: plan.minutes, periodInMinutes: plan.minutes });
      await chrome.storage.local.set({ refreshPace: { ...pace, ...plan, nextAt: Date.now() + plan.minutes * 60_000 } });
    })
    .catch((err) => console.warn(LOG_PREFIX, "could not schedule the next refresh", err));
  return paceWrites;
}

/**
 * A reply just finished in this browser. If readings had slowed down because
 * nothing was happening, or stopped getting through because claude.ai was
 * signed out, that is no longer so: read now instead of at the next alarm.
 */
export async function wakeRefresh() {
  const { refreshPace: pace } = await chrome.storage.local.get("refreshPace");
  const signedOut = pace?.mode === "backoff" && pace.errorCode === "NOT_LOGGED_IN";
  if (pace?.mode !== "slow" && !signedOut) return;
  await new Promise((resolve) => setTimeout(resolve, AFTER_SETTLE_MS)); // the same wait a message's "after" reading gets
  await refreshUsage({ notBefore: Date.now() });
}

/**
 * Are readings being held back because they keep failing? Then the ones
 * per-message cost would take around a message wait too. One failure can be a
 * blip, so it takes two; and being signed out doesn't count, because a message
 * going through is the sign that it is over.
 */
export async function backingOff() {
  const { refreshPace: pace } = await chrome.storage.local.get("refreshPace");
  return pace?.mode === "backoff" && pace.failures >= 2 && pace.errorCode !== "NOT_LOGGED_IN" && Date.now() < pace.nextAt;
}

export const ensureAlarm = () => scheduleRefresh();

/**
 * Captures kept by an earlier version could hold more than usage figures: its
 * page hook read every request under /api/organizations, chats included. Once,
 * on the first run of a version with the narrower rules, they are thrown away.
 */
async function scrubOldCaptures() {
  const { capturesScrubbed } = await chrome.storage.local.get("capturesScrubbed");
  if (capturesScrubbed) return;
  await chrome.storage.local.set({ __debug_captures: [], capturesScrubbed: true });
}

/**
 * An earlier version stored an answer with no limits in it — an error body, a
 * changed shape — as if it were a reading. If that is what is on show, the last
 * real one takes its place. (The history is cleaned of them as it is moved
 * into the archive, and the archive doesn't hand them out.)
 */
async function dropEmptyReadings() {
  const { latestSnapshot, history = [] } = await chrome.storage.local.get(["latestSnapshot", "history"]);
  const real = (snapshot) => Boolean(snapshot?.session) || (snapshot?.weekly ?? []).length > 0;
  if (!latestSnapshot || real(latestSnapshot)) return;
  await chrome.storage.local.set({ latestSnapshot: history.findLast(real) ?? null });
}

/** What a new version has to put right in what an older one left behind. In order, and with no reading landing in between. */
export function migrate() {
  return withLock("reading", async () => {
    await scrubOldCaptures().catch((err) => console.warn(LOG_PREFIX, "could not clear old captures", err));
    await dropEmptyReadings().catch((err) => console.warn(LOG_PREFIX, "could not tidy the stored readings", err));
    await moveLogs();
  });
}
