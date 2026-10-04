// The health page's reasoning: given what the extension can see of itself, is
// each thing it depends on working — and a bug report that says so without
// saying who you are.
//
// Pure: the page (src/health/health.js) gathers the facts and draws the result.
//
//   Facts = {
//     now: number,
//     manifest: { version, permissions, host_permissions },
//     granted: { permissions: string[], origins: string[] },   // chrome.permissions.getAll()
//     userAgent: string,
//     settings: object,                                         // as stored
//     state: { latestSnapshot, lastError, refreshPace, orgCache, orgList, claudeCodeStatus, apiSpendStatus,
//              webhookStatus, backupStatus, snoozeUntil, history, usageLog, messageLog, annotations },
//     alarm: { scheduledTime, periodInMinutes } | null,         // the refresh alarm
//     storageBytes: number | null,
//     archive: { count, first } | null,                         // null when IndexedDB couldn't be opened
//     notifications: "granted" | "denied" | null,               // null when the browser can't say
//     hasAdminKey: boolean,
//   }
//
//   Check = { id, title, status: "ok" | "warn" | "fail" | "off", detail: string, action?: "options" | "claude" | "retry" }

import { describePlan } from "./refresh-plan.js";
import { describeArchive } from "./archive.js";
import { SERVICES } from "./webhooks.js";
import { FREQUENCIES } from "./backup.js";
import { timeAgo, formatClock } from "./time-format.js";

export const ISSUES_URL = "https://github.com/kanishksharma04/Claude-Meter/issues/new";

/** GitHub turns away a new-issue link much longer than this. */
export const MAX_ISSUE_URL = 7000;

// ------------------------------------------------------------------ checks --

/** What a failed reading means, by the code lib/usage-api.js gave it. */
export function describeUsageError(code) {
  if (code === "NOT_LOGGED_IN") return "claude.ai says this browser isn't signed in. Sign in at claude.ai, then check again.";
  if (code === "NETWORK_ERROR") return "Couldn't reach claude.ai at all: offline, or a firewall, VPN or another extension is in the way.";
  if (code === "HTTP_429") return "claude.ai is asking for fewer requests. ClaudeMeter is waiting longer between tries.";
  if (/^HTTP_5\d\d$/.test(code)) return `claude.ai answered with a server error (${code.replace("_", " ")}). These usually pass on their own.`;
  if (/^HTTP_\d+$/.test(code)) return `claude.ai refused the request (${code.replace("_", " ")}). If it keeps happening, its API may have changed: worth reporting.`;
  if (code === "BAD_JSON") return "claude.ai answered with something that isn't usage data. Its API may have changed: worth reporting.";
  if (code === "UNPARSEABLE_RESPONSE") return "claude.ai answered, but with no usage limits ClaudeMeter can read. Its API has probably changed: worth reporting.";
  if (code === "NO_LIMITS") return "claude.ai answered, but this organisation has no session or weekly limit to show. If it is the wrong organisation, choose another in Options.";
  if (code === "NO_ORGS") return "This sign-in doesn't belong to any organisation, so there is no usage to read.";
  return `The last reading failed (${code || "no reason given"}).`;
}

const ago = (epochMs, now) => timeAgo(epochMs + (Date.now() - now)); // timeAgo measures from the real clock

function endpointCheck({ now, settings, state }) {
  const title = "claude.ai usage endpoint";
  const { latestSnapshot: snapshot, lastError: error, refreshPace: pace } = state;
  if (settings.demoMode) return { id: "endpoint", title, status: "off", detail: "Demo mode is on, so nothing is fetched." };

  const lastGood = snapshot ? ` The last good reading was ${ago(snapshot.fetchedAt, now)}.` : "";
  if (error && (!snapshot || error.timestamp > snapshot.fetchedAt)) {
    const action = error.code === "NOT_LOGGED_IN" ? "claude" : "retry";
    return { id: "endpoint", title, status: "fail", detail: describeUsageError(error.code) + lastGood, action };
  }
  if (!snapshot) return { id: "endpoint", title, status: "warn", detail: "No reading yet. Sign in at claude.ai, then check again.", action: "claude" };
  // Kept by an earlier version, which stored an answer with nothing in it as if it were a reading.
  if (!snapshot.session && (snapshot.weekly ?? []).length === 0) {
    return { id: "endpoint", title, status: "fail", detail: "The reading in hand has no limits in it, so there is nothing to show. Check again to replace it.", action: "retry" };
  }

  // Three waits without a reading is more than a late alarm: the browser was asleep, or something is stuck.
  const expected = (pace?.minutes ?? settings.refreshIntervalMinutes) * 60_000;
  if (now - snapshot.fetchedAt > Math.max(3 * expected, 15 * 60_000)) {
    return { id: "endpoint", title, status: "warn", detail: `The last reading was ${ago(snapshot.fetchedAt, now)}, longer than it should be. The computer may have been asleep.`, action: "retry" };
  }
  const org = state.orgCache ? "" : " The organisation hasn't been looked up yet.";
  return { id: "endpoint", title, status: "ok", detail: `Answering. Last reading ${ago(snapshot.fetchedAt, now)}.${org}` };
}

