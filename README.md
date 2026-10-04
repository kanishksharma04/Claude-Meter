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
- **`cm` in the address bar** — type `cm`, then a space: the dropdown shows every
  limit and its reset time without opening anything. Enter opens the dashboard;
  `cm refresh`, `cm report`, `cm health`, `cm open` (claude.ai) and `cm options` do what they say
- **Right-click the icon** — Refresh now, **Snooze alerts** (1 hour, 4 hours, until
  tomorrow morning, or resume), Open history, Open side panel, Open mini window, Health check.
  A snooze pauses desktop notifications *and* the nudge banners on claude.ai, shows
  in the popup and Options with a Resume button, and ends by itself
- **Keyboard shortcuts** — `Alt+Shift+U` opens ClaudeMeter, `Alt+Shift+R` refreshes,
  `Alt+Shift+S` snoozes alerts for an hour (press again to resume), `Alt+Shift+P`
  toggles privacy mode. They work from any tab; the toolbar badge flashes a short
  confirmation (✓, `zz`, `on`, `hide`, `show`). Options lists the keys
  Chrome actually bound and links to where you can change them
- **Privacy mode** — one switch for screen sharing. Every figure in the popup, side
  panel and mini window is blurred (chat titles too) and the bars stop encoding the
  value; the toolbar icon becomes an empty ring with no badge or hover figures; on
  claude.ai the pill reads "Usage hidden", banner text is blurred and the tab title
  and favicon go back to normal; notifications and the `cm` dropdown carry no numbers.
  Flip it from the eye in the popup, `Alt+Shift+P`, the icon's right-click menu,
  `cm privacy`, or Options
- **Share card** — the share button in the footer copies a usage summary as plain
  text (one line per limit, dated) or as a PNG card drawn in your current theme,
  accent and warning colours, or saves that PNG. The same menu exports the reset
  calendar. It contains only the limits you
  haven't hidden, in your order — never anything about individual chats
- **Demo mode** — made-up but coherent usage on every surface (popup, side panel,
  mini window, toolbar icon, the pill on claude.ai, the `cm` dropdown, the share
  card): a session at 62%, two weekly limits, a 12-hour history, a few chats and two
  past limit hits. It's for trying ClaudeMeter before signing in — the welcome page
  offers it when you aren't — and for screenshots (the "Demo" badge can be switched
  off). Nothing is fetched while it's on and your real readings are left as they were
