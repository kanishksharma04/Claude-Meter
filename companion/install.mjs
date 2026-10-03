#!/usr/bin/env node
// Registers the ClaudeMeter companion with your browsers, so the extension can
// start it — or removes it again.
//
//   node companion/install.mjs <extension-id>             install, for Chrome, Edge, Brave…
//   node companion/install.mjs --firefox                  install, for Firefox
//   node companion/install.mjs <extension-id> --dry-run   show what would be done
//   node companion/install.mjs --uninstall                remove (add --firefox for Firefox's)
//
// The extension id is the 32-letter one on chrome://extensions; the Claude
// Code card in ClaudeMeter's Options shows this command with it filled in.
//
// What "registering" means: a browser will only start a native-messaging host
// it finds a manifest for, and the manifest names the one extension allowed to
// use it. On macOS and Linux the manifest is a file in each browser's
// NativeMessagingHosts folder; on Windows it is a file anywhere, pointed to by
// a registry value under HKEY_CURRENT_USER. Nothing here needs administrator
// rights, and nothing outside your own user profile is touched.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_NAME, dataDir } from "./paths.mjs";
import { GECKO_ID } from "../src/lib/platform.js";
import { statusPath } from "./status-file.mjs";

/** Chromium-family browsers: where each keeps its profile, and its registry root on Windows. */
const BROWSERS = [
  { name: "Chrome", darwin: "Google/Chrome", linux: "google-chrome", registry: "Google\\Chrome" },
  { name: "Chrome Beta", darwin: "Google/Chrome Beta", linux: "google-chrome-beta", registry: null },
  { name: "Chromium", darwin: "Chromium", linux: "chromium", registry: "Chromium" },
  { name: "Edge", darwin: "Microsoft Edge", linux: "microsoft-edge", registry: "Microsoft\\Edge" },
  { name: "Brave", darwin: "BraveSoftware/Brave-Browser", linux: "BraveSoftware/Brave-Browser", registry: "BraveSoftware\\Brave-Browser" },
  { name: "Vivaldi", darwin: "Vivaldi", linux: "vivaldi", registry: "Vivaldi" },
];

export function isExtensionId(value) {
  return /^[a-p]{32}$/.test(String(value ?? ""));
}

/**
 * Everything an install (or uninstall) would write, as data — so it can be
 * shown, tested, and carried out by one small loop.
 *
 * @param {object} options
 * @param {"darwin" | "linux" | "win32"} options.platform
 * @param {string} options.home - the user's home directory
 * @param {Record<string, string | undefined>} options.env
 * @param {string} options.extensionId
 * @param {string} options.nodePath - the Node.js binary to run the agent with
 * @param {string} options.agentPath - companion/claudemeter-agent.mjs
 * @param {string} [options.cliPath] - companion/claudemeter.mjs; when given, a `claudemeter` command is set up too
 * @param {(path: string) => boolean} [options.exists] - "is this browser installed?"
 * @param {boolean} [options.firefox] - register with Firefox instead of the Chromium family
 * @returns {{ files: Array<{ path: string, content: string, mode?: number }>,
 *   registry: Array<{ key: string, value: string }>, browsers: string[], launcher: string, command: string | null }}
 *   `command` is where the `claudemeter` terminal command was put
 */
