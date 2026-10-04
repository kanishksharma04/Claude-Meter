// ClaudeMeter's in-page UI on claude.ai, first of seven files.
//
// Runs in the ISOLATED content script world (the same world as
// src/content/relay.js). Everything it draws lives inside one shadow root, so
// claude.ai's styles and ours never touch. It never calls claude.ai's API
// itself: it only reads what the background worker already put in
// chrome.storage.local and re-renders when that changes.
//
// A content script can't import, so the UI is split another way: the files in
// this folder are listed in order in manifest.json and share one scope. Each
// can use what the ones before it declared, and — once the page is running —
// any function from any of them. In order:
//
//   core.js           constants, the state, and small helpers (among them the
//                     copies of src/lib functions these files can't import)
//   styles.js         the stylesheet
//   dock.js           the shadow root and its elements, the pill, the panel, the cost chip
//   banners.js        the banner stack, the lockout countdown, attachment weight
//   tab-indicator.js  the usage % in the tab's title and favicon
//   nudges.js         snooze, the limit-hit line, long-context, model-switch and pre-send hints
//   main.js           render(), the polling tick, and the storage listener that starts it all
//
// This file: what the others share.

const LOG_PREFIX = "[ClaudeMeter:page]";
const HOST_ID = "claudemeter-page-ui";
const CHAT_EVENT_NAME = "__claudemeter_chat__"; // dispatched by inject-hook.js
const COST_FLASH_MS = 15_000;
const MEASURE_TIMEOUT_MS = 20_000;
// "[42%] " — what the tab-title indicator prepends. relay.js strips the same
// shape before using the title as a chat name.
const TITLE_PREFIX_PATTERN = /^\[\d{1,3}%\]\s*/;
const FAVICON_SIZE = 32;
const SEVERITY_COLORS = { ok: "#7a9b6e", warn: "#d9a452", danger: "#c1554a" };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// Mirrors ACCENTS in src/lib/theme.js.
const ACCENT_COLORS = {
  clay: "#cc785c",
  ocean: "#4a8fd9",
  forest: "#4f9a6a",
  violet: "#8b6fd6",
  rose: "#d6608a",
  slate: "#7d8ba0",
};
// A reading at least this much newer than a logged limit hit, showing the
// bucket clearly below full, means the lockout ended early (limits were
// reset, plan changed) — stop counting down.
const LOCKOUT_OVERRULE_AFTER_MS = 60_000;
const LOCKOUT_CLEARLY_BELOW = 90;
// Rough weights for files we can't read: an image costs about this many
// tokens whatever its size on disk, and PDFs/office files carry far less
// text per byte than plain text does.
const IMAGE_TOKENS = 1500;
const BINARY_BYTES_PER_TOKEN = 20;
const TEXT_FILE_PATTERN =
  /\.(txt|md|csv|tsv|json|xml|ya?ml|html?|css|jsx?|tsx?|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sql|sh|log|tex)$/i;
// Pasting more than this much text is treated like attaching a file (claude.ai does the same).
const PASTE_WEIGHT_CHARS = 4000;
// Rough English-text ratio. Good enough to tell a 5k-token chat from a 50k one.
const CHARS_PER_TOKEN = 4;
const STALE_AFTER_MS = 60_000;
const REPOSITION_MS = 500;

// claude.ai's composer is a ProseMirror contenteditable inside a <fieldset>.
// None of this is a stable contract, so try a few shapes and fall back to a
// corner of the viewport when nothing matches.
// The model picker's button text ("Opus 4.5") — used until a message has
// been sent from this tab and the request itself tells us the model.
const MODEL_PICKER_SELECTORS = [
  '[data-testid="model-selector-dropdown"]',
  'button[aria-haspopup="menu"][data-testid*="model"]',
];

const COMPOSER_SELECTORS = [
  '[data-testid="chat-input"]',
  'div.ProseMirror[contenteditable="true"]',
  'fieldset [contenteditable="true"]',
  "fieldset textarea",
];

