# ClaudeMeter companion

The extension can see your claude.ai plan limits, but not what **Claude Code** is
doing: that lives in log files on your disk, which a browser extension can't read.
The companion is the small program that can. The browser starts it when ClaudeMeter
asks, it reads Claude Code's logs and answers with a summary — once, or again each
time the logs change — and that is all it does.

- It reads `~/.claude/projects/**/*.jsonl` (or wherever `CLAUDE_CONFIG_DIR` points).
  It never writes, moves or deletes anything there. From each file it takes the token
  counts, the model, the working directory, the time, and the session's title.
- It makes no network connections. What it reads goes to the extension over the
  browser's own [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
  pipe and nowhere else.
- The one thing it writes is its own status file, `~/.claudemeter/status.json` (and
  `status.txt` beside it), with the plan usage the extension passes it and a digest
  of the Claude Code figures — for the `claudemeter` terminal command and for any
  other local tool you point at it. One switch in Options turns that off.
- It has no dependencies beyond Node.js itself.

## What you need

- **Node.js 18 or newer.**
- ClaudeMeter loaded in your browser, and its folder left where it is: the companion
  runs from `companion/` and shares code with the extension in `src/lib/`.

## Install

1. Open ClaudeMeter's **Options → Claude Code**. It shows the command to run, with
   your copy's extension id already in it.
2. Run it in a terminal, from the ClaudeMeter folder:

   ```sh
   node companion/install.mjs <extension-id>
   ```

3. Back in Options, switch **Show Claude Code usage** on. It should say "Connected".

The same command works on **macOS, Linux and Windows**. To see what it would do
without doing it, add `--dry-run`.

### What the installer does

A browser will only start a native-messaging host it has been told about, by a small
manifest naming the program and the one extension allowed to use it.

| | Launcher | Manifest | Terminal command |
|---|---|---|---|
| **macOS** | `~/.claudemeter/claudemeter-agent` | `~/Library/Application Support/<browser>/NativeMessagingHosts/com.claudemeter.agent.json` | `~/.claudemeter/bin/claudemeter` |
| **Linux** | `~/.claudemeter/claudemeter-agent` | `~/.config/<browser>/NativeMessagingHosts/com.claudemeter.agent.json` | `~/.claudemeter/bin/claudemeter` |
| **Windows** | `%LOCALAPPDATA%\ClaudeMeter\claudemeter-agent.cmd` | `%LOCALAPPDATA%\ClaudeMeter\com.claudemeter.agent.json`, pointed to by `HKCU\Software\<browser>\NativeMessagingHosts\com.claudemeter.agent` | `%LOCALAPPDATA%\ClaudeMeter\bin\claudemeter.cmd` |

The launcher is a two-line script that runs the companion with the full path of the
Node.js you ran the installer with. That matters: a browser started from the dock or
the Start menu doesn't have your shell's `PATH`, so a bare `node` often isn't found.

It covers Chrome, Chromium, Edge, Brave and Vivaldi. On macOS and Linux it writes a
manifest for each of those it finds a profile for; on Windows it sets the registry
value for all of them. Everything is under your own user account — no administrator
rights, nothing system-wide.

## In the terminal: `claudemeter status`

The installer also sets up a `claudemeter` command (it prints where). It shows your
**claude.ai plan usage** — the same percentages as the popup — as one line:

```console
$ claudemeter status
5h 62% · wk 71%
$ claudemeter status --resets
5h 62% (2h14m) · wk 71% (3d6h)
```

`5h` is the session, `wk` the fullest of your weekly limits.

| Option | |
|---|---|
| `--resets` | add the time until each reset |
| `--format <template>` | say exactly what to print, with the placeholders below |
| `--color` | colour each figure green, amber or red (ANSI), by the warning levels you set in Options |
| `--tmux` | the same, with tmux's `#[fg=…]` codes |
| `--max-age <minutes>` | mark figures older than this with `~` (default 15; 0 = never) |
| `--json` | print the status file itself |

Placeholders: `{session}`, `{session_reset}`, `{weekly}` (the fullest weekly limit),
`{weekly:Opus}` (one by name), `{weekly_label}`, `{weekly_reset}`, `{tier}`, `{age}`.

Where to put it:

```jsonc
// Claude Code status line — ~/.claude/settings.json
{ "statusLine": { "type": "command", "command": "claudemeter status" } }
```

```tmux
# tmux — ~/.tmux.conf
set -g status-right "#(claudemeter status --tmux)"
```

```zsh
# zsh prompt — ~/.zshrc
setopt prompt_subst
RPROMPT='$(claudemeter status)'
```

