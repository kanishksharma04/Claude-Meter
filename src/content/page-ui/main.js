// Last of the seven: render() draws everything from the state, tick() notices what the DOM won't
// say, and the storage listener starts it all. See core.js for how these files fit together.

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