const state = {
  snapshot: null,
  settings: {},
  panelOpen: false,
  drafting: false, // composer currently holds unsent text
  messageLog: [],
  measuring: new Set(), // requestIds whose cost hasn't landed in messageLog yet
  costFlash: null, // { entry, until } — the just-measured message, shown briefly next to the pill
  conversationId: null, // chat currently on screen, tracked across SPA navigation
  threads: new Map(), // conversationId -> { messages, chars } for the active thread
  modelHint: null, // computed by the background worker (lib/burn-rate.js)
  limitHits: [], // "limit reached" log (lib/limit-hits.js)
  snoozeUntil: 0, // epoch ms until which nudges are paused (lib/snooze.js)
  pendingFiles: [], // { name, size, tokens } added to the draft since the last message was sent
  projects: new Map(), // projectId -> { docs, chars } of project knowledge
  threadProjects: new Map(), // conversationId -> projectId
  sentModel: null, // model id from the last completion request made in this tab
  pickerModel: "", // text of claude.ai's model picker
  dismissed: new Set(), // banner keys the user closed in this tab
};

// ---------------------------------------------------------------- helpers --

// Content scripts can't import ES modules, so these two mirror
// src/lib/time-format.js. Keep them in sync.
function timeAgo(epochMs) {
  if (!epochMs) return "never";
  const sec = Math.floor((Date.now() - epochMs) / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

function formatDuration(fromMs, toMs) {
  if (toMs == null) return null;
  const diffMs = toMs - fromMs;
  if (diffMs <= 0) return "now";
  const totalMin = Math.round(diffMs / 60000);

  if (totalMin >= 24 * 60) {
    const day = Math.floor(totalMin / (24 * 60));
    const hr = Math.floor((totalMin % (24 * 60)) / 60);
    if (hr === 0) return `${day} day${day === 1 ? "" : "s"}`;
    return `${day} day${day === 1 ? "" : "s"} ${hr} hr`;
  }

  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hr === 0) return `${min} min`;
  if (min === 0) return `${hr} hr`;
  return `${hr} hr ${min} min`;
}

/** Mirrors severityOf() in src/lib/severity.js: the user's cut-offs, defaulting to 80 / 95. */
function severityClass(pct) {
  const warnAt = Number(state.settings.warnAt ?? 80);
  const dangerAt = Number(state.settings.dangerAt ?? 95);
  if (pct >= dangerAt) return "danger";
  if (pct >= warnAt) return "warn";
  return "";
}

/** The user's colour for a level if they set one, else null. */
function customSeverityColor(level) {
  const color = state.settings.severityColors?.[level];
  return typeof color === "string" && HEX_COLOR.test(color) ? color : null;
}

/** Tiny createElement helper — no innerHTML, so page Trusted Types rules can't bite. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function bucketsOf(snapshot) {
  if (!snapshot) return [];
  const buckets = [];
  if (snapshot.session) buckets.push(snapshot.session);
  return buckets.concat(snapshot.weekly ?? []);
}

function worstWeekly(snapshot) {
  const weekly = snapshot?.weekly ?? [];
  return weekly.reduce((worst, b) => (worst == null || b.percentUsed > worst.percentUsed ? b : worst), null);
}

function effectiveTheme() {
  const theme = state.settings.theme ?? "auto";
  if (theme !== "auto") return theme;
  if (matchMedia("(prefers-contrast: more)").matches) return "contrast";
  // claude.ai stamps its own resolved theme on <html data-mode>; prefer it so
  // the pill matches the page rather than the OS.
  const pageMode = document.documentElement.getAttribute("data-mode");
  if (pageMode === "dark" || pageMode === "light") return pageMode;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function currentConversationId() {
  return /\/chat\/([0-9a-f-]{36})/i.exec(location.pathname)?.[1] ?? null;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTokens(tokens) {
  return tokens >= 1000 ? `~${Math.round(tokens / 1000)}k tokens` : `~${tokens} tokens`;
}

/** Mirrors formatCost() in src/lib/message-cost.js. */
function formatCost(delta) {
  return delta === 0 ? "under 1%" : `${delta}%`;
}

/** "3% of session", falling back to the weekly bucket that moved most when the session window reset mid-reply. */
function costLabel(entry) {
  const approx = entry.shared ? "~" : "";
  if (entry.session != null) return `${approx}${formatCost(entry.session)} of session`;
  const weekly = [...(entry.weekly ?? [])].sort((a, b) => b.delta - a.delta)[0];
  return weekly ? `${approx}${formatCost(weekly.delta)} of ${weekly.label} week` : null;
}

/** Dismissals are scoped to a bucket's reset window, so a banner comes back after the reset. */
function windowKey(prefix, bucket) {
  return `${prefix}:${bucket.label}:${bucket.resetsAt ?? "?"}`;
}

/** chrome.* throws once the extension is reloaded under a live tab — never let that surface. */
function sendToBackground(message) {
  try {
    return chrome.runtime.sendMessage(message).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}
