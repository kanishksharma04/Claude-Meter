#!/usr/bin/env node
// Parses every script in the repository, so a typo is caught here and not by
// a browser refusing to load the extension. Nothing is run.
//
//   node scripts/check-syntax.mjs

import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "dist", ".git"]);

async function scripts(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await scripts(path)));
    else if (/\.m?js$/.test(entry.name)) found.push(path);
  }
  return found;
}

const files = await scripts(ROOT);
const broken = [];
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    broken.push(`${relative(ROOT, file)}\n${String(error.stderr).trim()}`);
  }
}
for (const report of broken) console.error(report + "\n");
console.log(broken.length === 0 ? `${files.length} scripts parse.` : `${broken.length} of ${files.length} scripts don't parse.`);
process.exitCode = broken.length === 0 ? 0 : 1;
