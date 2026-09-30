// The weekly report page: one week of usage on a single printable sheet.
// All the figures come from buildWeeklyReport() in lib/weekly-report.js; this
// file only lays them out.

import { getAll, onStorageChanged } from "../lib/storage.js";
import { buildWeeklyReport, describeWeek, weeksOnRecord, reportWeek, weekdayName } from "../lib/weekly-report.js";
import { applyTheme, onSystemThemeChange } from "../lib/theme.js";
import { severityOf } from "../lib/severity.js";
import { describeSpike } from "../lib/spikes.js";
import { formatDuration, formatHour, formatMoment } from "../lib/time-format.js";
import { valueForMoney, monthlyPriceFor, formatDollars } from "../lib/value.js";

const $ = (id) => document.getElementById(id);
const weekSelect = $("weekSelect");

let weeksAgo = Number(new URLSearchParams(location.search).get("week")) || 0;
let latestSettings = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const dateOf = (epochMs, options = { day: "numeric", month: "short" }) =>
  new Date(epochMs).toLocaleDateString([], options);

/** "24 Sep – 30 Sep 2026"; `to` is exclusive. */
function rangeLabel({ from, to }) {
  return `${dateOf(from)} – ${dateOf(to - 1, { day: "numeric", month: "short", year: "numeric" })}`;
}

const span = (ms) => (ms < 60_000 ? "under a minute" : formatDuration(0, ms));

