// The dashboard's analytics sections. They only appear in the side panel /
// full-tab view (popup.html?view=panel) — the toolbar popup has no room for
// them — and each hides itself until there is enough data to say something.

import { buildHeatmap, describeHeatmap, describeSlot, WEEKDAYS } from "../lib/heatmap.js";
import { nextStart, describeStart } from "../lib/window-start.js";
import { lockoutStats } from "../lib/lockout-stats.js";
import { planFit, describePlanFit } from "../lib/plan-fit.js";
import { timelineDays, summarizeWindows } from "../lib/session-windows.js";
import { severityOf } from "../lib/severity.js";
import { recentSpikes, describeSpike, spikeSource } from "../lib/spikes.js";
import { attribution, describeAttribution } from "../lib/attribution.js";
import { valueForMoney, describeValue, monthlyPriceFor, formatDollars, formatTokens } from "../lib/value.js";
import { timeAgo } from "../lib/time-format.js";
import { modelLabel } from "../lib/claude-code.js";
import { summarizeSpend } from "../lib/api-spend.js";
import { formatHour, formatDuration, formatClock, formatMoment } from "../lib/time-format.js";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A length of time in words — "2 hr 40 min". */
const span = (ms) => (ms < 60_000 ? "under a minute" : formatDuration(0, ms));

/** "24 Sep – 30 Sep" for a span of days; `to` is exclusive. */
function dateRange(from, to) {
  const format = (epochMs) => new Date(epochMs).toLocaleDateString([], { day: "numeric", month: "short" });
  return `${format(from)} – ${format(to - 1)}`;
}

// ---------------------------------------------------------------- heatmap --

/** Hours that get a label along the top of the grid. */
const HEATMAP_TICKS = [0, 6, 12, 18];

function renderHeatmap({ usageLog }) {
  const grid = buildHeatmap(usageLog);
  const section = $("heatmapSection");
  section.hidden = grid.max === 0;
  if (section.hidden) return;

  $("heatmapNote").textContent = `average per hour · ${plural(grid.days, "day")}`;
  $("heatmapSummary").textContent = describeHeatmap(grid);

  const cells = [el("span")]; // the corner above the weekday labels
  for (let hour = 0; hour < 24; hour++) {
    cells.push(el("span", { className: "heat-tick" }, HEATMAP_TICKS.includes(hour) ? formatHour(hour) : ""));
  }
  grid.cells.forEach((row, day) => {
    cells.push(el("span", { className: "heat-day" }, WEEKDAYS[day]));
    row.forEach((value, hour) => {
      const cell = el("span", { className: "heat-cell", title: describeSlot(day, hour, value) });
      // Square-root scale: one very heavy hour shouldn't wash every other slot out to nothing.
      if (value > 0) cell.style.setProperty("--heat", `${Math.round(15 + 85 * Math.sqrt(value / grid.max))}%`);
      cells.push(cell);
    });
  });

  const heatmap = $("heatmap");
  heatmap.setAttribute("aria-label", `Usage by weekday and hour. ${describeHeatmap(grid)}`);
  heatmap.replaceChildren(...cells);
}

// ----------------------------------------------------------- window start --

function renderWindowStart({ usageLog, settings }) {
  const suggestion = nextStart(usageLog, settings);
  const section = $("startSection");
  section.hidden = !suggestion;
  if (!suggestion) return;

  const { lead, windows, basis } = describeStart(suggestion);
  $("startNote").textContent = `${suggestion.when} · ${WEEKDAYS[suggestion.day]}`;
  $("startLead").textContent = lead;
  $("startPlan").replaceChildren(...windows.map((text) => el("li", {}, text)));
  $("startBasis").textContent = basis;
}

// ------------------------------------------------------ session timeline --

