// Runs in the page's MAIN world (see manifest.json `"world": "MAIN"`).
//
// Content scripts normally run in an isolated JS world that does NOT share
// `window.fetch` / `XMLHttpRequest` with the actual page — patching them
// there would never see claude.ai's own requests. Running as a MAIN-world
// content script patches the *real* globals the page code calls into.
//
// This script has NO access to chrome.* extension APIs (MAIN world scripts
// never do). It only observes traffic the page already made and hands
// matches off via a CustomEvent; src/content/relay.js (isolated world)
// listens for that event and forwards it to the background service worker.

(() => {
  const MATCH_KEYWORDS = ["usage", "limit", "quota", "rate", "organizations", "billing"];
  const EVENT_NAME = "__claudemeter_capture__";
  const CHAT_EVENT_NAME = "__claudemeter_chat__";
  const COMPLETION_PATTERN =
    /\/api\/organizations\/[^/]+\/chat_conversations\/([0-9a-f-]+)\/(?:retry_)?completion(?:[/?]|$)/i;
  const LOG_PREFIX = "[ClaudeMeter:discovery]";
  const MAX_BODY_CHARS = 20000;

  function matchesKeywords(absoluteUrl) {
    const lower = absoluteUrl.toLowerCase();
    return MATCH_KEYWORDS.some((kw) => lower.includes(kw));
  }

  function toAbsoluteUrl(url) {
    try {
      return new URL(url, window.location.href).toString();
    } catch {
      return String(url);
    }
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function makeCaptureId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function emitCapture(capture) {
    try {
      console.log(LOG_PREFIX, capture.method, capture.url, capture);
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: capture }));
    } catch (err) {
      console.warn(LOG_PREFIX, "failed to emit capture", err);
    }
  }

  // ----------------------------------------------------------------- chat --
  // Sending a message is a POST to .../chat_conversations/{id}/completion that
  // streams the reply back as server-sent events. We only announce that one
  // started and when its stream finished — message text never leaves the page.

  function emitChat(detail) {
    try {
      window.dispatchEvent(new CustomEvent(CHAT_EVENT_NAME, { detail: { ...detail, timestamp: Date.now() } }));
    } catch (err) {
      console.warn(LOG_PREFIX, "failed to emit chat event", err);
    }
  }

  /** Returns a small descriptor if this fetch call is a chat completion, else null. Never throws. */
  function describeCompletion(args) {
    try {
      const input = args[0];
      const init = args[1] || {};
      const rawUrl = typeof input === "string" ? input : input?.url ?? String(input ?? "");
      const method = (init.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
      if (method !== "POST") return null;

      const match = COMPLETION_PATTERN.exec(toAbsoluteUrl(rawUrl));
      if (!match) return null;

      const body = typeof init.body === "string" ? safeJsonParse(init.body) : null;
      return {
        requestId: makeCaptureId(),
        conversationId: match[1],
        model: typeof body?.model === "string" ? body.model : null,
      };
    } catch {
      return null;
    }
  }

  /** Drain a clone of the reply stream so we know when it actually finished. */
  async function watchCompletion(response, chat, startedAt) {
    const finish = (extra) =>
      emitChat({ kind: "completion_end", ...chat, status: response.status, durationMs: Date.now() - startedAt, ...extra });

    if (!response.ok || !response.body) return finish({ ok: false });

    try {
      const reader = response.clone().body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
      finish({ ok: true });
    } catch {
      // The user hit "stop" (or the connection dropped) — whatever was
      // generated up to that point still counted against the limit.
      finish({ ok: true, aborted: true });
    }
  }

  // ---------------------------------------------------------------- fetch --
  const originalFetch = window.fetch;
  window.fetch = async function claudeMeterFetch(...args) {
    const chat = describeCompletion(args);
    const startedAt = Date.now();
    if (chat) emitChat({ kind: "completion_start", ...chat });

    let response;
    try {
      response = await originalFetch.apply(this, args);
    } catch (err) {
      if (chat) emitChat({ kind: "completion_end", ...chat, ok: false, status: 0, durationMs: Date.now() - startedAt });
      throw err;
    }

    if (chat) watchCompletion(response, chat, startedAt);

    try {
      const input = args[0];
      const init = args[1] || {};
      const rawUrl = typeof input === "string" ? input : input?.url ?? "";
      const absoluteUrl = toAbsoluteUrl(rawUrl);
      const method = (init.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();

      if (absoluteUrl && matchesKeywords(absoluteUrl)) {
        response
          .clone()
          .text()
          .then((text) => {
            emitCapture({
              id: makeCaptureId(),
              timestamp: Date.now(),
              source: "fetch",
              url: absoluteUrl,
              method,
              status: response.status,
              responseBody: safeJsonParse(text) ?? text.slice(0, MAX_BODY_CHARS),
            });
          })
          .catch((err) => console.warn(LOG_PREFIX, "could not read fetch response body", err));
      }
    } catch (err) {
      // Never let hook bugs break the page's own fetch call.
      console.warn(LOG_PREFIX, "fetch hook error (page unaffected)", err);
    }

    return response;
  };

  // ------------------------------------------------------------------ XHR --
  const OriginalOpen = XMLHttpRequest.prototype.open;
  const OriginalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function claudeMeterOpen(method, url, ...rest) {
    try {
      this.__claudemeter = {
        method: String(method || "GET").toUpperCase(),
        url: toAbsoluteUrl(url),
      };
    } catch (err) {
      console.warn(LOG_PREFIX, "xhr open hook error (page unaffected)", err);
    }
    return OriginalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function claudeMeterSend(...args) {
    try {
      const meta = this.__claudemeter;
      if (meta && matchesKeywords(meta.url)) {
        this.addEventListener("loadend", () => {
          try {
            let body;
            if (this.responseType === "" || this.responseType === "text") {
              body = safeJsonParse(this.responseText) ?? this.responseText.slice(0, MAX_BODY_CHARS);
            } else if (this.responseType === "json") {
              body = this.response;
            } else {
              body = `[unsupported responseType: ${this.responseType}]`;
            }
            emitCapture({
              id: makeCaptureId(),
              timestamp: Date.now(),
              source: "xhr",
              url: meta.url,
              method: meta.method,
              status: this.status,
              responseBody: body,
            });
          } catch (err) {
            console.warn(LOG_PREFIX, "could not read XHR response body", err);
          }
        });
      }
    } catch (err) {
      console.warn(LOG_PREFIX, "xhr send hook error (page unaffected)", err);
    }
    return OriginalSend.apply(this, args);
  };

  console.log(LOG_PREFIX, "network hooks installed (fetch + XHR) — watching for", MATCH_KEYWORDS.join(", "));
})();
