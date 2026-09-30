// Plan-fit adviser: after four weeks of watching, does the plan look too big,
// too small, or about right?
//
// Limits are compared across plans by their advertised multiples of Pro —
// Max 5x has five times the room, Max 20x twenty. That is exact for the
// session limit as Anthropic describes it and an approximation for the weekly
// ones, so a suggestion to move down only comes with headroom to spare.

import { summarizeWeeks } from "./weekly-stats.js";
import { lockoutStats } from "./lockout-stats.js";

/** Smallest first. `room` is the plan's usage allowance as a multiple of Pro's. */
export const PLANS = [
  { id: "pro", label: "Pro", room: 1 },
  { id: "max5", label: "Max 5x", room: 5 },
  { id: "max20", label: "Max 20x", room: 20 },
];

export const WEEKS_NEEDED = 4;
/** A week counts as observed once ClaudeMeter saw this many days of it. */
const MIN_DAYS_PER_WEEK = 3;

/** On the smaller plan, the busiest moments of the last four weeks must stay under this. */
const DOWNGRADE_CEILING = 80;
/** Running out this often, in at least this many separate weeks, says the plan is too small… */
const UPGRADE_LOCKOUTS = 4;
const UPGRADE_WEEKS = 2;
/** …as does a weekly limit reaching this level in that many weeks. */
const WEEKLY_NEAR_FULL = 95;

/** The plan a claude.ai tier name ("Max 5x", "Default Claude Max 20x", "Pro") refers to, if any. */
export function detectPlan(planTier) {
  const tier = String(planTier ?? "").toLowerCase();
  if (tier.includes("20x")) return "max20";
  if (tier.includes("5x")) return "max5";
  if (/\bpro\b/.test(tier)) return "pro";
  return null;
}

/**
 * @param {object} input
 * @param {Array<object>} input.usageLog - HourRecords (lib/usage-log.js)
 * @param {Array<object>} input.limitHits - LimitHit entries (lib/limit-hits.js)
 * @param {string | null} input.planTier - from the usage snapshot
 * @param {string} [input.plan] - the user's setting: a PLANS id, or "auto" to detect it
 * @returns {{ verdict: "learning" | "upgrade" | "downgrade" | "fits", plan: object | null, target: object | null,
 *   weeksSeen: number, sessionPeak?: number, weeklyPeak?: number, lockouts?: number, blockedMs?: number,
 *   onTarget?: { sessionPeak: number, weeklyPeak: number } }}
 *   `plan` is null when it couldn't be told; `target` is the plan suggested instead, when one can be named.
 */
export function planFit({ usageLog, limitHits, planTier, plan: setting = "auto", now = Date.now() }) {
  const plan = PLANS.find((p) => p.id === (setting === "auto" ? detectPlan(planTier) : setting)) ?? null;
  const weeks = summarizeWeeks(usageLog, { now, weeks: WEEKS_NEEDED });
  const weeksSeen = weeks.filter((week) => week.days >= MIN_DAYS_PER_WEEK).length;
  if (weeksSeen < WEEKS_NEEDED) return { verdict: "learning", plan, target: null, weeksSeen };

  const lockouts = lockoutStats(limitHits, { now, weeks: WEEKS_NEEDED });
  const facts = {
    plan,
    weeksSeen,
    sessionPeak: Math.max(...weeks.map((week) => week.sessionPeak ?? 0)),
    weeklyPeak: Math.max(...weeks.map((week) => week.weeklyPeak ?? 0)),
    lockouts: lockouts.total,
    blockedMs: lockouts.blockedMs,
  };

  const index = plan ? PLANS.indexOf(plan) : -1;
  const tooSmall =
    (lockouts.total >= UPGRADE_LOCKOUTS && lockouts.weeks.filter((week) => week.count > 0).length >= UPGRADE_WEEKS) ||
    weeks.filter((week) => (week.weeklyPeak ?? 0) >= WEEKLY_NEAR_FULL).length >= UPGRADE_WEEKS;
  if (tooSmall) return { verdict: "upgrade", target: (plan && PLANS[index + 1]) ?? null, ...facts };

  // Moving down: only when nothing ran out and the smaller plan would have had room for the busiest moments.
  // With the plan unknown, assume the smallest step there is between two plans.
  const smaller = index > 0 ? PLANS[index - 1] : null;
  const factor = plan && smaller ? plan.room / smaller.room : index === 0 ? Infinity : 4;
  const onTarget = { sessionPeak: facts.sessionPeak * factor, weeklyPeak: facts.weeklyPeak * factor };
  if (lockouts.total === 0 && Math.max(onTarget.sessionPeak, onTarget.weeklyPeak) <= DOWNGRADE_CEILING) {
    return { verdict: "downgrade", target: smaller, onTarget, ...facts };
  }

  return { verdict: "fits", target: null, ...facts };
}

const times = (count) => (count === 1 ? "once" : `${count} times`);

/** The verdict in a sentence or two. `blocked` is the blocked time already put into words. */
export function describePlanFit(fit, blocked = "") {
  const { verdict, plan, target } = fit;
  if (verdict === "learning") {
    return (
      `Plan advice needs ${WEEKS_NEEDED} weeks of history to go on; ClaudeMeter has seen ` +
      `${fit.weeksSeen === 0 ? "none" : fit.weeksSeen} so far.`
    );
  }

  const peaks = `your busiest session reached ${fit.sessionPeak}% and your fullest weekly limit ${fit.weeklyPeak}%`;
  const name = plan?.label ?? "your plan";

  if (verdict === "upgrade") {
    const ranOut =
      fit.lockouts > 0
        ? `You ran out ${times(fit.lockouts)} in four weeks${blocked ? ` (${blocked} blocked)` : ""}, and ${peaks}.`
        : `In four weeks ${peaks}.`;
    if (target) return `${ranOut} ${target.label} has ${target.room / plan.room}× the room of ${name} and may suit you better.`;
    return plan
      ? `${ranOut} ${name} is already the largest plan, so there is no bigger one to suggest.`
      : `${ranOut} A larger plan may suit you better — set your plan in Options for a specific suggestion.`;
  }

  if (verdict === "downgrade") {
    const intro = `Nothing ran out in four weeks: ${peaks}.`;
    if (target) {
      return (
        `${intro} On ${target.label} (${fractionOf(plan.room / target.room)} the room) that would have been about ` +
        `${Math.round(fit.onTarget.sessionPeak)}% and ${Math.round(fit.onTarget.weeklyPeak)}% — ${target.label} may be enough.`
      );
    }
    return `${intro} A smaller plan may be enough — set your plan in Options for a specific suggestion.`;
  }

  const ranOut = fit.lockouts === 0 ? "nothing ran out" : `you ran out ${times(fit.lockouts)}`;
  return `${name[0].toUpperCase()}${name.slice(1)} looks about right: in four weeks ${peaks}, and ${ranOut}.`;
}

function fractionOf(divisor) {
  return { 4: "a quarter of", 5: "a fifth of" }[divisor] ?? `1/${divisor} of`;
}
