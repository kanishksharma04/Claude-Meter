// Runs in the default ISOLATED content script world (has chrome.runtime
// access, unlike src/content/inject-hook.js which runs in the page's MAIN
// world). Its only job is to relay captures and chat events dispatched by
// inject-hook.js to the background service worker.

const EVENT_NAME = "__claudemeter_capture__";
const CHAT_EVENT_NAME = "__claudemeter_chat__";
const LOG_PREFIX = "[ClaudeMeter:discovery]";

window.addEventListener(EVENT_NAME, (event) => {
  const capture = event.detail;
  if (!capture) return;

  chrome.runtime.sendMessage({ type: "CLAUDEMETER_CAPTURE", capture }).catch((err) => {
    console.warn(LOG_PREFIX, "failed to relay capture to background", err);
  });
});

window.addEventListener(CHAT_EVENT_NAME, (event) => {
  const chatEvent = event.detail;
  if (!chatEvent?.kind) return;

  chrome.runtime.sendMessage({ type: "CLAUDEMETER_CHAT_EVENT", event: chatEvent }).catch((err) => {
    console.warn(LOG_PREFIX, "failed to relay chat event to background", err);
  });
});

console.log(LOG_PREFIX, "relay content script ready");
