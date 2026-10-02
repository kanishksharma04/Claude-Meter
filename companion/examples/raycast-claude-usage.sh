#!/bin/bash

# Shows your claude.ai plan usage in Raycast, refreshed every minute.
# To use: in Raycast, Extensions -> Script Commands -> Add Directories, and add
# the folder this file is in (or copy the file into a folder you already use).

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Claude usage
# @raycast.mode inline
# @raycast.refreshTime 1m

# Optional parameters:
# @raycast.icon 📊
# @raycast.packageName ClaudeMeter
# @raycast.description claude.ai session and weekly usage, from ClaudeMeter's status file

# status.txt is the plan usage as one line; the companion rewrites it as the figures change.
FILE="${CLAUDEMETER_HOME:-$HOME/.claudemeter}/status.txt"

if [ -r "$FILE" ]; then
  cat "$FILE"
else
  echo "ClaudeMeter: no data yet"
fi