- **Extra-usage spend** — if your account has extra usage (pay-as-you-go past the
  plan's limits) switched on, the popup gets a row for it: what you've spent this
  month against your cap, as a bar in your warning colours, with what today added —
  "$12.40 of $50.00 · 25% of this month's cap · $2.10 today". It joins the toolbar
  icon's hover text and the usage alerts (80% / 95% of the cap). Accounts without the
  feature see nothing
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

### Analytics

The side panel dashboard also keeps a longer memory than the popup needs — one small
record per hour, eight weeks deep — and builds its analytics from that:

- **Weekday and hour heatmap** — a 7 × 24 grid of how much of a session you typically
  use in each hour of the week, averaged over every such weekday on record, with the
  busiest slots named underneath. Hover a cell for its figure.
- **Weekly budget planner** — under each weekly limit, in the popup too: "Budget: 12% a
  day until reset · 9% used today". The daily figure is what was left at the start of
  today divided by the days until the reset, so it holds still while you work and only
  re-plans at midnight; go past it and the line turns amber and says by how much.
- **Time-of-day-aware forecast** — next to every reset time: "on course for 84%", or
  "full around Thu 3:10 PM" in red when the limit would run out first. Instead of
  extending the current pace in a straight line — which at 3 PM on a working day
  assumes you'll keep going all night and all weekend — it adds up what you
  *typically* use in each coming hour of the week, and scales the rest of today by
  how today compares with a usual one. Hover it for the reasoning.
- **Window-start optimiser** — the 5-hour session opens with your first message and
  resets five hours later, so *when* you send it decides where the reset falls. The
  dashboard works out the start that puts a reset inside your busiest stretch, so no
  one window has to carry it all: "Send your first message around 7:00 AM — any short
  one will do. Your session then resets at 12:00 PM…", with the resulting windows and
  how full each would get. It plans for today until that time has passed, then for
  tomorrow, and says so when your usual start is already fine.
- **Lockout statistics** — how many times a limit ran out and how long that left you
  blocked, for each of the last four weeks, plus which limit it usually is. Blocked
  time runs from when the lockout was first seen to its reset; two limits exhausted at
  once count once. A limit that a refresh finds at 100% is now logged as a lockout
  even if no message was refused in this browser.
- **Plan-fit adviser** — after four weeks of watching, a verdict on the plan itself.
  If nothing ran out and your busiest session and fullest weekly limit would still
  have fitted under 80% of the next plan down, it says so with the numbers ("…on Pro
  that would have been about 70% and 60% — Pro may be enough"). If you ran out four or
  more times across at least two weeks, or a weekly limit got to 95% in two of them,
  it points at the next plan up. Otherwise it tells you the plan looks right.
- **Value-for-money readout** — what your usage would have cost through the API, set
  against your subscription: "The last 28 days of usage would cost about $277 at API
  prices — 3× the $91.99 of your subscription that covers the same days." Messages
  sent from this browser give both a rough token count and a number of session points,
  which yields a dollars-per-point rate; that rate is applied to every point used on
  the account. The working is shown underneath.
- **Weekly report page** — one printable sheet per week: session peak, average session,
  usage per day, lockouts and time blocked, the fastest-burning day, the busiest hour,
  the share used elsewhere and the API-equivalent cost, each against the week before;
  a bar per day; where each weekly limit peaked; and the week's notes and spikes. Step
  back through earlier weeks from the menu. Open it from the dashboard, from Options,
  or with `cm report` in the address bar.
- **Week-over-week comparison** — the usage-over-time chart has a **24 hours / 7 days**
  switch and a "Compare with a week earlier" box. Ticked, the same stretch from one
  week before is drawn underneath as dashed lines in the matching colours, and the
  legend adds where each limit stood at this point last week ("38% (was 24%)").
- **Session window timeline** — a Gantt-style view of your past 5-hour windows: one
  row per day for the last week, one bar per session from its first message to its
  reset, coloured by how full it got and labelled with its peak. The window still open
  is hatched. It shows at a glance how many sessions a day you get through, where the
  gaps are, and which ones ran hot.
- **Chart annotations** — pin a short note to the chart ("started project X",
  "switched to Sonnet") for now or for any earlier moment. Each note becomes a numbered
  flag with a dotted rule down the chart and a line in the list underneath, so a bend
  in the lines can be traced to its cause. Notes are yours, not readings: demo mode
  leaves them alone.
- **Spike detection** — a limit that jumps by 15% or more within five minutes (the
  threshold is yours to set) is logged as a spike: a red arrow at the foot of the
  chart, a line in the dashboard ("Current session +18% in 4 min (41% → 59%)") with
  the chat it happened during — or a note that nothing was sent from this browser —
  and a desktop notification if those are on. Weekly limits are watched as well.
- **Other-device attribution** — the endpoint doesn't say where usage came from, so
  ClaudeMeter works it out by elimination: it knows every message sent from this
  browser, and a rise in usage with nothing being sent or answered here happened
  somewhere else — another computer, the apps, Claude Code. Those stretches are shaded
  on the chart ("used elsewhere"), and the dashboard splits the last seven days into
  **This browser** and **Elsewhere**.

### Claude Code

Claude Code draws on the same plan as claude.ai, and keeps an exact log of every
conversation on your disk. With the **companion** installed (a small local program;
see [companion/README.md](companion/README.md)), ClaudeMeter reads those logs:

- **Claude Code usage in the popup** — tokens and API-equivalent cost for the current
  5-hour session, today and the last seven days, from the token counts Claude Code
  itself recorded. The session is the same window claude.ai reports, since both draw
  on one allowance.
- **Claude Code on the history chart** — its activity is drawn as bars along the foot
  of the usage-over-time chart, quarter-hours in the 24-hour view and hours in the
  7-day one, so you can see whether a climb in the session line was Claude Code or
  something else. The bars are dollars, not percent, so they are drawn to their own
  scale; the legend gives the total for the span and each bar its figure on hover.
- **Per-project breakdown** — the week's Claude Code usage grouped by the working
  directory each message was sent from: cost and share of the total, sessions,
  tokens, when it was last used and what it has cost today. Folders are shown by name
  (with enough of the path to tell two of the same name apart) and by full path on
  hover. In the dashboard.
- **Most expensive sessions** — the week's costliest Claude Code sessions, each under
  the title Claude Code gave it, with its project, model, number of messages, how
  long it ran and what it cost. Sub-agent work counts towards the session that
  started it. In the dashboard.
- **Cache efficiency** — how much of what Claude Code sent came from the prompt cache:
  tokens read from the cache against tokens written to it and tokens sent plain, as
  a bar and a percentage, plus how many times each written token was read back and
  what caching saved (or cost) in dollars against sending everything fresh. In the
  dashboard.
- **Live push** — instead of being asked every few minutes, the companion stays
  running while the browser is open, watches Claude Code's log folder, and sends new
  figures within a second or two of a reply being written. It only re-reads the lines
  that were added. If the connection is lost ClaudeMeter says so, carries on by
  asking at each refresh, and reconnects at the next one. Can be switched off.
- **Terminal command** — `claudemeter status` prints your claude.ai plan usage as one
  line, `5h 62% · wk 71%`, for the Claude Code status line, a tmux status bar or a
  shell prompt. `--resets` adds the time to each reset, `--color` and `--tmux` colour
  the figures by your own warning levels, and `--format` takes a template
  (`{session}`, `{weekly}`, `{weekly:Opus}`, `{session_reset}`…). It only reads a
  file, so it returns in a few hundredths of a second. Privacy mode hides the
  figures here too, and figures older than 15 minutes are marked with `~`.
- **Local JSON output** — the companion keeps `~/.claudemeter/status.json` up to date
  with your plan usage and a digest of Claude Code's (session, today, week, cache hit
  rate, top project), plus `status.txt` with the one-line form, for anything outside
  the browser to read: Raycast, Stream Deck, SwiftBar or xbar, a script of your own.
  The format is fixed by a JSON Schema, and `companion/examples/` has a Raycast
  script command and a menu-bar plugin ready to use. One switch in Options turns it
  off and removes the files.
- **One installer for macOS, Linux and Windows** — `node companion/install.mjs <id>`
  registers the companion with Chrome, Chromium, Edge, Brave and Vivaldi. On Windows
  that means writing the manifest, a `.cmd` launcher and the registry values under
  your own user; no administrator rights. Options shows the exact command for your
  copy and says plainly what is wrong if it doesn't connect.

### Accounts and platforms

- **Anthropic Console API spend** — if you also pay for the Claude API, the dashboard
  shows what it has cost: the month so far, today, yesterday and the last seven days,
  where the month is heading at its current daily average, a bar for each of the last
  30 days, and the month's spend by model. It reads the Console's own cost report
  (`GET /v1/organizations/cost_report`) with an **Admin API key** you paste into
  Options. That is a separate, pay-as-you-go account from the claude.ai plan
  everything else here watches.

- **Several organisations side by side** — a claude.ai sign-in can belong to more than
  one organisation, each with its own limits. Options lists them: pick which is the
  **main** one (the toolbar icon, alerts and history are about it) and tick up to
  three others to **show** alongside. The popup then has a table with a column per
  organisation and a row per limit, so a personal plan and a team's can be read at a
  glance instead of by switching. Changing the main one sets its predecessor's
  readings and history aside and brings the new one's back; nothing is mixed or lost.

- **Firefox, Edge and Safari** — `node scripts/build.mjs` packages the extension for
  each browser from the one codebase, writing the manifest that browser needs. Edge
  takes Chrome's as it is. Firefox gets an event page in place of the service worker,
  a sidebar in place of the side panel, and its own add-on id; Safari's drops what
  Safari has no API for. The code checks for each browser-specific API before using
  it, and [`store/`](store/) has the listing text, permission justifications and
  step-by-step submission notes for addons.mozilla.org, Microsoft Edge Add-ons and
  the Mac App Store. See the limitations below for how far each has been tested.

- **Six languages** — English, Español, Deutsch, 日本語, हिन्दी and 简体中文. Options
  and the popup, side panel and mini window follow the browser's language, or the one
  you pick under Appearance; the store description and shortcut names are translated
  too. Each translation covers the same 325 strings, which `scripts/check-locales.mjs`
  verifies.

### Data and reliability

- **Unlimited history** — every reading is also filed in an **IndexedDB** archive in
  the browser, which is never trimmed: years of data instead of the last 500
  readings. The usage-over-time chart gains **30 days**, **1 year** and **All time**
  ranges drawn from it, thinned to what a chart can show (each point is the session's
  peak over its stretch, so a spike survives). Each organisation has its own archive.
  The first time, it is started off with what was already stored — the recent
  readings, and the hourly log before them — so the longer ranges aren't empty on
  day one. Options → Data says how much it holds and since when.

- **Adaptive refresh** — the interval in Options is the normal pace, and readings move
  around it. While a limit is past 75% and still climbing they come twice as often,
  past 90% four times as often, because that is when a stale number costs you. Once
  nothing has changed for half an hour they come half as often, after two hours a
  quarter as often. And after a failed attempt — signed out, offline, claude.ai
  having a bad hour — the wait doubles each time, up to an hour, instead of asking
  again at the same rate. Never more than once a minute or less than once an hour.
  A reply finishing in this browser brings a slowed-down pace straight back. Options
  shows what it is doing and why ("Now: refreshing every 10 min: nothing has changed
  for a while. Next at 4:32 PM"), and one switch turns it off for a fixed interval.

- **Automatic backup** — the whole history written to a file on a schedule: every
  day or every week, as `claudemeter-backup-YYYY-MM-DD.json.gz` in a `ClaudeMeter`
  folder inside Downloads. It holds every archived reading for every organisation,
  plus the hourly log, session windows, lockouts, spikes, message costs and your
  chart notes — and no settings, so no keys or webhook addresses. Two years of
  readings come to about 400 KB. Older files are deleted past the number you choose
  to keep (4, 8, 30 or all). **Back up now** makes one on the spot, and **Restore
  from a backup** merges a file back in: readings into the archive (restoring twice
  changes nothing), notes by id, and the other logs only where this browser has none
  of its own — which is the case on a new profile. A failed backup is retried within
  the hour, and the health check says so.

- **Health check** — one page that says whether each thing ClaudeMeter depends on is
  working, and what to do when it isn't: the claude.ai usage endpoint (with what the
  last failure means — signed out, offline, rate-limited, a changed API), the
  background refresh and its current pace, the browser permissions, the optional
  sites a switched-on feature needs, notifications, the Claude Code companion, the
  Console API, and storage. **Check again** tries all of them afresh. Open it from
  Options, the icon's menu, `cm health`, or the "Why?" on the popup's "Couldn't
  refresh" banner.

- **One-click bug report** — the same page builds a GitHub issue with the health
  check and a block of diagnostics already filled in; one click opens it. The text
  travels to GitHub in that link, but nothing is posted until you press Submit there,
  and you can edit it first. The diagnostics are shown on the page
  first, exactly as they will be sent, and are redacted by construction: settings are
  reduced to switches, numbers and fixed choices, and there are no organisation names
  or ids, keys, webhook addresses, chat titles, notes or usage figures in them.

### Alerts

Alerts are off until you turn them on, and everything below respects a snooze and
privacy mode (no figures in the text).

- **Your own thresholds** — alert at any whole percentage from 1 to 100, up to eight of
  them, instead of a fixed pair. Add and remove them as chips in Options. When one
  jump clears several thresholds at once, you get one alert, naming the highest.
- **Pace alert** — once a day, a heads-up when today is running well above a usual
  one: "You're using Claude at 2.3× your usual pace today: 84% of a session so far,
  against a usual 37% by now." Usual means what the same hours typically see on this
  weekday, so a heavy Monday morning is compared with Monday mornings. Set it to
  1.5×, 2× (default) or 3×, or off.
- **Smart reset alert** — "Your session has reset — it was used up, and you're back."
  Only for a limit you were actually waiting on: one that had reached 90% (or 80%, or
  only a full lockout — your choice) when its window rolled over. A limit that reset
  from 40% says nothing, and neither does one that reset hours ago while the browser
  was closed. When a limit is that high, ClaudeMeter schedules a refresh for just
  after its reset time, so the alert arrives as it happens.
- **Webhooks** — opt-in delivery of every alert to **Slack**, **Discord** or **ntfy**
  as well as the desktop. Paste the address in Options, switch it on, and the browser
  asks permission for that one site; "Send test" tries it straight away, and the card
  shows how the last delivery went. Only the alert's text is sent — in privacy mode,
  the same figure-free wording the notification uses.
- **Sound alerts** — a short sound with each alert, for when the notification is easy
  to miss: Chime, Ping, Knock or Pulse, at a volume you set, with a Play button to
  hear it. The sounds are synthesised, not audio files, and are played through an
  offscreen document that exists only for the second the sound lasts.
- **Quiet hours** — times of the week when alerts stay silent: no notification, no
  sound, no webhook. Every weekday has its own windows, up to four each, so nights,
  one standing meeting on Wednesdays and all of Sunday can coexist. A window whose
  end is earlier than its start runs into the next morning; "Copy to all" gives every
  day the same set. The popup and Options say when a quiet stretch ends.
- **Daily digest** — one notification a day, at a time you pick, instead of (or as
  well as) the threshold pings: "Today: about 128% of a session's allowance over 3
  sessions, peaking at 88%. That is 46% more than a usual day so far. Weekly: All
  models 38%, Opus 71% (resets in 3 days 6 hr). A limit ran out once." Usage is
  refreshed first so the figures are current, and clicking it opens the dashboard.
- **Reset calendar export** — download the weekly reset as an `.ics` file: a repeating
  weekly event at the reset time claude.ai reports, with an optional reminder 15
  minutes, an hour or a day before. Limits that reset together share one event.
  Google Calendar, Apple Calendar and Outlook all import it, and importing a newer
  export updates the event rather than adding a second. It is in Options and in the
  popup's share menu, and needs no alerts switched on.

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

- `GET https://claude.ai/api/organizations` — lists your orgs; the main one is the
  one you chose in Options, or else the first with a `"chat"` capability, and its
  `uuid` is cached.
- `GET https://claude.ai/api/organizations/{org_id}/usage` — returns usage buckets,
  e.g. `five_hour` (current session) and `seven_day` / `seven_day_opus` (weekly, per
  model group where applicable), and for some accounts an `extra_usage` block with the
  month's pay-as-you-go spend and cap.

These calls are made directly from the background service worker with
`fetch(url, { credentials: "include" })`. **No credentials are ever read, stored, or
forged by the extension** — `credentials: "include"` just tells the browser to attach
whatever cookies it already holds for `claude.ai`, exactly as it would for a normal
page request from an open tab. This requires the `https://claude.ai/*` host
permission, which is the only host permission this extension has unless you switch
on a webhook (below).

If you're not logged into claude.ai in this browser, fetches fail with
`NOT_LOGGED_IN` and the popup shows an error state — the extension cannot "log in" or
otherwise obtain a session on its own.

As a secondary, zero-cost data source, a content script also passively observes any
matching usage request claude.ai's own UI happens to make (e.g. if you open the
account usage panel yourself) and reuses that response immediately, without waiting
for the next scheduled fetch. See `src/content/inject-hook.js`.

