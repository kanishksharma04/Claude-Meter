// Made-up usage for demo mode: something to look at before signing in, and
// tidy, repeatable numbers for screenshots. Everything is derived from `now`
// alone — no randomness — so two renders a minute apart look the same.
//
// The shapes match what the rest of the extension stores (UsageSnapshot,
// MessageCost, LimitHit, the model hint), so nothing downstream needs to know
// it is looking at demo data.

import { formatDuration } from "./time-format.js";
import { foldSnapshot, hourStart } from "./usage-log.js";
import { foldWindow } from "./session-windows.js";
import { cacheEfficiency } from "./claude-code.js";

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

/** [minutes ago, chat index, session % points, model, tokens in, tokens out] — newest last. */
const MESSAGES = [
  [640, 2, 6, "claude-sonnet-5-5", 60_000, 4_000],
  [610, 2, 4, "claude-sonnet-5-5", 72_000, 3_000],
  [420, 1, 2, "claude-haiku-4-5", 15_000, 1_200],
  [400, 1, 1, "claude-haiku-4-5", 18_000, 1_000],
  [160, 0, 9, "claude-opus-5-5", 140_000, 6_000],
  [128, 0, 12, "claude-opus-5-5", 180_000, 9_000],
  [96, 0, 8, "claude-opus-5-5", 205_000, 5_000],
  [41, 0, 11, "claude-opus-5-5", 230_000, 8_000],
  [6, 0, 5, "claude-opus-5-5", 250_000, 4_000],
];

/** Pay-as-you-go spend past the plan's limits: $12.40 of a $50 monthly cap. */
const EXTRA_USAGE = { enabled: true, used: 12.4, limit: 50, percentUsed: 25, currency: "USD" };
/** The month's running total at the end of each of the last few days, oldest first; today's is EXTRA_USAGE.used. */
const EXTRA_USAGE_BY_DAY = [0, 3.2, 3.2, 6.1, 10.3];

function bucket(label, percentUsed, resetsAt, now) {
  return { label, percentUsed, resetsAt, resetsInLabel: formatDuration(now, resetsAt) ?? "unknown" };
}

/**
 * The session at time `t`: three 5-hour windows, each filling steadily until it resets.
 * @returns {{ pct: number, resetsAt: number }} the level, and the reset time of the window `t` falls in
 */
function sessionAt(t, sessionResetsAt) {
  const peaks = [SESSION_NOW, 88, 74]; // current window, the one before it, the one before that
  const windowsBack = Math.max(0, Math.ceil((sessionResetsAt - SESSION_LENGTH - t) / SESSION_LENGTH));
  const windowEnd = sessionResetsAt - windowsBack * SESSION_LENGTH;
  const elapsed = (t - (windowEnd - SESSION_LENGTH)) / SESSION_LENGTH; // 0..1 through this window
  // The current window is only part-way through, so scale it to land on SESSION_NOW "now".
  const full = windowsBack === 0 ? SESSION_NOW / ((SESSION_LENGTH - 134 * MIN) / SESSION_LENGTH) : peaks[windowsBack] ?? 60;
  return { pct: Math.max(0, Math.min(100, Math.round(full * elapsed))), resetsAt: windowEnd };
}

/**
 * @returns {{ latestSnapshot: object, history: object[], messageLog: object[], limitHits: object[], modelHint: object, lastError: null }}
 */