function scheduleCheck({ now, settings, state, alarm }) {
  const title = "Background refresh";
  if (!alarm) return { id: "schedule", title, status: "fail", detail: "No refresh alarm is set, so nothing is read in the background. Checking again sets it.", action: "retry" };
  const plan = settings.demoMode || !settings.adaptiveRefresh || !state.refreshPace?.minutes
    ? `Every ${alarm.periodInMinutes ?? settings.refreshIntervalMinutes} min.`
    : describePlan(state.refreshPace);
  const next = alarm.scheduledTime > now ? ` Next at ${formatClock(alarm.scheduledTime, now)}.` : " Due now.";
  return { id: "schedule", title, status: state.refreshPace?.mode === "backoff" && !settings.demoMode ? "warn" : "ok", detail: plan + next };
}

const hostOf = (pattern) => pattern.replace(/^https?:\/\//, "").replace(/\/\*$/, "");

function permissionCheck({ manifest, granted }) {
  const title = "Permissions";
  const wanted = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])];
  const have = new Set([...(granted.permissions ?? []), ...(granted.origins ?? [])]);
  const missing = wanted.filter((permission) => !have.has(permission));
  if (missing.length === 0) return { id: "permissions", title, status: "ok", detail: `All ${wanted.length} granted.` };
  const site = missing.includes("https://claude.ai/*");
  return {
    id: "permissions",
    title,
    status: "fail",
    detail:
      `Not granted: ${missing.map(hostOf).join(", ")}.` +
      (site ? " Without access to claude.ai nothing can be read: allow it under this extension's site access in the browser's extensions page." : ""),
  };
}

/** The sites asked for only when a feature needs them: is each one a switched-on feature needs actually allowed? */
function optionalAccessCheck({ settings, granted, hasAdminKey }) {
  const title = "Optional site access";
  const origins = granted.origins ?? [];
  const allowed = (host) => origins.some((origin) => hostOf(origin) === host);
  const inUse = [];
  const blocked = [];
  for (const [id, service] of Object.entries(SERVICES)) {
    const hook = settings.webhooks?.[id];
    if (!hook?.enabled || !hook.url) continue;
    let host = service.hosts[0];
    try {
      host = new URL(hook.url).host;
    } catch {
      // An address that doesn't parse can't be delivered to either; the service's usual host stands in.
    }
    (allowed(host) ? inUse : blocked).push(`${service.label} (${host})`);
  }
  if (settings.apiSpend && hasAdminKey) (allowed("api.anthropic.com") ? inUse : blocked).push("API spend (api.anthropic.com)");

  if (blocked.length > 0) {
    return { id: "optional", title, status: "fail", detail: `Switched on but not allowed by the browser: ${blocked.join(", ")}. Turn it off and on again in Options to be asked.`, action: "options" };
  }
  if (inUse.length === 0) return { id: "optional", title, status: "off", detail: "Nothing that needs another site is switched on." };
  return { id: "optional", title, status: "ok", detail: `Allowed: ${inUse.join(", ")}.` };
}

function notificationCheck({ now, settings, state, notifications }) {
  const title = "Notifications";
  if (!settings.notificationsEnabled) return { id: "notifications", title, status: "off", detail: "Alerts are switched off." };
  if (notifications === "denied") {
    return { id: "notifications", title, status: "fail", detail: "Alerts are on, but the browser or the system is blocking ClaudeMeter's notifications. Allow them in the system's notification settings." };
  }
  if (state.snoozeUntil > now) return { id: "notifications", title, status: "warn", detail: `Alerts are snoozed until ${formatClock(state.snoozeUntil, now)}.` };
  const failed = Object.entries(SERVICES)
    .filter(([id]) => settings.webhooks?.[id]?.enabled && state.webhookStatus?.[id]?.ok === false)
    .map(([, service]) => service.label);
  if (failed.length > 0) return { id: "notifications", title, status: "warn", detail: `Alerts are on, but the last delivery to ${failed.join(" and ")} failed. Send a test from Options.`, action: "options" };
  return { id: "notifications", title, status: "ok", detail: notifications === "granted" ? "Alerts are on and allowed." : "Alerts are on." };
}

