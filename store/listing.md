# Store listing

The same text for every store, cut to each one's limits where noted.

## Name

ClaudeMeter

## Summary

*(AMO: 250 characters. Edge: short description. This is 128.)*

See your claude.ai session and weekly usage limits from the toolbar, with forecasts,
alerts and history. Nothing leaves your browser.

## Languages

English, Spanish, German, Japanese, Hindi and Simplified Chinese. The manifest's
description is translated in `_locales/`; AMO and Edge take a translated listing per
language if you want to add them — the summaries below would need translating too.

## Category

Productivity. *(AMO also: Web Development or Other. Safari: Productivity.)*

## Description

ClaudeMeter shows how much of your claude.ai plan you have used, without opening
claude.ai's own settings.

Click the toolbar icon for your current 5-hour session and each weekly limit, as a
percentage, a bar and the time until it resets. The icon itself is a small gauge that
fills as your session does.

Beyond the numbers:

• Forecasts — where each limit is heading by its reset, based on how you usually use
  Claude at that hour of the week.
• Alerts — at any percentage you choose, when a limit resets after you were locked
  out, or when a day is running unusually heavy. Quiet hours, sounds and a daily
  digest are optional.
• A dashboard — usage over time, a heatmap of when you use Claude, your past
  sessions, lockouts, and a weekly report you can print.
• On claude.ai itself — a small usage pill by the message box, a warning before you
  send when a limit is close, and what each message cost.
• Claude Code — with an optional companion program, the tokens and cost of your
  Claude Code sessions by project.

It works with the sign-in your browser already has. There is no account to create
and no server: your figures are fetched from claude.ai and kept in your browser.

ClaudeMeter is an independent, open-source project and is not affiliated with
Anthropic. It reads the same usage figures claude.ai shows you; that source is not a
documented one and may change.

## Permission justifications

*(Edge asks for one per permission; AMO and Apple want the same in the reviewer notes.)*

| Permission | Why |
|---|---|
| Host: `https://claude.ai/*` | Fetch the signed-in user's own usage figures, and draw the usage pill on claude.ai pages. |
| `storage` | Keep settings and usage history in the browser. |
| `alarms` | Refresh usage every few minutes without a tab open; schedule the daily digest. |
| `notifications` | Show the usage alerts the user switched on. Off by default. |
| `contextMenus` | Refresh, snooze and shortcuts on the toolbar icon's right-click menu. Nothing is added to pages. |
| `sidePanel` *(Chrome, Edge)* | Offer the dashboard in the side panel. |
| `offscreen` *(Chrome, Edge)* | Play a short sound with an alert; a service worker cannot play audio itself. |
| `nativeMessaging` | Talk to the optional companion that reads Claude Code's local logs. Unused unless the user installs it. |
| `unlimitedStorage`, `downloads` *(if present)* | Keep long usage history; save backups the user asked for. |
| Optional hosts: Slack, Discord, ntfy | Deliver alerts to a webhook the user entered. Requested only then, for that host. |
| Optional host: `api.anthropic.com` | Read the Anthropic Console cost report with an Admin API key the user entered. Requested only then. |

## Data and privacy answers

- Does the extension collect or transmit personal data? **No.** Usage figures are read
  from claude.ai and stored locally. The author receives nothing.
- Remote code? **None.** All code is in the package; nothing is fetched and run.
- Privacy policy: `PRIVACY.md` in the repository.
- Firefox data-collection declaration: `none` (set in the manifest).

## Notes for reviewers

- To see it working you need a claude.ai account signed in in the same browser. Without
  one, switch on **Options → Demo mode**: every screen then shows made-up but coherent
  data, and nothing is fetched.
- There is no build step. The files in the package are the source files in the
  repository; `scripts/build.mjs` only copies them and writes the manifest for the
  browser.
- One content script runs in the page's main world (`"world": "MAIN"`) on claude.ai. It
  wraps `fetch` to notice when a message is sent and when its reply ends, and passes
  on counts and timings — not message text — so the cost of a message can be measured.
- The native-messaging host is a separate, optional install from the repository's
  `companion/` folder. It is not part of this package.

## Assets still to make

- Screenshots, 1280×800: the popup, the dashboard, the pill on claude.ai, Options.
  Demo mode exists for exactly this.
- Edge: a 300×300 logo. Safari: an app icon set.
