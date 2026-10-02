#!/bin/bash

# Your claude.ai plan usage in the macOS menu bar, for SwiftBar or xbar.
# To use: copy this file into your plugin folder. The ".1m." in its name is how
# those tools are told to run it every minute.

# <xbar.title>Claude usage</xbar.title>
# <xbar.desc>claude.ai session and weekly usage, from ClaudeMeter's status file</xbar.desc>
# <xbar.dependencies>ClaudeMeter companion</xbar.dependencies>

HOME_DIR="${CLAUDEMETER_HOME:-$HOME/.claudemeter}"
CLAUDEMETER="$HOME_DIR/bin/claudemeter"

if [ ! -x "$CLAUDEMETER" ] || [ ! -r "$HOME_DIR/status.json" ]; then
  echo "Claude –"
  echo "---"
  echo "ClaudeMeter has no data yet"
  echo "Install the companion and switch on Claude Code in ClaudeMeter's Options"
  exit 0
fi

# The first line is what sits in the menu bar; everything after "---" is the menu under it.
"$CLAUDEMETER" status
echo "---"
"$CLAUDEMETER" status --format "Session: {session} · resets in {session_reset}"
"$CLAUDEMETER" status --format "Weekly ({weekly_label}): {weekly} · resets in {weekly_reset}"
"$CLAUDEMETER" status --format "Figures are {age} old"
