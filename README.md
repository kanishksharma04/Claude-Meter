<p align="center">
  <img src="src/icons/icon128.png" alt="ClaudeMeter logo" width="96" height="96" />
</p>

<h1 align="center">ClaudeMeter</h1>

<p align="center">
  A Manifest V3 browser extension that shows your claude.ai Pro/Max plan usage —
  current session %, weekly %, and reset countdowns — right from the toolbar,
  without ever opening claude.ai's own account menu.
</p>

---

## What this is

ClaudeMeter is a small, self-contained Chrome/Edge/Brave extension. Click the toolbar
icon and you immediately see:

- **Current session usage** — percent used, a progress bar, and "resets in X hr Y min"
- **Weekly limits** — one bar per bucket claude.ai actually returns (e.g. "All models",
  and "Opus" separately if your plan has a model-specific weekly cap), each with its
  own reset countdown
- **Plan badge** — shown only when a real plan name (Free/Pro/Max/Team/Enterprise) can
  be confidently detected, hidden otherwise rather than guessing
- **Manual refresh**, a spinning-icon in-flight state, and a "Last updated: X ago"
  label that keeps itself current
- Empty/loading/error states that never wipe out the last good reading — a failed
  refresh shows an inline warning, not a blank popup

Data auto-refreshes in the background on a configurable interval and every time you
open the popup, so the numbers stay current without you doing anything.

## How it works (and its limits)

There's no documented, public API for this data — claude.ai's own frontend calls an
internal endpoint to render its account usage panel, and this extension calls that
same endpoint directly:

- `GET https://claude.ai/api/organizations` — lists your orgs; the one with a
  `"chat"` capability is picked and its `uuid` cached.
- `GET https://claude.ai/api/organizations/{org_id}/usage` — returns usage buckets,
  e.g. `five_hour` (current session) and `seven_day` / `seven_day_opus` (weekly, per
  model group where applicable).

These calls are made directly from the background service worker with
`fetch(url, { credentials: "include" })`. **No credentials are ever read, stored, or
forged by the extension** — `credentials: "include"` just tells the browser to attach
whatever cookies it already holds for `claude.ai`, exactly as it would for a normal
page request from an open tab. This requires the `https://claude.ai/*` host
permission, which is the only host permission this extension requests.

If you're not logged into claude.ai in this browser, fetches fail with
`NOT_LOGGED_IN` and the popup shows an error state — the extension cannot "log in" or
otherwise obtain a session on its own.

As a secondary, zero-cost data source, a content script also passively observes any
matching usage request claude.ai's own UI happens to make (e.g. if you open the
account usage panel yourself) and reuses that response immediately, without waiting
for the next scheduled fetch. See `src/content/inject-hook.js`.

Nothing is ever sent to any third-party server — everything stays in
`chrome.storage.local` on your machine.

## Tech stack

- **Manifest V3** — targets Chrome, Edge, and Brave (any Chromium-based browser)
- **Vanilla JavaScript (ES modules)** — no framework, no bundler, no build step;
  `src/**/*.js` is loaded and run as-is
- **Plain HTML/CSS** — hand-written, using CSS custom properties for a single
  light/dark/auto theme system shared across the popup, options, and debug pages
- **`chrome.storage.local`** — the only persistence layer; schema in `src/lib/storage.js`
- **`chrome.alarms`** — periodic background refresh, independent of any open tab
- **`chrome.notifications`** — optional desktop alerts on usage-threshold crossings
- **`chrome.action`** — toolbar icon, popup, and color-coded usage badge text
- Content scripts split across the **MAIN** and **isolated** JS worlds (see
  `src/content/inject-hook.js` and `src/content/relay.js`) to safely observe the
  page's own network calls without touching page state
- No external runtime dependencies of any kind — nothing "phones home"

## Project structure

