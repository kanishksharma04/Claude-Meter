// Value-for-money readout: what the usage on this account would have cost at
// API prices, set against what the subscription costs.
//
// The usage endpoint only reports percentages, so there is no direct way to
// price them. But for messages sent from this browser ClaudeMeter knows two
// things at once: roughly how many tokens went in and out, and how many
// session %-points the message used. Together those give a rate — dollars per
// point — which can then be applied to every point used on the account,
// wherever it was used.
//
// Everything here is an estimate. Token counts are characters divided by four
// and leave out what the page never shows (system prompt, tool results,
// reasoning, images); prices are list prices with no prompt caching, which an
// API client re-sending a long thread would use. The first error makes the
// figure too low, the second too high.

import { detectPlan } from "./plan-fit.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 365.25 / 12;

export const CHARS_PER_TOKEN = 4;

/** When the price list below was last checked against Anthropic's published API pricing. */
export const PRICES_AS_OF = "2026-09-25";

/**
 * US$ per million tokens, first match wins. A model older than the ones listed
 * falls through to its family's last row, which is close but not exact.
 */
export const API_PRICES = [
  { match: /fable|mythos/, input: 10, output: 50 }, // Fable 5, 5.1
  { match: /opus-5-5/, input: 4, output: 20 },
  { match: /opus/, input: 5, output: 25 }, // Opus 5, 4.8, 4.7, 4.6
  { match: /sonnet-5/, input: 2, output: 10 }, // Sonnet 5.5, 5
  { match: /sonnet/, input: 3, output: 15 }, // Sonnet 4.6
  { match: /haiku/, input: 1, output: 5 }, // Haiku 4.5
];

/** Used when the model a message went to couldn't be read from the request. */
const FALLBACK_PRICE = API_PRICES.find((price) => price.match.test("sonnet-5-5"));

/** What each plan costs a month in US$, before tax — overridable in Options. */
export const PLAN_PRICES = { pro: 20, max5: 100, max20: 200 };

/** A dollars-per-point rate needs at least this much to stand on. */
export const MIN_MESSAGES = 5;
export const MIN_POINTS = 10;

export function tokensOf(chars) {
  return Math.round((chars ?? 0) / CHARS_PER_TOKEN);
}

export function priceFor(model) {
  const id = String(model ?? "").toLowerCase();
  return API_PRICES.find((price) => price.match.test(id)) ?? FALLBACK_PRICE;
}

/** What one logged message would have cost through the API, in US$; null if its tokens weren't estimated. */
export function messageApiCost(entry) {
  if (entry?.inputTokens == null || entry.outputTokens == null) return null;
  const price = priceFor(entry.model);
  return (entry.inputTokens * price.input + entry.outputTokens * price.output) / 1_000_000;
}

/** The monthly price to compare against: the user's own figure, else the list price of their plan, else null. */
export function monthlyPriceFor(settings, planTier) {
  if (settings?.planPrice > 0) return settings.planPrice;
  const plan = settings?.plan && settings.plan !== "auto" ? settings.plan : detectPlan(planTier);
  return PLAN_PRICES[plan] ?? null;
}

/**
 * @param {object} input
 * @param {Array<object>} input.messageLog - MessageCost entries with token estimates (lib/message-cost.js)
 * @param {Array<object>} input.usageLog - HourRecords (lib/usage-log.js)
 * @param {number | null} input.monthlyPrice - subscription price in US$, if known
 * @returns {{ ready: boolean, measured: { messages: number, inputTokens: number, outputTokens: number, cost: number },
 *   perPoint?: number, points?: number, days?: number, apiCost?: number, subscription?: number | null, ratio?: number | null }}
 *   `measured` is what was priced directly; `apiCost` is all usage over `days` days at the rate that gives.
 */
export function valueForMoney({ messageLog, usageLog, monthlyPrice = null, now = Date.now(), days = 28 }) {
  const measured = { messages: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
  const basis = { messages: 0, points: 0, cost: 0 };

  for (const entry of messageLog ?? []) {
    const cost = messageApiCost(entry);
    if (cost == null) continue;
    measured.messages += 1;
    measured.inputTokens += entry.inputTokens;
    measured.outputTokens += entry.outputTokens;
    measured.cost += cost;
    // Only clean measurements set the rate: the points must be this message's alone.
    if (entry.session > 0 && !entry.shared) {
      basis.messages += 1;
      basis.points += entry.session;
      basis.cost += cost;
    }
  }

  if (basis.messages < MIN_MESSAGES || basis.points < MIN_POINTS) return { ready: false, measured };

  const records = (usageLog ?? []).filter((record) => record.t > now - days * DAY_MS && record.t <= now);
  const points = records.reduce((sum, record) => sum + (record.burn ?? 0) + (record.unseen ?? 0), 0);
  // Compare like with like: only as many days of subscription as there are days of usage on record.
  const covered = records.length > 0 ? Math.min(days, Math.max(1, Math.ceil((now - records[0].t) / DAY_MS))) : 0;

  const perPoint = basis.cost / basis.points;
  const apiCost = points * perPoint;
  const subscription = monthlyPrice > 0 && covered > 0 ? (monthlyPrice * covered) / DAYS_PER_MONTH : null;
  return {
    ready: true,
    measured,
    perPoint,
    points,
    days: covered,
    apiCost,
    subscription,
    ratio: subscription ? apiCost / subscription : null,
  };
}

/** "$412" for round sums, "$18.20" below a hundred; `digits` overrides that for small rates ("$0.087"). */
export function formatDollars(amount, digits = amount >= 100 ? 0 : 2) {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "1.2M" / "85k" / "640" */
export function formatTokens(count) {
  if (count >= 1_000_000) return `${Math.round(count / 100_000) / 10}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

/**
 * The readout in words.
 * @returns {{ lead: string, detail: string }}
 */
export function describeValue(value) {
  const { measured } = value;
  if (!value.ready) {
    return {
      lead:
        `Pricing your usage needs at least ${MIN_MESSAGES} messages measured in this browser ` +
        `(${measured.messages} so far) — it fills in as you chat with "Measure what each message costs" on.`,
      detail: "",
    };
  }

  const span = value.days === 1 ? "The last day" : `The last ${value.days} days`;
  let lead = `${span} of usage would cost about ${formatDollars(value.apiCost)} at API prices`;
  if (value.subscription == null) {
    lead += ". Set your plan or its price in Options to compare that with your subscription.";
  } else if (value.ratio >= 1) {
    lead +=
      ` — ${Math.round(value.ratio * 10) / 10}× the ${formatDollars(value.subscription)} ` +
      "of your subscription that covers the same days.";
  } else {
    lead +=
      ` — ${Math.round(value.ratio * 100)}% of the ${formatDollars(value.subscription)} ` +
      "of your subscription that covers the same days.";
  }

  return {
    lead,
    detail:
      `From ${measured.messages} messages measured here (about ${formatTokens(measured.inputTokens)} tokens in, ` +
      `${formatTokens(measured.outputTokens)} out, ${formatDollars(measured.cost)} at API prices): ` +
      `${formatDollars(value.perPoint, 3)} per 1% of a session, applied to all ${Math.round(value.points)} points ` +
      "used on the account. List prices, no prompt caching; token counts are estimates.",
  };
}
