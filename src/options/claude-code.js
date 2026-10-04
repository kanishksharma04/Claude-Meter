// Options > Claude Code: the companion's switches, whether it can be reached, and the command that installs it.

import { getAll, setSettings } from "../lib/storage.js";
import { detectBrowser, companionInstallCommand } from "../lib/platform.js";
import { timeAgo } from "../lib/time-format.js";

// -------------------------------------------------------------- claude code --

const claudeCodeToggle = document.getElementById("claudeCodeToggle");

const claudeCodeLiveToggle = document.getElementById("claudeCodeLiveToggle");

const statusFileToggle = document.getElementById("statusFileToggle");

const claudeCodeStatusNote = document.getElementById("claudeCodeStatus");

export const BROWSER = detectBrowser();

const INSTALL_COMMAND = companionInstallCommand(BROWSER, chrome.runtime.id);

/** Says how the companion is doing, and keeps the install steps in view until it answers. */
export async function renderClaudeCode() {
  const { settings, claudeCodeStatus, claudeCode } = await getAll({ logs: false });
  claudeCodeToggle.checked = settings.claudeCode;
  claudeCodeLiveToggle.checked = settings.claudeCodeLive;
  claudeCodeLiveToggle.disabled = !settings.claudeCode;
  document.getElementById("claudeCodeLiveRow").classList.toggle("disabled", !settings.claudeCode);
  document.getElementById("installCommand").textContent = INSTALL_COMMAND;

  const working = settings.claudeCode && claudeCodeStatus?.ok;
  document.getElementById("claudeCodeSetup").hidden = working;
  statusFileToggle.checked = settings.statusFile;
  statusFileToggle.disabled = !settings.claudeCode;
  document.getElementById("statusFileRow").classList.toggle("disabled", !settings.claudeCode);

  // Where the file is, in the companion's own words, once it has said.
  const terminal = document.getElementById("claudeCodeTerminal");
  const file = claudeCodeStatus?.statusFile;
  terminal.hidden = !working || settings.demoMode || !settings.statusFile || !file;
  if (!terminal.hidden) {
    const code = (text) => Object.assign(document.createElement("code"), { textContent: text });
    terminal.replaceChildren(
      "Writing ",
      code(file),
      " (and status.txt beside it). In a terminal, ",
      code("claudemeter status"),
      " prints a line such as ",
      code("5h 62% · wk 71%"),
      "; companion/examples has scripts for Raycast and the menu bar."
    );
  }
  claudeCodeStatusNote.classList.toggle("problem", settings.claudeCode && claudeCodeStatus?.ok === false);
  claudeCodeStatusNote.textContent = !settings.claudeCode
    ? ""
    : settings.demoMode
      ? "Demo mode is on, so these are made-up figures and the companion isn't being asked."
      : !claudeCodeStatus
        ? "Asking the companion…"
        : claudeCodeStatus.ok
          ? `Connected to the companion (version ${claudeCodeStatus.version}). ` +
            (claudeCodeStatus.live
              ? `Live: watching ${claudeCode?.files ?? 0} log file${claudeCode?.files === 1 ? "" : "s"}` +
                (claudeCodeStatus.watching === "polling" ? ", checked every 15 seconds." : " for changes.")
              : `Read ${claudeCode?.files ?? 0} log file${claudeCode?.files === 1 ? "" : "s"} ${timeAgo(claudeCodeStatus.at)}; asked again at each refresh.`)
          : claudeCodeStatus.problem.text;
}

claudeCodeToggle.addEventListener("change", async () => {
  await setSettings({ claudeCode: claudeCodeToggle.checked });
  renderClaudeCode();
});

claudeCodeLiveToggle.addEventListener("change", async () => {
  await setSettings({ claudeCodeLive: claudeCodeLiveToggle.checked });
  renderClaudeCode();
});

statusFileToggle.addEventListener("change", async () => {
  await setSettings({ statusFile: statusFileToggle.checked });
  renderClaudeCode();
});

document.getElementById("claudeCodeCheckBtn").addEventListener("click", async () => {
  claudeCodeStatusNote.textContent = "Asking the companion…";
  claudeCodeStatusNote.classList.remove("problem");
  await chrome.runtime.sendMessage({ type: "CLAUDEMETER_REFRESH_CLAUDE_CODE" }).catch(() => null);
  renderClaudeCode();
});

document.getElementById("copyInstallBtn").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(INSTALL_COMMAND).catch(() => {});
  event.target.textContent = "Copied";
  setTimeout(() => (event.target.textContent = "Copy"), 1500);
});
