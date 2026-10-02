#!/usr/bin/env node
// The ClaudeMeter companion: a native-messaging host. The browser starts it
// when the extension asks, and talks to it over stdin/stdout; it reads Claude
// Code's logs under ~/.claude and answers with a summary of the usage in them.
// It reads, and that is all — no network, nothing written under ~/.claude.
//
// Wire format (the browser's, not ours): each message is a 32-bit
// little-endian length followed by that many bytes of UTF-8 JSON.
//
//   { type: "ping" }                     -> { type: "pong", version }
//   { type: "get", sessionResetsAt? }    -> { type: "usage", version, data }
//   anything that goes wrong             -> { type: "error", version, message }

import { claudeDir } from "./paths.mjs";
import { readUsage } from "./read-logs.mjs";
import { summarizeClaudeCode } from "../src/lib/claude-code.js";

export const VERSION = "1.0.0";

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

async function handle(message) {
  try {
    if (message?.type === "ping") return send({ type: "pong", version: VERSION });
    if (message?.type === "get") {
      const { records, files } = await readUsage(claudeDir());
      const data = summarizeClaudeCode(records, { sessionResetsAt: message.sessionResetsAt ?? null });
      return send({ type: "usage", version: VERSION, data: { ...data, files } });
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
process.stdin.on("end", () => pending.finally(() => process.exit(0)));
