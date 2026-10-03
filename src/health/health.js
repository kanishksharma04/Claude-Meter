// The health page: is everything ClaudeMeter depends on working, and a bug
// report that carries the answer. What each check concludes and what the
// report may say are decided in lib/health.js; this file gathers the facts
// those need and lays out the result.

import { getSettings, getAdminKey, getOrgCache, onStorageChanged } from "../lib/storage.js";
import { buildChecks, summarizeChecks, buildDiagnostics, formatDiagnostics, issueUrl } from "../lib/health.js";
import { REFRESH_ALARM_NAME } from "../lib/refresh-plan.js";
import { archiveInfo } from "../lib/archive.js";
import { applyTheme, onSystemThemeChange } from "../lib/theme.js";
import { localizePage } from "../lib/i18n.js";

const $ = (id) => document.getElementById(id);
const checkBtn = $("checkBtn");

// The real state, not what getAll() shows in demo mode: this page is about the machinery, not the figures.
const STATE_KEYS = [
  "latestSnapshot",
  "lastError",
  "refreshPace",
  "orgCache",
  "orgList",
  "claudeCodeStatus",
  "apiSpendStatus",
  "webhookStatus",
  "backupStatus",
  "snoozeUntil",
  "history",
  "usageLog",
  "messageLog",
  "annotations",
];

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Chrome answers "granted" or "denied"; a browser that can't say leaves it at null. */
async function notificationLevel() {
  if (!chrome.notifications?.getPermissionLevel) return null;
  try {
    return await new Promise((resolve) => chrome.notifications.getPermissionLevel(resolve));
  } catch {
    return null;
  }
}

async function gatherFacts() {
  const [settings, state, granted, alarm, adminKey, storageBytes, notifications, orgCache] = await Promise.all([
    getSettings(),
    chrome.storage.local.get(STATE_KEYS),
    chrome.permissions.getAll(),
    chrome.alarms.get(REFRESH_ALARM_NAME),
    getAdminKey(),
    chrome.storage.local.getBytesInUse?.()?.catch(() => null) ?? null, // not in Firefox
    notificationLevel(),
    getOrgCache(),
  ]);
  const archive = await archiveInfo(orgCache?.orgId ?? "").catch(() => null);
  return {
    now: Date.now(),
    manifest: chrome.runtime.getManifest(),
    granted,
    userAgent: navigator.userAgent,
    settings,
    state: { snoozeUntil: 0, ...state },
    alarm: alarm ?? null,
    storageBytes,
    archive,
    notifications,
    hasAdminKey: Boolean(adminKey), // the key itself never comes near this page's output
  };
}

const CHECK_TIMEOUT_MS = 8000;

const MARKS = { ok: ["✓", "Working"], warn: ["!", "Needs a look"], fail: ["✕", "Not working"], off: ["–", "Switched off"] };

/** What can be done about a check, where something can. */
function actionFor(check) {
  if (check.action === "options") return el("a", { href: "../options/options.html", textContent: "Open Options →" });
  if (check.action === "claude") return el("a", { href: "https://claude.ai", target: "_blank", rel: "noopener", textContent: "Open claude.ai →" });
  if (check.action === "retry") {
    const button = el("button", { type: "button", textContent: "Check again" });
    button.addEventListener("click", checkAgain);
    return button;
  }
  return null;
}

let diagnosticsText = "";

async function render() {
  const facts = await gatherFacts();
  applyTheme(facts.settings);
  $("demoBadge").hidden = !facts.settings.demoMode;

  const checks = buildChecks(facts);
  const summary = summarizeChecks(checks);
  $("summary").textContent = summary.text;
  $("summary").dataset.status = summary.status;

  $("checks").replaceChildren(
    ...checks.map((check) => {
      const [mark, meaning] = MARKS[check.status];
      const action = actionFor(check);
      const item = el(
        "li",
        {},
        el("span", { className: "mark", textContent: mark, ariaHidden: "true" }),
        el("h3", {}, check.title, el("span", { className: "sr-only", textContent: ` — ${meaning}` })),
        el("p", {}, check.detail, ...(action ? [" ", action] : []))
      );
      item.dataset.status = check.status;
      item.dataset.check = check.id;
      return item;
    })
  );

  diagnosticsText = formatDiagnostics(buildDiagnostics(facts));
  $("diagnostics").textContent = diagnosticsText;
  const issue = issueUrl(checks, diagnosticsText);
  $("issueLink").href = issue.url;
  $("truncatedNote").hidden = !issue.truncated;
}

/** Tries everything afresh — a reading, the companion, the cost report — then shows how it went. */
async function checkAgain() {
  checkBtn.disabled = true;
  checkBtn.textContent = "Checking…";
  const settings = await getSettings();
  // Each is given a few seconds: whatever hasn't answered by then shows as it stood, and updates when it does.
  const ask = (type) =>
    Promise.race([chrome.runtime.sendMessage({ type }).catch(() => null), new Promise((resolve) => setTimeout(resolve, CHECK_TIMEOUT_MS))]);
  await Promise.all([
    ask("CLAUDEMETER_REFRESH"),
    settings.claudeCode && !settings.demoMode ? ask("CLAUDEMETER_REFRESH_CLAUDE_CODE") : null,
    settings.apiSpend && !settings.demoMode ? ask("CLAUDEMETER_REFRESH_API_SPEND") : null,
  ]);
  await render();
  checkBtn.disabled = false;
  checkBtn.textContent = "Check again";
}

checkBtn.addEventListener("click", checkAgain);

$("copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(diagnosticsText);
    $("copyStatus").textContent = "Copied.";
  } catch {
    // No clipboard access here: select the text so Ctrl/⌘+C does it.
    getSelection().selectAllChildren($("diagnostics"));
    $("copyStatus").textContent = "Couldn't copy. The text is selected: press Ctrl+C or ⌘C.";
  }
  setTimeout(() => ($("copyStatus").textContent = ""), 4000);
});

onStorageChanged((changes) => {
  if (STATE_KEYS.some((key) => key in changes) || changes.settings) render();
});
onSystemThemeChange(async () => applyTheme(await getSettings()));
setInterval(render, 30_000); // "2 min ago" shouldn't stay 2 minutes for ever

getSettings().then(async (settings) => {
  applyTheme(settings);
  await localizePage(settings);
  await render();
});
