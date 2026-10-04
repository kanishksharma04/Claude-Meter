// What the tests share: stand-ins for the parts of a browser the code under
// test talks to. Nothing here is a test.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const read = (path) => readFileSync(join(ROOT, path), "utf8");

const tick = () => new Promise((done) => setTimeout(done, 1));

/**
 * chrome.storage.local, near enough: asynchronous, and handing out copies, so
 * that a read followed by a write really can be overtaken by another.
 */
export function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  const area = {
    async get(keys) {
      await tick();
      const wanted = keys == null ? Object.keys(data) : [].concat(keys);
      return structuredClone(Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, data[key]])));
    },
    async set(values) {
      await tick();
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      await tick();
      for (const key of [].concat(keys)) delete data[key];
    },
    async clear() {
      await tick();
      for (const key of Object.keys(data)) delete data[key];
    },
  };
  return { data, area };
}

/** Puts a chrome with that storage where lib/storage.js will find it, and returns what is stored. */
export function installChrome(initial = {}) {
  const { data, area } = fakeStorage(initial);
  globalThis.chrome = { storage: { local: area, session: fakeStorage().area, onChanged: { addListener() {} } } };
  return data;
}

/** A window that can only do what the content scripts ask of one: listen for events, dispatch them, and fetch. */
export function fakeWindow(respond) {
  const listeners = new Map();
  const dispatched = [];
  const window = {
    location: { href: "https://claude.ai/new", origin: "https://claude.ai" },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    dispatchEvent(event) {
      dispatched.push(event);
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    fetch: async (input) => respond(new URL(typeof input === "string" ? input : input.url, "https://claude.ai")),
  };
  return { window, dispatched };
}

export class FakeCustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
}

/** Runs one of the extension's classic (non-module) scripts with the given globals. */
export function runScript(path, globals) {
  const context = vm.createContext({ URL, TextDecoder, Response, JSON, Date, Math, RegExp, Promise, setTimeout, console: { log() {}, warn() {}, error() {} }, CustomEvent: FakeCustomEvent, ...globals });
  vm.runInContext(read(path), context, { filename: path });
  return context;
}

export const soon = (ms = 30) => new Promise((done) => setTimeout(done, ms));
