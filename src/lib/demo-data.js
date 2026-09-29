// Made-up usage for demo mode: something to look at before signing in, and
// tidy, repeatable numbers for screenshots. Everything is derived from `now`
// alone — no randomness — so two renders a minute apart look the same.
//
// The shapes match what the rest of the extension stores (UsageSnapshot,
// MessageCost, LimitHit, the model hint), so nothing downstream needs to know
// it is looking at demo data.

import { formatDuration } from "./time-format.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const SESSION_LENGTH = 5 * HOUR;
const SESSION_NOW = 62;
const WEEKLY_NOW = { "All models": 38, Opus: 71 };
/** How long ago the weekly buckets started climbing from their starting values. */
const HISTORY_SPAN = 12 * HOUR;
const HISTORY_STEP = 15 * MIN;

const CHATS = [
  { id: "d3m00001-0000-4000-8000-000000000001", title: "Refactor the billing module" },
  { id: "d3m00002-0000-4000-8000-000000000002", title: "Lisbon trip itinerary" },
  { id: "d3m00003-0000-4000-8000-000000000003", title: "Quarterly report draft" },
];

/** [minutes ago, chat index, session % points, model] — newest last. */
const MESSAGES = [
  [640, 2, 6, "claude-sonnet-4-5"],
  [610, 2, 4, "claude-sonnet-4-5"],
  [420, 1, 2, "claude-haiku-4-5"],
  [400, 1, 1, "claude-haiku-4-5"],
  [160, 0, 9, "claude-opus-4-5"],
  [128, 0, 12, "claude-opus-4-5"],
  [96, 0, 8, "claude-opus-4-5"],
  [41, 0, 11, "claude-opus-4-5"],
  [6, 0, 5, "claude-opus-4-5"],
];

function bucket(label, percentUsed, resetsAt, now) {
  return { label, percentUsed, resetsAt, resetsInLabel: formatDuration(now, resetsAt) ?? "unknown" };
}

/** Session % at time `t`: three 5-hour windows, each filling steadily until it resets. */
function sessionAt(t, sessionResetsAt) {
  const peaks = [SESSION_NOW, 88, 74]; // current window, the one before it, the one before that
  const windowsBack = Math.max(0, Math.ceil((sessionResetsAt - SESSION_LENGTH - t) / SESSION_LENGTH));
  const windowEnd = sessionResetsAt - windowsBack * SESSION_LENGTH;
  const elapsed = (t - (windowEnd - SESSION_LENGTH)) / SESSION_LENGTH; // 0..1 through this window
  // The current window is only part-way through, so scale it to land on SESSION_NOW "now".
  const full = windowsBack === 0 ? SESSION_NOW / ((SESSION_LENGTH - 134 * MIN) / SESSION_LENGTH) : peaks[windowsBack] ?? 60;
  return Math.max(0, Math.min(100, Math.round(full * elapsed)));
}

/**
 * @returns {{ latestSnapshot: object, history: object[], messageLog: object[], limitHits: object[], modelHint: object, lastError: null }}
 */
export function buildDemoState(now = Date.now()) {
  const sessionResetsAt = now + 134 * MIN; // "resets in 2 hr 14 min"
  const weeklyResetsAt = now + 3 * DAY + 6 * HOUR;

  const snapshotAt = (t) => {
    const progress = 1 - (now - t) / HISTORY_SPAN; // 0 at the start of the history, 1 now
    return {
      fetchedAt: t,
      planTier: "Max 5x",
      session: bucket("Current session", sessionAt(t, sessionResetsAt), sessionResetsAt, t),
      weekly: [
        bucket("All models", Math.round(WEEKLY_NOW["All models"] - 9 * (1 - progress)), weeklyResetsAt, t),
        bucket("Opus", Math.round(WEEKLY_NOW.Opus - 17 * (1 - progress)), weeklyResetsAt, t),
      ],
    };
  };

  const history = [];
  for (let t = now - HISTORY_SPAN; t <= now; t += HISTORY_STEP) history.push(snapshotAt(t));

  const messageLog = MESSAGES.map(([minutesAgo, chat, session, model], index) => ({
    id: `demo-${index}`,
    at: now - minutesAgo * MIN,
    conversationId: CHATS[chat].id,
    title: CHATS[chat].title,
    model,
    session,
    weekly: model.includes("opus") ? [{ label: "Opus", delta: Math.max(1, Math.round(session / 6)) }] : [],
    durationMs: 9000 + index * 1700,
    shared: false,
  }));

  const hit = (ago, attempts) => ({
    at: now - ago,
    lastAt: now - ago + (attempts - 1) * 2 * MIN,
    attempts,
    source: "rejected",
    claim: "five_hour",
    resetsAt: now - ago + 47 * MIN,
    conversationId: CHATS[0].id,
    model: "claude-opus-4-5",
  });

  return {
    latestSnapshot: history.at(-1),
    history,
    messageLog,
    limitHits: [hit(5 * DAY + 3 * HOUR, 1), hit(2 * DAY + 5 * HOUR, 3)],
    modelHint: {
      label: "Opus",
      percentUsed: WEEKLY_NOW.Opus,
      resetsAt: weeklyResetsAt,
      basis: "rate",
      ratePerHour: 1.4,
      hoursLeft: 20.7,
      suggest: "Sonnet or Haiku",
    },
    lastError: null,
  };
}
