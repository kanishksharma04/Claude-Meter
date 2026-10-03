#!/usr/bin/env node
// Packages ClaudeMeter for each browser.
//
//   node scripts/build.mjs            every target
//   node scripts/build.mjs firefox    just one (chrome, edge, firefox, safari)
//
// There is no compiling or bundling: the extension's files are copied as they
// are, with the manifest that browser needs (scripts/manifest-targets.mjs).
// Each target gets a folder in dist/ that can be loaded unpacked, and a zip
// beside it for the store.

import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestFor, TARGETS } from "./manifest-targets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

/** What ships: the extension itself. The companion, docs and tooling stay in the repository. */
const SHIPPED = ["src", "_locales"];

/** Zips a folder's contents with whatever this system has; returns false when it has nothing suitable. */
function zip(folder, file) {
  try {
    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path "${folder}\\*" -DestinationPath "${file}" -Force`], { stdio: "ignore" });
    } else {
      // -X leaves out file attributes that would make two builds of the same source differ.
      execFileSync("zip", ["-q", "-r", "-X", file, "."], { cwd: folder, stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

export async function build(target) {
  const base = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
  const out = join(DIST, target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const entry of SHIPPED) {
    await cp(join(ROOT, entry), join(out, entry), { recursive: true }).catch((err) => {
      if (err.code !== "ENOENT") throw err; // a folder this version doesn't have yet
    });
  }
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifestFor(target, base), null, 2) + "\n");

  const archive = join(DIST, `claudemeter-${target}-${base.version}.zip`);
  await rm(archive, { force: true });
  return { target, folder: out, archive: zip(out, archive) ? archive : null };
}

async function main() {
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter((target) => !TARGETS.includes(target));
  if (unknown.length > 0) throw new Error(`Unknown target: ${unknown.join(", ")}. Choose from ${TARGETS.join(", ")}.`);

  for (const target of wanted.length > 0 ? wanted : TARGETS) {
    const { folder, archive } = await build(target);
    console.log(`${target.padEnd(8)} ${folder}`);
    console.log(`${"".padEnd(8)} ${archive ?? "(no zip tool found: zip the folder's contents yourself)"}`);
  }
  console.log("\nNext steps for each store are in store/README.md.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