That script sits on the page's `fetch`, so what it may read is kept deliberately
narrow and written down in one place, `src/lib/capture-rules.js`: the answers to
`…/usage` and `…/overage_spend_limit`, and nothing else. Developer mode adds requests
whose address mentions usage, limits, quota, billing or subscription, plus the
organisation list — for finding the figures again if claude.ai moves them. Anything
under a chat, a project or a file is never read in either mode. The rule is applied
three times over (the page script, the relay beside it, the background worker), a
response larger than 20,000 characters is cut short rather than passed on whole, and
nothing is printed to the page's console unless Developer mode is on. To count thread
length the page script does look at a conversation as it loads, but only the counts
leave the page.

If you add an Admin API key for the Console spend panel, it is sent to
`api.anthropic.com` — Anthropic itself, but a different service from claude.ai — and
only there, to read the cost report.

Nothing is sent to any third-party server unless you set up a webhook — everything
stays on your machine: in `chrome.storage.local`, and, if you install the Claude Code
companion, in the status file it writes to its own folder for your other local tools. A webhook is the one exception, and
only what you opt into: the text of each alert, posted to the Slack, Discord or ntfy
address you gave, after the browser has asked you to allow that one site.

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
- **`chrome.offscreen`** — a service worker can't play audio, so alert sounds are
  played by `src/offscreen/offscreen.html`, opened with the `AUDIO_PLAYBACK` reason and
  closed as soon as the sound ends; the sounds themselves are Web Audio oscillators
- **`chrome.runtime.connectNative` / `sendNativeMessage`** — the only way out of the
  browser sandbox to the Claude Code logs. They start `companion/claudemeter-agent.mjs`,
  a Node.js script with no dependencies that shares `src/lib/claude-code.js` with the
  extension: a long-lived connection for live updates, a one-off message otherwise
- **`chrome.permissions`** — the four webhook hosts and `api.anthropic.com` are
  `optional_host_permissions`, requested one at a time from Options when a webhook is
  switched on or an Admin API key is saved, and given back when it is switched off or
  removed
- **`chrome.downloads`** — an optional permission, asked for when automatic backups
  are switched on and given back when they are switched off. The service worker gzips
  the history with `CompressionStream` and hands it to `downloads.download()` as a
  `data:` address (a service worker can't make a `blob:` one; Firefox's event page
  can, and does), then uses `downloads.removeFile()` to delete its own older backups
- **IndexedDB** — the long-term archive of readings (`src/lib/archive.js`), with
  `unlimitedStorage` so the browser doesn't cap or evict it
- **`chrome.action`** — toolbar popup, hover title, badge text, and the gauge icon,
  which the service worker draws on an `OffscreenCanvas` and hands to `setIcon()`
- **`chrome.sidePanel`** — the dashboard; it is the popup page loaded as
  `popup.html?view=panel`, so both surfaces share one renderer
- **`chrome.commands`** — the four keyboard shortcuts
- **`chrome.contextMenus`** — the toolbar icon's right-click menu (`action` context
  only; nothing is added to web pages)
- **`chrome.omnibox`** — the `cm` keyword; `src/lib/omnibox.js` builds the suggestions
  and maps what was typed to a command
