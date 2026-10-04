// The dock: the shadow root and the elements in it, where it sits on the page, the usage pill,
// the panel it opens, and the per-message cost chip. See core.js for how these files fit together.

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
