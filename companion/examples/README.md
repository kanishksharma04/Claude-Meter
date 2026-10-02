# Reading ClaudeMeter from other tools

While the browser is open with **Show Claude Code usage** on, the companion keeps two
small files up to date in its folder — `~/.claudemeter/` on macOS and Linux,
`%LOCALAPPDATA%\ClaudeMeter\` on Windows (`claudemeter path` prints the exact place):

| File | What it is |
|---|---|
| `status.json` | Plan usage and a digest of Claude Code usage, as JSON. Described field by field in [`../status.schema.json`](../status.schema.json). |
| `status.txt` | The plan usage as one line of text: `5h 62% · wk 71%`. |

Anything that can read a file can use them. Nothing needs to be running besides the
browser, and reading them costs nothing: no network, no process started.

## What `status.json` looks like

```json
{
  "schema": 1,
  "updatedAt": 1791282757297,
  "updatedAtIso": "2026-10-06T09:12:37.297Z",
  "plan": {
    "fetchedAt": 1791282751022,
    "tier": "Max 5x",
    "hidden": false,
    "session": { "percent": 62, "resetsAt": 1791290791000, "resetsAtIso": "2026-10-06T11:26:31.000Z" },
    "weekly": [
      { "label": "All models", "percent": 38, "resetsAt": 1791563551000, "resetsAtIso": "2026-10-09T15:12:31.000Z" },
      { "label": "Opus", "percent": 71, "resetsAt": 1791563551000, "resetsAtIso": "2026-10-09T15:12:31.000Z" }
    ],
    "thresholds": { "warnAt": 80, "dangerAt": 95 }
  },
  "claudeCode": {
    "generatedAt": 1791282757290,
    "session": { "cost": 2.77, "tokens": 6513000, "messages": 64, "from": 1791272791000, "to": 1791290791000 },
    "today": { "cost": 9.61, "tokens": 22598000, "messages": 221 },
    "week": { "cost": 41.97, "tokens": 98693000, "messages": 965 },
    "cacheHitRate": 0.982,
    "topProject": { "name": "billing-api", "cost": 23.5 }
  },
  "display": { "line": "5h 62% · wk 71%" }
}
```

Three things worth knowing before building on it:

- **It can be stale.** Nothing rewrites it while the browser is closed. Compare
  `updatedAt` (or `plan.fetchedAt`) with the clock and decide how old is too old; the
  `claudemeter` command uses fifteen minutes.
- **It can be hidden.** With privacy mode on in the browser, `plan.hidden` is `true`,
  the figures are left out, and `display.line` reads `usage hidden`.
- **Dollar figures are not a bill.** `claudeCode.*.cost` is what the tokens in Claude
  Code's logs would cost at API list prices.

## Raycast

[`raycast-claude-usage.sh`](raycast-claude-usage.sh) is a Raycast *script command*
that shows the line inline and refreshes every minute. Add this folder under
Extensions → Script Commands → Add Directories.

## macOS menu bar (SwiftBar, xbar)

[`menubar-claude-usage.1m.sh`](menubar-claude-usage.1m.sh) puts the line in the menu
bar with the reset times in the menu under it. Copy it into your plugin folder.

## Stream Deck

Stream Deck has no built-in way to show a value from a file, but several plugins
can show the contents of a text file on a key, or run a command and show what it
prints. Point one at `status.txt`, or at `claudemeter status --format "{session}"`
for just the session figure. If a plugin can take a value out of JSON by path,
`plan.session.percent` and `display.line` are the two most useful.

## Anything else

```sh
# shell
cat ~/.claudemeter/status.txt
jq -r '.plan.session.percent' ~/.claudemeter/status.json

# the command, when you want a different shape
claudemeter status --format "{session} / {weekly:Opus}"
claudemeter status --json
```

```python
# Python
import json, pathlib, time
status = json.loads((pathlib.Path.home() / ".claudemeter" / "status.json").read_text())
stale = time.time() * 1000 - status["updatedAt"] > 15 * 60 * 1000
print(status["plan"]["session"]["percent"], "(stale)" if stale else "")
```