export function buildDemoState(now = Date.now()) {
  const sessionResetsAt = now + 134 * MIN; // "resets in 2 hr 14 min"
  const weeklyResetsAt = now + 3 * DAY + 6 * HOUR;

  const snapshotAt = (t) => {
    const progress = 1 - (now - t) / HISTORY_SPAN; // 0 at the start of the history, 1 now
    const session = sessionAt(t, sessionResetsAt);
    return {
      fetchedAt: t,
      planTier: "Max 5x",
      extraUsage: EXTRA_USAGE,
      session: bucket("Current session", session.pct, session.resetsAt, t),
      weekly: [
        bucket("All models", Math.round(WEEKLY_NOW["All models"] - 9 * (1 - progress)), weeklyResetsAt, t),
        bucket("Opus", Math.round(WEEKLY_NOW.Opus - 17 * (1 - progress)), weeklyResetsAt, t),
      ],
    };
  };

  const history = [];
  for (let t = now - HISTORY_SPAN; t <= now; t += HISTORY_STEP) history.push(snapshotAt(t));
  // The oldest of the three windows was Claude Code on another machine: nothing was sent from this browser.
  const elsewhereUntil = sessionResetsAt - 2 * SESSION_LENGTH;
  for (let index = 1; index < history.length && history[index].session.resetsAt <= elsewhereUntil; index++) {
    const rise = history[index].session.percentUsed - history[index - 1].session.percentUsed;
    if (rise > 0) history[index].elsewhere = rise;
  }

  const messageLog = MESSAGES.map(([minutesAgo, chat, session, model, inputTokens, outputTokens], index) => ({
    id: `demo-${index}`,
    at: now - minutesAgo * MIN,
    conversationId: CHATS[chat].id,
    title: CHATS[chat].title,
    model,
    session,
    weekly: model.includes("opus") ? [{ label: "Opus", delta: Math.max(1, Math.round(session / 6)) }] : [],
    durationMs: 9000 + index * 1700,
    inputTokens,
    outputTokens,
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
    model: "claude-opus-5-5",
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
const WORKDAY_HOURS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 13, 19, 17, 11, 4, 9, 13, 10, 6, 3, 1, 0, 4, 3, 0];
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
  const lockouts = [];
  const windows = [];
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
      if (want > 0) {
        windowEnd = t + SESSION_LENGTH;
        windows.push({ start: t, resetsAt: windowEnd, firstSeen: t, lastSeen: t, peak: 0 });
      }
    }
    if (t >= weekEnd) {
      used = 0;
      weekEnd += 7 * DAY;
    }
    const burn = Math.min(want, 100 - session);
    session += burn;
    used += burn;
    if (burn > 0) Object.assign(windows.at(-1), { peak: session, lastSeen: t + HOUR });
    // Wanting more than the window had left is a lockout, from part-way through this hour.
    if (burn < want && lockouts.at(-1)?.resetsAt !== windowEnd) {
      lockouts.push({ at: t + Math.round((burn / want) * 50) * MIN, resetsAt: windowEnd });
    }

    // Evenings and weekends are the phone: used, but not from this browser.
    const away = weekend || hour >= 21 ? burn : 0;
    if (hour >= FIRST_HOUR) hours.push({ t, burn, away, peak: session, used, weekEnd });
  }

  const reached = hours.at(-1)?.used ?? 0;
  const levels = {}; // label -> level at the previous record
  let lastWeekEnd = null;
  const records = hours.map(({ t, burn, away, peak, used: soFar, weekEnd: end }) => {
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
    return { t, n: 12, peak, burn, weekly, ...(away > 0 ? { away } : {}) };
  });
  return { records, lockouts, windows };
}

/**
 * @param {{ history: object[], limitHits: object[] }} demo - what buildDemoState() returned
 * @returns {{ usageLog: object[], sessionWindows: object[], spikes: object[], limitHits: object[] }}
 */
