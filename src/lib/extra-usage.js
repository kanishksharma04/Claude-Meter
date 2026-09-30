// Extra usage: pay-as-you-go spend past the plan's limits, with a monthly cap
// the user sets on claude.ai. The usage endpoint reports it only for accounts
// that have the feature — see normalizeExtraUsage() in lib/normalize-usage.js
// for the raw shape. This module keeps a small day-by-day record of the
// running total, so the popup can say what today added.
//
//   ExtraUsage = {
//     enabled: boolean,
//     used: number | null,         // spent so far this month, in major units (dollars)
//     limit: number | null,        // the monthly cap; null when none is set
//     percentUsed: number | null,  // of the cap
//     currency: string,            // ISO code, "USD" unless the endpoint says otherwise
//   }

export const MAX_EXTRA_DAYS = 62;

function startOfDay(epochMs) {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Folds a reading into the daily record: one entry per local day, holding the
 * running total as last seen that day. Returns the same array when nothing changed.
 * @param {Array<{ day: number, used: number }>} log - oldest first
 */
export function foldExtraUsage(log, reading, at = Date.now(), max = MAX_EXTRA_DAYS) {
  const days = log ?? [];
  if (reading?.used == null) return days;

  const day = startOfDay(at);
  const last = days.at(-1);
  if (last?.day === day) {
    return last.used === reading.used ? days : [...days.slice(0, -1), { day, used: reading.used }];
  }
  if (last && day < last.day) return days; // the clock went backwards
  return [...days, { day, used: reading.used }].slice(-max);
}

/**
 * What today has added to the month's total; null when there is no earlier day
 * to measure from. A total lower than yesterday's means the month rolled over,
 * so everything in the new total is from today.
 */
export function spentToday(log, reading, now = Date.now()) {
  if (reading?.used == null) return null;
  const today = startOfDay(now);
  const before = (log ?? []).findLast((entry) => entry.day < today);
  if (!before) return null;
  return Math.max(0, reading.used < before.used ? reading.used : reading.used - before.used);
}

export function formatMoney(amount, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`; // a currency code Intl doesn't know
  }
}

/**
 * The reading in words, for the popup row.
 * @returns {{ amount: string, detail: string }} e.g. "$12.40 of $50.00" and "25% of this month's cap · $2.10 today"
 */
export function describeExtraUsage(reading, today = null) {
  const { used, limit, percentUsed, currency } = reading;
  const spent = used != null ? formatMoney(used, currency) : "–";
  const parts = [];
  if (limit != null && percentUsed != null) parts.push(`${percentUsed}% of this month's cap`);
  else if (limit == null) parts.push("this month · no cap set");
  if (today != null) parts.push(today > 0 ? `${formatMoney(today, currency)} today` : "nothing today");

  return {
    amount: limit != null ? `${spent} of ${formatMoney(limit, currency)}` : spent,
    detail: parts.join(" · "),
  };
}
