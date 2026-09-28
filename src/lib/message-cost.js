// Per-message cost: how far each usage bucket moved between the reading taken
// just before a message was sent and the one taken just after the reply ended.
//
// The usage endpoint only reports whole percentages, so this is an estimate —
// a delta of 0 means "under 1%", not "free". Anything else that burns usage in
// the same few seconds (another tab, Claude Code, a second device) lands in the
// same delta; callers flag that case with `shared` when they can see it.

export const MAX_MESSAGE_LOG = 300;

/** A pending message older than this is assumed lost (tab closed mid-reply, worker restarted). */
export const PENDING_TTL_MS = 30 * 60 * 1000;

function bucketDelta(before, after) {
  if (!before || !after) return null;
  const delta = after.percentUsed - before.percentUsed;
  // A drop means the window reset mid-message — the two readings aren't comparable.
  return delta < 0 ? null : delta;
}

/**
 * @param {import("./types").UsageSnapshot | null} before
 * @param {import("./types").UsageSnapshot | null} after
 * @returns {{ session: number | null, weekly: Array<{ label: string, delta: number }> }}
 */
export function computeMessageCost(before, after) {
  const beforeWeekly = new Map((before?.weekly ?? []).map((b) => [b.label, b]));
  return {
    session: bucketDelta(before?.session, after?.session),
    weekly: (after?.weekly ?? [])
      .map((b) => ({ label: b.label, delta: bucketDelta(beforeWeekly.get(b.label), b) }))
      .filter((w) => w.delta != null),
  };
}

/** "under 1%" for a zero delta, otherwise "3%". */
export function formatCost(delta) {
  if (delta == null) return null;
  return delta === 0 ? "under 1%" : `${delta}%`;
}

export function appendMessage(log, entry, max = MAX_MESSAGE_LOG) {
  return [...(log ?? []), entry].slice(-max);
}

/** Drop pending entries that never got their matching "reply ended" event. */
export function prunePending(pending, now = Date.now()) {
  return Object.fromEntries(
    Object.entries(pending ?? {}).filter(([, p]) => now - p.startedAt < PENDING_TTL_MS)
  );
}
