// Talks to claude.ai's own undocumented usage endpoints. No credentials are
// ever read or stored by this extension — `credentials: "include"` just
// tells the browser to attach whatever cookies it already holds for
// claude.ai, exactly as it would for a normal page request. This only works
// because the extension's host_permissions are scoped to https://claude.ai/*.
//
// Endpoints (reverse-engineered, not documented by Anthropic):
//   GET https://claude.ai/api/organizations            -> list orgs, pick one with "chat" capability
//   GET https://claude.ai/api/organizations/{id}/usage -> five_hour / seven_day / seven_day_* blocks

import { normalizeUsageResponse } from "./normalize-usage.js";
import { getOrgCache, setOrgCache } from "./storage.js";

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

async function discoverOrg() {
  const cached = await getOrgCache();
  if (cached) return cached;

  const orgs = await fetchJson("https://claude.ai/api/organizations");
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new UsageApiError("NO_ORGS", "No organizations returned");
  }

  const chatOrg = orgs.find((o) => Array.isArray(o.capabilities) && o.capabilities.includes("chat")) ?? orgs[0];
  if (!chatOrg?.uuid) {
    throw new UsageApiError("NO_ORGS", "No usable organization uuid");
  }

  const orgMeta = { orgId: chatOrg.uuid, orgName: chatOrg.name ?? "", raw: chatOrg };
  await setOrgCache(orgMeta);
  return orgMeta;
}

/**
 * Fetches and normalizes the current usage snapshot.
 * Throws UsageApiError on failure — callers decide how to surface that
 * (e.g. keep last-known-good data and show an inline warning).
 */
export async function fetchUsageSnapshot({ forceOrgRediscovery = false } = {}) {
  if (forceOrgRediscovery) await setOrgCache(null);

  const orgMeta = await discoverOrg();
  let raw;
  try {
    raw = await fetchJson(`https://claude.ai/api/organizations/${orgMeta.orgId}/usage`);
  } catch (err) {
    // A cached org id can go stale (account switch, org change) — retry once
    // with a fresh org lookup before giving up.
    if (err instanceof UsageApiError && err.code === "HTTP_404" && !forceOrgRediscovery) {
      return fetchUsageSnapshot({ forceOrgRediscovery: true });
    }
    throw err;
  }

  const snapshot = normalizeUsageResponse(raw, { orgMeta: orgMeta.raw });
  if (!snapshot) {
    throw new UsageApiError("UNPARSEABLE_RESPONSE", "Usage response was not an object");
  }
  return snapshot;
}
