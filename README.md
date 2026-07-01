# ClaudeMeter

A Manifest V3 browser extension that shows your claude.ai Pro/Max plan usage (session
%, weekly %, reset countdowns) from the toolbar, without opening claude.ai's own
account menu.

**Status: Phase 2 complete.** The extension fetches real usage data from claude.ai's
own (undocumented) usage endpoint and renders it in the popup, with background
auto-refresh, notifications, and a full options page.

## How it works (and its limits)

- There's no documented consumer usage API. This extension calls the same endpoints
  claude.ai's own frontend uses to render its account usage panel:
  - `GET https://claude.ai/api/organizations` — lists your orgs; the one with a
    `"chat"` capability is picked and its `uuid` cached.
  - `GET https://claude.ai/api/organizations/{org_id}/usage` — returns usage buckets,
    e.g. `five_hour` (current session) and `seven_day` / `seven_day_opus` (weekly, per
    model group where applicable).
- These calls are made directly from the background service worker with
  `fetch(url, { credentials: "include" })`. **No credentials are ever read, stored, or
  forged by the extension** — `credentials: "include"` just tells the browser to
  attach whatever cookies it already holds for `claude.ai`, exactly as it would for a
  normal page request from an open tab. This requires the `https://claude.ai/*` host
  permission, which is the only host permission this extension requests.
- If you're not logged into claude.ai in this browser, fetches fail with
  `NOT_LOGGED_IN` and the popup shows an error state — the extension cannot "log in"
  or otherwise obtain a session on its own.
- As a secondary, zero-cost data source, a content script also passively observes any
  matching usage request claude.ai's own UI happens to make (e.g. if you open the
  account usage panel yourself) and reuses that response immediately, without waiting
  for the next scheduled fetch. This uses the same `"world": "MAIN"` content-script
  trick as before — see `src/content/inject-hook.js`.
- Nothing is sent to any third-party server. All data stays in `chrome.storage.local`.
- This endpoint isn't documented or versioned and can change or disappear without
  notice — see Known limitations below.

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
│   └── icons/                         # placeholder icons — swap in real art later
└── README.md
```

## Load it locally (Chrome / Edge)

Requires **Chrome/Edge 111+** — the content script uses the `"world": "MAIN"` key in
`manifest.json` (needed so the hook patches the page's *real* `fetch`/`XMLHttpRequest`
rather than an isolated copy that the page never calls).

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `claudemeter/` folder.
4. Make sure you're logged into `claude.ai` in this browser.
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
