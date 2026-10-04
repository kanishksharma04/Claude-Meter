// First-run page: opened once by the service worker when the extension is
// installed, and reachable again from Options. It checks that claude.ai is
// signed in, explains each permission, and offers the alert settings.

import { getSettings, setSettings } from "../lib/storage.js";
import { applyTheme, onSystemThemeChange } from "../lib/theme.js";
import { addThreshold, removeThreshold } from "../lib/thresholds.js";

const signinStatus = document.getElementById("signinStatus");
const openClaudeBtn = document.getElementById("openClaudeBtn");
const recheckBtn = document.getElementById("recheckBtn");
const demoBtn = document.getElementById("demoBtn");
const permissionList = document.getElementById("permissionList");
const notificationsToggle = document.getElementById("notificationsToggle");
const thresholds = document.getElementById("thresholds");
const thresholdChecks = [...document.querySelectorAll(".threshold-check")];
const testNote = document.getElementById("testNote");

// Why ClaudeMeter asks for each thing in its manifest. Keyed by the manifest
// string, so the list on the page is always the list Chrome actually granted.
const PERMISSION_REASONS = {
  "https://claude.ai/*": {
    name: "Your data on claude.ai",
    why: "Read your usage numbers from claude.ai with the session you're already signed in with, and draw the usage pill on claude.ai pages. Your cookies and messages are never read or stored.",
  },
  storage: {
    name: "Storage",
    why: "Keep your settings and recent usage readings in this browser.",
  },
  unlimitedStorage: {
    name: "Unlimited storage",
    why: "Keep every reading in a database in this browser, so the chart can go back years instead of a day. Nothing is uploaded.",
  },
  downloads: {
    name: "Downloads",
    why: "Save the backups you switched on to a ClaudeMeter folder in Downloads, and remove the older ones. Asked for only when you turn backups on.",
  },
  alarms: {
    name: "Alarms",
    why: "Wake up every few minutes to refresh your usage, even with no claude.ai tab open.",
  },
  notifications: {
    name: "Notifications",
    why: "Show the alerts you choose in step 3. None are sent unless you turn them on.",
  },
  sidePanel: {
    name: "Side panel",
    why: "Offer the dashboard in Chrome's side panel.",
  },
  offscreen: {
    name: "Offscreen document",
    why: "Play a short sound with an alert, if you turn that on in Options. It needs a hidden page to do it, which is opened for the second the sound lasts and nothing else.",
  },
  nativeMessaging: {
    name: "Native messaging",
    why: "Talk to the ClaudeMeter companion, if you install it, to show Claude Code usage from the logs on this computer. Without the companion and its switch in Options, this is never used.",
  },
  contextMenus: {
    name: "Context menu",
    why: "Add Refresh, Snooze and a few shortcuts to the menu you get by right-clicking the ClaudeMeter icon. Nothing is added to web pages' own menus.",
  },
};

const SIGNIN_PROBLEMS = {
  NOT_LOGGED_IN: "You're not signed in to claude.ai in this browser. Sign in, then come back to this tab.",
  UNPARSEABLE_RESPONSE: "claude.ai answered, but not with usage figures ClaudeMeter can read. Its API may have changed: the health page can report it.",
  NO_LIMITS: "You're signed in, but this organisation has no session or weekly limit to show.",
  NETWORK_ERROR: "Couldn't reach claude.ai. Check your connection and try again.",
  NO_ORGS: "claude.ai didn't return an account to read usage from. Sign in to claude.ai and try again.",
};

function setSigninStatus(state, text) {
  signinStatus.dataset.state = state;
  signinStatus.textContent = text;
  openClaudeBtn.hidden = state !== "problem";
  // Not signed in shouldn't be a dead end: demo data lets you see what you'd get.
  demoBtn.hidden = state === "ok" || state === "checking";
  demoBtn.textContent = state === "demo" ? "Turn demo data off" : "Look around with demo data";
}

async function checkSignin() {
  setSigninStatus("checking", "Checking…");
  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ type: "CLAUDEMETER_REFRESH" });
  } catch {
    // The background worker was restarting; treated like any other failed check below.
  }

  if (result?.demo) {
    // A demo "refresh" always succeeds, so it says nothing about being signed in.
    setSigninStatus(
      "demo",
      "Demo data is on, so ClaudeMeter is showing made-up numbers and not contacting claude.ai. Turn it off to check your sign-in."
    );
  } else if (result?.ok) {
    const pct = result.snapshot?.session?.percentUsed;
    setSigninStatus(
      "ok",
      pct != null ? `Signed in. Your current session is at ${pct}%.` : "Signed in. ClaudeMeter can read your usage."
    );
  } else {
    const code = result?.error?.code;
    setSigninStatus("problem", SIGNIN_PROBLEMS[code] ?? "Couldn't read your usage from claude.ai just now. Try again in a moment.");
  }
}

function renderPermissions() {
  const manifest = chrome.runtime.getManifest();
  const granted = [...(manifest.host_permissions ?? []), ...(manifest.permissions ?? [])];

  permissionList.replaceChildren(
    ...granted.flatMap((permission) => {
      const reason = PERMISSION_REASONS[permission];
      const term = document.createElement("dt");
      const code = document.createElement("code");
      code.textContent = permission;
      term.append(reason?.name ?? permission, code);

      const detail = document.createElement("dd");
      detail.textContent = reason?.why ?? "Used by a ClaudeMeter feature.";
      return [term, detail];
    })
  );
}

function renderAlerts(settings) {
  notificationsToggle.checked = settings.notificationsEnabled;
  thresholds.classList.toggle("disabled", !settings.notificationsEnabled);
  for (const check of thresholdChecks) {
    check.checked = settings.notifyThresholds.includes(Number(check.value));
    check.disabled = !settings.notificationsEnabled;
  }
}

notificationsToggle.addEventListener("change", async () => {
  renderAlerts(await setSettings({ notificationsEnabled: notificationsToggle.checked }));
});

for (const check of thresholdChecks) {
  check.addEventListener("change", async () => {
    // Only this one value changes: thresholds added in Options are left as they are.
    const { notifyThresholds } = await getSettings();
    const change = check.checked ? addThreshold : removeThreshold;
    await setSettings({ notifyThresholds: change(notifyThresholds, check.value) });
  });
}

document.getElementById("testNotificationBtn").addEventListener("click", () => {
  chrome.notifications.create(`claudemeter-test-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("src/icons/icon128.png"),
    title: "ClaudeMeter",
    message: "This is what a usage alert looks like.",
  });
  testNote.textContent =
    "Sent. If nothing appeared, your system's notification settings are blocking this browser — alerts won't show until that's allowed.";
});

openClaudeBtn.addEventListener("click", () => chrome.tabs.create({ url: "https://claude.ai/" }));
recheckBtn.addEventListener("click", checkSignin);
demoBtn.addEventListener("click", async () => {
  await setSettings({ demoMode: signinStatus.dataset.state !== "demo" });
  // Give the worker a beat to swap datasets before asking it again.
  setTimeout(checkSignin, 400);
});
document.getElementById("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());

// Coming back to this tab after signing in elsewhere should just work.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && signinStatus.dataset.state === "problem") checkSignin();
});

onSystemThemeChange(async () => applyTheme(await getSettings()));

const settings = await getSettings();
applyTheme(settings);
renderPermissions();
renderAlerts(settings);
checkSignin();
