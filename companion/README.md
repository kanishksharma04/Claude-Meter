# ClaudeMeter companion

The extension can see your claude.ai plan limits, but not what **Claude Code** is
doing: that lives in log files on your disk, which a browser extension can't read.
The companion is the small program that can. The browser starts it when ClaudeMeter
asks, it reads Claude Code's logs, answers with a summary, and that is all it does.

- It reads `~/.claude/projects/**/*.jsonl` (or wherever `CLAUDE_CONFIG_DIR` points).
  It never writes, moves or deletes anything there.
- It makes no network connections. What it reads goes to the extension over the
  browser's own [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
  pipe and nowhere else.
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

| | Launcher | Manifest |
|---|---|---|
| **macOS** | `~/.claudemeter/claudemeter-agent` | `~/Library/Application Support/<browser>/NativeMessagingHosts/com.claudemeter.agent.json` |
| **Linux** | `~/.claudemeter/claudemeter-agent` | `~/.config/<browser>/NativeMessagingHosts/com.claudemeter.agent.json` |
| **Windows** | `%LOCALAPPDATA%\ClaudeMeter\claudemeter-agent.cmd` | `%LOCALAPPDATA%\ClaudeMeter\com.claudemeter.agent.json`, pointed to by `HKCU\Software\<browser>\NativeMessagingHosts\com.claudemeter.agent` |

The launcher is a two-line script that runs the companion with the full path of the
Node.js you ran the installer with. That matters: a browser started from the dock or
the Start menu doesn't have your shell's `PATH`, so a bare `node` often isn't found.

It covers Chrome, Chromium, Edge, Brave and Vivaldi. On macOS and Linux it writes a
manifest for each of those it finds a profile for; on Windows it sets the registry
value for all of them. Everything is under your own user account — no administrator
rights, nothing system-wide.

## Uninstall

```sh
node companion/install.mjs --uninstall
```

removes the launcher, the manifests and (on Windows) the registry values.

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

## What it sends the extension

| Request | Reply |
|---|---|
| `{ "type": "ping" }` | `{ "type": "pong", "version": "1.0.0" }` |
| `{ "type": "get", "sessionResetsAt": 1790000000000 }` | `{ "type": "usage", "version": "…", "data": { "session", "today", "week", "models", "buckets", "files", "generatedAt" } }` |

`session`, `today` and `week` are totals: `tokens`, `input`, `output`, `cacheRead`,
`cacheWrite`, `cost` (US$ at API list prices) and `messages`. `sessionResetsAt` is
optional — it lets the extension say when the claude.ai session window ends, since
Claude Code draws on the same allowance; without it the window is inferred from the
activity in the logs.

`buckets` is the week's activity in 15-minute slots, as `[slot start, tokens, cost]`
with empty slots left out — what the chart's Claude Code bars are drawn from.
