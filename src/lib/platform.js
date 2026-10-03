// Which browser this is running in, and what that changes. ClaudeMeter is
// written against the WebExtensions API that Chrome, Edge, Brave, Firefox and
// Safari share; the few places they differ are decided here and at the call
// sites that ask, never by sniffing the user-agent string.

/** The add-on's id in Firefox, which (unlike Chromium) lets an extension name its own. */
export const GECKO_ID = "claudemeter@kanishksharma04.github.io";

/**
 * @param {string} [extensionUrl] - any URL of the extension's own pages
 * @returns {"chromium" | "firefox" | "safari"}
 */
export function detectBrowser(extensionUrl = globalThis.chrome?.runtime?.getURL?.("") ?? "") {
  if (extensionUrl.startsWith("moz-extension://")) return "firefox";
  if (extensionUrl.startsWith("safari-web-extension://")) return "safari";
  return "chromium";
}

/** The command that installs the Claude Code companion for this browser (see companion/install.mjs). */
export function companionInstallCommand(browser, extensionId) {
  // Firefox knows the add-on by the id in its manifest, so there is nothing to pass.
  return browser === "firefox" ? "node companion/install.mjs --firefox" : `node companion/install.mjs ${extensionId}`;
}