/** "+12% on the week before", or null when there is nothing to compare with. */
function versus(now, before, unit = "%") {
  if (now == null || before == null) return null;
  const diff = Math.round(now - before);
  if (diff === 0) return "same as the week before";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}${unit} on the week before`;
}

function stat(label, value, note) {
  const group = el("div", { className: "stat" }, el("dt", {}, label), el("dd", { className: "stat-value" }, value));
  if (note) group.append(el("dd", { className: "stat-note" }, note));
  return group;
}

function renderStats(report, state) {
  const { previous, lockouts } = report;
  const tiles = [
    stat(
      "Session peak",
      report.sessionPeak != null ? `${report.sessionPeak}%` : "–",
      versus(report.sessionPeak, previous.sessionPeak)
    ),
    stat(
      "Average session",
      report.averageWindowPeak != null ? `${report.averageWindowPeak}%` : "–",
      report.windows > 0
        ? `peak of ${report.windows} session${report.windows === 1 ? "" : "s"}` +
            (report.fullWindows > 0 ? ` · ${report.fullWindows} reached 100%` : "")
        : "no sessions on record"
    ),
    stat(
      "Used per day",
      report.averagePerDay != null ? `${Math.round(report.averagePerDay)}%` : "–",
      report.averagePerDay != null
        ? `of a session, over ${report.daysObserved} day${report.daysObserved === 1 ? "" : "s"} on record`
        : null
    ),
    stat(
      "Lockouts",
      String(lockouts.count),
      lockouts.count > 0
        ? `blocked for ${span(lockouts.blockedMs)}`
        : previous.lockouts.count > 0
          ? `down from ${previous.lockouts.count} the week before`
          : "nothing ran out"
    ),
    stat(
      "Fastest-burning day",
      report.fastestDay ? weekdayName(report.fastestDay.dayStart) : "–",
      report.fastestDay ? `${Math.round(report.fastestDay.burn)}% of a session · ${dateOf(report.fastestDay.dayStart)}` : null
    ),
    stat(
      "Busiest hour",
      report.busiestHour != null ? formatHour(report.busiestHour) : "–",
      report.busiestHour != null ? "the hour of day with the most use" : null
    ),
  ];

  if (report.elsewhereShare != null) {
    tiles.push(
      stat("Used elsewhere", `${Math.round(report.elsewhereShare * 100)}%`, "other devices, the apps, Claude Code")
    );
  }

  // The API-equivalent figure for just these seven days, at the rate the measured messages give.
  const value = valueForMoney({
    messageLog: state.settings.messageCost ? state.messageLog : [],
    usageLog: state.usageLog,
    monthlyPrice: monthlyPriceFor(state.settings, state.latestSnapshot?.planTier),
  });
  if (value.ready && report.burn > 0) {
    tiles.push(stat("API-equivalent cost", formatDollars(report.burn * value.perPoint), "at API list prices, estimated"));
  }

  $("stats").replaceChildren(...tiles);
}

function renderDays(report, settings) {
  const most = Math.max(1, ...report.days.map((day) => day.burn));
  $("days").replaceChildren(
    ...report.days.map((day) => {
      const fastest = report.fastestDay?.dayStart === day.dayStart;
      const future = day.dayStart > Date.now();
      const bar = el("span", { className: `day-bar ${severityOf(day.peak ?? 0, settings)}` });
      bar.style.width = `${(day.burn / most) * 100}%`;

      const figure = future
        ? "–"
        : `${Math.round(day.burn)}%` + (day.peak != null ? ` · peak ${day.peak}%` : "") + (fastest ? " · fastest" : "");
      const item = el(
        "li",
        { className: fastest ? "fastest" : "" },
        el("span", { className: "day-name" }, dateOf(day.dayStart, { weekday: "short", day: "numeric" })),
        el("span", { className: "day-track", ariaHidden: "true" }, bar),
        el("span", { className: "day-figure" }, figure)
      );
      return item;
    })
  );
}

function renderLimits(report, settings) {
  $("limitsSection").hidden = report.weekly.length === 0;
  $("limits").replaceChildren(
    ...report.weekly.map(({ label, peak, end }) => {
      const before = report.previous.weekly.find((w) => w.label === label)?.peak;
      const fill = el("span", { className: `limit-fill ${severityOf(peak, settings)}` });
      fill.style.width = `${peak}%`;
      return el(
        "li",
        {},
        el("span", { className: "limit-name" }, label),
        el("span", { className: "limit-track", ariaHidden: "true" }, fill),
        el(
          "span",
          { className: "limit-figure" },
          `peaked at ${peak}%` +
            // Lower at the end than at its peak: the limit reset during the week.
            (end !== peak ? `, ${report.weeksAgo === 0 ? "now" : "ended at"} ${end}%` : "") +
            (before != null ? ` · ${before}% the week before` : "")
        )
      );
    })
  );
}

function renderEvents(report) {
  const events = [
    ...report.notes.map((note) => ({ at: note.at, kind: "Note", text: note.text })),
    ...report.spikes.map((spike) => ({ at: spike.at, kind: "Spike", text: `${spike.label} ${describeSpike(spike)}` })),
  ].sort((a, b) => a.at - b.at);

  $("eventsSection").hidden = events.length === 0;
  $("events").replaceChildren(
    ...events.map((event) =>
      el(
        "li",
        {},
        el("time", { dateTime: new Date(event.at).toISOString() }, formatMoment(event.at)),
        el("span", { className: `event-kind ${event.kind.toLowerCase()}` }, event.kind),
        el("span", {}, event.text)
      )
    )
  );
}

function renderWeekSelect(usageLog) {
  const oldest = Math.max(weeksAgo, weeksOnRecord(usageLog));
  weekSelect.replaceChildren(
    ...Array.from({ length: oldest + 1 }, (_, index) => {
      const name = index === 0 ? "This week" : index === 1 ? "Last week" : `${index} weeks ago`;
      return new Option(`${name} · ${rangeLabel(reportWeek(Date.now(), index))}`, String(index));
    })
  );
  weekSelect.value = String(weeksAgo);
}

async function render() {
  const state = await getAll();
  latestSettings = state.settings;
  applyTheme(state.settings);
  document.documentElement.dataset.privacy = state.settings.privacyMode ? "on" : "off";
  $("privacyNote").hidden = !state.settings.privacyMode;
  $("demoBadge").hidden = !state.settings.demoMode;

  const report = buildWeeklyReport(state, { weeksAgo });
  renderWeekSelect(state.usageLog);
  $("range").textContent = rangeLabel(report);
  document.title = `ClaudeMeter — Weekly report, ${rangeLabel(report)}`;
  $("summary").textContent = describeWeek(report);

  renderStats(report, state);
  renderDays(report, state.settings);
  renderLimits(report, state.settings);
  renderEvents(report);

  $("footnote").textContent =
    `Built from what this browser saw: ${report.daysObserved} of 7 days on record. ` +
    "Usage is in session %-points — a day can pass 100 because it spans several 5-hour sessions.";
}

weekSelect.addEventListener("change", () => {
  weeksAgo = Number(weekSelect.value);
  // Keep the address shareable with yourself: reloading shows the same week.
  history.replaceState(null, "", weeksAgo > 0 ? `?week=${weeksAgo}` : location.pathname);
  render();
});

$("printBtn").addEventListener("click", () => window.print());

onStorageChanged((changes) => {
  const watched = ["latestSnapshot", "settings", "limitHits", "annotations", "spikes", "demoState"];
  if (watched.some((key) => key in changes)) render();
});

onSystemThemeChange(() => {
  if (latestSettings) applyTheme(latestSettings);
});

render();
