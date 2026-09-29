// Which usage buckets the popup shows, in what order, and which of them sit in
// the pinned block at the top. Buckets are identified as "session" or
// "weekly:<label>", so a preference survives the bucket briefly disappearing
// from the usage response.

export const SESSION_ID = "session";

export const DEFAULT_BUCKET_PREFS = {
  order: [], // ids in display order; anything not listed keeps the endpoint's order, after the listed ones
  hidden: [],
  pinned: [SESSION_ID],
};

/** Every bucket in a snapshot, session first, as { id, kind, bucket }. */
export function listBuckets(snapshot) {
  const entries = [];
  if (snapshot?.session) entries.push({ id: SESSION_ID, kind: "session", bucket: snapshot.session });
  for (const bucket of snapshot?.weekly ?? []) {
    entries.push({ id: `weekly:${bucket.label}`, kind: "weekly", bucket });
  }
  return entries;
}

function withDefaults(prefs) {
  return {
    order: Array.isArray(prefs?.order) ? prefs.order : DEFAULT_BUCKET_PREFS.order,
    hidden: Array.isArray(prefs?.hidden) ? prefs.hidden : DEFAULT_BUCKET_PREFS.hidden,
    pinned: Array.isArray(prefs?.pinned) ? prefs.pinned : DEFAULT_BUCKET_PREFS.pinned,
  };
}

/**
 * Splits a snapshot's buckets into the three groups the popup renders.
 * Hidden wins over pinned: a hidden bucket is only ever listed under `hidden`.
 */
export function arrangeBuckets(snapshot, prefs) {
  const { order, hidden, pinned } = withDefaults(prefs);
  const rank = (id) => {
    const index = order.indexOf(id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  // Array.prototype.sort is stable, so unranked buckets keep the endpoint's order.
  const entries = listBuckets(snapshot).sort((a, b) => rank(a.id) - rank(b.id));

  return {
    pinned: entries.filter((e) => pinned.includes(e.id) && !hidden.includes(e.id)),
    rest: entries.filter((e) => !pinned.includes(e.id) && !hidden.includes(e.id)),
    hidden: entries.filter((e) => hidden.includes(e.id)),
  };
}

/** Moves a bucket one place up (-1) or down (+1) within its own group. No-op at the edge. */
export function moveBucket(snapshot, prefs, id, delta) {
  const current = withDefaults(prefs);
  const groups = Object.values(arrangeBuckets(snapshot, current)).map((group) => group.map((e) => e.id));

  for (const ids of groups) {
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from === -1) continue;
    if (to < 0 || to >= ids.length) return current;
    [ids[from], ids[to]] = [ids[to], ids[from]];
  }

  const visible = groups.flat();
  // Keep remembered ids for buckets this snapshot doesn't have, after the ones it does.
  return { ...current, order: [...visible, ...current.order.filter((known) => !visible.includes(known))] };
}

function toggled(list, id) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function togglePinned(prefs, id) {
  const current = withDefaults(prefs);
  return { ...current, pinned: toggled(current.pinned, id) };
}

export function toggleHidden(prefs, id) {
  const current = withDefaults(prefs);
  return { ...current, hidden: toggled(current.hidden, id) };
}
