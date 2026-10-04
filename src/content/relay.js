// Runs in the default ISOLATED content script world (has chrome.runtime
// access, unlike src/content/inject-hook.js which runs in the page's MAIN
// world). Its job is to relay captures and chat events dispatched by
// inject-hook.js to the background service worker — and to be the second
// check on what a capture may be: anything on the page can dispatch an event
// with the hook's name, so the rules are applied again here.
//
// Wrapped in a function so that its names stay its own: the in-page UI
// (src/content/page-ui/) runs in this same world, unwrapped.

(() => {
  const EVENT_NAME = "__claudemeter_capture__";
  const CHAT_EVENT_NAME = "__claudemeter_chat__";
  const CONFIG_EVENT_NAME = "__claudemeter_config__";
  const READY_EVENT_NAME = "__claudemeter_hook_ready__";
  const LOG_PREFIX = "[ClaudeMeter:discovery]";

  // Mirrors src/lib/capture-rules.js — a content script can't import it. Keep the two in step.
  const ORG_PATH = "/api/organizations/[^/]+";
  const USAGE_PATH = new RegExp(`^${ORG_PATH}/usage/?$`);
  const SPEND_LIMIT_PATH = new RegExp(`^${ORG_PATH}/overage_spend_limit/?$`);
  const PRIVATE_PATH = /\/(?:chat_conversations|projects|files|artifacts|memory|skills)(?:\/|$)/i;
  const DISCOVERY_PATH = /^\/api\/.*(?:usage|limit|quota|billing|overage|subscription)/i;
  const ORG_LIST_PATH = /^\/api\/organizations\/?$/;
  const MAX_BODY_CHARS = 20000;

  // Developer mode widens what the hook reads (never to chats). The hook can't
  // read the setting itself, so it is told from here, and told again whenever it changes.
  let developerMode = false;

  function tellHook() {
    // A string, not an object: it has to cross from this world into the page's.
    window.dispatchEvent(new CustomEvent(CONFIG_EVENT_NAME, { detail: developerMode ? "discovery" : "off" }));
  }

  async function readDeveloperMode() {
    try {
      const { settings } = await chrome.storage.local.get("settings");
      developerMode = Boolean(settings?.developerMode);
    } catch {
      developerMode = false; // the extension was reloaded under this tab
    }
    tellHook();
  }

  window.addEventListener(READY_EVENT_NAME, tellHook);
  readDeveloperMode();
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.settings) return;
      developerMode = Boolean(changes.settings.newValue?.developerMode);
      tellHook();
    });
  } catch {
    // No storage events (extension reloaded): the hook stays as it was last told.
  }

  function captureAllowed(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.origin !== "https://claude.ai") return false;
    const path = parsed.pathname;
    if (PRIVATE_PATH.test(path)) return false;
    if (USAGE_PATH.test(path) || SPEND_LIMIT_PATH.test(path)) return true;
    return developerMode && (DISCOVERY_PATH.test(path) || ORG_LIST_PATH.test(path));
  }

  /** A body as it may be handed on: as it is when small, otherwise the start of its text. */
  function trimBody(body) {
    if (body == null) return null;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    if (typeof text !== "string") return null;
    return text.length <= MAX_BODY_CHARS ? body : text.slice(0, MAX_BODY_CHARS);
  }

  window.addEventListener(EVENT_NAME, (event) => {
    const capture = event.detail;
    if (!capture || !captureAllowed(capture.url)) return;

    const message = { type: "CLAUDEMETER_CAPTURE", capture: { ...capture, responseBody: trimBody(capture.responseBody) } };
    chrome.runtime.sendMessage(message).catch((err) => {
      console.warn(LOG_PREFIX, "failed to relay capture to background", err);
    });
  });

  /** claude.ai titles a chat tab "<conversation name> - Claude"; a bare "Claude" means it isn't named yet. */
  function conversationTitle() {
    const title = document.title
      .replace(/^\[\d{1,3}%\]\s*/, "") // ClaudeMeter's own tab-title indicator (page-ui/tab-indicator.js)
      .replace(/\s+[-\u2013|]\s+Claude\s*$/, "")
      .trim();
    return title && title !== "Claude" ? title.slice(0, 120) : null;
  }

  window.addEventListener(CHAT_EVENT_NAME, (event) => {
    const chatEvent = event.detail;
    if (!chatEvent?.kind) return;

    const message = { type: "CLAUDEMETER_CHAT_EVENT", event: { ...chatEvent, title: conversationTitle() } };
    chrome.runtime.sendMessage(message).catch((err) => {
      console.warn(LOG_PREFIX, "failed to relay chat event to background", err);
    });
  });
})();