function renderTimeline({ sessionWindows, settings }) {
  const summary = summarizeWindows(sessionWindows);
  const section = $("timelineSection");
  section.hidden = summary.count === 0;
  if (section.hidden) return;

  $("timelineNote").textContent = `${plural(summary.count, "window")} in 7 days`;
  $("timelineSummary").textContent =
    `About ${summary.perDay} a day, peaking at ${summary.averagePeak}% on average` +
    (summary.full > 0 ? ` · ${summary.full} reached 100%` : "") +
    ". Each bar is one 5-hour session, from its first message to its reset.";

  const clock = (epochMs) => new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("timelineTicks").replaceChildren(...HEATMAP_TICKS.map((hour) => el("span", {}, formatHour(hour))));
  $("timeline").replaceChildren(
    ...timelineDays(sessionWindows).map((row) => {
      const day = new Date(row.dayStart).toLocaleDateString([], { weekday: "short", day: "numeric" });
      const track = el("div", { className: "timeline-track", ariaHidden: "true" });
      const spoken = [];

      for (const bar of row.bars) {
        const node = el("span", {
          className: `timeline-bar ${severityOf(bar.peak, settings)}${bar.live ? " live" : ""}`,
          title: `${formatClock(bar.start)} – ${formatClock(bar.resetsAt)} · peaked at ${bar.peak}%`,
        });
        node.style.left = `${bar.left}%`;
        node.style.width = `${bar.width}%`;
        // The figure only goes on bars wide enough to hold it — the stub of a window that crossed midnight isn't.
        if (bar.width > 9) node.textContent = `${bar.peak}%`;
        track.append(node);
        spoken.push(`${clock(bar.start)} to ${clock(bar.resetsAt)}, ${bar.live ? "at" : "peaked at"} ${bar.peak}%`);
      }

      return el(
        "li",
        {},
        el("span", { className: "timeline-day", ariaHidden: "true" }, day),
        track,
        el("span", { className: "sr-only" }, `${day}: ${spoken.length > 0 ? spoken.join("; ") : "no sessions"}.`)
      );
    })
  );
}

// ----------------------------------------------------------------- spikes --

function renderSpikes({ spikes, messageLog, settings }) {
  const section = $("spikeSection");
  // With detection off there is nothing to report, and "none found" would be a lie.
  section.hidden = !(settings.spikePercent > 0);
  if (section.hidden) return;

  const recent = recentSpikes(spikes);
  $("spikeNote").textContent = `+${settings.spikePercent}% within 5 min`;
  $("spikeLead").textContent =
    recent.length === 0
      ? "No sudden jumps in the last 7 days."
      : `${plural(recent.length, "sudden jump")} in the last 7 days.`;

  $("spikeList").replaceChildren(
    ...recent.slice(0, 6).map((spike) => {
      const source = spikeSource(spike, settings.messageCost ? messageLog : []);
      const cause = source
        ? `during “${source.title}”` + (source.messages > 1 ? ` and ${plural(source.messages - 1, "other message")}` : "")
        : "nothing was sent from this browser";
      return el(
        "li",
        {},
        el("time", { dateTime: new Date(spike.at).toISOString() }, formatMoment(spike.at)),
        el("span", { className: "spike-what" }, `${spike.label} ${describeSpike(spike)}`),
        el("span", { className: "spike-cause" }, cause)
      );
    })
  );
}

// ------------------------------------------------------------ attribution --

/** Below this many session points in the week there is too little to split meaningfully. */
const MIN_ATTRIBUTION_POINTS = 10;

function renderAttribution({ usageLog }) {
  const split = attribution(usageLog);
  const section = $("attributionSection");
  section.hidden = split.total < MIN_ATTRIBUTION_POINTS;
  if (section.hidden) return;

  const elsewhere = Math.round(split.share * 100);
  $("attributionHere").style.flexGrow = String(100 - elsewhere);
  $("attributionElsewhere").style.flexGrow = String(elsewhere);
  $("attributionBar").setAttribute("aria-label", `This browser ${100 - elsewhere}%, elsewhere ${elsewhere}%`);
  $("attributionHereLabel").textContent = `This browser · ${100 - elsewhere}%`;
  $("attributionElsewhereLabel").textContent = `Elsewhere · ${elsewhere}%`;
  $("attributionLead").textContent = describeAttribution(split);
}

// ------------------------------------------------------------------ value --

function renderValue({ messageLog, usageLog, settings, latestSnapshot }) {
  const section = $("valueSection");
  // The rate comes from measured messages; with measuring off there is nothing to go on.
  section.hidden = !settings.messageCost;
  if (section.hidden) return;

  const monthlyPrice = monthlyPriceFor(settings, latestSnapshot?.planTier);
  const value = valueForMoney({ messageLog, usageLog, monthlyPrice });
  const { lead, detail } = describeValue(value);
  $("valueNote").textContent = monthlyPrice ? `vs $${monthlyPrice} a month` : "API-equivalent cost";
  $("valueLead").textContent = lead;
  $("valueDetail").textContent = detail;
  section.dataset.verdict = value.ready ? "ready" : "learning";
}

// -------------------------------------------------------------- api spend --