export function installPlan({ platform, home, env, extensionId, nodePath, agentPath, cliPath = null, exists = existsSync, firefox = false }) {
  const windows = platform === "win32";
  const path = windows ? win32 : posix;
  const directory = dataDir(platform, env, home);

  // The browser needs something it can execute directly. Naming Node by its full path matters:
  // a browser started from the dock or the Start menu doesn't have your shell's PATH.
  const launcher = path.join(directory, windows ? "claudemeter-agent.cmd" : "claudemeter-agent");
  const script = (target) =>
    windows ? `@echo off\r\n"${nodePath}" "${target}" %*\r\n` : `#!/bin/sh\nexec "${nodePath}" "${target}" "$@"\n`;
  const launcherContent = script(agentPath);
  // The terminal command, in a folder of its own so it can go on PATH without the launcher coming too.
  const command = cliPath ? path.join(directory, "bin", windows ? "claudemeter.cmd" : "claudemeter") : null;

  const manifest =
    JSON.stringify(
      {
        name: HOST_NAME,
        description: "ClaudeMeter companion: reads Claude Code usage for the ClaudeMeter extension",
        path: launcher,
        type: "stdio",
        // The two families name the extension allowed in differently: Firefox by add-on id, Chromium by origin.
        ...(firefox ? { allowed_extensions: [GECKO_ID] } : { allowed_origins: [`chrome-extension://${extensionId}/`] }),
      },
      null,
      2
    ) + "\n";

  const files = [{ path: launcher, content: launcherContent, mode: 0o755 }];
  if (command) files.push({ path: command, content: script(cliPath), mode: 0o755 });
  const registry = [];
  const browsers = [];

  if (firefox) {
    // Firefox keeps its hosts in one place per user, whichever channel or profile is in use.
    if (windows) {
      const manifestPath = path.join(directory, `${HOST_NAME}.firefox.json`);
      files.push({ path: manifestPath, content: manifest });
      registry.push({ key: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`, value: manifestPath });
    } else {
      const hosts =
        platform === "darwin"
          ? path.join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts")
          : path.join(home, ".mozilla", "native-messaging-hosts");
      files.push({ path: path.join(hosts, `${HOST_NAME}.json`), content: manifest });
    }
    return { files, registry, browsers: ["Firefox"], launcher, command };
  }

  if (windows) {
    // One manifest file; each browser is told where it is through the registry.
    const manifestPath = path.join(directory, `${HOST_NAME}.json`);
    files.push({ path: manifestPath, content: manifest });
    for (const browser of BROWSERS.filter((b) => b.registry)) {
      registry.push({ key: `HKCU\\Software\\${browser.registry}\\NativeMessagingHosts\\${HOST_NAME}`, value: manifestPath });
      browsers.push(browser.name);
    }
    return { files, registry, browsers, launcher, command };
  }

  const base = platform === "darwin" ? path.join(home, "Library", "Application Support") : path.join(home, ".config");
  const installed = BROWSERS.filter((browser) => exists(path.join(base, browser[platform])));
  // No browser profile found (a fresh machine, or an unusual setup): set up Chrome's folder anyway.
  for (const browser of installed.length > 0 ? installed : [BROWSERS[0]]) {
    files.push({ path: path.join(base, browser[platform], "NativeMessagingHosts", `${HOST_NAME}.json`), content: manifest });
    browsers.push(browser.name);
  }
  return { files, registry, browsers, launcher, command };
}

/** Carries a plan out. `run` executes one command; it is a parameter so tests can watch instead. */
export async function applyPlan(plan, { uninstall = false, run = (command, args) => execFileSync(command, args, { stdio: "ignore" }) } = {}) {
  for (const file of plan.files) {
    if (uninstall) {
      await rm(file.path, { force: true });
      continue;
    }
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, file.mode ? { mode: file.mode } : {});
  }
  for (const { key, value } of plan.registry) {
    try {
      if (uninstall) run("reg", ["delete", key, "/f"]);
      else run("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"]);
    } catch (err) {
      // Deleting a key that was never there is not a failure worth stopping for.
      if (!uninstall) throw new Error(`Couldn't write the registry key ${key}: ${err.message}`);
    }
  }
}

function describe(plan, uninstall) {
  const verb = uninstall ? "remove" : "write";
  return [
    ...plan.files.map((file) => `  ${verb}  ${file.path}`),
    ...plan.registry.map(({ key }) => `  ${uninstall ? "delete" : "set   "} ${key}`),
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const uninstall = args.includes("--uninstall");
  const dryRun = args.includes("--dry-run");
  const firefox = args.includes("--firefox");
  const extensionId = args.find((arg) => !arg.startsWith("--"));

  if (!["darwin", "linux", "win32"].includes(process.platform)) {
    console.error(`Sorry, the companion can't be installed on ${process.platform} yet.`);
    process.exit(1);
  }
  if (!uninstall && !firefox && !isExtensionId(extensionId)) {
    console.error("Usage: node companion/install.mjs <extension-id> [--dry-run]     Chrome, Edge, Brave…");
    console.error("       node companion/install.mjs --firefox [--dry-run]          Firefox");
    console.error("       node companion/install.mjs --uninstall [--firefox]");
    console.error("\nThe extension id is the 32-letter one shown for ClaudeMeter on chrome://extensions.");
    console.error("ClaudeMeter's Options page has this command ready to copy, with the id filled in.");
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const plan = installPlan({
    platform: process.platform,
    home: homedir(),
    env: process.env,
    // Uninstalling removes the same paths whatever id was installed with.
    extensionId: extensionId ?? "a".repeat(32),
    nodePath: process.execPath,
    agentPath: resolve(here, "claudemeter-agent.mjs"),
    cliPath: resolve(here, "claudemeter.mjs"),
    firefox,
    // When uninstalling, clear out every browser's folder, not just the ones that look installed.
    exists: uninstall ? () => true : existsSync,
  });

  if (dryRun) {
    console.log(`This would ${uninstall ? "remove" : "set up"} the companion for ${plan.browsers.join(", ")}:\n`);
    console.log(describe(plan, uninstall));
    return;
  }

  await applyPlan(plan, { uninstall });
  // The status file isn't part of the plan — the companion writes it later — but it goes when the companion does.
  if (uninstall) await rm(statusPath(), { force: true });
  console.log(describe(plan, uninstall));
  console.log(
    uninstall
      ? "\nRemoved. The extension will say the companion isn't installed; switch Claude Code off in its Options."
      : `\nDone, for ${plan.browsers.join(", ")}. Now open ClaudeMeter's Options and switch on "Claude Code".\n` +
          "Keep this folder where it is: the browser runs the companion from here.\n\n" +
          `For plan usage in the terminal, the command is:\n  ${plan.command} status\n` +
          `Put ${dirname(plan.command)} on your PATH to call it as plain "claudemeter" (try "claudemeter help").`
  );
}

// Only when run as a program — the tests import this file for its functions.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
