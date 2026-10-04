// Which of claude.ai's own requests the page hook may read the answer to.
//
// The hook (src/content/inject-hook.js) sits on the page's fetch and
// XMLHttpRequest, so it could read anything the page loads — chats included.
// These rules are what stop it: two endpoints are read always, because their
// answers are the usage figures; a few more only in developer mode, for working
// out where claude.ai keeps such figures when it moves them; and anything that
// carries a conversation, a project or a file is never read at all.
//
// The same rules are applied three times — in the hook, in the relay
// (src/content/relay.js) and in the service worker — so that a slip in one
// place doesn't let a response through. The two content scripts can't import
// this file and carry their own copy; tests/capture-rules.test.mjs holds the
// three to the same answers.

const ORIGIN = "https://claude.ai";
const ORG_PATH = "/api/organizations/[^/]+";

/** The usage figures themselves. */
export const USAGE_PATH = new RegExp(`^${ORG_PATH}/usage/?$`);
/** The extra-usage spend and cap, as claude.ai's settings page reads them. */
export const SPEND_LIMIT_PATH = new RegExp(`^${ORG_PATH}/overage_spend_limit/?$`);

/** Never read, whatever else the address says: these answers hold what the user wrote, uploaded or was told. */
export const PRIVATE_PATH = /\/(?:chat_conversations|projects|files|artifacts|memory|skills)(?:\/|$)/i;
/** Developer mode only: addresses that sound like they are about usage or billing, and the organisation list. */
export const DISCOVERY_PATH = /^\/api\/.*(?:usage|limit|quota|billing|overage|subscription)/i;
export const ORG_LIST_PATH = /^\/api\/organizations\/?$/;

/** A captured body is kept whole up to this size; a usage answer is a few hundred characters. */
export const MAX_BODY_CHARS = 20_000;

/**
 * @param {string} url - absolute
 * @returns {"usage" | "spend" | "discovery" | null} what a request is to the hook; null means its answer is not read
 */
export function captureKind(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== ORIGIN) return null;
  const path = parsed.pathname;
  if (PRIVATE_PATH.test(path)) return null;
  if (USAGE_PATH.test(path)) return "usage";
  if (SPEND_LIMIT_PATH.test(path)) return "spend";
  return DISCOVERY_PATH.test(path) || ORG_LIST_PATH.test(path) ? "discovery" : null;
}

/** May this request's answer be read? The two usage endpoints always; the rest only in developer mode. */
export function captureAllowed(url, developerMode = false) {
  const kind = captureKind(url);
  return kind === "usage" || kind === "spend" || (kind === "discovery" && Boolean(developerMode));
}

/** A body as it may be kept: parsed JSON when small, otherwise the start of its text. */
export function trimBody(body, max = MAX_BODY_CHARS) {
  if (body == null) return null;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  if (typeof text !== "string") return null;
  return text.length <= max ? body : text.slice(0, max);
}
