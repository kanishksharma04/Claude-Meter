// What the page script on claude.ai reports (src/content/inject-hook.js, by
// way of relay.js): the answers to the page's own usage requests, messages
// being sent and answered, and limits being hit. From those come the passive
// readings, the per-message costs and the lockout log.

import {
  getAll,
  getSettings,
  getOrgCache,
  pushDebugCapture,
  setPendingMessage,
  takePendingMessage,
  pushMessageCost,
  pushLimitHit,
  noteLocalActivity,
  setExtraUsage,
  withLock,
} from "../lib/storage.js";
import { orgIdFromUsageUrl } from "../lib/orgs.js";
import { captureAllowed, captureKind, trimBody } from "../lib/capture-rules.js";
import { normalizeUsageResponse, normalizeExtraUsage } from "../lib/normalize-usage.js";
import { computeMessageCost } from "../lib/message-cost.js";
import { resolveResetsAt } from "../lib/limit-hits.js";
import { tokensOf } from "../lib/value.js";
import { refreshUsage, applySnapshot, wakeRefresh, backingOff } from "./refresh.js";
import { LOG_PREFIX, BEFORE_MAX_AGE_MS, AFTER_SETTLE_MS } from "./shared.js";

export async function handlePassiveCapture(capture, sender) {
  try {
    const settings = await getSettings();
    // The page hook and the relay have both applied these rules already; a capture
    // that reaches here against them didn't come from either, and is dropped.
    if (!captureAllowed(capture?.url, settings.developerMode)) return;

    if (settings.developerMode) {
      await pushDebugCapture({
        ...capture,
        responseBody: trimBody(capture.responseBody),
        tabId: sender?.tab?.id ?? null,
        pageUrl: sender?.tab?.url ?? sender?.url ?? null,
      });
    }

    // Only an answer that worked is a reading. The page's own request can fail like any
    // other — a 429, a 500, a sign-in page — and what comes back then is an error body.
    const answered = capture.method === "GET" && capture.status === 200 && capture.responseBody && typeof capture.responseBody === "object";
    if (settings.demoMode || !answered) return;
    const kind = captureKind(capture.url);

    // Zero-cost passive update: if the page itself just made this exact
    // request (e.g. user opened claude.ai's own usage panel), reuse that
    // response instead of waiting for the next active refresh.
    if (kind === "usage") {
      const orgCache = await getOrgCache();
      // The page may be looking at a different organisation from the main one; its figures aren't ours to file.
      const forMain = !orgCache || orgIdFromUsageUrl(capture.url) === orgCache.orgId;
      // null when there is no limit in it: then the reading in hand stays as it is.
      const snapshot = forMain && normalizeUsageResponse(capture.responseBody, { orgMeta: orgCache?.raw });
      if (snapshot) {
        await applySnapshot(snapshot);
        console.log(LOG_PREFIX, "updated snapshot from passive capture");
      }
    }

    // Same idea for extra usage: when the page loads its own spend-limit data, read it over its shoulder.
    if (kind === "spend") {
      const extraUsage = normalizeExtraUsage(capture.responseBody);
      if (extraUsage) await setExtraUsage(extraUsage, capture.timestamp ?? Date.now());
    }
  } catch (err) {
    console.error(LOG_PREFIX, "failed to handle passive capture", err);
  }
}

// ------------------------------------------------------------ message cost --
// In-flight "before" readings, so a reply that ends before its start handler
// has finished still finds its baseline. Lost if the worker is recycled — the
// stored pendingMessages entry covers that case.
const startsInFlight = new Map();

let activityWrites = Promise.resolve();

export async function handleChatEvent(event) {
  try {
    const settings = await getSettings();
    // Demo mode shows made-up numbers; measuring real messages against them would be nonsense.
    if (settings.demoMode) return;
    if (event?.kind === "limit_hit") return await recordLimitHit(event);

    // Whatever else is switched off, remember that this browser was in use: it is
    // how a rise in usage gets told apart from one that happened on another device.
    if (event?.kind === "completion_start" || event?.kind === "completion_end") {
      // One at a time — a start and an end landing together must not overwrite each other.
      activityWrites = activityWrites.then(() => noteLocalActivity(event)).catch(() => {});
      await activityWrites;
    }
    // With per-message cost on, the readings around the message do this already.
    if (event?.kind === "completion_end" && !settings.messageCost) wakeRefresh();

    if (!settings.messageCost) return;
    if (event?.kind === "conversation_loaded") return await setThreadChars(event.conversationId, event.chars ?? 0);
    if (!event?.requestId) return;

    if (event.kind === "completion_start") {
      const started = recordMessageStart(event);
      startsInFlight.set(event.requestId, started);
      await started;
      startsInFlight.delete(event.requestId);
    } else if (event.kind === "completion_end") {
      await startsInFlight.get(event.requestId);
      await recordMessageEnd(event);
    }
  } catch (err) {
    console.error(LOG_PREFIX, "failed to handle chat event", err);
  }
}

