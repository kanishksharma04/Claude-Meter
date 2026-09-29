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
- **Gauge toolbar icon** — the icon itself is redrawn as a ring that fills with your
  session and changes colour as it gets close, with the number in the middle on
  high-density displays. Hovering it gives the exact figures for every limit. Badge
  text ("42%"), both, or the plain icon are one setting away
- **Your own warning levels** — choose the percentages at which meters turn amber and
  red (80 / 95 by default) and, if you like, the three colours. One setting drives
  the toolbar icon, the popup bars, and the pill and favicon on claude.ai
- **Arrange your limits** — the pencil in the popup footer turns on arrange mode:
  move any bucket up or down, **pin** the ones you care about to the top block, and
  **hide** the ones you don't. It works by keyboard, is remembered, and applies to the
  side panel too
- **Mini window** — pop the meters out into a small window of their own that stays
  open while you work in other apps. It shows just your pinned limits, puts the
  session % in its title (so it reads in the task switcher), sizes itself to fit, and
  remembers where you put it
- **Themes and accents** — light, dark, or a **high-contrast** theme (pure black and
  white, every text pair at 7:1 or better, outlined meters), plus six accent colours:
  Clay, Ocean, Forest, Violet, Rose, Slate. "Auto" follows the system's light/dark
  and "more contrast" preferences live. The UI drawn on claude.ai follows along
- **Welcome page on first install** — checks that this browser is signed in to
  claude.ai (and re-checks when you come back from signing in), explains every
  permission in plain words straight from the manifest, and lets you pick your alerts
  and fire a test notification. Reopen it any time from Options
- **Side panel dashboard** — the same view as a persistent panel that stays open beside
  whatever you're browsing, with a **usage-over-time chart** (one line per limit) drawn
  from the stored history. Open it from the popup's footer, from Chrome's own side
  panel menu, or make the toolbar icon open it directly

Data auto-refreshes in the background on a configurable interval and every time you
open the popup, so the numbers stay current without you doing anything.

### On claude.ai itself

A content script also draws a small ClaudeMeter layer on top of claude.ai, so the
numbers are in front of you while you type:

- **Inline usage pill** — session % and your highest weekly % float just above the
  composer, colour-coded like the popup bars. Click it for every bucket and its reset
  time; no toolbar click needed.
- **Tab title / favicon %** — the claude.ai tab itself carries your session %, as a
  `[42%]` title prefix, a drawn favicon with a colour-coded meter, or both — readable
  from any other tab without switching.
- **Pre-send warning** — while there's a draft in the composer and any limit is past
  a threshold you choose (default 80%), a slim banner says so and when it resets.
  Dismiss it once and it stays away until that limit's window rolls over.
- **Per-message cost** — ClaudeMeter reads your usage right before a message goes out
  and again when the reply finishes streaming, then shows the difference next to the
  pill ("Last message: 3% of session"). The popup shows the most recent one too.
- **Per-conversation totals** — those per-message costs are summed per chat. The pill
  panel shows the running total for the chat you're in, and the popup ranks your
  **most expensive chats** with a link back to each.
- **Model-switch hint** — if a model-specific weekly limit (e.g. Opus) is your
  fastest-filling one and past a threshold (default 50%), and that's the model you
  have selected, a banner suggests Sonnet or Haiku, which count against the larger
  all-models limit. It shows the measured pace ("+4%/hr, about 5 hr left").
- **Attachment weight warning** — files you pick, drop, or paste into the composer
  (and long text pastes) are sized up before you send. Past a threshold (default ~25k
  tokens) a banner tells you how heavy the draft is and which file is the largest. The
  same check runs on a project's knowledge files when you're in that project.
- **Limit-hit detector** — when claude.ai refuses a message (HTTP 429) or marks a
  reply as the one that used up your allowance, ClaudeMeter logs it: when, which limit,
  when it resets, and how many messages you sent into the lockout. The popup and the
  pill panel show "Limit reached 3× in the last 7 days".
- **Lockout countdown overlay** — while a limit is exhausted (a logged limit hit, or a
  bucket at 100%), a card above the composer says "Limit reached — back at 4:30 PM"
  with a timer that ticks every second. Minimise it to a small "Back at 4:30 PM" chip;
  when the window rolls over it refreshes your usage and disappears.
- **Long-context nudge** — every message re-sends the whole thread, so long chats burn
  faster. ClaudeMeter estimates the active thread's size when a chat loads and after
  each reply; past a threshold (default ~40k tokens) it suggests a new chat. The
  estimate is always visible in the pill panel.

The UI is rendered inside a shadow root, so claude.ai's own DOM and styles are left
alone — the one exception is the tab indicator, which has to edit the page's `<title>`
and icon `<link>`s and restores them when switched off. Each piece can be turned off
in Options.

## Accessibility

- Every meter is a real `progressbar` with a name, a spoken value ("86% used") and
  its reset time as the description — in the popup, the side panel, the mini window
  and the panel on claude.ai.