If `claudemeter` isn't on your `PATH`, use the full path the installer printed
(`~/.claudemeter/bin/claudemeter`, or `%LOCALAPPDATA%\ClaudeMeter\bin\claudemeter.cmd`).

**How it knows.** Plan usage only exists inside the browser, so the extension hands
it to the companion with each refresh, and the companion writes it to
`~/.claudemeter/status.json` (`claudemeter path` prints the exact place). The
command just reads that file: it starts nothing, contacts nothing, and takes a few
hundredths of a second, so it is safe to run on every prompt. The other side of that
is that the figures stop moving when the browser is closed — that is what `~` means
— and that it needs **Show Claude Code usage** switched on in Options. With privacy
mode on in the browser, it prints `usage hidden`.

`claudemeter status` exits 0 when it printed figures, 1 when there were none yet, and
2 for a mistake in the options.

## For other tools: `status.json`

The file the command reads is there for anything else to read too — Raycast, Stream
Deck, a menu-bar tool, a script. It is plain JSON with a fixed format
([`status.schema.json`](status.schema.json)), rewritten whenever the figures change,
with `status.txt` beside it holding the one-line form. [`examples/`](examples/) has a
Raycast script command and a SwiftBar/xbar plugin ready to use, and a walk through
the fields.

To stop it being written, switch off **Share usage with local tools** in Options; the
companion removes both files, and `claudemeter status` goes back to "no data yet".

## Uninstall

```sh
node companion/install.mjs --uninstall
```

removes the launcher, the terminal command, the manifests, the status file and (on
Windows) the registry values.

## If it doesn't connect

Options says which of these it is:

- **"isn't installed for this browser"** — the manifest isn't where this browser
  looks. Run the install command again; if you use a browser not in the list above,
  copy the manifest into its `NativeMessagingHosts` folder by hand.
- **"installed for a different extension id"** — an unpacked extension's id depends
  on the folder it was loaded from, so it changes if you move the folder or load a
  second copy. Run the command Options shows now.
- **"started but stopped at once"** — Node.js is missing or older than 18, the
  ClaudeMeter folder has moved since you installed, or (if you use a version manager)
  the Node.js you installed with has been removed. Run the install command again.

## Live or on request

With **Update live** on in Options (the default), the extension opens one connection
and leaves it open. The companion watches `~/.claude/projects`, and when a log
changes it reads the new lines and sends the figures again — after a second's lull,
or every five seconds while a reply is still streaming in. It stays running for as
long as the browser keeps the connection, and exits when it is closed.

With it off, the browser starts the companion at each refresh, asks once, and the
companion exits as soon as it has answered.

## What it sends the extension

| Request | Reply |
|---|---|
| `{ "type": "ping" }` | `{ "type": "pong", "version": "1.3.0" }` |
| `{ "type": "plan", "plan": { … }, "statusFile": true }` | none — the plan usage is written to the status file, or with `"statusFile": false` the file is removed. Both may also ride along on a `get` or `watch` |
| `{ "type": "watch", "sessionResetsAt": 1790000000000 }` | a `usage` reply now, and another — with `"live": true` — every time the logs change, for as long as the connection stays open |
| `{ "type": "get", "sessionResetsAt": 1790000000000 }` | `{ "type": "usage", "version": "…", "data": { "session", "today", "week", "models", "cache", "buckets", "projects", "sessions", "files", "generatedAt" } }` |

A `usage` reply also carries `statusFile`: the path of the status file, or null while
it is switched off.

`session`, `today` and `week` are totals: `tokens`, `input`, `output`, `cacheRead`,
`cacheWrite`, `cost` (US$ at API list prices) and `messages`. `sessionResetsAt` is
optional — it lets the extension say when the claude.ai session window ends, since
Claude Code draws on the same allowance; without it the window is inferred from the
activity in the logs.

`cache` has `today` and `week`, each with `read`, `write` and `input` tokens,
`hitRate` (the share of prompt tokens served from the cache), `readsPerWrite`, and
in US$ `paid` (what the cached tokens cost), `uncached` (what they would have cost
as plain input) and `saved`.

`buckets` is the week's activity in 15-minute slots, as `[slot start, tokens, cost]`
with empty slots left out — what the chart's Claude Code bars are drawn from.

`projects` is the week by working directory, costliest first, up to twelve:
`cwd`, a short `name`, `tokens`, `cost`, `costToday`, `messages`, `sessions`, `lastAt`.

`sessions` is the week's eight costliest sessions: `sessionId`, `title` (the one Claude
Code wrote, or null), `project`, `model`, `startedAt`, `lastAt`, `tokens`, `cost`,
`messages`. Titles are the only free text the companion ever passes on; prompts and
replies are never read beyond their token counts.