function renderApiSpend({ settings, apiSpend, apiSpendStatus }) {
  const section = $("apiSpendSection");
  section.hidden = !settings.apiSpend;
  if (section.hidden) return;

  const failed = apiSpendStatus && !apiSpendStatus.ok;
  $("apiSpendBody").hidden = !apiSpend;
  $("apiSpendNote").classList.toggle("problem", Boolean(failed));
  $("apiSpendNote").textContent = failed
    ? `${apiSpend ? "Showing the last report. " : ""}${apiSpendStatus.problem.text}`
    : apiSpend
      ? `From the Anthropic Console's cost report · days are UTC · read ${timeAgo(apiSpend.fetchedAt)}`
      : "Add an Admin API key in Options to read the Console's cost report.";
  if (!apiSpend) return;

  const spend = summarizeSpend(apiSpend.days);
  const month = new Date().toLocaleDateString([], { month: "long", timeZone: "UTC" });
  $("apiSpendHeaderNote").textContent = `${month} so far`;
  $("apiSpendTotal").textContent = formatDollars(spend.monthToDate);
  $("apiSpendFigures").replaceChildren(
    ...[
      ["Today", spend.today],
      ["Yesterday", spend.yesterday],
      ["Last 7 days", spend.last7],
      ...(spend.projectedMonth != null ? [["On course for", spend.projectedMonth]] : []),
    ].flatMap(([label, amount]) => [el("dt", {}, label), el("dd", {}, formatDollars(amount))])
  );

  // Thirty days, a bar each, tallest = the dearest day.
  const dearest = Math.max(0.01, ...spend.daily.map((day) => day.total));
  $("apiSpendBars").replaceChildren(
    ...spend.daily.map((day) => {
      const date = new Date(day.day).toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" });
      const bar = el("span", { className: "spend-bar", title: `${date} · ${formatDollars(day.total)}` });
      bar.style.height = `${Math.max(2, (day.total / dearest) * 100)}%`;
      return bar;
    })
  );
  $("apiSpendBars").setAttribute(
    "aria-label",
    `Daily API spend over the last 30 days: ${formatDollars(spend.last30)} in all, ${formatDollars(dearest)} on the dearest day.`
  );

  $("apiSpendLines").replaceChildren(
    ...spend.lines.slice(0, 5).map((line) =>
      el(
        "li",
        {},
        el("span", {}, /^claude-/.test(line.name) ? modelLabel(line.name) : line.name),
        el("span", { className: "project-cost" }, `${formatDollars(line.total)} · ${Math.round((line.total / (spend.monthToDate || 1)) * 100)}%`)
      )
    )
  );
}

// ------------------------------------------------- claude code: projects --

function renderProjects({ settings, claudeCode }) {
  const projects = settings.claudeCode ? (claudeCode?.projects ?? []) : [];
  const section = $("projectSection");
  section.hidden = projects.length === 0;
  if (section.hidden) return;

  const total = claudeCode.week.cost || 1;
  $("projectNote").textContent = `${projects.length} ${projects.length === 1 ? "directory" : "directories"} · last 7 days`;
  $("projectList").replaceChildren(
    ...projects.map((project) => {
      const share = Math.round((project.cost / total) * 100);
      const bar = el("span", { className: "project-bar" });
      bar.style.width = `${Math.max(1, (project.cost / projects[0].cost) * 100)}%`;
      return el(
        "li",
        {},
        el(
          "div",
          { className: "project-head" },
          // The short name is what fits; the full path is one hover away.
          el("span", { className: "project-name", title: project.cwd || "" }, project.name),
          el("span", { className: "project-cost" }, `${formatDollars(project.cost)} · ${share}%`)
        ),
        el("div", { className: "project-track", ariaHidden: "true" }, bar),
        el(
          "p",
          { className: "project-meta" },
          `${plural(project.sessions, "session")} · ${formatTokens(project.tokens)} tokens · last used ${timeAgo(project.lastAt)}` +
            (project.costToday > 0 ? ` · ${formatDollars(project.costToday)} today` : "")
        )
      );
    })
  );
}

// ------------------------------------------------- claude code: sessions --

function renderSessions({ settings, claudeCode }) {
  const sessions = settings.claudeCode ? (claudeCode?.sessions ?? []) : [];
  const section = $("sessionSection");
  section.hidden = sessions.length === 0;
  if (section.hidden) return;

  $("sessionList").replaceChildren(
    ...sessions.map((session) => {
      const length = session.lastAt - session.startedAt;
      return el(
        "li",
        {},
        el(
          "div",
          { className: "project-head" },
          el("span", { className: `project-name${session.title ? "" : " untitled"}` }, session.title ?? "Untitled session"),
          el("span", { className: "project-cost" }, formatDollars(session.cost))
        ),
        el(
          "p",
          { className: "project-meta" },
          `${session.project} · ${modelLabel(session.model)} · ${plural(session.messages, "message")}` +
            (length >= 60_000 ? ` over ${span(length)}` : "") +
            ` · ${timeAgo(session.lastAt)}`
        )
      );
    })
  );
}

// ---------------------------------------------------- claude code: cache --

