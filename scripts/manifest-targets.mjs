// The manifest each browser gets. manifest.json at the root of the repository
// is Chrome's, and the one the extension is developed against; the others are
// derived from it here, so a new permission or page only has to be added once.

import { GECKO_ID } from "../src/lib/platform.js";

export const TARGETS = ["chrome", "edge", "firefox", "safari"];

/**
 * The oldest Firefox this is offered to: 140, an extended-support release. Everything used works from
 * 128 (MAIN-world content scripts, optional host permissions in MV3), but 140 is the first to understand
 * the data-collection declaration AMO requires.
 */
const FIREFOX_MIN_VERSION = "140.0";

const without = (list, ...remove) => (list ?? []).filter((item) => !remove.includes(item));

/**
 * @param {"chrome" | "edge" | "firefox" | "safari"} target
 * @param {object} base - the repository's manifest.json, parsed
 * @returns {object} that browser's manifest
 */
export function manifestFor(target, base) {
  const manifest = structuredClone(base);

  // Edge runs Chrome's manifest as it is: same engine, same APIs, side panel and offscreen documents included.
  if (target === "chrome" || target === "edge") return manifest;

  if (target === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        // What AMO asks every add-on to declare. ClaudeMeter collects nothing: what it reads stays in the browser.
        data_collection_permissions: { required: ["none"] },
      },
    };
    // Firefox has no extension service workers; the same file runs as an event page.
    manifest.background = { scripts: [base.background.service_worker], type: "module" };
    // No side panel API, but a sidebar that shows the same page.
    delete manifest.side_panel;
    manifest.sidebar_action = {
      default_title: base.name,
      default_panel: base.side_panel.default_path,
      default_icon: base.icons,
    };
    // No offscreen documents either — and no need: an event page can play a sound itself.
    manifest.permissions = without(base.permissions, "sidePanel", "offscreen");
    manifest.options_ui = { page: base.options_page, open_in_tab: true };
    delete manifest.options_page;
    return manifest;
  }

  if (target === "safari") {
    // Safari has no side panel, offscreen documents, address-bar keywords or notifications,
    // and its native messaging only reaches the app the extension ships inside.
    delete manifest.side_panel;
    delete manifest.omnibox;
    manifest.permissions = without(base.permissions, "sidePanel", "offscreen", "notifications", "nativeMessaging");
    return manifest;
  }

  throw new Error(`Unknown target: ${target}`);
}