export function buildDemoAnalytics(demo) {
  const [first] = demo.history;
  const now = demo.history.at(-1).fetchedAt;
  const to = hourStart(first.fetchedAt);
  const weeklyAt = Object.fromEntries(first.weekly.map((b) => [b.label, b.percentUsed]));

  const past = simulateHours(to - LOG_SPAN, to, first.weekly[0].resetsAt, weeklyAt);
  let usageLog = past.records;
  // The made-up past stops where the first window of the stored history begins.
  let sessionWindows = past.windows.filter((w) => w.resetsAt <= first.session.resetsAt - SESSION_LENGTH);
  let previous = null;
  for (const snapshot of demo.history) {
    usageLog = foldSnapshot(usageLog, previous, snapshot);
    sessionWindows = foldWindow(sessionWindows, snapshot);
    previous = snapshot;
  }

  // The last week's lockouts are the stored demo ones, which the page script on claude.ai shows too.
  const olderHits = past.lockouts
    .filter((lockout) => lockout.at < now - 7 * DAY)
    .map(({ at, resetsAt }, index) => ({
      at,
      lastAt: at + (index % 3) * 4 * MIN,
      attempts: 1 + (index % 3),
      source: "rejected",
      claim: "five_hour",
      resetsAt,
      conversationId: CHATS[0].id,
      model: "claude-opus-5-5",
    }));

  // Two sudden jumps: one in the current window, lined up with the costliest demo message, and an older one.
  const spike = (minutesAgo, minutes, before, rise) => ({
    at: now - minutesAgo * MIN,
    from: now - (minutesAgo + minutes) * MIN,
    label: "Current session",
    before,
    after: before + rise,
    rise,
  });
  const spikes = [spike(2 * 24 * 60 + 190, 5, 48, 21), spike(128, 4, 9, 16)];

  const today = new Date(now).setHours(0, 0, 0, 0);
  const extraUsageLog = [...EXTRA_USAGE_BY_DAY, EXTRA_USAGE.used].map((used, index, all) => ({
    day: today - (all.length - 1 - index) * DAY,
    used,
  }));

  // Claude Code, as the companion would report it. Its activity follows the made-up plan usage —
  // busiest in the hours the session climbed fastest — and every total below is summed from it.
  const buckets = usageLog
    .filter((record) => record.t > now - 7 * DAY && record.burn > 0)
    .flatMap((record) =>
      [0, 1, 2, 3].map((quarter) => {
        const share = 0.15 + 0.2 * noise(record.t / HOUR + quarter); // the hour's four quarters, unevenly
        const cost = Math.round(record.burn * share * 480) / 10_000;
        return [record.t + quarter * 15 * MIN, Math.round(cost * 2_351_520), cost];
      })
    )
    .filter(([t]) => t <= now);
  /**
   * Totals for the buckets from `since` on, with the token mix of a long cached session — chosen so
   * that, at Opus 5.5 prices with hour-long cache entries, each dollar's tokens do add up to a dollar.
   */
  const totals = (since) => {
    const cost = buckets.filter(([t]) => t >= since).reduce((sum, bucket) => sum + bucket[2], 0);
    const [input, output, cacheRead, cacheWrite] = [620, 10_900, 2_300_000, 40_000].map((perDollar) => Math.round(cost * perDollar));
    return { tokens: input + output + cacheRead + cacheWrite, input, output, cacheRead, cacheWrite, cost, messages: Math.round(cost * 23) };
  };
  const sessionResetsAt = demo.latestSnapshot.session.resetsAt;
  const week = totals(0);
  const claudeCode = {
    generatedAt: now,
    files: 14,
    session: { from: sessionResetsAt - SESSION_LENGTH, to: sessionResetsAt, ...totals(sessionResetsAt - SESSION_LENGTH) },
    today: totals(new Date(now).setHours(0, 0, 0, 0)),
    week,
    models: [
      { model: "claude-opus-5-5", tokens: Math.round(week.tokens * 0.82), cost: week.cost * 0.86 },
      { model: "claude-haiku-4-5", tokens: Math.round(week.tokens * 0.18), cost: week.cost * 0.14 },
    ],
    buckets,
    projects: [
      ["/Users/demo/code/billing-api", 0.56, 9, 6 * MIN],
      ["/Users/demo/code/marketing-site", 0.25, 5, 26 * HOUR],
      ["/Users/demo/dotfiles", 0.12, 3, 3 * DAY],
      ["/Users/demo/code/scratch/billing-api", 0.07, 2, 5 * DAY],
    ].map(([cwd, share, sessions, ago], index) => ({
      cwd,
      // Two of them share a folder name, so the names show how that is told apart.
      name: ["code/billing-api", "marketing-site", "dotfiles", "scratch/billing-api"][index],
      tokens: Math.round(week.tokens * share),
      cost: week.cost * share,
      costToday: index === 0 ? totals(new Date(now).setHours(0, 0, 0, 0)).cost : 0,
      messages: Math.round(week.messages * share),
      sessions,
      lastAt: now - ago,
    })),
  };

  // Mostly Opus 5.5 with hour-long cache entries: $4 a million to send, $0.20 to read back, $8 to write.
  const cacheOf = ({ cacheRead: read, cacheWrite: write, input }) =>
    cacheEfficiency({ read, write, input, paid: (read * 0.2 + write * 8) / 1e6, uncached: ((read + write) * 4) / 1e6 });
  claudeCode.cache = { today: cacheOf(claudeCode.today), week: cacheOf(week) };

  claudeCode.sessions = [
    ["Refactor the billing module", "code/billing-api", "claude-opus-5-5", 0.21, 3 * HOUR + 10 * MIN, 6 * MIN, 212],
    ["Migrate invoices to the new schema", "code/billing-api", "claude-opus-5-5", 0.16, 2 * DAY + 5 * HOUR, 2 * DAY + 1 * HOUR, 174],
    ["Landing page rewrite", "marketing-site", "claude-opus-5-5", 0.13, 27 * HOUR, 26 * HOUR, 96],
    [null, "code/billing-api", "claude-opus-5-5", 0.08, 4 * DAY + 3 * HOUR, 4 * DAY + 2 * HOUR, 71],
    ["Tidy zsh startup time", "dotfiles", "claude-haiku-4-5", 0.05, 3 * DAY + 40 * MIN, 3 * DAY, 58],
  ].map(([title, project, model, share, startedAgo, lastAgo, messages], index) => ({
    sessionId: `d3m0c0de-0000-4000-8000-00000000000${index}`,
    title,
    project,
    model,
    startedAt: now - startedAgo,
    lastAt: now - lastAgo,
    tokens: Math.round(week.tokens * share),
    cost: week.cost * share,
    messages,
  }));

  return {
    usageLog,
    sessionWindows,
    spikes,
    claudeCode,
    claudeCodeStatus: { ok: true, at: now, version: "demo" },
    limitHits: [...olderHits, ...demo.limitHits],
    extraUsage: { ...EXTRA_USAGE, fetchedAt: now },
    extraUsageLog,
  };
}
