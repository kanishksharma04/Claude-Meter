// The hints that come and go with what the user is doing: snooze, the limit-hit line, and the
// long-context, model-switch and pre-send nudges. See core.js for how these files fit together.

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
