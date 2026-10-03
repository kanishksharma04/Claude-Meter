// Talks to claude.ai's own undocumented usage endpoints. No credentials are
// ever read or stored by this extension — `credentials: "include"` just
// tells the browser to attach whatever cookies it already holds for
// claude.ai, exactly as it would for a normal page request. This only works
// because the extension's host_permissions are scoped to https://claude.ai/*.
//
// Endpoints (reverse-engineered, not officially documented):
//   GET https://claude.ai/api/organizations            -> list orgs; the main one is the user's choice, else the first with "chat"
//   GET https://claude.ai/api/organizations/{id}/usage -> five_hour / seven_day / seven_day_* blocks

import { normalizeUsageResponse } from "./normalize-usage.js";
import { getOrgCache, setOrgCache, setOrgList } from "./storage.js";
import { normalizeOrgs, choosePrimary } from "./orgs.js";

export class UsageApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "UsageApiError";
    this.code = code;
  }
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new UsageApiError("NETWORK_ERROR", err.message);
  }

  if (res.status === 401 || res.status === 403) {
    throw new UsageApiError("NOT_LOGGED_IN", `HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new UsageApiError(`HTTP_${res.status}`, `HTTP ${res.status}`);
  }

  try {
    return await res.json();
  } catch (err) {
    throw new UsageApiError("BAD_JSON", err.message);
  }
}

/** Fetches the organisations this sign-in belongs to, and remembers the list for Options to offer. */
export async function fetchOrgs() {
  const orgs = normalizeOrgs(await fetchJson("https://claude.ai/api/organizations"));
  if (orgs.length === 0) throw new UsageApiError("NO_ORGS", "No organizations returned");
  await setOrgList(orgs);
  return orgs;
}

/**
 * The main organisation: the cached one, unless a different one is now
 * preferred — in which case the list is fetched again and it is looked up.
 */
async function discoverOrg(preferredId) {
  const cached = await getOrgCache();
  if (cached && (!preferredId || cached.orgId === preferredId)) return cached;

  const org = choosePrimary(await fetchOrgs(), preferredId);
  const orgMeta = { orgId: org.id, orgName: org.name, raw: org.meta };
  await setOrgCache(orgMeta);
  return orgMeta;
}

/** One organisation's usage, normalized. */
async function fetchUsageFor(orgId, meta) {
  const raw = await fetchJson(`https://claude.ai/api/organizations/${orgId}/usage`);
  const snapshot = normalizeUsageResponse(raw, { orgMeta: meta });
  if (!snapshot) throw new UsageApiError("UNPARSEABLE_RESPONSE", "Usage response was not an object");
  return snapshot;
}

/**
 * Fetches and normalizes the main organisation's current usage snapshot.
 * Throws UsageApiError on failure — callers decide how to surface that
 * (e.g. keep last-known-good data and show an inline warning).
 * @param {object} [options]
 * @param {string | null} [options.primaryOrg] - the organisation the user chose as main, if they chose
 */
export async function fetchUsageSnapshot({ forceOrgRediscovery = false, primaryOrg = null } = {}) {
  if (forceOrgRediscovery) await setOrgCache(null);

  const orgMeta = await discoverOrg(primaryOrg);
  try {
    return await fetchUsageFor(orgMeta.orgId, orgMeta.raw);
  } catch (err) {
    // A cached org id can go stale (account switch, org change) — retry once
    // with a fresh org lookup before giving up.
    if (err instanceof UsageApiError && err.code === "HTTP_404" && !forceOrgRediscovery) {
      return fetchUsageSnapshot({ forceOrgRediscovery: true, primaryOrg });
    }
    throw err;
  }
}

/**
 * The current usage of the organisations followed alongside the main one.
 * One failing doesn't stop the others: each entry carries its snapshot or its error.
 * @param {Array<{ id: string, name: string, meta: object }>} orgs
 * @returns {Promise<Array<{ id: string, name: string, snapshot: object | null, error: { code: string } | null }>>}
 */
export async function fetchOtherOrgs(orgs) {
  return Promise.all(
    orgs.map(async (org) => {
      try {
        return { id: org.id, name: org.name, snapshot: await fetchUsageFor(org.id, org.meta), error: null };
      } catch (err) {
        return { id: org.id, name: org.name, snapshot: null, error: { code: err instanceof UsageApiError ? err.code : "UNKNOWN_ERROR" } };
      }
    })
  );
}
