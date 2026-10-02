#!/usr/bin/env node
// The `claudemeter` command: your claude.ai plan usage in the terminal.
//
//   claudemeter status                  5h 62% · wk 71%
//
// The figures come from the status file the companion keeps up to date while
// the browser is open (see status-file.mjs). This command only reads that file
// — it starts nothing, contacts nothing, and returns at once, so it is safe to
// run on every prompt.

import { readStatus, statusPath } from "./status-file.mjs";
import { formatStatus, DEFAULT_FORMAT, DEFAULT_FORMAT_WITH_RESETS, DEFAULT_MAX_AGE_MINUTES } from "./status-format.mjs";

const HELP = `claudemeter — claude.ai plan usage in the terminal

Usage:
  claudemeter status [options]    print one line of plan usage
  claudemeter path                print where the status file is
  claudemeter help                show this

Options for "status":
  --resets              include the time to each reset: 5h 62% (2h14m) · wk 71% (3d6h)
  --format <template>   say exactly what to print (see below)
  --color               colour each figure green, amber or red, with ANSI codes
  --tmux                the same, with tmux's #[fg=…] codes
  --max-age <minutes>   mark figures older than this with "~" (default ${DEFAULT_MAX_AGE_MINUTES}; 0 = never)
  --json                print the status file itself

Placeholders for --format (the default is "${DEFAULT_FORMAT}"):
  {session}             session (5-hour) usage, e.g. 62%
  {session_reset}       time until the session resets, e.g. 2h14m
  {weekly}              the fullest weekly limit, e.g. 71%
  {weekly:Opus}         a weekly limit by name
  {weekly_label}        which limit {weekly} is
  {weekly_reset}        time until that weekly limit resets, e.g. 3d6h
  {tier}                your plan, when claude.ai reports it
  {age}                 how old the figures are

Where to put it:
  Claude Code status line (~/.claude/settings.json):
    "statusLine": { "type": "command", "command": "claudemeter status" }
  tmux (~/.tmux.conf):
    set -g status-right "#(claudemeter status --tmux)"
  zsh prompt (~/.zshrc):
    RPROMPT='$(claudemeter status)'

The figures are as fresh as ClaudeMeter's last refresh in the browser, and stop
updating when the browser is closed — that is what "~" means.`;

function parseArguments(argv) {
  const options = { command: argv[0] ?? "help", format: null, color: "none", maxAgeMinutes: DEFAULT_MAX_AGE_MINUTES, json: false, resets: false };
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--format") options.format = argv[++index] ?? "";
    else if (argument.startsWith("--format=")) options.format = argument.slice("--format=".length);
    else if (argument === "--max-age") options.maxAgeMinutes = Number(argv[++index]);
    else if (argument.startsWith("--max-age=")) options.maxAgeMinutes = Number(argument.slice("--max-age=".length));
    else if (argument === "--color" || argument === "--colour") options.color = "ansi";
    else if (argument === "--tmux") options.color = "tmux";
    else if (argument === "--json") options.json = true;
    else if (argument === "--resets") options.resets = true;
    else if (argument === "--help" || argument === "-h") options.command = "help";
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!Number.isFinite(options.maxAgeMinutes) || options.maxAgeMinutes < 0) throw new Error("--max-age takes a number of minutes");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.command === "help" || options.command === "--help" || options.command === "-h") return console.log(HELP);
  if (options.command === "path") return console.log(statusPath());
  if (options.command !== "status") throw new Error(`Unknown command: ${options.command}. Try "claudemeter help".`);

  const status = await readStatus();
  if (options.json) {
    if (!status) throw new Error("No status file yet. Open the browser with ClaudeMeter's Claude Code switch on.");
    return console.log(JSON.stringify(status, null, 2));
  }

  const { text, ok } = formatStatus(status, {
    format: options.format ?? (options.resets ? DEFAULT_FORMAT_WITH_RESETS : DEFAULT_FORMAT),
    color: options.color,
    maxAgeMinutes: options.maxAgeMinutes,
  });
  console.log(text);
  // A status line or prompt shows whatever was printed; the exit code is for scripts that want to know.
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`claudemeter: ${err.message}`);
  process.exitCode = 2;
});