- **`chrome.windows`** — the mini window is the same page again (`?view=mini`) in a
  `popup`-type window; its id is kept in `storage.session`, its bounds in `storage.local`
- Content scripts split across the **MAIN** and **isolated** JS worlds (see
  `src/content/inject-hook.js` and `src/content/relay.js`) to safely observe the
  page's own network calls without touching page state
- No external runtime dependencies of any kind — nothing "phones home"

## Project structure

```
claudemeter/
├── manifest.json                      # Chrome's manifest, and the one the others are derived from
├── _locales/                          # the manifest's own strings (description, shortcut names), per language
├── scripts/
│   ├── check-locales.mjs              # checks every translation covers the same strings
│   ├── build.mjs                      # packages dist/<browser> and a zip for each store
│   └── manifest-targets.mjs           # what changes in the manifest for Edge, Firefox and Safari
├── store/                             # listing text and submission steps for AMO, Edge Add-ons and the App Store
├── PRIVACY.md                         # the privacy policy the stores link to
├── companion/                         # the optional local helper that reads Claude Code's logs (Node.js)
│   ├── claudemeter-agent.mjs          # native-messaging host: answers the extension over stdin/stdout
│   ├── read-logs.mjs                  # finds and parses ~/.claude/projects/**/*.jsonl, read-only, incrementally
│   ├── watch-logs.mjs                 # notices when a log changes (file events, or polling where there are none)
│   ├── claudemeter.mjs                # the `claudemeter` terminal command
│   ├── status-file.mjs                # status.json / status.txt: what the companion writes for other tools
│   ├── status.schema.json             # the status file's format, as a JSON Schema
│   ├── examples/                      # a Raycast script command and a SwiftBar/xbar plugin that read it
│   ├── status-format.mjs              # status file -> one line, with templates and colours
│   ├── install.mjs                    # registers it with your browsers on macOS, Linux and Windows
│   └── paths.mjs                      # where ~/.claude and the companion's own folder are
├── src/
│   ├── background/service-worker.js   # active fetch on alarm/request, badge, notifications
│   ├── content/
│   │   ├── inject-hook.js             # MAIN world: patches fetch/XHR, dispatches captures + chat events
│   │   ├── relay.js                   # ISOLATED world: forwards both to the background worker
│   │   └── page-ui.js                 # ISOLATED world: in-page UI (pill, banners, lockout timer) in a shadow root
│   ├── popup/                         # toolbar popup, ?view=panel side panel dashboard, ?view=mini window
│   │   └── insights.js                # the dashboard's analytics sections
│   ├── report/                        # the weekly report page (printable)
│   ├── health/                        # the health check and bug report page
│   ├── offscreen/                     # windowless page the worker opens to play an alert sound
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
│   │   ├── lockout-stats.js           # limit-hit log -> lockouts and time blocked per week
│   │   ├── weekly-stats.js            # usage log -> per-week peaks and totals
│   │   ├── weekly-report.js           # one calendar week's figures, with the week before for comparison
│   │   ├── plan-fit.js                # four weeks of peaks and lockouts -> smaller / larger / fits
│   │   ├── value.js                   # API price list, per-message API cost, usage vs subscription price
│   │   ├── history-chart.js           # history / usage log -> chart series, week-earlier overlay, SVG paths
│   │   ├── annotations.js             # the user's notes on the chart: add, remove, place on the axis
│   │   ├── spikes.js                  # a sudden jump between nearby readings -> spike log
│   │   ├── attribution.js             # which rises this browser can't account for -> "used elsewhere"
│   │   ├── usage-log.js               # hourly rollup of every reading, kept for eight weeks
│   │   ├── backup.js                  # the history as one gzipped file: contents, schedule, pruning, restore
│   │   ├── health.js                  # health checks, redacted diagnostics, the prefilled GitHub issue
│   │   ├── refresh-plan.js            # adaptive refresh: the wait before the next reading, and why
│   │   ├── archive.js                 # every reading, for good, in IndexedDB -> the chart's long ranges
│   │   ├── session-windows.js         # log of past 5-hour windows + the timeline rows drawn from it
│   │   ├── heatmap.js                 # usage log -> weekday × hour averages
│   │   ├── budget.js                  # weekly limit -> % a day until reset, and today's share used
│   │   ├── forecast.js                # level at reset from the typical hourly profile (or a straight line)
│   │   ├── window-start.js            # the first-message time that lands the reset mid-workday
│   │   ├── gauge-icon.js              # draws the ring-gauge toolbar icon onto any 2D canvas
│   │   ├── severity.js                # amber/red cut-offs + colours shared by every meter
│   │   ├── bucket-prefs.js            # popup bucket order / pinned / hidden + the moves between them
│   │   ├── theme.js                   # resolves auto/light/dark/contrast + accent presets
│   │   ├── omnibox.js                 # "cm" keyword: suggestion rows + command resolution
│   │   ├── snooze.js                  # snooze options -> end time, and the "is it snoozed" check
│   │   ├── thresholds.js              # the alert levels: any 1–100, tidied, and which one a jump crossed
│   │   ├── pace.js                    # today against the usual for these hours -> the once-a-day pace alert
│   │   ├── reset-alert.js             # which resets are worth announcing, and when to look for the next
│   │   ├── webhooks.js                # Slack / Discord / ntfy: address checks, request shapes, delivery
│   │   ├── quiet-hours.js             # per-weekday silent windows: "is it quiet now", "until when", editing
│   │   ├── digest.js                  # today's figures as one notification, and when the next is due
│   │   ├── ics.js                     # the weekly reset as an iCalendar file (RFC 5545 escaping and folding)
│   │   ├── sounds.js                  # the alert sounds as notes, and scheduling them on an AudioContext
│   │   ├── share.js                   # usage summary as text, and as a card drawn on a canvas
│   │   ├── demo-data.js               # the deterministic made-up dataset behind demo mode
│   │   ├── i18n.js                    # translates a page in place from src/locales/<language>.json
│   │   ├── platform.js                # which browser this is, and its add-on id in Firefox
│   │   ├── orgs.js                    # the organisation list: which is main, which are shown alongside, the table
│   │   ├── api-spend.js               # Console cost report: the request, days from the response, the summary
│   │   ├── console-api.js             # fetches that report with the Admin API key
│   │   ├── claude-code.js             # Claude Code log lines -> usage records -> summary (shared with companion/)
│   │   ├── package.json               # only says "these files are ES modules", so Node can load them too
│   │   ├── extra-usage.js             # extra-usage spend: day-by-day record, "today", wording
│   │   ├── usage-api.js               # org discovery + usage fetch + typed errors
│   │   ├── capture-rules.js           # which of the page's requests the hook may read (and which never)
│   │   └── normalize-usage.js         # raw usage response -> UsageSnapshot (+ extra-usage block)
│   ├── locales/                       # the translations: English text -> translated text, one file per language
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

**Other browsers.** Run `node scripts/build.mjs` first, then:

- **Firefox 140+** — `about:debugging` → This Firefox → Load Temporary Add-on →
  `dist/firefox/manifest.json`.
- **Edge** — as for Chrome, loading `dist/edge` (or this folder directly).
- **Safari** — `xcrun safari-web-extension-converter dist/safari` makes an Xcode
  project to build and run; see [`store/README.md`](store/README.md).

The side panel needs **Chromium 116+**; on older builds the extension still works and
simply doesn't offer it. Alert sounds need 116+ as well.

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
  extraUsage: {                 // pay-as-you-go spend past the plan; null when the response has no such block
    enabled: boolean,
    used: number | null,        // spent this month, in major units (dollars)
    limit: number | null,       // the monthly cap; null when none is set
    percentUsed: number | null, // of the cap
    currency: string,           // "USD" unless the endpoint says otherwise
  } | null,
}
```