function renderCache({ settings, claudeCode }) {
  const cache = settings.claudeCode ? claudeCode?.cache?.week : null;
  const section = $("cacheSection");
  section.hidden = !cache || cache.hitRate == null;
  if (section.hidden) return;

  const prompt = cache.read + cache.write + cache.input;
  const hit = Math.round(cache.hitRate * 100);
  $("cacheNote").textContent = `${hit}% from cache · last 7 days`;

  // Three kinds of prompt token, as shares of all of them: served from the cache, written to it, sent plain.
  for (const [id, tokens] of [["cacheReadBar", cache.read], ["cacheWriteBar", cache.write], ["cacheInputBar", cache.input]]) {
    $(id).style.flexGrow = String(tokens / prompt);
  }
  $("cacheBar").setAttribute(
    "aria-label",
    `Prompt tokens: ${formatTokens(cache.read)} read from the cache, ${formatTokens(cache.write)} written to it, ${formatTokens(cache.input)} sent uncached`
  );
  $("cacheLegend").replaceChildren(
    el("span", {}, el("i", { className: "cache-read" }), `Read ${formatTokens(cache.read)}`),
    el("span", {}, el("i", { className: "cache-write" }), `Written ${formatTokens(cache.write)}`),
    el("span", {}, el("i", { className: "cache-input" }), `Uncached ${formatTokens(cache.input)}`)
  );

  $("cacheLead").textContent =
    cache.saved >= 0
      ? `Caching saved about ${formatDollars(cache.saved)} this week: the cached tokens cost ${formatDollars(cache.paid)} ` +
        `where sending them fresh every time would have cost ${formatDollars(cache.uncached)}.`
      : `Caching cost about ${formatDollars(-cache.saved)} more than it saved this week: ${formatDollars(cache.paid)} was spent ` +
        `writing to and reading from the cache, against ${formatDollars(cache.uncached)} to send the same tokens plainly.`;

  const today = claudeCode.cache.today;
  $("cacheDetail").textContent =
    (cache.readsPerWrite != null
      ? `Every token written to the cache was read back ${Math.round(cache.readsPerWrite * 10) / 10} times. `
      : "Nothing was written to the cache. ") +
    (today.hitRate != null ? `Today: ${Math.round(today.hitRate * 100)}% from cache, ${formatDollars(Math.abs(today.saved))} ${today.saved >= 0 ? "saved" : "lost"}.` : "");
}

// --------------------------------------------------------------- lockouts --

function renderLockouts({ limitHits }) {
  const stats = lockoutStats(limitHits);
  const [thisWeek] = stats.weeks;

  $("lockoutLead").textContent =
    stats.total === 0
      ? "No limit has run out in the last four weeks."
      : thisWeek.count === 0
        ? "No lockouts in the last 7 days."
        : `${plural(thisWeek.count, "lockout")} in the last 7 days, blocked for ${span(thisWeek.blockedMs)} in all.`;

  const table = $("lockoutTable");
  table.hidden = stats.total === 0;
  const longest = Math.max(1, ...stats.weeks.map((week) => week.blockedMs));
  $("lockoutRows").replaceChildren(
    ...stats.weeks.map((week) => {
      const bar = el("span", { className: "lockout-bar" });
      bar.style.width = `${Math.round((week.blockedMs / longest) * 100)}%`;
      return el(
        "tr",
        {},
        el("th", { scope: "row" }, dateRange(week.from, week.to)),
        el("td", {}, week.count === 0 ? "–" : `${week.count}×`),
        el("td", {}, week.blockedMs === 0 ? "–" : span(week.blockedMs)),
        el("td", { className: "lockout-bar-cell", ariaHidden: "true" }, bar)
      );
    })
  );

  $("lockoutNote").textContent =
    stats.total === 0
      ? ""
      : `${plural(stats.total, "lockout")} and ${span(stats.blockedMs)} blocked in four weeks` +
        (stats.most ? ` · most often: ${stats.most.label} (${stats.most.count}×)` : "");
}

// --------------------------------------------------------------- plan fit --

function renderPlanFit({ usageLog, limitHits, latestSnapshot, settings }) {
  const fit = planFit({ usageLog, limitHits, planTier: latestSnapshot?.planTier, plan: settings.plan });
  $("planFitNote").textContent = fit.plan ? `on ${fit.plan.label}` : "plan not detected";
  $("planFitLead").textContent = describePlanFit(fit, fit.blockedMs > 0 ? span(fit.blockedMs) : "");
  $("planFitSection").dataset.verdict = fit.verdict;
}

// ------------------------------------------------------------------------

export function renderInsights(state) {
  renderHeatmap(state);
  renderWindowStart(state);
  renderTimeline(state);
  renderSpikes(state);
  renderAttribution(state);
  renderApiSpend(state);
  renderProjects(state);
  renderSessions(state);
  renderCache(state);
  renderLockouts(state);
  renderPlanFit(state);
  renderValue(state);
}
