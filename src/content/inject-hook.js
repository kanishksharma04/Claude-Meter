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
  const CONVERSATION_PATTERN = /\/api\/organizations\/[^/]+\/chat_conversations\/([0-9a-f-]+)(?:\?|$)/i;
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
  // started and when its stream finished, plus character counts so the page UI
  // can estimate how long the thread has grown — message text itself never
  // leaves the page.

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
        promptChars: messageChars({ text: body?.prompt, attachments: body?.attachments }),
      };
    } catch {
      return null;
    }
  }

  /** Characters of text one message contributes to the thread (its text blocks plus pasted/extracted attachments). */
  function messageChars(message) {
    let chars = 0;
    const blocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of blocks) {
      if (typeof block?.text === "string") chars += block.text.length;
    }
    if (chars === 0 && typeof message?.text === "string") chars = message.text.length;
    for (const attachment of Array.isArray(message?.attachments) ? message.attachments : []) {
      if (typeof attachment?.extracted_content === "string") chars += attachment.extracted_content.length;
    }
    return chars;
  }

  /**
   * The conversation endpoint returns every branch (edits, retries). Only the
   * branch ending at current_leaf_message_uuid is what gets re-sent, so walk
   * back from the leaf; fall back to all messages if the links aren't there.
   */
  function activeThread(conversation) {
    const all = Array.isArray(conversation?.chat_messages) ? conversation.chat_messages : null;
    if (!all) return null;

    const byId = new Map(all.map((m) => [m?.uuid, m]));
    const thread = [];
    let cursor = byId.get(conversation.current_leaf_message_uuid);
    while (cursor && thread.length < all.length) {
      thread.push(cursor);
      cursor = byId.get(cursor.parent_message_uuid);
    }
    return thread.length > 0 ? thread : all;
  }

  /** When the page loads a conversation, report how big its active thread is. */
  function watchConversation(response, absoluteUrl, method) {
    const match = method === "GET" && response.ok ? CONVERSATION_PATTERN.exec(absoluteUrl) : null;
    if (!match) return;

    response
      .clone()
      .json()
      .then((conversation) => {
        const thread = activeThread(conversation);
        if (!thread) return;
        emitChat({
          kind: "conversation_loaded",
          conversationId: match[1],
          messages: thread.length,
          chars: thread.reduce((sum, m) => sum + messageChars(m), 0),
        });
      })
      .catch(() => {});
  }

  /** Feeds a byte stream of server-sent events to onData, one parsed `data:` payload at a time. */
  function createSseReader(onData) {
    const decoder = new TextDecoder();
    let buffer = "";
    return (chunk) => {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = safeJsonParse(line.slice(5));
        if (data && typeof data === "object") onData(data);
      }
    };
  }

  function toEpochMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    const parsed = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * Looks for claude.ai's "limit reached" marker — an object with
   * type "exceeded_limit" — anywhere in a payload. It shows up nested, and in
   * error responses it is a JSON string inside the error message, so strings
   * that look like JSON are unwrapped too.
   */
  function findExceededLimit(value, depth = 0) {
    if (depth > 5 || value == null) return null;
    if (typeof value === "string") {
      return value.includes("exceeded_limit") ? findExceededLimit(safeJsonParse(value), depth + 1) : null;
    }
    if (typeof value !== "object") return null;
    if (value.type === "exceeded_limit") {
      return {
        resetsAt: toEpochMs(value.resetsAt ?? value.resets_at),
        claim: typeof value.representativeClaim === "string" ? value.representativeClaim : null,
      };
    }
    for (const child of Object.values(value)) {
      const found = findExceededLimit(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  /** Drain a clone of the reply stream so we know when it actually finished and how long the reply was. */
  async function watchCompletion(response, chat, startedAt) {
    let replyChars = 0;
    let limitReported = false;
    const reportLimit = (limit, source) => {
      if (limitReported) return;
      limitReported = true;
      emitChat({ kind: "limit_hit", ...chat, source, resetsAt: limit?.resetsAt ?? null, claim: limit?.claim ?? null });
    };

    const finish = (extra) =>
      emitChat({
        kind: "completion_end",
        ...chat,
        status: response.status,
        durationMs: Date.now() - startedAt,
        replyChars,
        ...extra,
      });

    if (response.status === 429) {
      // The message was refused outright. The body says which limit and until when.
      const text = await response.clone().text().catch(() => "");
      reportLimit(findExceededLimit(text), "rejected");
    }
    if (!response.ok || !response.body) return finish({ ok: false });

    const feed = createSseReader((data) => {
      // Sent alongside a reply that went through but used up the last of the allowance.
      if (data.type === "message_limit") {
        const limit = findExceededLimit(data);
        if (limit) reportLimit(limit, "reply");
      }
      if (data.type === "content_block_delta" && typeof data.delta?.text === "string") {
        replyChars += data.delta.text.length;
      } else if (typeof data.completion === "string") {
        replyChars += data.completion.length; // older stream format
      }
    });

    try {
      const reader = response.clone().body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        try {
          feed(value);
        } catch {
          // A parsing slip must not stop us from seeing the end of the stream.
        }
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

      watchConversation(response, absoluteUrl, method);

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
