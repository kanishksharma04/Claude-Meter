// The usage % on the claude.ai tab itself: in its title, its favicon, or both.
// See core.js for how these files fit together.

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