```
claudemeter/
├── manifest.json
├── src/
│   ├── background/service-worker.js   # active fetch on alarm/request, badge, notifications
│   ├── content/
│   │   ├── inject-hook.js             # MAIN world: patches fetch/XHR, dispatches captures
│   │   └── relay.js                   # ISOLATED world: forwards captures to the background worker
│   ├── popup/                         # toolbar popup — session/weekly bars, refresh, states
│   ├── options/                       # refresh interval, notifications, theme, developer mode
│   ├── debug/                         # debug.html — raw capture viewer (developer mode only)
│   ├── lib/
│   │   ├── storage.js                 # chrome.storage.local schema + helpers
│   │   ├── time-format.js             # relative-time / duration formatting helpers
│   │   ├── usage-api.js               # org discovery + usage fetch + typed errors
│   │   └── normalize-usage.js         # raw usage response -> UsageSnapshot
│   └── icons/                         # toolbar/store icon set (16/32/48/128)
└── README.md
```

## Load it locally (Chrome / Edge / Brave)

Requires a **Chromium 111+** based browser — the content script uses the
`"world": "MAIN"` key in `manifest.json` (needed so the hook patches the page's *real*
`fetch`/`XMLHttpRequest` rather than an isolated copy the page never calls).

1. Open `chrome://extensions` (`brave://extensions` on Brave, `edge://extensions` on Edge).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `claudemeter/` folder.
4. Make sure you're logged into `claude.ai` in that same browser.
5. Click the ClaudeMeter toolbar icon. On first load it kicks off a background fetch
   automatically — give it a second, then click the refresh icon if it's still empty.

## Data model

```js
UsageSnapshot = {
  fetchedAt: number,           // epoch ms
  planTier: string | null,     // rarely detectable from this endpoint — null is common
  session: {                   // "five_hour" bucket, or null if unparseable
    label: string,
    percentUsed: number,
    resetsAt: number | null,
    resetsInLabel: string,
  } | null,
  weekly: Array<{               // one entry per "seven_day*" bucket found
    label: string,              // "All models", "Opus", etc. — derived from the key name
    percentUsed: number,
    resetsAt: number | null,
    resetsInLabel: string,
  }>,
}
```

Stored in `chrome.storage.local` as `latestSnapshot`, plus a capped rolling `history`
(last 50 snapshots) for potential future charting. Settings live under `settings`
(`refreshIntervalMinutes`, `notificationsEnabled`, `notifyThresholds`, `theme`,
`developerMode`). Raw request/response captures (`__debug_captures`, last 20) are only
written when Developer mode is on, from Options.

## Refresh behavior

- **Background alarm**: fetches on the interval set in Options (default 5 min),
  regardless of whether a claude.ai tab is open.
- **Popup open**: triggers a silent background refresh every time you open the popup,
  so numbers are current without a manual click.
- **Manual refresh**: the refresh icon in the popup header.
- **Passive capture**: if claude.ai's own UI makes the exact usage request while a
  claude.ai tab is open, that response is captured and applied immediately too.
- Failed refreshes never wipe the UI — the popup keeps showing the last known-good
  snapshot with an inline "Couldn't refresh — showing data from X ago" warning.

## Known limitations

- The usage endpoint is undocumented and reverse-engineered (consistent with what
  other open-source claude.ai usage extensions use, e.g.
  [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension),
  [sshnox/Claude-Usage-Tracker](https://github.com/sshnox/Claude-Usage-Tracker)) — it
  can change shape, move, or disappear without notice, at which point normalization
  will silently degrade to partial data rather than crash (see
  `src/lib/normalize-usage.js`), but the popup may show stale or missing numbers until
  the endpoint/parser is updated.
- Plan tier badge (Free/Pro/Max 5x/Max 20x/Team/Enterprise) is rarely populated — the
  usage endpoint itself doesn't return it, and the org-list endpoint's plan field name
  isn't confirmed, so the badge is best-effort and often simply hidden.
- Requires being logged into claude.ai in the same browser profile the extension runs
  in; it cannot establish a session on its own.
- No sparkline/usage-over-time chart yet, though the rolling `history` array needed
  for one is already being collected.

## Options

- **Refresh interval** — 1–30 minutes, default 5.
- **Notifications** — desktop notification when session or weekly usage crosses 80%
  and/or 95% (configurable), only fires on the transition, not on every fetch above
  threshold.
- **Theme** — Auto (follows `prefers-color-scheme`), Light, or Dark.
- **Developer mode** — keeps raw request/response captures for the debug page
  (`src/debug/debug.html`), off by default.
- **Clear stored data** — wipes snapshot, history, org cache, and debug captures.

## Author

Built by [**kanishksharma04**](https://github.com/kanishksharma04).
