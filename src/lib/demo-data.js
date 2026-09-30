// Made-up usage for demo mode: something to look at before signing in, and
// tidy, repeatable numbers for screenshots. Everything is derived from `now`
// alone — no randomness — so two renders a minute apart look the same.
//
// The shapes match what the rest of the extension stores (UsageSnapshot,
// MessageCost, LimitHit, the model hint), so nothing downstream needs to know
// it is looking at demo data.

import { formatDuration } from "./time-format.js";
import { foldSnapshot, hourStart } from "./usage-log.js";

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

// --------------------------------------------------------------- analytics --
// Weeks of hourly records for the dashboard's analytics. Kept apart from
// buildDemoState() because it is much larger and never needs storing — see
// demoData() in lib/storage.js.

const LOG_SPAN = 35 * DAY;
/** The made-up browser is open from this hour until midnight. */
const FIRST_HOUR = 7;
/** Session %-points used in each hour of a working day, and of a weekend day. */
const WORKDAY_HOURS = [0, 0, 0, 0, 0, 0, 0, 0, 2, 9, 16, 14, 6, 4, 12, 17, 13, 8, 3, 1, 0, 4, 3, 0];
const WEEKEND_HOURS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 5, 2, 0, 0, 4, 2, 0, 0, 0, 0, 3, 1, 0];

/** A repeatable stand-in for randomness: the same seed always gives the same 0–1 value. */
function noise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** How many weekly %-points one session %-point costs, per weekly limit. */
const WEEKLY_PER_SESSION_POINT = { "All models": 0.085, Opus: 0.13 };

/**
 * Hourly records for [from, to): busy working days, quiet weekends, some days
 * heavier than others. `weeklyAt` gives each weekly limit's level at `to`, so
 * the made-up past joins up with the stored demo history.
 */
function simulateHours(from, to, weeklyResetsAt, weeklyAt) {
  const hours = [];
  let session = 0;
  let windowEnd = 0;
  let weekEnd = weeklyResetsAt;
  while (weekEnd - 7 * DAY > from) weekEnd -= 7 * DAY;
  let used = 0; // session points used so far in the weekly window being walked

  for (let t = from; t < to; t += HOUR) {
    const date = new Date(t);
    const hour = date.getHours();
    const day = Math.round(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / DAY);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const want = Math.round(
      (weekend ? WEEKEND_HOURS : WORKDAY_HOURS)[hour] * (0.6 + 1.3 * noise(day)) * (0.7 + 0.6 * noise(day * 24 + hour + 0.5))
    );

    if (t >= windowEnd) {
      session = 0;
      if (want > 0) windowEnd = t + SESSION_LENGTH;
    }
    if (t >= weekEnd) {
      used = 0;
      weekEnd += 7 * DAY;
    }
    const burn = Math.min(want, 100 - session);
    session += burn;
    used += burn;

    if (hour >= FIRST_HOUR) hours.push({ t, burn, peak: session, used, weekEnd });
  }

  const reached = hours.at(-1)?.used ?? 0;
  const levels = {}; // label -> level at the previous record
  let lastWeekEnd = null;
  return hours.map(({ t, burn, peak, used: soFar, weekEnd: end }) => {
    if (end !== lastWeekEnd) for (const label of Object.keys(weeklyAt)) levels[label] = 0;
    lastWeekEnd = end;
    const weekly = {};
    for (const [label, target] of Object.entries(weeklyAt)) {
      const rate = WEEKLY_PER_SESSION_POINT[label] ?? 0.1;
      // The week still running is counted back from where it has to end up.
      const level = end === weeklyResetsAt ? target - (reached - soFar) * rate : soFar * rate;
      const pct = Math.max(0, Math.min(100, Math.round(level)));
      weekly[label] = { pct, burn: Math.max(0, pct - levels[label]) };
      levels[label] = pct;
    }
    return { t, n: 12, peak, burn, weekly };
  });
}

/**
 * @param {{ history: object[] }} demo - what buildDemoState() returned
 * @returns {{ usageLog: object[] }}
 */
export function buildDemoAnalytics(demo) {
  const [first] = demo.history;
  const to = hourStart(first.fetchedAt);
  const weeklyAt = Object.fromEntries(first.weekly.map((b) => [b.label, b.percentUsed]));

  let usageLog = simulateHours(to - LOG_SPAN, to, first.weekly[0].resetsAt, weeklyAt);
  let previous = null;
  for (const snapshot of demo.history) {
    usageLog = foldSnapshot(usageLog, previous, snapshot);
    previous = snapshot;
  }
  return { usageLog };
}
