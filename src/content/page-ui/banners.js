// The banner stack above the composer, the lockout countdown, and the attachment-weight
// warning. See core.js for how these files fit together.

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
