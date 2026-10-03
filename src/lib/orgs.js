// More than one organisation. A claude.ai sign-in can belong to several — a
// personal plan and a team's, say — each with its own limits. ClaudeMeter
// follows one of them closely (the "main" one: the toolbar icon, the alerts
// and all the analytics are about it) and can read the others' current usage
// alongside, so they can be seen side by side instead of one at a time.
//
// This module is the pure part: making sense of the organisation list and
// deciding which is which.

/** How many organisations can be followed alongside the main one. Each costs a request per refresh. */
export const MAX_EXTRA_ORGS = 3;

/** The fields an organisation record may name its plan in — kept so the plan badge still works. */
const PLAN_FIELDS = ["rate_limit_tier", "plan_tier", "plan", "subscription_tier", "tier"];

/**
 * The organisation list as claude.ai returns it, cut down to what is used.
 * @returns {Array<{ id: string, name: string, chat: boolean, meta: object }>}
 *   `chat` says whether the organisation can use claude.ai chat at all (an API-only one can't)
 */
export function normalizeOrgs(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((org) => typeof org?.uuid === "string" && org.uuid)
    .map((org) => ({
      id: org.uuid,
      name: typeof org.name === "string" && org.name.trim() ? org.name.trim() : "Unnamed organisation",
      chat: Array.isArray(org.capabilities) && org.capabilities.includes("chat"),
      meta: Object.fromEntries(PLAN_FIELDS.filter((field) => typeof org[field] === "string").map((field) => [field, org[field]])),
    }));
}

/** The main organisation: the one asked for if it is still there, else the first that can chat, else the first. */
export function choosePrimary(orgs, preferredId = null) {
  return orgs.find((org) => org.id === preferredId) ?? orgs.find((org) => org.chat) ?? orgs[0] ?? null;
}

/** The organisations followed alongside the main one: those ticked that still exist, in the list's order. */
export function extraOrgs(orgs, primaryId, trackedIds) {
  const wanted = new Set(trackedIds ?? []);
  return orgs.filter((org) => org.id !== primaryId && wanted.has(org.id)).slice(0, MAX_EXTRA_ORGS);
}

/** The organisation a usage request was for, from its URL. */
export function orgIdFromUsageUrl(url) {
  return /\/api\/organizations\/([^/?#]+)\/usage(?:[/?#]|$)/.exec(String(url ?? ""))?.[1] ?? null;
}

/**
 * The side-by-side table: one row per limit that any organisation has, one
 * column per organisation, the main one first.
 * @param {{ name: string, snapshot: object | null }} primary
 * @param {Array<{ id: string, name: string, snapshot: object | null, error?: object }>} others
 * @returns {{ columns: Array<{ name: string, main: boolean, error: object | null }>,
 *   rows: Array<{ label: string, cells: Array<{ percent: number, resetsAt: number | null } | null> }> }}
 */
export function compareOrgs(primary, others) {
  const all = [{ ...primary, main: true }, ...(others ?? []).map((org) => ({ ...org, main: false }))];
  const cell = (bucket) => (bucket ? { percent: bucket.percentUsed, resetsAt: bucket.resetsAt ?? null } : null);

  // Session first, then each weekly limit in the order first met.
  const labels = [];
  for (const org of all) {
    for (const bucket of org.snapshot?.weekly ?? []) if (!labels.includes(bucket.label)) labels.push(bucket.label);
  }

  return {
    columns: all.map((org) => ({ name: org.name, main: org.main, error: org.error ?? null })),
    rows: [
      { label: "Session", cells: all.map((org) => cell(org.snapshot?.session)) },
      ...labels.map((label) => ({
        label: `${label} (weekly)`,
        cells: all.map((org) => cell(org.snapshot?.weekly?.find((bucket) => bucket.label === label))),
      })),
    ],
  };
}