The latest extra-usage reading is also kept on its own as `extraUsage` (it can come from
a second endpoint, below), with the month's running total at the end of each day in
`extraUsageLog` (last 62 days) so "today" can be worked out.

Stored in `chrome.storage.local` as `latestSnapshot`, plus a capped rolling `history`
(last 500 snapshots) that feeds the 24-hour chart and the burn-rate maths. Every
reading is also appended to the **archive**, an IndexedDB database (`claudemeter`,
store `readings`, keyed by organisation and time) that is never trimmed and holds one
compact record each — `{ o, t, s, sr, w: [[label, %, resetsAt]], e? }`, about 100
bytes, so a reading every five minutes is roughly 10 MB a year
([`src/lib/archive.js`](src/lib/archive.js)). Settings
live under `settings` (`refreshIntervalMinutes`, `adaptiveRefresh`, `notificationsEnabled`,
`notifyThresholds`, `language`, `paceAlertFactor`, `resetAlertPercent`, `dailyDigest`, `digestTime`, `calendarReminder`, `quietHours`, `soundAlerts`, `soundName`, `soundVolume`, `webhooks`, `theme`, `accent`, `iconStyle`, `warnAt`, `dangerAt`, `severityColors`,
`bucketPrefs`, `privacyMode`, `actionOpens`, `developerMode`, `demoMode`, `demoLabel`, `inlinePill`, `tabIndicator`, `preSendWarnPercent`, `modelHintPercent`,
`longContextTokens`, `attachmentWarnTokens`, `lockoutOverlay`, `messageCost`, `primaryOrg`, `trackedOrgs`, `apiSpend`, `claudeCode`, `claudeCodeLive`, `statusFile`, `weeklyBudget`, `forecast`, `workdayStart`, `workdayEnd`, `plan`, `planPrice`, `spikePercent`, `chartRange`, `chartCompare`, `autoBackup`, `backupKeep`). The current model-switch hint, if any, is kept
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
  inputTokens: number | null,  // rough: the thread as it stood plus this message, in characters / 4
  outputTokens: number,        // rough: the reply's characters / 4
  shared: boolean,             // another reply was streaming at the same time
}
```

"Limit reached" events go to `limitHits` (last 100), one entry per lockout:

```js
LimitHit = {
  at: number,                  // epoch ms of the first refused/flagged message
  lastAt: number,              // ...and of the most recent one in the same lockout
  attempts: number,            // messages sent into this lockout (0 for "observed")
  source: "rejected" | "reply" | "observed", // HTTP 429, the reply stream's message_limit
                               // event, or a refresh that found the limit at 100%
  claim: string | null,        // claude.ai's name for the limit, e.g. "five_hour"
  resetsAt: number | null,     // from the response, else from the usage snapshot
  conversationId: string | null,
  model: string | null,
}
```

Every reading is also folded into `usageLog`, the long-term record the analytics are
built from (last 1,344 hours — eight weeks):

```js
HourRecord = {
  t: number,                   // epoch ms of the start of the local clock hour
  n: number,                   // readings folded into it
  peak: number | null,         // highest session % seen during the hour
  burn: number,                // session %-points used during the hour
  weekly: { [label]: { pct: number, burn: number } },  // level at the last reading, points used
  away?: number,               // the part of `burn` that rose with nothing sent from this browser
  unseen?: number,             // session points that built up across a gap in the readings (not in `burn`)
}
```

A snapshot whose rise this browser can't account for carries that rise as
`elsewhere` (session %-points). What "this browser" was doing is a tiny
`localActivity` record — the time of the last message sent or answered here, and
the requests still streaming.

Each 5-hour window gets one entry in `sessionWindows` (last 300), recognised by its
reset time:

```js
SessionWindow = {
  start: number,               // epoch ms it opened: its reset time minus five hours
  resetsAt: number,
  firstSeen: number,           // first and last readings taken inside it
  lastSeen: number,
  peak: number,                // highest session % seen in it
}
```

The notes pinned to the chart are kept in `annotations` (last 100), in time order, as
`{ id, at, text }` with the text capped at 80 characters.

Sudden jumps are logged to `spikes` (last 50):

```js
Spike = {
  at: number,                  // epoch ms of the reading that revealed it
  from: number,                // ...and of the low point it is measured from
  label: string,               // "Current session", "All models", "Opus", …
  before: number,              // % at `from`
  after: number,               // % at `at`
  rise: number,
}
```

The organisations the sign-in belongs to are kept as `orgList`, the current usage of
those shown alongside as `orgSnapshots`, and each former main organisation's own
readings and history under `orgState[<id>]` until it is made main again.

The Console cost report is kept as `apiSpend` (`{ fetchedAt, days }`, each day a UTC
midnight, a total in dollars and its lines by model), with `apiSpendStatus` for how
the last read went. The Admin API key is stored on its own as `adminApiKey`, outside
`settings`.

The companion's latest summary of Claude Code usage is kept as `claudeCode`, with how
the last attempt to reach it went in `claudeCodeStatus`.

Demo mode never overwrites any of this. `getAll()` in `src/lib/storage.js` swaps the
made-up dataset in at read time, and the same dataset is written to a separate
`demoState` key (removed again when demo mode goes off) so the page script on
claude.ai can read it. The demo's five weeks of hourly records are generated on each
read and never stored.

A snooze is a single top-level `snoozeUntil` timestamp (0 when alerts aren't paused);
an alarm at that time clears it, so it ends even if the browser was closed meanwhile.

Per-conversation totals aren't stored — `src/lib/conversation-costs.js` derives them
from `messageLog` on demand, so they only cover the messages still in that log.
 Raw request/response captures (`__debug_captures`, last 20) are only
written when Developer mode is on, from Options, and only for the requests
`src/lib/capture-rules.js` allows. An earlier version captured more widely, so the
first run of this one empties that list once (`capturesScrubbed`).

## Refresh behavior

- **Background alarm**: fetches on the interval set in Options (default 5 min),
  regardless of whether a claude.ai tab is open. With **adaptive refresh** on (the
  default) that interval is the normal pace and `src/lib/refresh-plan.js` picks the
  actual wait after every reading and every failure:

  | When | Wait | With the default 5 min |
  |---|---|---|
  | The fullest limit with room left is ≥ 90%, and usage moved in the last 15 min | interval ÷ 4 | 1.5 min |
  | … ≥ 75%, and usage moved in the last 15 min | interval ÷ 2 | 2.5 min |
  | Nothing has changed for 30 min | interval × 2 | 10 min |
  | Nothing has changed for 2 hours | interval × 4 | 20 min |
  | The last *n* attempts failed | interval × 2ⁿ | 10, 20, 40, 60 min |
  | Otherwise | the interval | 5 min |

  Waits are rounded to half a minute and kept between 1 and 60 minutes. A limit that
  is already full doesn't count as "close" — it can't get closer. The alarm repeats at
  the pace last chosen, so readings carry on even if the worker is stopped before it
  can choose again. What was chosen, and why, is stored as `refreshPace`.
- **Waking up**: a reply finishing in this browser triggers a reading straight away
  when the pace had slowed for lack of change, or when attempts were failing because
  claude.ai was signed out (a message going through means that is over). Opening the
  popup always tries once.
- **Backups**: their own alarm, one interval (a day or a week) after the last backup
  that worked, an hour after one that didn't, and at once if one fell due while the
  browser was closed.
- **Per-message cost and failures**: after two failed attempts in a row, the readings
  per-message cost takes around a message are skipped until the next scheduled try,
  so a struggling claude.ai isn't asked more often by someone who is typing. Those
  messages go unmeasured.
- **Other organisations**: one extra request each, with a normal refresh but at most
  once a minute.
- **API spend**: the Console's cost report is daily, so it is read at most every 30
  minutes, alongside a normal refresh.
- **Claude Code**: pushed by the companion as the logs change, when "Update live" is
  on. Otherwise read with each refresh, but at most once a minute — the companion is
  started, reads the logs touched in the last week, answers and exits.
- **For the daily digest**: one fetch at the digest's time, so it reports the day as it
  stands.
- **At a reset**: when a limit is high enough for the reset alert, one extra fetch is
  timed for ten seconds after its reset time.
- **Popup open**: triggers a silent background refresh every time you open the popup,
  so numbers are current without a manual click.
- **Manual refresh**: the refresh icon in the popup header.
- **Passive capture**: if claude.ai's own UI makes the exact usage request while a
  claude.ai tab is open, that response is captured and applied immediately too. The
  same goes for the `overage_spend_limit` request its settings page makes, which
  carries the extra-usage spend and cap. Only an answer that worked counts: a `GET`
  that came back `200` with limits in it. The page's own request failing (a 429, a
  server error) changes nothing.
- **Around each message** (when per-message cost is on): once as you send — skipped if
  the last reading is under 20 seconds old — and once ~1.5 s after the reply ends.
- Failed refreshes never wipe the UI — the popup keeps showing the last known-good
  snapshot with an inline "Couldn't refresh — showing data from X ago" warning. That
  includes an answer that arrives but has no reading in it: `UNPARSEABLE_RESPONSE`
  when it isn't a shape this version can read, `NO_LIMITS` when the organisation
  simply has no session or weekly limit.

## Known limitations

- The usage endpoint is undocumented and reverse-engineered (consistent with what
  other open-source claude.ai usage extensions use, e.g.
  [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension),
  [sshnox/Claude-Usage-Tracker](https://github.com/sshnox/Claude-Usage-Tracker)) — it
  can change shape, move, or disappear without notice. A limit that can no longer be
  read is left out and the rest still shown (see `src/lib/normalize-usage.js`); an
  answer with no limit in it at all is treated as a failed refresh
  (`UNPARSEABLE_RESPONSE`), so the last good reading stays on screen with the usual
  "Couldn't refresh" warning and the health page says the API has probably changed.
  Either way the numbers are stale or partial until the parser is updated.
- Percentages are whole numbers, and `utilization` is read as being on a 0–100 scale,
  whatever its size: 0.5 is half a percent (shown as 1%, by ordinary rounding), not a
  half. An earlier version guessed that anything under 1 was a 0–1 fraction,
  which would have shown the start of every window as tens of percent used. A limit
  only reads 100% — which is what logs a lockout and starts the countdown on claude.ai
  — when the endpoint says 100 or more; 99.6 is 99%. The scale is taken from the
  other open-source extensions and has **not been checked against a live account**
  from this repository: if every limit reads 0% or 1% while you are plainly using
  Claude, the endpoint is sending fractions, and that is worth an issue. To see what
  it sends, switch on Developer mode, open claude.ai's usage settings, and look at
  the capture on the debug page.
- Plan tier badge (Free/Pro/Max 5x/Max 20x/Team/Enterprise) is rarely populated — the
  usage endpoint itself doesn't return it, and the org-list endpoint's plan field name
  isn't confirmed, so the badge is best-effort and often simply hidden.
- Requires being logged into claude.ai in the same browser profile the extension runs
  in; it cannot establish a session on its own.
- While demo mode is on, real usage isn't tracked at all: no refreshes, no per-message
  costs, no limit-hit logging, no notifications. Turn it off to get real numbers back.
- Sharing is deliberate, so it works with privacy mode on and copies the real numbers.
  If the browser refuses the clipboard (it can when the window isn't focused), the
  menu says so and "Save image" still works.
- Privacy mode has to be switched on by you — an extension can't tell that the
  screen is being shared. It hides what is drawn on screen; screen readers still get
  the real values, and an OS notification banner still appears (without figures).
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
  logged, with the reset time borrowed from the usage snapshot. Refusals that happen in
  another browser, the desktop/mobile apps, or Claude Code aren't seen as such — but
  the limit they exhausted shows up at 100% on the next refresh and is logged then.
- Time blocked is measured from when ClaudeMeter first saw the lockout, so a limit
  that ran out while the browser was closed is counted from the next refresh, and one
  with no known reset time counts as a lockout but adds no blocked time. Being
  "blocked" on a weekly model limit still leaves the other models usable.
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
- The 24-hour chart only reaches back as far as the stored history: 500 readings,
  which is about a day at the default interval and less if per-message cost is adding
  two readings per message. The 7-day view and the week-earlier overlay are drawn from
  the hourly log instead, so they are coarser — one point per hour, the session line
  showing each hour's peak — and the line breaks wherever the browser wasn't running.
- Adaptive refresh trades freshness for fewer requests when nothing is happening.
  Once the pace has slowed, usage that starts on another device — or in Claude Code —
  is noticed up to four intervals late (20 minutes by default, an hour at most), and
  so are the alerts that depend on it. "Close to a limit" only speeds things up while
  usage is moving, so the first reading after a quiet spell is at the slower pace.
  The rules are fixed, not learned from your habits, and the switch is all or nothing.
- A backup goes where the browser puts downloads, because that is the only place an
  extension can write: a `ClaudeMeter` folder in Downloads, not a folder of your
  choosing. Each one shows up in the browser's downloads list like any other file,
  and if the browser is set to ask where to save every download, it asks for backups
  too. Tidying only touches files ClaudeMeter wrote itself and still finds where it
  left them; one you moved or renamed is yours. Backups run while the browser is
  open — one that fell due overnight is made at the next start — and are not
  encrypted. Restoring merges; it never deletes, and it doesn't bring back settings.
  The "downloads" permission also lets an extension see your download history;
  ClaudeMeter only ever looks up its own backups in it. Safari has no downloads API,
  so there are no automatic backups there (a backup made elsewhere can be restored).
  Verified in Chromium; not run in Firefox, where the same code hands the browser a
  blob instead of a data: address.
- The health check reports what the extension can see of itself. It can't tell whether
  the page script on claude.ai is running in a given tab, whether a notification the
  browser accepted was actually shown by the system (Chrome only says if they are
  blocked outright; Firefox and Safari don't say), or why a webhook's far end dropped
  a message. "Answering" for the usage endpoint means the last reading succeeded, not
  that its figures are right.
- The bug report is a link, and a link has a length limit: past about 7,000
  characters the diagnostics are cut from the end and the page says so. Redaction
  works on what ClaudeMeter stores; anything you type into the issue yourself is
  yours to check. The health page's own text is translated; the checks' findings and
  the diagnostics are in English, so an issue reads the same whoever files it.
- The archive starts the day this version is installed. What it is seeded with reaches
  back at most eight weeks, and that part is hourly, not every reading. Only the chart
  reads it: the heatmap, forecast and the other analytics still work from the
  eight-week hourly log. Over the longer ranges a point stands for a stretch of time
  (about 72 minutes over 30 days, 15 hours over a year), the week-earlier overlay is
  not offered, and "used elsewhere" bands are not drawn past 30 days. It lives in this
  browser profile only — nothing syncs it — and removing the extension deletes it.
  Demo mode draws those ranges from its made-up hourly log.
- The analytics only know what this browser saw. Hours when it wasn't running leave no
  record, and usage that built up across a gap of more than 90 minutes between two
  readings isn't assigned to any hour, because there is no telling when it happened.
  The heatmap needs a few weeks before its averages mean much; the header says how
  many days it rests on.
- The forecast is an expectation, not a promise: it assumes the coming hours look like
  the same hours in past weeks. It needs seven days on record before it uses the
  hourly profile (the tooltip says which method produced the figure), and "today is
  running at N× your usual" is capped between 0.5× and 2×. A straight-line forecast
  isn't offered in the first 2% of a window, where one message would swing it wildly.
- The cache saving compares what the cached tokens were billed at — reads at the
  model's cache-read price, writes at 1.25× the input price for five-minute entries
  and 2× for hour-long ones — with the plain input price for the same tokens. That
  is the saving against not caching at all, which no real client would do for a long
  conversation, so read it as "what the cache is worth", not as money you could have
  kept. Older log lines don't say how long a cache entry was kept and are priced as
  five-minute writes.
- A session's title is the one Claude Code wrote into its own log; sessions it never
  titled are listed as untitled, and no prompt or reply text is read to make one up.
  A session that started more than a week ago is ranked on what it used this week.
- Projects are grouped by the exact working directory in each log line, so a session
  that `cd`s into a subfolder is split between the two, and running Claude Code from
  your home directory makes "home" a project. Only the twelve costliest directories
  of the week are listed.
- The status file is plain, unencrypted JSON in your own home folder, readable by any
  program running as you — which is the point of it, and the reason for the switch.
  It holds percentages, reset times, Claude Code totals and the name of the week's
  costliest project folder; no chat text, session titles or full paths. It goes stale
  when the browser closes (check `updatedAt`), and Stream Deck needs a third-party
  plugin that can show a text file or a command's output, since it has no such
  action of its own.
- The terminal command shows what the browser last knew. The plan percentages exist
  only inside the browser (they come from claude.ai with your sign-in), so the
  extension passes them to the companion, which writes them to a status file; with
  the browser closed nothing updates it, and the figures gain a `~`. A session whose
  reset time has passed is shown as 0%. The command needs the Claude Code switch on
  in Options, since that is what puts the companion to work.
- Live updates keep two things running that otherwise wouldn't be: the companion
  process, and ClaudeMeter's background worker, which the browser can't put to sleep
  while the connection is open. Both are small and idle between changes, and both
  stop when the browser closes or the switch goes off. A burst of writes is reported
  once it pauses for a second, or every five seconds while it doesn't. Where the
  system can't watch a folder tree (Linux with Node.js older than 20), the companion
  checks every 15 seconds instead, and Options says so.
- Claude Code's bars on the chart share its time axis but not its percentage scale:
  the tallest bar in view is always the same height, whatever it cost. They are there
  to show *when*, and the legend to say *how much*.
- **What is and isn't translated.** The fixed text of Options and of the popup, side
  panel and mini window is: headings, labels, hints, buttons, menus, tooltips. Text
  that is assembled from your data is not yet — forecasts and budgets ("on course for
  84%"), the advice and summaries in the dashboard, alert messages, durations ("2 hr
  14 min") — nor are the welcome page, the weekly report, the UI drawn on claude.ai,
  or status messages in Options. Those show in English in every language. The
  translations were written for this project and have not been reviewed by native
  speakers; corrections are a one-line change in `src/locales/`.
- Translations are keyed by the English text, so rewording an English string orphans
  its translations until they are updated — it then shows in English rather than
  breaking, and `node scripts/check-locales.mjs` only checks the languages against
  each other, not against the pages.
- **How far each browser has been tested.** Chrome and Edge share an engine and a
  manifest, and the built package is run in Chromium. The Firefox package passes
  Mozilla's `web-ext lint` with no errors but has **not been run in Firefox**. The
  Safari manifest has been derived but the port has **not been converted, built or
  run**, and Safari has no notifications, side panel, address-bar keyword or route to
  the companion. Nothing has been submitted to any store: that takes a developer
  account with each, and their review.
- In Firefox the mini window doesn't remember its place (Firefox doesn't report window
  moves), and the dashboard lives in the sidebar. The Firefox add-on id is fixed in
  `src/lib/platform.js` and must not change once published.
- Organisations shown alongside get their current figures and nothing else: no
  history, forecasts, alerts or lockout log, which exist only for the main one.
  Per-message costs are measured against the main organisation, so chatting in a
  different one on claude.ai measures nothing. A reading the page itself makes for
  another organisation is ignored rather than filed under the main one. Whether one
  sign-in's organisations can all be read this way hasn't been checked on a real
  multi-organisation account.
- The API spend panel needs an **Admin API key**, which only organisations have:
  Anthropic's Admin API isn't available to individual accounts, and an ordinary API
  key is refused. An Admin key can do far more than read costs, and it is stored in
  this browser's extension storage unencrypted, so treat this as you would pasting it
  into any tool — ClaudeMeter uses it for the one read-only request and keeps it out
  of its settings, exports and bug reports. The report's days are UTC days, it lags a
  few minutes behind real usage, Priority Tier costs aren't in it, and "on course
  for" is this month's daily average carried to the month's end, nothing cleverer.
  Not checked against a live Console account: it follows Anthropic's published
  reference for the endpoint.
- Claude Code figures are exact where the plan percentages are not — they are the
  API's own token counts — but the dollar amounts are API list prices
  (`src/lib/value.js`), not anything you were charged: on a subscription Claude Code
  costs you nothing extra. Only this computer's logs are read, so Claude Code on
  another machine is invisible, and Claude Code deletes old logs on its own schedule.
  The log format isn't a published one; lines ClaudeMeter can't make sense of are
  skipped rather than guessed at.
- The Windows half of the installer has been checked for what it writes and which
  `reg` commands it runs, but not run on a Windows machine. `--dry-run` shows the
  plan first.
- Extra-usage figures depend on a part of the response that is even less certain than
  the rest: the field names (`extra_usage` with `is_enabled` / `monthly_limit` /
  `used_credits`) and the unit (taken to be cents) are what other tools read, not
  something documented, and none of it has been checked against a live account with
  the feature on. If the amounts look a hundred times off, that assumption is why.
  ClaudeMeter never fetches the spend-limit endpoint itself — it only reads that
  response when the page happens to load it — and "today" needs a reading from a
  previous day to measure from.
- A report week is seven calendar days ending today (or the seven before that, and so
  on), so the current week's last day is still filling in. "Used per day" divides by
  the days actually on record, not by seven. The report reaches back as far as the
  hourly log does — eight weeks — and can only print what this browser saw.
- The value-for-money figure is an estimate built on estimates. Tokens are characters
  divided by four and leave out everything the page never shows — the system prompt,
  tool results, reasoning, images, project knowledge — which makes the figure too low.
  Prices are Anthropic's API list prices as of 25 September 2026 (`src/lib/value.js`),
  with models older than that list priced at their family's rate and no prompt
  caching, which an API client re-sending a long thread would use — that makes it too
  high. The rate needs five cleanly measured messages (10 points between them) and
  assumes usage elsewhere costs the same per point as usage here. Subscription list
  prices are US ones before tax; set your own in Options.
- "Used elsewhere" is an inference from timing, per stretch between two readings: if
  anything was sent or answered in this browser during it (or in the two minutes
  before), the whole rise is counted as this browser's, even if another device was
  busy too — so the elsewhere share is a floor. A second browser profile, or a
  claude.ai tab the page hook isn't running in, counts as elsewhere. Usage that built
  up while the browser was closed is counted as elsewhere but, having no known hour,
  is left out of the heatmap and the forecasts.
- The calendar export is a snapshot, not a subscription: it repeats weekly from the
  reset time known when you exported, on the assumption that the weekly window stays
  put. If claude.ai moves your reset, export again — the event has a fixed identity,
  so the new file replaces the old event. Only weekly limits are exported; the 5-hour
  session has no fixed schedule to put in a calendar. Times are written in UTC, so
  the event keeps to the real reset through daylight-saving changes.
- The digest is an alert like the others: it needs alerts switched on, and one that
  falls inside quiet hours or a snooze is skipped for that day. If the browser is
  closed at the chosen time it is sent when the browser next starts, if that is still
  the same day's worth of news — once a day at most. "Today" is since local midnight,
  and counts only what this browser has on record.
- An alert that comes due in quiet hours is dropped, not held: a threshold crossed at
  3 AM is not announced at 7. (The pace alert is the exception only because it is
  re-checked on every refresh, so it can still go out later the same day.) Quiet
  hours silence alerts, not the nudge banners on claude.ai — a snooze does both.
  Times are your computer's local time and move with it when you travel.
- A sound plays at the browser's own output volume and on whatever device it uses;
  the extension can't tell whether you're in a call or have the tab muted, so quiet
  hours or a snooze are the way to keep it silent. Sounds are played one after another
  when several alerts land together.
- Webhooks carry your usage figures to a third party's servers; that is the point of
  them, and why they are off until you set one up. The address is stored in
  `chrome.storage.local` like every other setting, unencrypted. Only `ntfy.sh` itself
  is supported, not a self-hosted ntfy server, because the extension only ever asks
  for a fixed list of hosts. A delivery gets ten seconds and is not retried, and
  webhooks follow the same switch, snooze and privacy mode as desktop alerts — they
  are a second place for an alert to go, not a separate set of alerts.
- The reset alert goes by the last reading before the reset: a limit that climbed from
  70% to 95% and reset inside one refresh interval was last seen below the bar and
  stays silent. A reset is announced only within 15 minutes of happening, so one that
  occurs while the browser is closed or the computer asleep is never announced.
- The pace alert needs seven days on record before it knows what usual is, and stays
  quiet until the day has something to compare: at least 10 points of usual usage for
  the hours so far and 20 actually used. Today's own hours are part of the average it
  is compared with, which blunts the ratio a little in the first weeks. It is sent at
  most once a day; if alerts were snoozed when it came due, it can still come later.
- A spike can only be seen between two readings at most five minutes apart (plus a
  minute's slack for a late timer). At the default 5-minute refresh that means
  consecutive readings; with per-message cost on, the readings around each message
  make it much finer. On a longer refresh interval, jumps between scheduled
  refreshes go unnoticed. A reset is never counted as a spike, and one jump is
  flagged once, measured from the lowest reading in the window.
- A chart note only gets a flag while its moment is inside the span the chart is
  showing; older ones stay in the list (dimmed) so they can still be removed. Notes
  can't be edited, only removed and re-added, and can't be pinned to the future.
- A session window is only logged once a reading shows it with something used, and its
  start is taken to be five hours before its reset. Windows that opened and closed
  while the browser wasn't running never appear, and a window's peak is the highest
  reading ClaudeMeter happened to take, which can be short of where it really ended.
- Plan-fit advice compares plans by their advertised multiples of Pro (Max 5x = 5×,
  Max 20x = 20×). That holds for the session limit as Anthropic describes it and is
  only approximate for the weekly ones, and it is why "peaked at 40% on Max 5x" is
  *not* read as "Pro would do": that is twice Pro's allowance. It knows nothing about
  price, Free, Team or Enterprise, and it needs your plan — pick it in Options if the
  header says "plan not detected". Each of the four weeks needs at least three days on
  record before it says anything.
- The window-start suggestion plans a *typical* day of that weekday, in half-hour
  steps, and only speaks up when the heaviest window would get at least 10 points
  lighter. Before there is a week of history it has no idea how heavy your day is, so
  it assumes even use across the working hours from Options and talks in hours of work
  instead of percentages. It can't open the window for you: that takes a message.
- "Used today" in the weekly budget is the limit's level now minus its level at local
  midnight. If ClaudeMeter has no reading from before midnight it uses the level just
  before today's first reading, and with no readings today it shows the budget alone.

## Options

- **Refresh interval** — 1–30 minutes, default 5.
- **Adaptive refresh** — on by default: readings come more often near a limit, less
  often when nothing is changing, and back off after failures. Off for exactly the
  interval set.
- **Notifications** — desktop notification when session or weekly usage crosses one of
  your thresholds (80% and 95% to begin with; add any others, up to eight). It only
  fires on the transition, not on every fetch above a threshold. While alerts are
  snoozed this card says until when and offers Resume.
- **Pace alert** — Off, or at 1.5× / 2× (default) / 3× your usual pace for the day so far.
- **Reset alert** — Off, or when the limit had reached 80% / 90% (default) / 100%.
- **Reset calendar** — choose a reminder (none, 15 minutes, 1 hour, 1 day before) and
  download the `.ics`.
- **Daily digest** — off by default; pick the time (18:00 to begin with).
- **Quiet hours** — off by default; per weekday, up to four windows each.
- **Play a sound** — off by default; pick the sound and volume, and Play to hear it.
- **Webhooks** — Slack, Discord and ntfy, each with its own switch, address and test
  button. All off by default.
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
- **Organisations** — which organisation is the main one, and which others (up to
  three) are shown beside it. "Refresh the list" asks claude.ai again.
- **Anthropic Console API spend** — off by default. Paste an Admin API key to switch it
  on; Remove forgets the key and everything read with it.
- **Claude Code** — off by default. Shows the install command for the companion, and
  whether it is connected. **Update live** (on by default) keeps it running and
  watching; off, it is asked once per refresh. **Share usage with local tools** (on by
  default) lets it write the status file; off, the file is removed and the plan
  figures stay in the browser.
- **Weekly budget** — show/hide the "% a day until reset" line under each weekly limit.
- **Forecast** — from your usual week (default), straight line, or off.
- **Working hours** — start and end (9:00–17:00 by default), used for the window-start
  suggestion until a week of your own usage is on record.
- **Subscription price** — what you pay a month in US dollars, for the value readout;
  empty uses your plan's list price ($20 Pro, $100 Max 5x, $200 Max 20x).
- **Spike detection** — Off, or +10 / +15 (default) / +20 / +30% within five minutes.
- **Your plan** — Auto-detect (default), Pro, Max 5x or Max 20x, for the plan-fit advice.
- **Icon shows** — gauge ring (default), badge text, both, or nothing.
- **Keyboard shortcuts** — shows the current bindings; "Change shortcuts…" opens
  `chrome://extensions/shortcuts`.
