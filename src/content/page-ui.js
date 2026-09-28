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
  const STALE_AFTER_MS = 60_000;
  const REPOSITION_MS = 500;

  // claude.ai's composer is a ProseMirror contenteditable inside a <fieldset>.
  // None of this is a stable contract, so try a few shapes and fall back to a
  // corner of the viewport when nothing matches.
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

  function severityClass(pct) {
    if (pct >= 95) return "danger";
    if (pct >= 80) return "warn";
    return "";
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
    // claude.ai stamps its own resolved theme on <html data-mode>; prefer it so
    // the pill matches the page rather than the OS.
    const pageMode = document.documentElement.getAttribute("data-mode");
    if (pageMode === "dark" || pageMode === "light") return pageMode;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function currentConversationId() {
    return /\/chat\/([0-9a-f-]{36})/i.exec(location.pathname)?.[1] ?? null;
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
    .pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
    .fill { height: 100%; border-radius: 999px; background: var(--accent); }
    .fill.warn { background: var(--warn); }
    .fill.danger { background: var(--danger); }
    .sub { margin-top: 4px; color: var(--muted); font-size: 11px; }
    .panel-foot { color: var(--muted); font-size: 11px; }

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
  const pill = el("button", { class: "pill", type: "button", "aria-expanded": "false", onclick: togglePanel });
  const costChip = el("span", { class: "chip", hidden: true });
  const pillRow = el("div", { class: "pill-row" }, costChip, pill);
  const banners = el("div", { class: "banners", role: "status", "aria-live": "polite" });
  const dock = el("div", { class: "dock" }, banners, panel, pillRow);
  shadow.append(dock);

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
    pill.replaceChildren(...parts);
  }

  function renderBucket(bucket) {
    const resetsIn = bucket.resetsAt != null ? formatDuration(Date.now(), bucket.resetsAt) : null;
    const fill = el("div", { class: `fill ${severityClass(bucket.percentUsed)}`.trim() });
    fill.style.width = `${bucket.percentUsed}%`;

    return el(
      "div",
      { class: "bucket" },
      el(
        "div",
        { class: "bucket-head" },
        el("span", { class: "bucket-label", text: bucket.label }),
        el("span", { class: "bucket-pct", text: `${bucket.percentUsed}% used` })
      ),
      el("div", { class: "track" }, fill),
      el("div", { class: "sub", text: `Resets in ${resetsIn ?? bucket.resetsInLabel ?? "unknown"}` })
    );
  }

  function renderPanel() {
    panel.hidden = !state.panelOpen;
    pill.setAttribute("aria-expanded", String(state.panelOpen));
    if (!state.panelOpen) return;

    const { snapshot } = state;
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
      el("div", { class: "panel-foot", text: `Updated ${timeAgo(snapshot?.fetchedAt)}` })
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

  function renderCostChip() {
    const enabled = state.settings.messageCost !== false;
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
    if (!chat?.requestId) return;

    if (chat.kind === "completion_start") {
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

  function togglePanel() {
    state.panelOpen = !state.panelOpen;
    renderPanel();
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

  function renderBanners() {
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
            "aria-label": "Dismiss",
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
      key: windowKey("presend", over),
      tone: severityClass(over.percentUsed) || "warn",
      lead: isSession ? `Session at ${over.percentUsed}%.` : `${over.label} weekly limit at ${over.percentUsed}%.`,
      text: resetsIn ? `This message may hit your limit — it resets in ${resetsIn}.` : "This message may hit your limit.",
    });
  }

  // ------------------------------------------------------------------ render --

  function render() {
    dock.dataset.theme = effectiveTheme();
    renderPill();
    renderCostChip();
    renderPanel();
    updatePreSendWarning();
    renderBanners();
  }

  /** Cheap poll for things the DOM won't tell us about (draft cleared after send, SPA navigation). */
  function tick() {
    positionDock();
    const drafting = hasDraft();
    if (drafting !== state.drafting) {
      state.drafting = drafting;
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
    if (state.panelOpen && !event.composedPath().includes(host)) togglePanel();
  });

  // ----------------------------------------------------------------- storage --

  // storage key -> [state field, value when absent]
  const STORAGE_KEYS = {
    latestSnapshot: ["snapshot", null],
    settings: ["settings", {}],
    messageLog: ["messageLog", []],
  };

  function applyStored(key, value) {
    if (!STORAGE_KEYS[key]) return false;
    const [field, fallback] = STORAGE_KEYS[key];
    state[field] = value ?? fallback;
    if (key === "messageLog") onMessageLogChanged();
    return true;
  }

  async function init() {
    let stored = {};
    try {
      stored = await chrome.storage.local.get(Object.keys(STORAGE_KEYS));
    } catch (err) {
      console.warn(LOG_PREFIX, "could not read storage", err);
    }
    for (const key of Object.keys(STORAGE_KEYS)) applyStored(key, stored[key]);

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
