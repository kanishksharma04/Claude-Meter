// Where things live on this machine. Shared by the agent and the installer.

import { homedir } from "node:os";
import { join } from "node:path";

/** The native-messaging host's name: what the extension asks the browser to start. */
export { COMPANION_HOST as HOST_NAME } from "../src/lib/claude-code.js";

/** Where Claude Code keeps its logs. CLAUDE_CONFIG_DIR is Claude Code's own override. */
export function claudeDir(env = process.env, home = homedir()) {
  return env.CLAUDE_CONFIG_DIR || join(home, ".claude");
}

/** Where the companion keeps its own few files (the launcher the browser runs). */
export function dataDir(platform = process.platform, env = process.env, home = homedir()) {
  if (env.CLAUDEMETER_HOME) return env.CLAUDEMETER_HOME;
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "ClaudeMeter");
  return join(home, ".claudemeter");
}
