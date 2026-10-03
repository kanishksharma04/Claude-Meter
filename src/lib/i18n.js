// Translations for ClaudeMeter's own pages.
//
// The pages are written in English, and translated in place when they load:
// every piece of text on the page — and every tooltip, label and placeholder —
// is looked up in the chosen language's dictionary, which is keyed by the
// English text itself (src/locales/<code>.json). Text with no entry stays as
// it is, so a string that hasn't been translated yet shows in English rather
// than breaking, and new English copy needs no key invented for it.
//
// What this covers is the fixed text of the pages. Sentences assembled from
// the user's data ("on course for 84%", the alerts, the advice in the
// dashboard) are built elsewhere and are not translated yet, apart from the
// few shapes listed under "patterns" in each locale file.

/** The languages offered, by locale code, each under its own name. */
export const LANGUAGES = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  ja: "日本語",
  hi: "हिन्दी",
  zh_CN: "简体中文",
};

/**
 * Which language to use: the user's choice, or — on "auto" — the browser's,
 * where there is a translation for it; English otherwise.
 * @param {string} setting - a key of LANGUAGES, or "auto"
 * @param {string} [browserLanguage] - e.g. "es-MX", "zh-TW", "de"
 */
export function resolveLanguage(setting, browserLanguage = globalThis.navigator?.language ?? "en") {
  if (setting && setting !== "auto") return setting in LANGUAGES ? setting : "en";
  const tag = String(browserLanguage).toLowerCase();
  // Simplified Chinese is the only Chinese here; better that than English for a Chinese-language browser.
  if (tag.startsWith("zh")) return "zh_CN";
  const base = tag.split("-")[0];
  return base in LANGUAGES ? base : "en";
}

/** Text as it is looked up: runs of whitespace (the HTML's indentation) count as one space. */
const normalize = (text) => text.replace(/\s+/g, " ").trim();

/**
 * @param {{ strings: Record<string, string>, patterns?: Array<[string, string]> }} locale
 * @returns {(text: string) => string | null} the translation of a piece of text, keeping the
 *   whitespace around it, or null when there isn't one
 */
export function createTranslator(locale) {
  const strings = locale?.strings ?? {};
  const patterns = (locale?.patterns ?? []).map(([source, replacement]) => [new RegExp(source), replacement]);

  return function translate(text) {
    const key = normalize(text ?? "");
    if (!key) return null;

    let translated = Object.hasOwn(strings, key) ? strings[key] : null;
    if (translated == null) {
      for (const [pattern, replacement] of patterns) {
        const match = pattern.exec(key);
        if (!match) continue;
        // What the pattern captured may itself have a translation ("just now").
        translated = replacement.replace(/\$(\d)/g, (_, index) => strings[match[index]] ?? match[index] ?? "");
        break;
      }
    }
    if (translated == null) return null;
    // Put back the spaces the text had around it: they separate it from its neighbours.
    return text.slice(0, text.length - text.trimStart().length) + translated + text.slice(text.trimEnd().length);
  };
}

const ATTRIBUTES = ["title", "aria-label", "placeholder"];
/** Never translated: code, and anything marked as the user's own words or data. */
const SKIP = "script, style, code, [data-no-i18n]";

function translateNode(node, translate) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.parentElement?.closest(SKIP)) return;
    const translated = translate(node.nodeValue);
    if (translated != null && translated !== node.nodeValue) node.nodeValue = translated;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || node.closest(SKIP)) return;

  for (const element of [node, ...node.querySelectorAll("*")]) {
    if (element.matches(SKIP)) continue;
    for (const attribute of ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      const translated = value && translate(value);
      if (translated != null && translated !== value) element.setAttribute(attribute, translated);
    }
    // A template's contents are a separate tree; rows are cloned out of it later.
    if (element.tagName === "TEMPLATE") translateNode(element.content, translate);
  }
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) translateNode(text, translate);
}

/** Loads a language's dictionary from the extension's own files. English has none: it is what the pages are written in. */
export async function loadLocale(code) {
  if (code === "en") return null;
  const response = await fetch(chrome.runtime.getURL(`src/locales/${code}.json`));
  return response.ok ? response.json() : null;
}

/**
 * Translates the page into the user's language, and keeps it translated as
 * the page changes.
 * @param {{ language?: string }} settings
 * @returns {Promise<string>} the language now in use
 */
export async function localizePage(settings, root = document.documentElement) {
  const code = resolveLanguage(settings?.language ?? "auto");
  root.lang = code.replace("_", "-");
  const locale = await loadLocale(code).catch(() => null);
  if (!locale) return "en";

  const translate = createTranslator(locale);
  // A DocumentFragment (a template's content) has no element at its top; walk its children.
  const apply = (node) => (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? node.childNodes.forEach((child) => translateNode(child, translate)) : translateNode(node, translate));
  apply(root);

  // Pages redraw themselves as data arrives; whatever they write is translated as it lands.
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") apply(mutation.target);
      else if (mutation.type === "attributes") {
        const value = mutation.target.getAttribute(mutation.attributeName);
        const translated = value && !mutation.target.closest(SKIP) && translate(value);
        if (translated != null && translated !== value) mutation.target.setAttribute(mutation.attributeName, translated);
      } else mutation.addedNodes.forEach(apply);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });

  return code;
}
