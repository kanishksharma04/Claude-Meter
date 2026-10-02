#!/usr/bin/env node
// The ClaudeMeter companion: a native-messaging host. The browser starts it
// when the extension asks, and talks to it over stdin/stdout; it reads Claude
// Code's logs under ~/.claude and answers with a summary of the usage in them.
// No network, and nothing written under ~/.claude. The one file it does write
// is its own status file (status-file.mjs), with the plan usage the extension
// passes it, so the `claudemeter` command has something to print.
//
// Wire format (the browser's, not ours): each message is a 32-bit
// little-endian length followed by that many bytes of UTF-8 JSON.
//
//   { type: "ping" }                     -> { type: "pong", version }
//   { type: "get", sessionResetsAt? }    -> { type: "usage", version, data }
//   { type: "watch", sessionResetsAt? }  -> a "usage" now, and another whenever the logs change
//   { type: "plan", plan }               -> (no reply) the plan usage is written to the status file
//   anything that goes wrong             -> { type: "error", version, message }
//
// "get" is one question and one answer, after which the browser closes the
// pipe and this exits. "watch" is the long-lived form: the extension keeps the
// pipe open and this keeps answering, unasked, for as long as it does.

import { join } from "node:path";
import { claudeDir } from "./paths.mjs";
import { createLogReader } from "./read-logs.mjs";
import { watchLogs } from "./watch-logs.mjs";
import { buildStatus, writeStatus } from "./status-file.mjs";
import { summarizeClaudeCode } from "../src/lib/claude-code.js";

export const VERSION = "1.2.0";

/** While watching with nothing changing, send the figures again this often: "today" and the session window move on their own. */
const HEARTBEAT_MS = 5 * 60 * 1000;

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

const readLogs = createLogReader(); // remembers what it has read, so a re-read costs only the new lines
let sessionResetsAt = null;
let watching = null;

async function sendUsage(extra = {}) {
  const { records, titles, files } = await readLogs(claudeDir());
  const data = summarizeClaudeCode(records, { titles, sessionResetsAt });
  send({ type: "usage", version: VERSION, ...extra, data: { ...data, files } });
}

/** A failed push is reported, never thrown: the next change gets another try. */
function push() {
  return sendUsage({ live: true, watching: watching.mode }).catch((err) =>
    send({ type: "error", version: VERSION, message: String(err?.message ?? err) })
  );
}

async function handle(message) {
  try {
    if (message?.type === "ping") return send({ type: "pong", version: VERSION });

    // The plan figures can ride along with any request, or come on their own.
    if (message?.plan) await writeStatus(buildStatus(message.plan));
    if (message?.type === "plan") return;

    if (message?.type === "get" || message?.type === "watch") {
      sessionResetsAt = message.sessionResetsAt ?? null;
      if (message.type === "get") return await sendUsage();

      if (!watching) {
        // Each push waits for the one before, so two can't read the logs at once.
        watching = watchLogs(join(claudeDir(), "projects"), () => (pending = pending.then(push)));
        setInterval(() => (pending = pending.then(push)), HEARTBEAT_MS).unref();
      }
      return await push(); // straight away, and again on every later "watch" (the window moved)
    }
    send({ type: "error", version: VERSION, message: `Unknown request: ${message?.type}` });
  } catch (err) {
    send({ type: "error", version: VERSION, message: String(err?.message ?? err) });
  }
}

let inbox = Buffer.alloc(0);
let pending = Promise.resolve();

process.stdin.on("data", (chunk) => {
  inbox = Buffer.concat([inbox, chunk]);
  while (inbox.length >= 4) {
    const length = inbox.readUInt32LE(0);
    if (inbox.length < 4 + length) break;
    const body = inbox.subarray(4, 4 + length).toString("utf8");
    inbox = inbox.subarray(4 + length);

    let message = null;
    try {
      message = JSON.parse(body);
    } catch {
      // Not JSON: answered as an unknown request below.
    }
    // One at a time, in order, so replies can't overtake each other.
    pending = pending.then(() => handle(message));
  }
});

// The browser closes stdin when it is done with us; finish what's in hand, then go.
process.stdin.on("end", () => {
  watching?.close();
  pending.finally(() => process.exit(0));
});
