#!/usr/bin/env node
// Checks the translations in src/locales/ against each other: every language
// should translate the same set of English strings, with nothing left empty,
// and every pattern should be a regular expression that compiles.
//
//   node scripts/check-locales.mjs

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCALES = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "locales");

/** @returns {Promise<{ ok: boolean, report: string[] }>} */
export async function checkLocales(directory = LOCALES) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const locales = await Promise.all(files.map(async (file) => [file.replace(".json", ""), JSON.parse(await readFile(join(directory, file), "utf8"))]));
  const every = new Set(locales.flatMap(([, locale]) => Object.keys(locale.strings ?? {})));
  const report = [];

  for (const [code, locale] of locales) {
    const strings = locale.strings ?? {};
    const missing = [...every].filter((key) => !(key in strings));
    const empty = Object.entries(strings).filter(([, value]) => typeof value !== "string" || !value.trim()).map(([key]) => key);
    const broken = (locale.patterns ?? []).filter(([source]) => {
      try {
        new RegExp(source);
        return false;
      } catch {
        return true;
      }
    });
    if (!locale.language) report.push(`${code}: no "language" name`);
    for (const key of missing) report.push(`${code}: not translated: ${key}`);
    for (const key of empty) report.push(`${code}: empty translation for: ${key}`);
    for (const [source] of broken) report.push(`${code}: pattern doesn't compile: ${source}`);
  }
  return { ok: report.length === 0, report, languages: locales.map(([code]) => code), strings: every.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkLocales();
  for (const line of result.report) console.log(line);
  console.log(result.ok ? `${result.languages.length} languages, ${result.strings} strings each: all complete.` : `\n${result.report.length} problem(s).`);
  process.exitCode = result.ok ? 0 : 1;
}
