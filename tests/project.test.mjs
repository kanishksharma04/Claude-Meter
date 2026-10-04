// The repository as a whole: that the manifest points at files that exist,
// that every import names something its module exports (the extension has no
// bundler to say so), that the translations are complete, and that each
// browser's manifest comes out as it should.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import vm from "node:vm";
import { ROOT, read } from "./helpers.mjs";
import { checkLocales } from "../scripts/check-locales.mjs";
import { manifestFor, TARGETS } from "../scripts/manifest-targets.mjs";

const manifest = JSON.parse(read("manifest.json"));
const exists = (path) => existsSync(join(ROOT, path.split("?")[0]));

function filesUnder(directory, pattern) {
  return readdirSync(join(ROOT, directory)).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(join(ROOT, path)).isDirectory()) return filesUnder(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

test("every file the manifest names is there", () => {
  const named = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    manifest.side_panel.default_path,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((entry) => entry.js),
  ];
  for (const path of named) assert.ok(exists(path), path);
});

test("content scripts are classic scripts: they parse without import or export", () => {
  for (const path of manifest.content_scripts.flatMap((entry) => entry.js)) {
    assert.doesNotThrow(() => new vm.Script(read(path), { filename: path }), path);
  }
});

test("pages load scripts and styles that exist", () => {
  for (const page of filesUnder("src", /\.html$/)) {
    const html = read(page);
    for (const [, reference] of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png|svg))"/g)) {
      if (/^[a-z]+:/.test(reference)) continue;
      assert.ok(existsSync(resolve(ROOT, dirname(page), reference)), `${page} -> ${reference}`);
    }
  }
});

/** The names a module exports, read off its text. */
function exportsOf(path) {
  const source = read(path);
  const names = new Set();
  for (const [, name] of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(name);
  for (const [, list] of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of list.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  if (/^export\s+default\b/m.test(source)) names.add("default");
  return names;
}

test("every import names a file that exists and something it exports", () => {
  const modules = [...filesUnder("src", /\.js$/), ...filesUnder("companion", /\.mjs$/), ...filesUnder("scripts", /\.mjs$/)];
  const problems = [];
  for (const path of modules) {
    for (const [, list, from] of read(path).matchAll(/^import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/gm)) {
      if (!from.startsWith(".")) continue; // node: built-ins
      const target = relative(ROOT, resolve(ROOT, dirname(path), from));
      if (!existsSync(join(ROOT, target))) {
        problems.push(`${path}: ${from} doesn't exist`);
        continue;
      }
      const exported = exportsOf(target);
      for (const part of list.split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name && !exported.has(name)) problems.push(`${path}: ${target} doesn't export ${name}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

/** A module's text with comments and quoted strings emptied, so that a name inside either isn't taken for a use. */
function codeOf(source) {
  return source
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

test("no module uses another module's export without importing it", () => {
  // The large files were split by moving code between modules; a name left behind without its
  // import only fails when that line runs. This reads for it: any exported name, used bare
  // (not as a property or an object key) in a module that neither declares nor imports it.
  const split = [...filesUnder("src/background", /\.js$/), ...filesUnder("src/options", /\.js$/)];
  const everyExport = new Set([...filesUnder("src", /\.js$/)].flatMap((path) => [...exportsOf(path)]));
  const problems = [];
  for (const path of split) {
    const source = read(path);
    const have = new Set();
    for (const [, list] of source.matchAll(/^import\s*\{([^}]*)\}\s*from/gm)) for (const part of list.split(",")) have.add(part.trim().split(/\s+as\s+/).pop());
    for (const [, name] of source.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) have.add(name);
    const code = codeOf(source);
    for (const name of everyExport) {
      if (have.has(name)) continue;
      // Bare, or spread ("...NAME"); and not "name:" as an object key.
      const use = new RegExp(`(?:(?<![.\\w$])|(?<=\\.\\.\\.))${name.replace(/\$/g, "\\$")}(?![\\w$])(?!\\s*:(?!:))`);
      if (use.test(code)) problems.push(`${path} uses ${name}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("the translations are complete", async () => {
  const result = await checkLocales();
  assert.deepEqual(result.report, []);
  assert.equal(result.languages.length, 5);
});

test("every static string on the translated pages has a translation", () => {
  // Text between tags in the pages' HTML, as lib/i18n.js would look it up.
  const strings = JSON.parse(read("src/locales/es.json")).strings;
  const missing = [];
  for (const page of ["src/options/options.html", "src/popup/popup.html", "src/health/health.html"]) {
    const html = read(page).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "");
    for (const [, raw] of html.matchAll(/>([^<>]+)</g)) {
      const text = raw.replace(/&rarr;/g, "→").replace(/&amp;/g, "&").replace(/&hellip;/g, "…").replace(/&middot;/g, "·").replace(/&times;/g, "×").replace(/&nbsp;/g, "\u00a0").replace(/\s+/g, " ").trim();
      if (!text || !/[A-Za-z]{3}/.test(text) || /&[a-z#0-9]+;/.test(text)) continue;
      if (!Object.hasOwn(strings, text)) missing.push(`${page}: ${text}`);
    }
  }
  assert.deepEqual(missing.filter((entry) => !SAME_IN_EVERY_LANGUAGE.includes(entry.split(": ")[1])), []);
});
// Product and plan names, the pages' own titles, a placeholder the page overwrites with a figure,
// and the word typed in a terminal.
const SAME_IN_EVERY_LANGUAGE = ["ClaudeMeter", "Claude Code", "ClaudeMeter — Options", "ClaudeMeter — Health check", "Pro", "Max 5x", "Max 20x", "5 min", "claudemeter"];

test("each browser gets the manifest it needs", () => {
  for (const target of TARGETS) assert.equal(manifestFor(target, manifest).version, manifest.version, target);
  assert.deepEqual(manifestFor("edge", manifest), manifest);
  const firefox = manifestFor("firefox", manifest);
  assert.deepEqual(firefox.background, { scripts: [manifest.background.service_worker], type: "module" });
  assert.ok(firefox.browser_specific_settings.gecko.id);
  assert.ok(!firefox.permissions.includes("offscreen") && !firefox.permissions.includes("sidePanel") && !("side_panel" in firefox));
  const safari = manifestFor("safari", manifest);
  assert.ok(!safari.permissions.includes("nativeMessaging") && !("omnibox" in safari) && !("optional_permissions" in safari));
  assert.throws(() => manifestFor("netscape", manifest));
});

test("the version is a real one, and the README's install steps name files that exist", () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.notEqual(manifest.version, "0.1.0", "the version has been raised since the first release");
  for (const path of ["LICENSE", "PRIVACY.md", "README.md", "companion/install.mjs", "scripts/build.mjs"]) assert.ok(exists(path), path);
});
