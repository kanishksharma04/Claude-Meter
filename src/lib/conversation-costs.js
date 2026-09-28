// Per-conversation totals, derived from the per-message cost log
// (lib/message-cost.js) rather than stored separately — the log is the single
// source of truth, so clearing or capping it can never leave totals out of sync.
//
// Totals are sums of session-% points. A chat that spans several 5-hour windows
// can therefore exceed 100: read it as "this much of a session's allowance,
// in total", not as a share of the current window.

/**
 * @param {Array<object>} messageLog - MessageCost entries, oldest first
 * @returns {Array<{ conversationId: string, title: string | null, session: number, messages: number, lastAt: number, approx: boolean }>}
 */
export function summarizeConversations(messageLog) {
  const byId = new Map();

  for (const entry of messageLog ?? []) {
    if (!entry?.conversationId) continue;

    let total = byId.get(entry.conversationId);
    if (!total) {
      total = { conversationId: entry.conversationId, title: null, session: 0, messages: 0, lastAt: 0, approx: false };
      byId.set(entry.conversationId, total);
    }

    total.messages += 1;
    total.session += entry.session ?? 0;
    total.lastAt = Math.max(total.lastAt, entry.at ?? 0);
    // Chats are usually untitled for their first message and renamed later — keep the newest name seen.
    if (entry.title) total.title = entry.title;
    // A message whose cost couldn't be isolated makes the whole total a lower/upper bound.
    if (entry.session == null || entry.shared) total.approx = true;
  }

  return [...byId.values()];
}

/** Most expensive conversations first; ties go to the more recent one. */
export function rankConversations(messageLog, { limit = 5 } = {}) {
  return summarizeConversations(messageLog)
    .filter((c) => c.session > 0)
    .sort((a, b) => b.session - a.session || b.lastAt - a.lastAt)
    .slice(0, limit);
}

export function conversationTotal(messageLog, conversationId) {
  if (!conversationId) return null;
  return summarizeConversations(messageLog).find((c) => c.conversationId === conversationId) ?? null;
}