function companionCheck({ now, settings, state }) {
  const title = "Claude Code companion";
  const status = state.claudeCodeStatus;
  if (!settings.claudeCode) return { id: "companion", title, status: "off", detail: "Claude Code usage is switched off." };
  if (settings.demoMode) return { id: "companion", title, status: "off", detail: "Demo mode is on, so the companion isn't asked." };
  if (!status) return { id: "companion", title, status: "warn", detail: "Not asked yet. Check again.", action: "retry" };
  if (!status.ok) {
    // The advice was written for Options, where the install command is on the page.
    const detail = (status.problem?.text ?? "Couldn't reach the companion.").replace(/the command below/g, "the install command in Options");
    return { id: "companion", title, status: "fail", detail, action: "options" };
  }
  const how = status.live ? "connected and pushing changes" : "answering when asked";
  return { id: "companion", title, status: "ok", detail: `Version ${status.version ?? "unknown"}, ${how}. Last heard from ${ago(status.at, now)}.` };
}

function spendCheck({ now, settings, state, hasAdminKey }) {
  const title = "Anthropic Console API";
  const status = state.apiSpendStatus;
  if (!settings.apiSpend) return { id: "apiSpend", title, status: "off", detail: "API spend is switched off." };
  if (!hasAdminKey) return { id: "apiSpend", title, status: "fail", detail: "API spend is on but no Admin API key is saved.", action: "options" };
  if (!status) return { id: "apiSpend", title, status: "warn", detail: "Not read yet. Check again.", action: "retry" };
  if (!status.ok) return { id: "apiSpend", title, status: "fail", detail: status.problem?.text ?? "The cost report couldn't be read.", action: "options" };
  return { id: "apiSpend", title, status: "ok", detail: `Cost report read ${ago(status.at, now)}.` };
}

export function formatBytes(bytes) {
  if (bytes == null) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function storageCheck({ storageBytes, archive }) {
  const title = "Storage";
  const kept = `Settings and recent readings: ${formatBytes(storageBytes)}.`;
  if (!archive) {
    return { id: "storage", title, status: "warn", detail: `${kept} The long-term archive can't be opened in this window, so the chart's longer ranges fall back to the hourly log.` };
  }
  return { id: "storage", title, status: "ok", detail: `${kept} Archive: ${describeArchive(archive).replace(/\.$/, "").replace(/^Nothing archived yet$/, "nothing yet")}.` };
}

function backupCheck({ now, settings, state }) {
  const title = "Automatic backup";
  const status = state.backupStatus;
  const every = FREQUENCIES[settings.autoBackup] ?? 0;
  if (!every) return { id: "backup", title, status: "off", detail: status?.ok ? `Switched off. The last backup was ${ago(status.at, now)}.` : "Backups are switched off." };
  if (!status) return { id: "backup", title, status: "warn", detail: "Switched on, but no backup has been made yet." };
  if (!status.ok) return { id: "backup", title, status: "fail", detail: `${status.problem ?? "The last backup failed."} It is tried again within the hour.`, action: "options" };
  // Two intervals without one: the alarm isn't firing, or the browser has hardly been open.
  if (now - status.at > 2 * every) return { id: "backup", title, status: "warn", detail: `The last backup was ${ago(status.at, now)}, later than it should be.`, action: "options" };
  return { id: "backup", title, status: "ok", detail: `Last backup ${ago(status.at, now)}: ${status.readings.toLocaleString()} readings, ${formatBytes(status.bytes)}.` };
}

/** @returns {Check[]} */
export function buildChecks(facts) {
  return [endpointCheck, scheduleCheck, permissionCheck, optionalAccessCheck, notificationCheck, companionCheck, spendCheck, storageCheck, backupCheck].map((check) => check(facts));
}

/** "Everything checks out." — or how much doesn't. Things switched off aren't problems. */
export function summarizeChecks(checks) {
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  const things = (n) => `${n} thing${n === 1 ? "" : "s"}`;
  if (failed > 0) return { status: "fail", text: `${things(failed)} ${failed === 1 ? "isn't" : "aren't"} working${warned ? `, and ${things(warned)} to look at` : ""}.` };
  if (warned > 0) return { status: "warn", text: `Working, with ${things(warned)} to look at.` };
  return { status: "ok", text: "Everything checks out." };
}

// ------------------------------------------------------------- diagnostics --

/**
 * Takes anything that could identify someone out of a piece of text: ids,
 * e-mail addresses, keys and tokens, the path and query of any address that
 * isn't claude.ai's own API, and the name in a home-directory path.
 */
export function redactText(text) {
  return String(text ?? "")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "<key>")
    // Addresses first, while they are still whole: the ids inside claude.ai's own are taken out by the next step.
    .replace(/https?:\/\/[^\s"'<>)]+/g, (url) => {
      try {
        const { origin, pathname } = new URL(url);
        return origin === "https://claude.ai" ? origin + pathname : `${origin}/<path>`;
      } catch {
        return "<url>";
      }
    })
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/(\/(?:Users|home)\/)[^/\s]+/g, "$1<user>")
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/g, "$1<user>")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<token>");
}

