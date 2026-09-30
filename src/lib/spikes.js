// Spike detection: a limit jumping by a lot in a few minutes — one enormous
// message, a runaway tool loop, or something else on the account burning
// through the allowance. Each new reading is compared with the lowest one from
// the last five minutes; a rise at or past the threshold is logged as a spike.
//
//   Spike = {
//     at: number,      // epoch ms of the reading that revealed it
//     from: number,    // epoch ms of the reading it is measured from
//     label: string,   // which limit: "Current session", "All models", "Opus"…
//     before: number,  // % at `from`
//     after: number,   // % at `at`
//     rise: number,    // after - before
//   }

export const MAX_SPIKES = 50;
export const SPIKE_WINDOW_MS = 5 * 60 * 1000;
/** A refresh on a five-minute timer lands a few seconds late; don't let that hide a jump. */
const WINDOW_SLACK_MS = 60 * 1000;
/** A reset time this much later than before means the window rolled over. */
const RESET_MOVED_MS = 5 * 60 * 1000;

function bucketsOf(snapshot) {
  return [...(snapshot?.session ? [{ ...snapshot.session, label: "Current session" }] : []), ...(snapshot?.weekly ?? [])];
}

/**
 * @param {Array<import("./types").UsageSnapshot>} history - earlier readings, oldest first
 * @param {import("./types").UsageSnapshot} snapshot - the reading that just arrived
 * @param {object} options
 * @param {number} options.percent - the rise that counts as a spike; 0 turns detection off
 * @param {number} [options.since] - ignore readings before this (the last spike), so one jump is flagged once
 * @returns {object | null} the biggest spike this reading reveals, if any
 */
export function detectSpike(history, snapshot, { percent, windowMs = SPIKE_WINDOW_MS, since = 0 }) {
  if (!(percent > 0) || !snapshot?.fetchedAt) return null;

  const earliest = Math.max(snapshot.fetchedAt - windowMs - WINDOW_SLACK_MS, since);
  const recent = (history ?? []).filter((s) => s.fetchedAt >= earliest && s.fetchedAt < snapshot.fetchedAt);

  let spike = null;
  for (const bucket of bucketsOf(snapshot)) {
    // Walk back from the newest reading looking for the low point, stopping at a reset.
    let low = null;
    for (let index = recent.length - 1; index >= 0; index--) {
      const before = bucketsOf(recent[index]).find((b) => b.label === bucket.label);
      if (!before) continue;
      const rolled =
        before.percentUsed > bucket.percentUsed ||
        (before.resetsAt != null && bucket.resetsAt != null && bucket.resetsAt - before.resetsAt > RESET_MOVED_MS);
      if (rolled) break;
      // Strictly lower: of two equal lows the later one gives the truer "in N minutes".
      if (!low || before.percentUsed < low.pct) low = { pct: before.percentUsed, at: recent[index].fetchedAt };
    }

    const rise = low ? bucket.percentUsed - low.pct : 0;
    if (rise >= percent && (!spike || rise > spike.rise)) {
      spike = { at: snapshot.fetchedAt, from: low.at, label: bucket.label, before: low.pct, after: bucket.percentUsed, rise };
    }
  }
  return spike;
}

export function addSpike(list, spike, max = MAX_SPIKES) {
  return [...(list ?? []), spike].slice(-max);
}

/** How long the jump took, in whole minutes, never less than one. */
export function spikeMinutes(spike) {
  return Math.max(1, Math.round((spike.at - spike.from) / 60_000));
}

/** "+18% in 4 min (41% → 59%)" */
export function describeSpike(spike) {
  return `+${spike.rise}% in ${spikeMinutes(spike)} min (${spike.before}% → ${spike.after}%)`;
}

/** The spikes from the last `days` days, newest first. */
export function recentSpikes(list, { now = Date.now(), days = 7 } = {}) {
  return (list ?? []).filter((spike) => now - spike.at <= days * 24 * 60 * 60 * 1000).reverse();
}

/**
 * The chat a spike most likely came from: the costliest measured message that
 * finished while it was building. null when nothing was sent from this browser.
 */
export function spikeSource(spike, messageLog) {
  const during = (messageLog ?? []).filter((m) => m.at >= spike.from && m.at <= spike.at + WINDOW_SLACK_MS);
  if (during.length === 0) return null;
  const [top] = [...during].sort((a, b) => (b.session ?? 0) - (a.session ?? 0));
  return { title: top.title ?? "Untitled chat", conversationId: top.conversationId ?? null, messages: during.length };
}