// How long each open chat's thread is, in characters, so a message's input can
// be sized: every message re-sends the whole thread. Kept in storage.session —
// it is only good for as long as the tabs it describes.
const MAX_TRACKED_THREADS = 50;

async function threadChars(conversationId) {
  const { threadChars: sizes = {} } = await chrome.storage.session.get("threadChars");
  return sizes[conversationId] ?? 0;
}

/** `change` is given the size on record and returns the new one, with nothing else writing in between. */
function setThreadChars(conversationId, change) {
  if (!conversationId) return Promise.resolve();
  return withLock("threadChars", async () => {
    const { threadChars: sizes = {} } = await chrome.storage.session.get("threadChars");
    const chars = typeof change === "function" ? change(sizes[conversationId] ?? 0) : change;
    delete sizes[conversationId]; // re-insert, so the least recently touched chat is the one dropped
    const entries = [...Object.entries(sizes), [conversationId, chars]].slice(-MAX_TRACKED_THREADS);
    await chrome.storage.session.set({ threadChars: Object.fromEntries(entries) });
  });
}

async function recordMessageStart(event) {
  let { latestSnapshot: before } = await getAll({ logs: false });
  if (!before || Date.now() - before.fetchedAt > BEFORE_MAX_AGE_MS) {
    if (await backingOff()) return; // this message goes unmeasured rather than adding to the trouble
    const result = await refreshUsage();
    if (result.ok) before = result.snapshot;
  }
  if (!before) return;

  await setPendingMessage(event.requestId, {
    startedAt: event.timestamp ?? Date.now(),
    conversationId: event.conversationId ?? null,
    model: event.model ?? null,
    // What went in: the thread as it stood, plus this message.
    promptChars: event.promptChars ?? 0,
    inputChars: (await threadChars(event.conversationId)) + (event.promptChars ?? 0),
    before,
  });
}

async function recordMessageEnd(event) {
  const { pending, othersInFlight } = await takePendingMessage(event.requestId);
  // A request that never produced a reply (HTTP error, network failure) cost nothing.
  if (!pending || !event.ok) return;

  // The thread is now longer by this exchange, whatever the next reading says.
  const exchanged = (pending.promptChars ?? 0) + (event.replyChars ?? 0);
  await setThreadChars(pending.conversationId, (chars) => chars + exchanged);

  if (await backingOff()) return;
  await new Promise((resolve) => setTimeout(resolve, AFTER_SETTLE_MS));
  // A refresh already on its way may have asked before this reply's cost had landed: it won't do.
  const result = await refreshUsage({ notBefore: Date.now() });
  if (!result.ok) return;

  const cost = computeMessageCost(pending.before, result.snapshot);
  await pushMessageCost({
    id: event.requestId,
    at: Date.now(),
    conversationId: pending.conversationId,
    title: event.title ?? null,
    model: pending.model,
    session: cost.session,
    weekly: cost.weekly,
    durationMs: event.durationMs ?? null,
    // Rough token counts, for pricing the message at API rates (lib/value.js).
    inputTokens: pending.inputChars != null ? tokensOf(pending.inputChars) : null,
    outputTokens: tokensOf(event.replyChars),
    // Another reply was streaming at the same time, so the delta is split between them.
    shared: othersInFlight,
  });
}

// -------------------------------------------------------------- limit hits --

async function recordLimitHit(event) {
  // Refresh first: a hit usually means the numbers we hold are behind, and the
  // fresh reading can supply a reset time the response didn't carry.
  const result = await refreshUsage({ notBefore: Date.now() });
  const snapshot = result.ok ? result.snapshot : (await getAll({ logs: false })).latestSnapshot;

  const hit = {
    at: event.timestamp ?? Date.now(),
    source: event.source ?? "rejected", // "rejected" = message refused, "reply" = last reply before the lockout
    claim: event.claim ?? null,
    resetsAt: event.resetsAt ?? null,
    conversationId: event.conversationId ?? null,
    model: event.model ?? null,
  };
  hit.resetsAt = resolveResetsAt(hit, snapshot);

  await pushLimitHit(hit);
  console.log(LOG_PREFIX, "logged limit hit", hit.claim ?? "(unnamed limit)");
}
