// Which theme and accent an extension page should wear. The palettes
// themselves are in src/shared/theme.css; this only picks one and sets the
// accent. Mirrored (in miniature) in src/content/page-ui.js for the in-page UI.

export const DEFAULT_ACCENT = "clay";

/** Accent presets, in the order the options page offers them. */
export const ACCENTS = {
  clay: { label: "Clay", color: "#cc785c" },
  ocean: { label: "Ocean", color: "#4a8fd9" },
  forest: { label: "Forest", color: "#4f9a6a" },
  violet: { label: "Violet", color: "#8b6fd6" },
  rose: { label: "Rose", color: "#d6608a" },
  slate: { label: "Slate", color: "#7d8ba0" },
};

export function accentColor(accent) {
  return (ACCENTS[accent] ?? ACCENTS[DEFAULT_ACCENT]).color;
}

/**
 * "auto" follows the system: high contrast if it asks for more contrast,
 * otherwise its light/dark preference.
 * @returns {"light" | "dark" | "contrast"}
 */
export function resolveTheme(theme, matches = (query) => matchMedia(query).matches) {
  if (theme === "light" || theme === "dark" || theme === "contrast") return theme;
  if (matches("(prefers-contrast: more)")) return "contrast";
  return matches("(prefers-color-scheme: dark)") ? "dark" : "light";
}

export function applyTheme(settings, root = document.documentElement) {
  const theme = resolveTheme(settings.theme);
  root.dataset.theme = theme;
  // The high-contrast palette brings its own accent — a preset tuned for the
  // regular themes could undo the contrast it exists to provide.
  if (theme === "contrast") root.style.removeProperty("--accent");
  else root.style.setProperty("--accent", accentColor(settings.accent));
}

/** Calls back when the system's light/dark or contrast preference flips, so "auto" stays in step. */
export function onSystemThemeChange(callback) {
  for (const query of ["(prefers-color-scheme: dark)", "(prefers-contrast: more)"]) {
    matchMedia(query).addEventListener("change", callback);
  }
}