- The popup has a proper heading outline, and a polite live region announces what a
  sighted user would simply see: a manual refresh finishing or failing, and each
  move, pin or hide in arrange mode. Refresh failures are also an `alert`.
- Everything is reachable and operable from the keyboard, with one visible focus ring
  in every theme. Focus is kept through re-renders: arrange-mode buttons keep it after
  each move, the pill's panel takes it on open and returns it on Escape, and a
  background refresh no longer drops it.
- The banner stack on claude.ai is a live region, so it is only rebuilt when its
  content actually changes — a refresh doesn't make a screen reader repeat it.
- `prefers-reduced-motion` turns off the spinner, the loading shimmer and bar
  transitions; the high-contrast theme follows `prefers-contrast` on its own.

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
- **Plain HTML/CSS** — hand-written; the theme tokens live once in
  `src/shared/theme.css` as CSS custom properties, and `src/lib/theme.js` picks the
  theme and accent for every page
- **`chrome.storage.local`** — the only persistence layer; schema in `src/lib/storage.js`
- **`chrome.alarms`** — periodic background refresh, independent of any open tab
- **`chrome.notifications`** — optional desktop alerts on usage-threshold crossings
- **`chrome.action`** — toolbar popup, hover title, badge text, and the gauge icon,
  which the service worker draws on an `OffscreenCanvas` and hands to `setIcon()`
- **`chrome.sidePanel`** — the dashboard; it is the popup page loaded as
  `popup.html?view=panel`, so both surfaces share one renderer
- **`chrome.windows`** — the mini window is the same page again (`?view=mini`) in a
  `popup`-type window; its id is kept in `storage.session`, its bounds in `storage.local`
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
│   │   ├── inject-hook.js             # MAIN world: patches fetch/XHR, dispatches captures + chat events
│   │   ├── relay.js                   # ISOLATED world: forwards both to the background worker
│   │   └── page-ui.js                 # ISOLATED world: in-page UI (pill, banners, lockout timer) in a shadow root
│   ├── popup/                         # toolbar popup, ?view=panel side panel dashboard, ?view=mini window
│   ├── options/                       # refresh interval, notifications, theme, developer mode
│   ├── onboarding/                    # first-run welcome page: sign-in check, permissions, alerts
│   ├── debug/                         # debug.html — raw capture viewer (developer mode only)
│   ├── lib/
│   │   ├── storage.js                 # chrome.storage.local schema + helpers
│   │   ├── time-format.js             # relative-time / duration formatting helpers
│   │   ├── message-cost.js            # before/after usage delta for one message
│   │   ├── conversation-costs.js      # per-chat totals + ranking, derived from the message log
│   │   ├── burn-rate.js               # weekly %/hr from history + the model-switch hint
│   │   ├── limit-hits.js              # "limit reached" log: dedupe per lockout + summary
│   │   ├── history-chart.js           # snapshot history -> line-chart series + SVG paths
│   │   ├── gauge-icon.js              # draws the ring-gauge toolbar icon onto any 2D canvas
│   │   ├── severity.js                # amber/red cut-offs + colours shared by every meter
│   │   ├── bucket-prefs.js            # popup bucket order / pinned / hidden + the moves between them
│   │   ├── theme.js                   # resolves auto/light/dark/contrast + accent presets
│   │   ├── usage-api.js               # org discovery + usage fetch + typed errors
│   │   └── normalize-usage.js         # raw usage response -> UsageSnapshot
│   ├── shared/theme.css               # theme tokens for every extension page
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
5. A welcome tab opens on first install and tells you whether it can read your usage.
   After that, click the ClaudeMeter toolbar icon — it fetches in the background as
   soon as it loads.

The side panel needs **Chromium 116+**; on older builds the extension still works and
simply doesn't offer it.

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
(last 500 snapshots) that feeds the dashboard chart and the burn-rate maths. Settings
live under `settings` (`refreshIntervalMinutes`, `notificationsEnabled`,
`notifyThresholds`, `theme`, `accent`, `iconStyle`, `warnAt`, `dangerAt`, `severityColors`,
`bucketPrefs`, `actionOpens`, `developerMode`, `inlinePill`, `tabIndicator`, `preSendWarnPercent`, `modelHintPercent`,
`longContextTokens`, `attachmentWarnTokens`, `lockoutOverlay`, `messageCost`). The current model-switch hint, if any, is kept
under `modelHint`. Per-message costs
are appended to `messageLog` (last 300), and the mini window's last position and size
are kept under `miniWindowBounds`:

```js
MessageCost = {
  id: string,                  // request id assigned by the page hook
  at: number,                  // epoch ms the reply finished
  conversationId: string | null,
  title: string | null,        // chat name from the tab title when the reply finished
  model: string | null,        // as sent in the completion request, when readable
  session: number | null,      // session % points this message used; null if the window reset mid-reply
  weekly: Array<{ label: string, delta: number }>,
  durationMs: number | null,
  shared: boolean,             // another reply was streaming at the same time
}
```

"Limit reached" events go to `limitHits` (last 100), one entry per lockout:

