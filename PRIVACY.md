# ClaudeMeter privacy policy

ClaudeMeter is a browser extension that shows your claude.ai usage. This is what it
reads, where it keeps it, and the few cases in which anything leaves your computer.

**The author of ClaudeMeter receives nothing.** There is no ClaudeMeter server, no
account, no analytics and no crash reporting.

## What it reads

- **Your usage figures from claude.ai** — the percentages and reset times claude.ai
  shows on its own usage page, fetched with the sign-in your browser already has.
  ClaudeMeter does not read or store your cookies, password or session tokens.
- **Counts from the claude.ai page** — when a message is sent and when its reply ends,
  how many characters long they were, which model was chosen, and the chat's title.
  The text of your messages and Claude's replies is counted inside the page and goes
  no further: it is not passed to the rest of the extension, stored or logged.
- **claude.ai's own usage requests** — when the claude.ai page itself asks for your
  usage or your extra-usage spend, ClaudeMeter reads that answer too, so its figures
  are current without asking again. Those two requests are the only ones whose answers
  it reads. Requests for chats, projects, files and everything else are left alone.
- **Optionally, more of claude.ai's usage and billing requests** — only while
  Developer mode is switched on in Options. It exists for working out where claude.ai
  keeps its usage figures when it moves them: the last 20 answers to requests whose
  address mentions usage, limits, quota, billing or subscription, and the list of your
  organisations, are kept for the debug page and printed in the page's console. They
  can include your organisation's name and plan. Requests for chats, projects and
  files are never read, in this mode or any other. Switching Developer mode off stops
  it; "Clear stored data" removes what was kept.
- **Optionally, Claude Code's logs on your computer** — only if you install the
  companion program and switch Claude Code on: token counts, model, working
  directory, time and session title from `~/.claude/projects`. Not the conversations.
- **Optionally, your Anthropic Console cost report** — only if you paste in an Admin
  API key.

## Where it is kept

In your browser's extension storage on your computer, unencrypted, like any
extension's data — settings and recent readings in the extension's storage area, and
the long-term archive of readings in a local database (IndexedDB) beside it. "Clear
stored data" in Options removes every reading and log from both, and the Admin API
key if you saved one; your settings stay, webhook addresses among them. "Reset
everything" removes those too, and gives back any optional permission you granted.
Uninstalling the extension removes all of it. If you use the companion, it also writes a small status
file to its own folder in your home directory, which you can switch off.

If you turn on automatic backups, the history (not the settings) is also written to
files in a `ClaudeMeter` folder inside your Downloads folder. They are ordinary,
unencrypted files on your disk: neither "Clear stored data" nor "Reset everything"
removes them, and anything
that syncs or backs up your Downloads folder will take them along.

## What leaves your computer

Nothing, unless you turn one of these on or press the button in the last row:

| You switch on | What is sent | To whom |
|---|---|---|
| Nothing (the default) | Requests for your own usage figures | claude.ai, as your browser would send them |
| A webhook | The text of each usage alert, such as "Current session usage just crossed 80%" | The Slack, Discord or ntfy address you entered |
| Console API spend | Your Admin API key, to read the cost report | api.anthropic.com |
| "Open a GitHub issue" on the health page | The redacted diagnostics described below, inside the link | github.com |

In privacy mode, alert text carries no figures.

**Bug reports.** The health page can open a new GitHub issue with diagnostics filled
in. That is a link your browser opens, with the text in it: GitHub receives it when
you click, nothing is posted until you press Submit there, and the text is shown to
you on the health page first. It contains the extension version, your
browser and operating system, which checks passed, error codes, counts of what is
stored and your settings reduced to switches and numbers. It does not contain
organisation names or ids, keys, webhook addresses, chat titles, notes or usage
figures.

## Permissions

The extension asks for access to `claude.ai` only. Access to Slack, Discord, ntfy or
`api.anthropic.com` is requested one site at a time, when you set that feature up, and
given back when you switch it off. The same goes for permission to save files, which
only automatic backups use. Every other permission is explained in plain words
on the extension's welcome page.

## Changes and contact

Changes to this policy are made in this file, in the project's public repository:
<https://github.com/kanishksharma04/Claude-Meter>. Questions and reports go to its
issue tracker.

ClaudeMeter is an independent project. It is not made by, endorsed by or affiliated
with Anthropic.