- **Warning levels** — the % at which meters turn amber and red, and optional custom
  colours for normal / amber / red. These are separate from the notification
  thresholds above.
- **Clicking the icon opens** — the popup (default) or the side panel.
- **Language** — Auto (the browser's language, where there is a translation) or one of
  the six. The page reloads in the new language.
- **Theme** — Auto (follows the system's `prefers-color-scheme` and
  `prefers-contrast`), Light, Dark, or High contrast.
- **Privacy mode** — hide every number while you share your screen.
- **Accent colour** — one of six presets. High contrast uses its own accent so a
  softer preset can't undo the contrast.
- **Demo mode** — show the demo dataset everywhere, with or without the "Demo" badge.
- **Developer mode** — keeps the last 20 raw answers to claude.ai's usage and billing
  requests for the debug page (`src/debug/debug.html`), off by default. Chats,
  projects and files are never captured.
- **Long-term archive** — how many readings the archive holds and since when.
- **Automatic backup** — off, every day or every week; how many files to keep; Back
  up now; Restore from a backup.
- **Clear stored data** — wipes snapshot, history, the archive, the hourly usage log, the session
  window log, your chart notes, the spike log, the extra-usage record, message costs,
  the limit-hit log, org cache, and debug captures.

## Author

Built by [**kanishksharma04**](https://github.com/kanishksharma04).