```js
LimitHit = {
  at: number,                  // epoch ms of the first refused/flagged message
  lastAt: number,              // ...and of the most recent one in the same lockout
  attempts: number,            // messages sent into this lockout
  source: "rejected" | "reply",// HTTP 429, or the reply stream's message_limit event
  claim: string | null,        // claude.ai's name for the limit, e.g. "five_hour"
  resetsAt: number | null,     // from the response, else from the usage snapshot
  conversationId: string | null,
  model: string | null,
}
```

Per-conversation totals aren't stored — `src/lib/conversation-costs.js` derives them
from `messageLog` on demand, so they only cover the messages still in that log.
 Raw request/response captures (`__debug_captures`, last 20) are only
written when Developer mode is on, from Options.

## Refresh behavior

- **Background alarm**: fetches on the interval set in Options (default 5 min),
  regardless of whether a claude.ai tab is open.
- **Popup open**: triggers a silent background refresh every time you open the popup,
  so numbers are current without a manual click.
- **Manual refresh**: the refresh icon in the popup header.
- **Passive capture**: if claude.ai's own UI makes the exact usage request while a
  claude.ai tab is open, that response is captured and applied immediately too.
- **Around each message** (when per-message cost is on): once as you send — skipped if
  the last reading is under 20 seconds old — and once ~1.5 s after the reply ends.
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
- The mini window is an ordinary window: Chrome gives extensions no way to keep one
  always on top, so it can be covered by other windows.
- Hiding a bucket only removes it from the popup and side panel. The toolbar icon
  still tracks the session, and the pill on claude.ai still shows your fullest weekly
  limit even if that bucket is hidden.
- Per-message cost is an estimate. The endpoint reports whole percentages, so a small
  message reads as "under 1%", and anything else using your plan in the same seconds
  (another tab, Claude Code, another device) is counted in the same delta. Only
  messages sent through `fetch` in a tab with the extension loaded are measured.
- Limit hits are recognised by the `exceeded_limit` marker claude.ai currently puts in
  its 429 body and in the reply stream. A bare 429 with no readable body is still
  logged, with the reset time borrowed from the usage snapshot. Hits that happen in
  another browser, the desktop/mobile apps, or Claude Code aren't seen.
- The model-switch hint needs about ten minutes of history to measure a pace; before
  that it falls back to "fullest weekly limit". It only appears when ClaudeMeter can
  tell which model you're on (from the model picker or the last message sent).
- Attachment weight is a rough guess made from file size and type alone (text ≈ 4
  bytes per token, images ≈ 1.5k tokens each, PDFs and other documents ≈ 20 bytes per
  token) — the files are never read. ClaudeMeter can't see you remove an attachment,
  so the warning can linger until you dismiss it or send. Project knowledge is only
  measured when claude.ai loads the project's file list in that tab.
- Thread length is a character count divided by four, not a real token count. It
  covers message text and pasted/extracted attachments on the active branch; images,
  PDFs, project knowledge, and tool results aren't counted, so treat it as a floor.
- The usage-over-time chart only reaches back as far as the stored history: 500
  readings, which is about a day at the default interval and less if per-message cost
  is adding two readings per message. There is no long-term archive or export.

## Options

- **Refresh interval** — 1–30 minutes, default 5.
- **Notifications** — desktop notification when session or weekly usage crosses 80%
  and/or 95% (configurable), only fires on the transition, not on every fetch above
  threshold.
- **Usage pill next to the composer** — show/hide the in-page pill on claude.ai.
- **Usage in the tab** — Off, title prefix (default), favicon, or both.
- **Warn before sending** — Off, or 50 / 70 / 80 / 90 / 95%; the usage level at which
  the banner above the composer appears while you type.
- **Model-switch hint** — Off, or 30 / 50 / 70 / 90%.
- **Long-chat nudge** — Off, or ~20k / 40k / 80k / 120k tokens.
- **Attachment weight warning** — Off, or ~10k / 25k / 50k / 100k estimated tokens.
- **Lockout countdown** — show/hide the "back at …" timer while a limit is exhausted.
- **Measure what each message costs** — on by default; turning it off also stops the
  two extra usage reads around each message.
- **Icon shows** — gauge ring (default), badge text, both, or nothing.
- **Warning levels** — the % at which meters turn amber and red, and optional custom
  colours for normal / amber / red. These are separate from the notification
  thresholds above.
- **Clicking the icon opens** — the popup (default) or the side panel.
- **Theme** — Auto (follows the system's `prefers-color-scheme` and
  `prefers-contrast`), Light, Dark, or High contrast.
- **Accent colour** — one of six presets. High contrast uses its own accent so a
  softer preset can't undo the contrast.
- **Developer mode** — keeps raw request/response captures for the debug page
  (`src/debug/debug.html`), off by default.
- **Clear stored data** — wipes snapshot, history, message costs, the limit-hit log,
  org cache, and debug captures.

## Author

Built by [**kanishksharma04**](https://github.com/kanishksharma04).