/** "Chrome 131 on macOS" from a user-agent string: the browser and system, without the build detail. */
export function describeAgent(userAgent) {
  const ua = String(userAgent ?? "");
  const pick = (pattern) => pattern.exec(ua)?.[1];
  const browser =
    (pick(/Edg\/(\d+)/) && `Edge ${pick(/Edg\/(\d+)/)}`) ||
    (pick(/Firefox\/(\d+)/) && `Firefox ${pick(/Firefox\/(\d+)/)}`) ||
    (pick(/Chrome\/(\d+)/) && `Chrome ${pick(/Chrome\/(\d+)/)}`) ||
    (pick(/Version\/(\d+)[\d.]* Safari/) && `Safari ${pick(/Version\/(\d+)[\d.]* Safari/)}`) ||
    "Unknown browser";
  const system = /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "unknown system";
  return `${browser} on ${system}`;
}

// Settings whose text says nothing about the person: a choice from a fixed list.
const CHOICE_SETTINGS = ["language", "theme", "accent", "iconStyle", "actionOpens", "tabIndicator", "forecast", "plan", "soundName", "chartRange", "autoBackup"];

/** Settings as they can be shown to a stranger: switches, numbers and fixed choices; anything typed in is reduced to whether it is set. */
export function redactSettings(settings) {
  const out = {};
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (typeof value === "boolean" || typeof value === "number") out[key] = value;
    else if (CHOICE_SETTINGS.includes(key) && typeof value === "string") out[key] = /^[\w-]{1,20}$/.test(value) ? value : "<other>";
  }
  out.planPrice = settings?.planPrice ? "set" : "list price";
  out.notifyThresholds = (settings?.notifyThresholds ?? []).filter((n) => typeof n === "number");
  out.webhooks = Object.fromEntries(Object.keys(SERVICES).map((id) => [id, settings?.webhooks?.[id]?.enabled ? "on" : "off"]));
  out.quietHours = settings?.quietHours?.enabled ? `on, ${(settings.quietHours.days ?? []).flat().length} windows` : "off";
  out.primaryOrg = settings?.primaryOrg ? "chosen" : "automatic";
  out.trackedOrgs = (settings?.trackedOrgs ?? []).length;
  out.severityColors = Object.values(settings?.severityColors ?? {}).some(Boolean) ? "custom" : "default";
  out.bucketPrefs = `${settings?.bucketPrefs?.hidden?.length ?? 0} hidden, ${settings?.bucketPrefs?.pinned?.length ?? 0} pinned`;
  return out;
}

const minutesSince = (epochMs, now) => (epochMs ? Math.round((now - epochMs) / 60_000) : null);

/**
 * Everything worth knowing to chase a bug, and nothing about who reported it:
 * no organisation names or ids, no keys or webhook addresses, no chat titles
 * or notes, and no usage figures — only which limits exist.
 */
