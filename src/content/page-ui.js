// Runs in the ISOLATED content script world on claude.ai (the same world as
// src/content/relay.js). Renders ClaudeMeter's in-page UI — everything lives
// inside one shadow root so claude.ai's styles and ours never touch.
//
// This script never calls claude.ai's API itself. It only reads what the
// background worker already put in chrome.storage.local and re-renders when
// that changes.

(() => {
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

  // ------------------------------------------------------------------ styles --

  const STYLES = `
    :host { all: initial; }

    .dock {
      position: fixed;
      z-index: 2147483000;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      pointer-events: none;
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, sans-serif;
      color: var(--text);
    }
    .dock > * { pointer-events: auto; }
    .dock [hidden] { display: none !important; }

    .dock[data-theme="dark"] {
      color-scheme: dark;
      --bg: #262624; --panel: #30302e; --border: #3e3e3a; --text: #f5f4ef; --muted: #a8a6a0;
      --accent: #cc785c; --track: #3e3e3a; --ok: #7a9b6e; --warn: #d9a452; --danger: #c1554a;
    }
    .dock[data-theme="light"] {
      color-scheme: light;
      --bg: #faf9f5; --panel: #f0eee6; --border: #e5e2d9; --text: #30302e; --muted: #82807a;
      --accent: #cc785c; --track: #e5e2d9; --ok: #4f9358; --warn: #b87f2e; --danger: #b54b3f;
    }
    .dock[data-theme="contrast"] {
      color-scheme: dark;
      --bg: #000000; --panel: #0f0f0f; --border: #b3b3b3; --text: #ffffff; --muted: #dcdcdc;
      --accent: #66d9ff; --track: #2b2b2b; --ok: #5dff8f; --warn: #ffb000; --danger: #ff8080;
    }
    .dock[data-theme="contrast"] .track { outline: 1px solid var(--border); }

    * { box-sizing: border-box; }

    .pill-row { display: flex; align-items: center; gap: 6px; }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--bg);
      color: var(--text);
      font: inherit;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.18);
    }
    .pill:hover { background: var(--panel); }
    :is(button, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
    .pill.warn .dot { background: var(--warn); }
    .pill.danger .dot { background: var(--danger); }
    .pill .sep, .pill .stale { color: var(--muted); }

    .chip {
      padding: 3px 9px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .chip strong { color: var(--text); font-weight: 600; }

    /* Privacy mode (screen sharing): figures blurred past reading; bars lose the
       width and colour that would give them away. */
    .dock[data-privacy="on"] :is(.bucket-pct, .panel .sub, .banner-text, .lockout-main, .lockout-count, .chip.locked) {
      filter: blur(5px);
      user-select: none;
    }
    .dock[data-privacy="on"] .fill {
      width: 100% !important;
      background: repeating-linear-gradient(-45deg, var(--track), var(--track) 4px, var(--border) 4px, var(--border) 8px);
    }
    .dock[data-privacy="on"] .pill .dot { background: var(--muted); }

    .panel {
      width: 264px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--bg);
      box-shadow: 0 6px 24px rgb(0 0 0 / 0.28);
    }
    .panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .panel-title { font-weight: 600; font-size: 13px; }
    .icon-btn {
      border: none; background: none; color: var(--muted); font: inherit; font-size: 14px;
      cursor: pointer; padding: 2px 6px; border-radius: 6px;
    }
    .icon-btn:hover { color: var(--text); background: var(--panel); }
    .bucket { margin-bottom: 10px; }
    .bucket-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
    .bucket-label { font-weight: 600; }
    .bucket-pct { color: var(--muted); font-variant-numeric: tabular-nums; }
    .track { height: 6px; border-radius: 999px; background: var(--track); overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; background: var(--ok-fill, var(--accent)); }
    .fill.warn { background: var(--warn); }
    .fill.danger { background: var(--danger); }
    .sub { margin-top: 4px; color: var(--muted); font-size: 11px; }
    .panel-foot { color: var(--muted); font-size: 11px; }

    .lockout {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      padding: 10px 10px 10px 14px;
      border: 1px solid var(--danger);
      border-left-width: 3px;
      border-radius: 12px;
      background: var(--bg);
      box-shadow: 0 6px 24px rgb(0 0 0 / 0.28);
    }
    .lockout-main { flex: 1; min-width: 0; }
    .lockout-title { font-weight: 600; font-size: 13px; }
    .lockout-sub { color: var(--muted); font-size: 11px; margin-top: 2px; }
    .lockout-count {
      font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
    }
    .chip.locked { border-color: var(--danger); color: var(--text); cursor: pointer; font: inherit; }

    .banners { display: flex; flex-direction: column; gap: 6px; width: 100%; }
    .banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px 7px 12px;
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      border-radius: 10px;
      background: var(--bg);
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.18);
    }
    .banner.warn { border-left-color: var(--warn); }
    .banner.danger { border-left-color: var(--danger); }
    .banner-text { flex: 1; min-width: 0; }
    .banner-text strong { font-weight: 600; }
    .banner-action {
      color: var(--accent); font: inherit; font-weight: 600; text-decoration: none;
      border: none; background: none; padding: 0; cursor: pointer; white-space: nowrap;
    }
    .banner-action:hover { text-decoration: underline; }
  `;

  // --------------------------------------------------------------------- DOM --

  const host = el("div", { id: HOST_ID });
  const shadow = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLES);
  shadow.adoptedStyleSheets = [sheet];

  const panel = el("div", { class: "panel", role: "dialog", "aria-label": "ClaudeMeter usage", hidden: true });
  const pill = el("button", {
    class: "pill",
    type: "button",
    "aria-expanded": "false",
    "aria-haspopup": "dialog",
    onclick: () => togglePanel(),
  });
  const costChip = el("span", { class: "chip", hidden: true });
  const lockoutChip = el("button", { class: "chip locked", type: "button", hidden: true });
  const pillRow = el("div", { class: "pill-row" }, lockoutChip, costChip, pill);
  const banners = el("div", { class: "banners", role: "status", "aria-live": "polite" });
  const lockoutCard = el("div", { class: "lockout", role: "timer", "aria-label": "Limit reached", hidden: true });
  const dock = el("div", { class: "dock" }, banners, lockoutCard, panel, pillRow);
  shadow.append(dock);

  /**
   * Re-rendering replaces nodes. If keyboard focus was on one of them, put it
   * back on the control in the same position instead of dropping it to <body>.
   */
  function keepingFocus(container, rebuild) {
    const active = shadow.activeElement;
    const index = active && container.contains(active) ? [...container.querySelectorAll("a, button")].indexOf(active) : -1;
    rebuild();
    if (index >= 0) [...container.querySelectorAll("a, button")][index]?.focus();
  }

  function mountHost() {
    // Attach to <html>, not <body>: claude.ai re-renders body children freely.
    if (!host.isConnected) document.documentElement.append(host);
  }

  function findComposerInput() {
    for (const selector of COMPOSER_SELECTORS) {
      const node = document.querySelector(selector);
      if (node && node.getClientRects().length > 0) return node;
    }
    return null;
  }

  function findComposer() {
    const input = findComposerInput();
    return input ? (input.closest("fieldset") ?? input) : null;
  }

  function hasDraft() {
    const input = findComposerInput();
    if (!input) return false;
    return ((input.value ?? input.textContent) || "").trim().length > 0;
  }

  /** Pin the dock just above the composer; fall back to the bottom-right corner. */
  function positionDock() {
    mountHost();
    const rect = findComposer()?.getBoundingClientRect();
    const usable = rect && rect.width >= 200 && rect.top > 48 && rect.top < window.innerHeight;

    if (usable) {
      dock.dataset.anchor = "composer";
      dock.style.left = `${Math.round(rect.left)}px`;
      dock.style.right = "auto";
      dock.style.width = `${Math.round(rect.width)}px`;
      dock.style.bottom = `${Math.round(window.innerHeight - rect.top + 8)}px`;
    } else {
      dock.dataset.anchor = "corner";
      dock.style.left = "auto";
      dock.style.right = "16px";
      dock.style.width = "min(360px, calc(100vw - 32px))";
      dock.style.bottom = "16px";
    }
  }

  // -------------------------------------------------------------------- pill --

  function renderPill() {
    const { snapshot } = state;
    const enabled = state.settings.inlinePill !== false;
    pillRow.hidden = !enabled || !snapshot;
    if (pillRow.hidden) {
      if (state.panelOpen) togglePanel();
      return;
    }

    if (state.settings.privacyMode) {
      // No numbers and no severity colour — either would say how full the limits are.
      pill.className = "pill";
      pill.title = "ClaudeMeter — numbers hidden (privacy mode)";
      pill.setAttribute("aria-label", "ClaudeMeter usage, hidden on screen by privacy mode. Show details.");
      pill.replaceChildren(el("span", { class: "dot" }), el("span", { class: "stale", text: "Usage hidden" }));
      return;
    }

    const session = snapshot.session;
    const weekly = worstWeekly(snapshot);
    const worstPct = Math.max(session?.percentUsed ?? 0, weekly?.percentUsed ?? 0);

    const parts = [el("span", { class: "dot" })];
    if (session) parts.push(el("span", { text: `Session ${session.percentUsed}%` }));
    if (session && weekly) parts.push(el("span", { class: "sep", text: "·" }));
    if (weekly) parts.push(el("span", { text: `Week ${weekly.percentUsed}%` }));
    if (!session && !weekly) parts.push(el("span", { class: "stale", text: "Usage unavailable" }));

    pill.className = `pill ${severityClass(worstPct)}`.trim();
    pill.title = "ClaudeMeter — click for details";
    // Spelled out, because "Session 42% · Week 31%" reads poorly and says nothing about what the button does.
    pill.setAttribute(
      "aria-label",
      [
        "ClaudeMeter usage.",
        session ? `Session ${session.percentUsed}% used.` : "",
        weekly ? `Fullest weekly limit, ${weekly.label}, ${weekly.percentUsed}% used.` : "",
        "Show details.",
      ]
        .filter(Boolean)
        .join(" ")
    );
    pill.replaceChildren(...parts);
  }

  function renderBucket(bucket) {
    const resetsIn = bucket.resetsAt != null ? formatDuration(Date.now(), bucket.resetsAt) : null;
    const fill = el("div", { class: `fill ${severityClass(bucket.percentUsed)}`.trim() });
    fill.style.width = `${bucket.percentUsed}%`;
    const resetText = `Resets in ${resetsIn ?? bucket.resetsInLabel ?? "unknown"}`;

    return el(
      "div",
      { class: "bucket" },
      el(
        "div",
        { class: "bucket-head" },
        el("span", { class: "bucket-label", text: bucket.label }),
        el("span", { class: "bucket-pct", text: `${bucket.percentUsed}% used` })
      ),
      el(
        "div",
        {
          class: "track",
          role: "progressbar",
          "aria-label": bucket.label,
          "aria-valuemin": "0",
          "aria-valuemax": "100",
          "aria-valuenow": String(bucket.percentUsed),
          "aria-valuetext": `${bucket.percentUsed}% used. ${resetText}`,
        },
        fill
      ),
      el("div", { class: "sub", text: resetText })
    );
  }

  function renderPanel() {
    panel.hidden = !state.panelOpen;
    pill.setAttribute("aria-expanded", String(state.panelOpen));
    if (!state.panelOpen) return;

    const { snapshot } = state;
    keepingFocus(panel, () =>
      panel.replaceChildren(
        el(
          "div",
          { class: "panel-head" },
          el("span", { class: "panel-title", text: "ClaudeMeter" }),
          el("button", {
            class: "icon-btn",
            type: "button",
            title: "Refresh now",
            "aria-label": "Refresh now",
            text: "↻",
            onclick: () => sendToBackground({ type: "CLAUDEMETER_REFRESH" }),
          })
        ),
        ...bucketsOf(snapshot).map(renderBucket),
        lastMessageLine(),
        conversationLine(),
        threadLine(),
        limitHitsLine(),
      snoozeLine(),
        el("div", { class: "panel-foot", text: `Updated ${timeAgo(snapshot?.fetchedAt)}` })
      )
    );
  }

  // ------------------------------------------------------------ message cost --

  function lastMessageLine() {
    const conversationId = currentConversationId();
    const entry = conversationId && state.messageLog.findLast((m) => m.conversationId === conversationId);
    const label = entry && costLabel(entry);
    if (!label) return null;

    const extras = (entry.weekly ?? [])
      .filter((w) => w.delta > 0 && entry.session != null)
      .map((w) => `${w.label} week +${w.delta}%`);
    return el("div", { class: "sub", text: [`Last message here: ${label}`, ...extras].join(" · ") });
  }

  /** Mirrors conversationTotal() in src/lib/conversation-costs.js for the chat on screen. */
  function conversationLine() {
    const conversationId = currentConversationId();
    const entries = conversationId ? state.messageLog.filter((m) => m.conversationId === conversationId) : [];
    if (entries.length < 2) return null; // one message is already covered by the "last message" line

    const total = entries.reduce((sum, m) => sum + (m.session ?? 0), 0);
    const approx = entries.some((m) => m.session == null || m.shared) ? "~" : "";
    return el("div", {
      class: "sub",
      text: `This chat so far: ${approx}${total}% of a session across ${entries.length} messages`,
    });
  }

  function renderCostChip() {
    const enabled = state.settings.messageCost !== false && !state.settings.privacyMode;
    const flash = state.costFlash && state.costFlash.until > Date.now() ? state.costFlash.entry : null;
    const label = flash && costLabel(flash);

    if (enabled && label) {
      costChip.replaceChildren("Last message: ", el("strong", { text: label }));
      costChip.title = flash.shared
        ? "Another reply was streaming at the same time, so this is split between them."
        : "Change in your usage between sending this message and the end of the reply.";
    } else if (enabled && state.measuring.size > 0) {
      costChip.replaceChildren("measuring\u2026");
      costChip.title = "ClaudeMeter is measuring what this message costs.";
    }
    costChip.hidden = !enabled || !(label || state.measuring.size > 0);
  }

  function onMessageLogChanged() {
    const newest = state.messageLog.at(-1);
    if (!newest || !state.measuring.delete(newest.id)) return;
    state.costFlash = { entry: newest, until: Date.now() + COST_FLASH_MS };
    setTimeout(render, COST_FLASH_MS + 50);
  }

  window.addEventListener(CHAT_EVENT_NAME, (event) => {
    const chat = event.detail;
    if (!chat?.kind) return;
    onThreadEvent(chat);

    if (chat.kind === "completion_start") {
      state.pendingFiles = []; // whatever was attached has now been sent
      if (chat.model) state.sentModel = chat.model;
      state.measuring.add(chat.requestId);
    } else if (chat.kind === "completion_end" && !chat.ok) {
      state.measuring.delete(chat.requestId);
    } else if (chat.kind === "completion_end") {
      // The background worker normally answers within a couple of seconds by
      // appending to messageLog; don't leave "measuring…" up if it never does.
      setTimeout(() => state.measuring.delete(chat.requestId) && render(), MEASURE_TIMEOUT_MS);
    }
    render();
  });

  /** Opening moves focus into the panel; closing hands it back to the pill, so keyboard users never lose their place. */
  function togglePanel({ restoreFocus = true } = {}) {
    const focusWasInPanel = panel.contains(shadow.activeElement);
    state.panelOpen = !state.panelOpen;
    renderPanel();
    if (state.panelOpen) panel.querySelector("button")?.focus();
    else if (restoreFocus && focusWasInPanel) pill.focus();
  }

  // ----------------------------------------------------------------- banners --

  // Each feature contributes at most one banner, keyed by id. A spec is
  // { key, tone, lead, text, actions: [{ label, href | onclick }] }; `key`
  // is what gets remembered when the user dismisses it.
  const bannerSpecs = new Map();

  function setBanner(id, spec) {
    if (spec && !state.dismissed.has(spec.key)) bannerSpecs.set(id, spec);
    else bannerSpecs.delete(id);
  }

  let bannersShown = ""; // signature of what is in the DOM

  function renderBanners() {
    // The stack is a live region: rebuilding it with identical content would make
    // a screen reader read every banner again on each refresh. Only touch it on a real change.
    const signature = JSON.stringify(
      [...bannerSpecs.entries()].map(([id, s]) => [id, s.key, s.tone, s.lead, s.text, (s.actions ?? []).map((a) => a.label)])
    );
    if (signature === bannersShown) return;
    bannersShown = signature;

    banners.replaceChildren(
      ...[...bannerSpecs.entries()].map(([id, spec]) =>
        el(
          "div",
          { class: `banner ${spec.tone ?? ""}`.trim(), "data-banner": id },
          el("span", { class: "banner-text" }, el("strong", { text: spec.lead }), ` ${spec.text}`),
          ...(spec.actions ?? []).map((action) =>
            action.href
              ? el("a", { class: "banner-action", href: action.href, text: action.label })
              : el("button", { class: "banner-action", type: "button", text: action.label, onclick: action.onclick })
          ),
          el("button", {
            class: "icon-btn",
            type: "button",
            title: "Dismiss",
            "aria-label": `Dismiss: ${spec.lead}`,
            text: "\u00d7",
            onclick: () => {
              state.dismissed.add(spec.key);
              render();
            },
          })
        )
      )
    );
  }

  // --------------------------------------------------------- lockout overlay --

  /** Mirrors claimLabel() in src/lib/limit-hits.js. */
  function claimLabel(claim) {
    if (typeof claim !== "string" || !claim) return null;
    if (/^five_hour/i.test(claim)) return "Current session";
    if (!/^seven_day/i.test(claim)) return null;
    const suffix = claim.replace(/^seven_day_?/i, "").replace(/_/g, " ").trim();
    return suffix ? suffix.replace(/\b\w/g, (c) => c.toUpperCase()) : "All models";
  }

  /** Is the most recent logged limit hit still in force, as far as we can tell? */
  function activeLimitHit(now) {
    const hit = state.limitHits.at(-1);
    if (!hit || hit.resetsAt == null || hit.resetsAt <= now) return null;

    const label = claimLabel(hit.claim);
    const snapshot = state.snapshot;
    if (snapshot && snapshot.fetchedAt - hit.lastAt >= LOCKOUT_OVERRULE_AFTER_MS) {
      const buckets = bucketsOf(snapshot);
      const relevant = label ? buckets.filter((b) => b.label === label) : buckets;
      if (relevant.length > 0 && relevant.every((b) => b.percentUsed < LOCKOUT_CLEARLY_BELOW)) return null;
    }
    return { label: label ?? "Usage limit", until: hit.resetsAt };
  }

  /** Locked out until the last of: a logged limit hit, or any bucket the snapshot shows as full. */
  function currentLockout(now = Date.now()) {
    const candidates = bucketsOf(state.snapshot)
      .filter((b) => b.percentUsed >= 100 && b.resetsAt != null && b.resetsAt > now)
      .map((b) => ({ label: b.label, until: b.resetsAt }));
    const hit = activeLimitHit(now);
    if (hit) candidates.push(hit);
    return candidates.sort((a, b) => b.until - a.until)[0] ?? null;
  }

  function formatClock(epochMs) {
    const date = new Date(epochMs);
    const sameDay = date.toDateString() === new Date().toDateString();
    return date.toLocaleString([], {
      ...(sameDay ? {} : { weekday: "short" }),
      hour: "numeric",
      minute: "2-digit",
    });
  }

  /** "1:12:05" under a day; days-and-hours beyond that, where seconds are just noise. */
  function formatCountdown(ms) {
    if (ms >= 24 * 3600e3) return formatDuration(0, ms);
    const total = Math.max(0, Math.ceil(ms / 1000));
    const pad = (n) => String(n).padStart(2, "0");
    const hr = Math.floor(total / 3600);
    const min = Math.floor((total % 3600) / 60);
    return hr > 0 ? `${hr}:${pad(min)}:${pad(total % 60)}` : `${min}:${pad(total % 60)}`;
  }

  let lockoutTimer = null;
  let lockoutCountEl = null;

  function tickLockout() {
    const lockout = state.settings.lockoutOverlay !== false ? currentLockout() : null;
    if (lockout) {
      if (lockoutCountEl) lockoutCountEl.textContent = formatCountdown(lockout.until - Date.now());
      return;
    }
    // The window just rolled over (or the overlay was switched off): get fresh numbers and redraw.
    clearInterval(lockoutTimer);
    lockoutTimer = null;
    sendToBackground({ type: "CLAUDEMETER_REFRESH" });
    render();
  }

  function renderLockout() {
    const lockout = state.settings.lockoutOverlay !== false ? currentLockout() : null;
    const key = lockout ? `lockout:${lockout.until}` : null;
    const collapsed = lockout != null && state.dismissed.has(key);

    lockoutCard.hidden = !lockout || collapsed;
    lockoutChip.hidden = !collapsed;
    if (!lockout) return;

    const backAt = formatClock(lockout.until);
    lockoutChip.textContent = `Back at ${backAt}`;
    lockoutChip.title = "Limit reached — click for the countdown";
    lockoutChip.onclick = () => {
      state.dismissed.delete(key);
      render();
    };

    lockoutCountEl = el("div", { class: "lockout-count", text: formatCountdown(lockout.until - Date.now()) });
    keepingFocus(lockoutCard, () =>
      lockoutCard.replaceChildren(
        el(
          "div",
          { class: "lockout-main" },
          el("div", { class: "lockout-title", text: `Limit reached — back at ${backAt}` }),
          el("div", { class: "lockout-sub", text: `${lockout.label} resets then. ClaudeMeter will refresh as soon as it does.` })
        ),
        lockoutCountEl,
        el("button", {
          class: "icon-btn",
          type: "button",
          title: "Minimise",
          "aria-label": "Minimise",
          text: "\u00d7",
          onclick: () => {
            state.dismissed.add(key);
            render();
          },
        })
      )
    );

    if (!lockoutTimer) lockoutTimer = setInterval(tickLockout, 1000);
  }

  // -------------------------------------------------------- attachment weight --

  function estimateFileTokens(file) {
    const type = file.type ?? "";
    if (type.startsWith("image/")) return IMAGE_TOKENS;
    const isText = type.startsWith("text/") || /json|xml|javascript/.test(type) || TEXT_FILE_PATTERN.test(file.name ?? "");
    return Math.round(file.size / (isText ? CHARS_PER_TOKEN : BINARY_BYTES_PER_TOKEN));
  }

  /** Called for every way a file can reach the composer: the picker, a drop, or a paste. */
  function notePendingFiles(files) {
    let added = false;
    for (const file of files ?? []) {
      const id = `${file.name}:${file.size}:${file.lastModified ?? ""}`;
      // The same file can surface twice (e.g. a drop that the page forwards to its file input).
      if (state.pendingFiles.some((f) => f.id === id)) continue;
      state.pendingFiles.push({ id, name: file.name || "pasted file", size: file.size, tokens: estimateFileTokens(file) });
      added = true;
    }
    if (added) render();
  }

  function clearPendingFiles() {
    if (state.pendingFiles.length === 0) return;
    state.pendingFiles = [];
    render();
  }

  document.addEventListener(
    "change",
    (event) => {
      if (event.target?.type === "file") notePendingFiles(event.target.files);
    },
    true
  );
  document.addEventListener("drop", (event) => notePendingFiles(event.dataTransfer?.files), true);
  document.addEventListener(
    "paste",
    (event) => {
      notePendingFiles(event.clipboardData?.files);
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text.length >= PASTE_WEIGHT_CHARS) {
        notePendingFiles([{ name: "pasted text", size: text.length, type: "text/plain", lastModified: Date.now() }]);
      }
    },
    true
  );

  /** We can't see files being removed again, so this errs towards warning; dismissing clears it until more is added. */
  function updateAttachmentWarning() {
    const threshold = Number(state.settings.attachmentWarnTokens ?? 25000);
    const files = state.pendingFiles;
    const tokens = files.reduce((sum, f) => sum + f.tokens, 0);
    if (threshold <= 0 || tokens < threshold) return setBanner("attach", null);

    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    const largest = files.reduce((a, b) => (b.size > a.size ? b : a));
    const count = `${files.length} item${files.length === 1 ? "" : "s"}, ${formatBytes(bytes)}`;
    setBanner("attach", {
      key: `attach:${files.length}:${bytes}`,
      tone: "warn",
      lead: `Heavy attachments (${formatTokens(tokens)}, rough).`,
      text:
        `${count}${files.length > 1 ? ` — largest is ${largest.name}` : ""}. ` +
        "They're re-read with every later message in this chat, so trim to what Claude needs.",
    });
  }

  /** Project knowledge rides along with every chat in the project. */
  function updateProjectWarning() {
    const threshold = Number(state.settings.attachmentWarnTokens ?? 25000);
    const projectId =
      /\/project\/([0-9a-f-]{36})/i.exec(location.pathname)?.[1] ?? state.threadProjects.get(state.conversationId);
    const project = projectId ? state.projects.get(projectId) : null;
    const tokens = project ? Math.round(project.chars / CHARS_PER_TOKEN) : 0;
    if (threshold <= 0 || tokens < threshold) return setBanner("project", null);

    setBanner("project", {
      key: `project:${projectId}:${Math.floor(tokens / threshold)}`,
      lead: `Large project knowledge (${formatTokens(tokens)}, ${project.docs} file${project.docs === 1 ? "" : "s"}).`,
      text: "It's loaded into every chat in this project, so each message here starts from that much.",
    });
  }

  // ----------------------------------------------------------- tab indicator --

  /** The one number worth showing in a tab strip: session %, or the fullest weekly bucket without one. */
  function tabPercent() {
    const mode = state.settings.tabIndicator ?? "title";
    // The tab strip is the first thing an audience sees, so privacy mode clears it entirely.
    if (mode === "off" || !state.snapshot || state.settings.privacyMode) return null;
    return state.snapshot.session?.percentUsed ?? worstWeekly(state.snapshot)?.percentUsed ?? null;
  }

  function applyTabTitle() {
    const mode = state.settings.tabIndicator ?? "title";
    const pct = mode === "title" || mode === "both" ? tabPercent() : null;
    const bare = document.title.replace(TITLE_PREFIX_PATTERN, "");
    const wanted = pct != null ? `[${pct}%] ${bare}` : bare;
    // Only write on a real difference — this runs from a MutationObserver on <head>.
    if (document.title !== wanted) document.title = wanted;
  }

  function faviconColor(pct) {
    const level = severityClass(pct) || "ok";
    return customSeverityColor(level) ?? SEVERITY_COLORS[level];
  }

  function drawFavicon(pct) {
    const canvas = el("canvas", { width: FAVICON_SIZE, height: FAVICON_SIZE });
    const ctx = canvas.getContext("2d");
    const color = faviconColor(pct);

    ctx.fillStyle = "#262624";
    ctx.beginPath();
    ctx.roundRect(0, 0, FAVICON_SIZE, FAVICON_SIZE, 7);
    ctx.fill();

    // The number, then a meter along the bottom edge.
    ctx.fillStyle = "#f5f4ef";
    ctx.font = `700 ${pct >= 100 ? 15 : 19}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(pct), FAVICON_SIZE / 2, 13);

    ctx.fillStyle = "#3e3e3a";
    ctx.fillRect(4, 24, 24, 4);
    ctx.fillStyle = color;
    ctx.fillRect(4, 24, Math.max(2, Math.round((24 * Math.min(pct, 100)) / 100)), 4);

    return canvas.toDataURL("image/png");
  }

  let faviconShown = null; // "percent:colour" currently drawn, so we only redraw on change

  function applyFavicon() {
    const mode = state.settings.tabIndicator ?? "title";
    const pct = mode === "favicon" || mode === "both" ? tabPercent() : null;
    const links = [...document.querySelectorAll('link[rel~="icon"]')];

    if (pct == null) {
      if (faviconShown == null) return;
      for (const link of links) {
        if (link.dataset.claudemeterAdded) link.remove();
        else if (link.dataset.claudemeterOriginal != null) link.href = link.dataset.claudemeterOriginal;
        delete link.dataset.claudemeterOriginal;
      }
      faviconShown = null;
      return;
    }

    const untouched = links.filter((link) => link.dataset.claudemeterOriginal == null && !link.dataset.claudemeterAdded);
    const drawing = `${pct}:${faviconColor(pct)}`;
    if (drawing === faviconShown && untouched.length === 0 && links.length > 0) return;

    let href;
    try {
      href = drawFavicon(pct);
    } catch (err) {
      console.warn(LOG_PREFIX, "could not draw favicon", err);
      return;
    }

    if (links.length === 0) {
      const link = el("link", { rel: "icon", type: "image/png" });
      link.dataset.claudemeterAdded = "1";
      document.head.append(link);
      links.push(link);
    }
    for (const link of links) {
      if (!link.dataset.claudemeterAdded && link.dataset.claudemeterOriginal == null) {
        link.dataset.claudemeterOriginal = link.getAttribute("href") ?? "";
      }
      link.href = href;
    }
    faviconShown = drawing;
  }

  function updateTabIndicator() {
    applyTabTitle();
    applyFavicon();
  }

  // ------------------------------------------------------------------ snooze --

  // The nudges "Snooze alerts" silences. The lockout card isn't one of them:
  // it answers "when can I use this again", which a snooze shouldn't hide.
  const SNOOZABLE_BANNERS = ["presend", "model", "longctx", "attach", "project"];

  function isSnoozed() {
    return state.snoozeUntil > Date.now();
  }

  function snoozeLine() {
    if (!isSnoozed()) return null;
    return el("div", { class: "sub", text: `Alerts snoozed until ${formatClock(state.snoozeUntil)}` });
  }

  // -------------------------------------------------------------- limit hits --

  function limitHitsLine() {
    const weekAgo = Date.now() - 7 * 24 * 3600e3;
    const recent = state.limitHits.filter((hit) => hit.at >= weekAgo);
    if (recent.length === 0) return null;
    return el("div", {
      class: "sub",
      text: `Limit reached ${recent.length}\u00d7 in the last 7 days · last ${timeAgo(recent.at(-1).lastAt)}`,
    });
  }

  // ------------------------------------------------------ long-context nudge --

  function currentThread() {
    const thread = state.threads.get(state.conversationId);
    return thread ? { ...thread, tokens: Math.round(thread.chars / CHARS_PER_TOKEN) } : null;
  }

  function threadLine() {
    const thread = currentThread();
    if (!thread || thread.messages === 0) return null;
    return el("div", {
      class: "sub",
      text: `Thread length: ${formatTokens(thread.tokens)} · ${thread.messages} messages`,
    });
  }

  /** Every message re-sends the whole thread, so a long chat makes each new message cost more. */
  function updateLongContextNudge() {
    const threshold = Number(state.settings.longContextTokens ?? 40000);
    const thread = currentThread();
    if (!thread || threshold <= 0 || thread.tokens < threshold) return setBanner("longctx", null);

    setBanner("longctx", {
      // Re-arm each time the thread grows by another threshold's worth.
      key: `longctx:${state.conversationId}:${Math.floor(thread.tokens / threshold)}`,
      lead: `Long chat (${formatTokens(thread.tokens)}, ${thread.messages} messages).`,
      text: "Every new message re-reads all of it. A fresh chat will use less of your limit.",
      actions: [{ label: "New chat", href: "https://claude.ai/new" }],
    });
  }

  function onThreadEvent(chat) {
    if (chat.kind === "project_loaded") {
      state.projects.set(chat.projectId, { docs: chat.docs ?? 0, chars: chat.chars ?? 0 });
    } else if (chat.kind === "conversation_loaded") {
      state.threads.set(chat.conversationId, { messages: chat.messages ?? 0, chars: chat.chars ?? 0 });
      if (chat.projectId) state.threadProjects.set(chat.conversationId, chat.projectId);
    } else if (chat.kind === "completion_end" && chat.ok) {
      // Until the page reloads the conversation, grow the estimate by this exchange.
      const thread = state.threads.get(chat.conversationId) ?? { messages: 0, chars: 0 };
      state.threads.set(chat.conversationId, {
        messages: thread.messages + 2,
        chars: thread.chars + (chat.promptChars ?? 0) + (chat.replyChars ?? 0),
      });
    }
  }

  // -------------------------------------------------------- model-switch hint --

  function readModelPicker() {
    for (const selector of MODEL_PICKER_SELECTORS) {
      const text = document.querySelector(selector)?.textContent?.trim();
      if (text) return text.slice(0, 60);
    }
    return "";
  }

  /** Only nudge when we can tell the model in use is the one whose bucket is under pressure. */
  function usingModel(label) {
    // The picker reflects a switch immediately; the last request only knows what was sent.
    const current = state.pickerModel || state.sentModel || "";
    return current.toLowerCase().includes(String(label).toLowerCase());
  }

  function updateModelHint() {
    const hint = state.modelHint;
    if (!hint || !usingModel(hint.label)) return setBanner("model", null);

    const pace =
      hint.basis === "rate"
        ? `It's your fastest-filling limit (+${hint.ratePerHour}%/hr` +
          (hint.hoursLeft != null ? `, about ${formatDuration(0, hint.hoursLeft * 3600e3)} left at this pace).` : ").")
        : "It's your fullest weekly limit.";

    const key = windowKey("model", hint);
    // Same bucket as the pre-send warning? This banner says more, so it replaces it.
    if (!state.dismissed.has(key) && bannerSpecs.get("presend")?.bucketLabel === hint.label) {
      bannerSpecs.delete("presend");
    }

    setBanner("model", {
      key,
      tone: severityClass(hint.percentUsed),
      lead: `${hint.label} weekly limit at ${hint.percentUsed}%.`,
      text: `${pace} ${hint.suggest} count against the larger all-models limit instead.`,
    });
  }

  // -------------------------------------------------------- pre-send warning --

  /** While a draft is in the composer, flag the bucket closest to its limit. */
  function updatePreSendWarning() {
    const threshold = Number(state.settings.preSendWarnPercent ?? 80);
    const over = bucketsOf(state.snapshot)
      .filter((b) => threshold > 0 && b.percentUsed >= threshold && b.percentUsed < 100)
      .sort((a, b) => b.percentUsed - a.percentUsed)[0];

    if (!over || !state.drafting) return setBanner("presend", null);

    const isSession = over === state.snapshot.session;
    const resetsIn = over.resetsAt != null ? formatDuration(Date.now(), over.resetsAt) : null;
    setBanner("presend", {
      bucketLabel: over.label,
      key: windowKey("presend", over),
      tone: severityClass(over.percentUsed) || "warn",
      lead: isSession ? `Session at ${over.percentUsed}%.` : `${over.label} weekly limit at ${over.percentUsed}%.`,
      text: resetsIn ? `This message may hit your limit — it resets in ${resetsIn}.` : "This message may hit your limit.",
    });
  }

  // ------------------------------------------------------------------ render --

  /** Colours the user picked override the theme's for every meter in the dock. */
  function applySeverityColors() {
    for (const [level, properties] of [["ok", ["--ok", "--ok-fill"]], ["warn", ["--warn"]], ["danger", ["--danger"]]]) {
      const custom = customSeverityColor(level);
      for (const property of properties) {
        if (custom) dock.style.setProperty(property, custom);
        else dock.style.removeProperty(property);
      }
    }
  }

  function render() {
    dock.dataset.theme = effectiveTheme();
    dock.dataset.privacy = state.settings.privacyMode ? "on" : "off";
    // High contrast keeps its own accent; the other themes take the chosen preset.
    if (dock.dataset.theme === "contrast") dock.style.removeProperty("--accent");
    else dock.style.setProperty("--accent", ACCENT_COLORS[state.settings.accent] ?? ACCENT_COLORS.clay);
    applySeverityColors();
    renderPill();
    renderCostChip();
    renderLockout();
    renderPanel();
    updatePreSendWarning();
    updateModelHint();
    updateLongContextNudge();
    updateAttachmentWarning();
    updateProjectWarning();
    if (isSnoozed()) SNOOZABLE_BANNERS.forEach((id) => bannerSpecs.delete(id));
    renderBanners();
    updateTabIndicator();
  }

  /** Cheap poll for things the DOM won't tell us about (draft cleared after send, SPA navigation). */
  function tick() {
    positionDock();
    const drafting = hasDraft();
    const conversationId = currentConversationId();
    const pickerModel = readModelPicker();
    if (
      drafting !== state.drafting ||
      conversationId !== state.conversationId ||
      pickerModel !== state.pickerModel
    ) {
      // A draft's attachments don't follow you to a different chat.
      if (conversationId !== state.conversationId && state.conversationId) state.pendingFiles = [];
      state.drafting = drafting;
      state.conversationId = conversationId;
      state.pickerModel = pickerModel;
      render();
    }
  }

  // Typing should surface the warning immediately, not on the next poll.
  document.addEventListener("input", tick, true);

  // Close the panel on Escape or a click anywhere outside our shadow root.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.panelOpen) togglePanel();
  });
  document.addEventListener("pointerdown", (event) => {
    // A click elsewhere on the page means focus is going there — don't yank it back.
    if (state.panelOpen && !event.composedPath().includes(host)) togglePanel({ restoreFocus: false });
  });

  // ----------------------------------------------------------------- storage --

  // storage key -> [state field, value when absent]
  const STORAGE_KEYS = {
    latestSnapshot: ["snapshot", null],
    settings: ["settings", {}],
    messageLog: ["messageLog", []],
    modelHint: ["modelHint", null],
    limitHits: ["limitHits", []],
    snoozeUntil: ["snoozeUntil", 0],
  };
  // In demo mode these come from the made-up dataset the background worker
  // writes under `demoState` instead (mirrors getAll() in src/lib/storage.js).
  const DEMO_KEYS = ["latestSnapshot", "messageLog", "modelHint", "limitHits"];
  const raw = {}; // last value seen for each storage key, demoState included

  function applyStored(key, value) {
    if (!STORAGE_KEYS[key] && key !== "demoState") return false;
    raw[key] = value;

    const demo = raw.settings?.demoMode ? raw.demoState : null;
    for (const [storageKey, [field, fallback]] of Object.entries(STORAGE_KEYS)) {
      const demoValue = demo && DEMO_KEYS.includes(storageKey) ? demo[storageKey] : undefined;
      state[field] = demoValue ?? raw[storageKey] ?? fallback;
    }
    if (key === "messageLog") onMessageLogChanged();
    return true;
  }

  async function init() {
    let stored = {};
    try {
      stored = await chrome.storage.local.get([...Object.keys(STORAGE_KEYS), "demoState"]);
    } catch (err) {
      console.warn(LOG_PREFIX, "could not read storage", err);
    }
    for (const key of [...Object.keys(STORAGE_KEYS), "demoState"]) applyStored(key, stored[key]);

    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        let touched = false;
        for (const [key, change] of Object.entries(changes)) {
          touched = applyStored(key, change.newValue) || touched;
        }
        if (touched) render();
      });
    } catch (err) {
      console.warn(LOG_PREFIX, "could not subscribe to storage", err);
    }

    tick();
    render();

    setInterval(tick, REPOSITION_MS);
    // claude.ai rewrites <title> (and occasionally its icon links) on every navigation.
    new MutationObserver(updateTabIndicator).observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.addEventListener("resize", positionDock);
    // Keep "resets in" / "updated X ago" honest while the tab sits open.
    setInterval(render, 30_000);

    // Opening claude.ai is a good moment to make sure the numbers are current.
    if (!state.snapshot || Date.now() - state.snapshot.fetchedAt > STALE_AFTER_MS) {
      sendToBackground({ type: "CLAUDEMETER_REFRESH" });
    }
  }

  init();
})();