export function buildDiagnostics(facts) {
  const { now, manifest, granted, userAgent, settings, state, alarm, storageBytes, archive, notifications, hasAdminKey } = facts;
  const snapshot = state.latestSnapshot;
  const pace = state.refreshPace;
  return {
    version: manifest.version,
    browser: describeAgent(userAgent),
    checks: Object.fromEntries(buildChecks(facts).map((check) => [check.id, check.status])),
    reading: snapshot
      ? {
          minutesAgo: minutesSince(snapshot.fetchedAt, now),
          plan: snapshot.planTier ?? null,
          session: snapshot.session ? "present" : "missing",
          weekly: (snapshot.weekly ?? []).map((bucket) => bucket.label),
          extraUsage: Boolean(snapshot.extraUsage),
        }
      : null,
    lastError: state.lastError ? { code: state.lastError.code, message: redactText(state.lastError.message), minutesAgo: minutesSince(state.lastError.timestamp, now) } : null,
    refresh: {
      alarm: alarm ? { everyMinutes: alarm.periodInMinutes ?? null, dueInMinutes: Math.round((alarm.scheduledTime - now) / 60_000) } : null,
      pace: pace ? { mode: pace.mode, minutes: pace.minutes, failures: pace.failures, errorCode: pace.errorCode, minutesSinceChange: minutesSince(pace.lastChangeAt, now) } : null,
    },
    organisations: { known: (state.orgList ?? []).length, mainFound: Boolean(state.orgCache) },
    permissions: { granted: [...(granted.permissions ?? [])].sort(), sites: (granted.origins ?? []).map(hostOf).sort(), notifications },
    companion: state.claudeCodeStatus
      ? { ok: state.claudeCodeStatus.ok, version: state.claudeCodeStatus.version ?? null, live: state.claudeCodeStatus.live ?? null, problem: state.claudeCodeStatus.problem?.code ?? null, minutesAgo: minutesSince(state.claudeCodeStatus.at, now) }
      : null,
    apiSpend: { keySaved: Boolean(hasAdminKey), ok: state.apiSpendStatus?.ok ?? null, problem: state.apiSpendStatus?.problem?.code ?? null },
    webhooks: Object.fromEntries(Object.entries(state.webhookStatus ?? {}).map(([id, status]) => [id, status?.ok ? "delivered" : "failed"])),
    backup: state.backupStatus ? { ok: state.backupStatus.ok, minutesAgo: minutesSince(state.backupStatus.at, now), bytes: state.backupStatus.bytes ?? null } : null,
    stored: {
      bytes: storageBytes,
      history: (state.history ?? []).length,
      usageLogHours: (state.usageLog ?? []).length,
      messageLog: (state.messageLog ?? []).length,
      notes: (state.annotations ?? []).length,
      archive: archive ? { readings: archive.count, days: archive.first ? Math.round((now - archive.first) / 86_400_000) : 0 } : "unavailable",
    },
    settings: redactSettings(settings),
  };
}

/** The diagnostics as indented text — readable in an issue, and short enough to fit in a link. */
export function formatDiagnostics(diagnostics, indent = "") {
  return Object.entries(diagnostics)
    .map(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const inner = formatDiagnostics(value, `${indent}  `);
        return inner ? `${indent}${key}:\n${inner}` : `${indent}${key}: {}`;
      }
      return `${indent}${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`;
    })
    .join("\n");
}

// -------------------------------------------------------------- bug report --

const MARK = { ok: "✅", warn: "⚠️", fail: "❌", off: "➖" };

/** The issue's text: room for the person's own words, then what the health check found. */
export function issueBody(checks, diagnosticsText) {
  return [
    "### What happened",
    "",
    "<!-- What went wrong, and what did you expect instead? -->",
    "",
    "### Steps to reproduce",
    "",
    "1. ",
    "",
    "### Health check",
    "",
    ...checks.map((check) => `- ${MARK[check.status]} **${check.title}**: ${redactText(check.detail)}`),
    "",
    "<details><summary>Diagnostics (no names, ids, keys, addresses or usage figures)</summary>",
    "",
    "```yaml",
    diagnosticsText,
    "```",
    "",
    "</details>",
  ].join("\n");
}

/** A title to start from: what is failing, if anything is. */
export function issueTitle(checks) {
  const failing = checks.find((check) => check.status === "fail");
  return failing ? `Bug: ${failing.title} not working` : "Bug: ";
}

/**
 * The link that opens a new GitHub issue with everything filled in. A link can
 * only be so long, so the diagnostics lose lines from the end until it fits.
 *
 * @returns {{ url: string, truncated: boolean }}
 */
export function issueUrl(checks, diagnosticsText, { maxLength = MAX_ISSUE_URL } = {}) {
  const build = (text) => `${ISSUES_URL}?${new URLSearchParams({ labels: "bug", title: issueTitle(checks), body: issueBody(checks, text) })}`;
  let url = build(diagnosticsText);
  if (url.length <= maxLength) return { url, truncated: false };

  const lines = diagnosticsText.split("\n");
  const note = "# …cut to fit a link. Paste the rest from the health page's Copy button.";
  while (lines.length > 0 && url.length > maxLength) {
    lines.splice(-Math.max(1, Math.ceil(lines.length / 10)));
    url = build([...lines, note].join("\n"));
  }
  return { url, truncated: true };
}
