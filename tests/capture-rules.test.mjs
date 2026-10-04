// The rules for what the page hook may read (src/lib/capture-rules.js), and
// that the two content scripts, which carry their own copies, follow them.

import test from "node:test";
import assert from "node:assert/strict";
import { captureKind, captureAllowed, trimBody, MAX_BODY_CHARS } from "../src/lib/capture-rules.js";
import { fakeWindow, FakeCustomEvent, runScript, soon } from "./helpers.mjs";

const ORG = "11111111-2222-3333-4444-555555555555";
const CHAT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const api = (path) => `https://claude.ai/api/organizations/${ORG}${path}`;

// [address, what it is]
const TABLE = [
  [api("/usage"), "usage"],
  [api("/usage/"), "usage"],
  [api("/usage?x=1"), "usage"],
  [api("/overage_spend_limit"), "spend"],
  [api("/usage/history"), "discovery"],
  [api("/subscription_details"), "discovery"],
  [api("/rate_limits"), "discovery"],
  ["https://claude.ai/api/organizations", "discovery"],
  ["https://claude.ai/api/billing/invoices", "discovery"],
  [api(`/chat_conversations/${CHAT}`), null],
  [api(`/chat_conversations/${CHAT}?tree=True&limit=5`), null],
  [api(`/chat_conversations/${CHAT}/completion`), null],
  [api("/chat_conversations?limit=30"), null],
  [api("/projects/p1/docs"), null],
  [api("/projects/p1/usage"), null],
  [api("/files/f1/usage"), null],
  [api("/memory"), null],
  [api("/artifacts/a1"), null],
  [api(""), null],
  ["https://claude.ai/api/account", null],
  ["https://claude.ai/new", null],
  [`https://evil.example/api/organizations/${ORG}/usage`, null],
  ["not a url", null],
];

test("each address is what the table says", () => {
  for (const [url, kind] of TABLE) assert.equal(captureKind(url), kind, url);
});

test("usage and spend are always allowed; discovery only in developer mode; the rest never", () => {
  for (const [url, kind] of TABLE) {
    assert.equal(captureAllowed(url, false), kind === "usage" || kind === "spend", `off: ${url}`);
    assert.equal(captureAllowed(url, true), kind != null, `on: ${url}`);
  }
});

test("a body is kept whole when small and cut when not", () => {
  assert.deepEqual(trimBody({ a: 1 }), { a: 1 });
  assert.equal(trimBody(null), null);
  const cut = trimBody({ text: "x".repeat(MAX_BODY_CHARS * 2) });
  assert.equal(typeof cut, "string");
  assert.equal(cut.length, MAX_BODY_CHARS);
});

/** The addresses whose answers the real hook hands on, with developer mode as given. */
async function hookCaptures(developerMode) {
  const { window, dispatched } = fakeWindow(() => new Response(JSON.stringify({ text: "PRIVATE" }), { status: 200 }));
  class XMLHttpRequest {}
  XMLHttpRequest.prototype.open = () => {};
  XMLHttpRequest.prototype.send = () => {};
  runScript("src/content/inject-hook.js", { window, XMLHttpRequest });
  if (developerMode) window.dispatchEvent(new FakeCustomEvent("__claudemeter_config__", { detail: "discovery" }));
  for (const [url] of TABLE) if (url.startsWith("http")) await window.fetch(url);
  await soon();
  return new Set(dispatched.filter((event) => event.type === "__claudemeter_capture__").map((event) => event.detail.url));
}

test("the page hook reads exactly what the rules allow", async () => {
  for (const developerMode of [false, true]) {
    const captured = await hookCaptures(developerMode);
    for (const [url] of TABLE.filter(([address]) => address.startsWith("https://claude.ai"))) {
      assert.equal(captured.has(new URL(url).toString()), captureAllowed(url, developerMode), `developer mode ${developerMode}: ${url}`);
    }
  }
});

test("the page hook says it is ready, and stays narrow until told otherwise", async () => {
  const { window, dispatched } = fakeWindow(() => new Response("{}", { status: 200 }));
  class XMLHttpRequest {}
  XMLHttpRequest.prototype.open = () => {};
  XMLHttpRequest.prototype.send = () => {};
  runScript("src/content/inject-hook.js", { window, XMLHttpRequest });
  assert.ok(dispatched.some((event) => event.type === "__claudemeter_hook_ready__"));
  window.dispatchEvent(new FakeCustomEvent("__claudemeter_config__", { detail: "discovery" }));
  window.dispatchEvent(new FakeCustomEvent("__claudemeter_config__", { detail: "off" }));
  await window.fetch(api("/subscription_details"));
  await soon();
  assert.equal(dispatched.filter((event) => event.type === "__claudemeter_capture__").length, 0);
});

test("a conversation's text never leaves the page, only its size", async () => {
  const conversation = { current_leaf_message_uuid: "m2", chat_messages: [{ uuid: "m1", content: [{ type: "text", text: "MY PROMPT" }] }, { uuid: "m2", parent_message_uuid: "m1", content: [{ type: "text", text: "THE REPLY" }] }] };
  const { window, dispatched } = fakeWindow(() => new Response(JSON.stringify(conversation), { status: 200 }));
  class XMLHttpRequest {}
  XMLHttpRequest.prototype.open = () => {};
  XMLHttpRequest.prototype.send = () => {};
  runScript("src/content/inject-hook.js", { window, XMLHttpRequest });
  window.dispatchEvent(new FakeCustomEvent("__claudemeter_config__", { detail: "discovery" }));
  await window.fetch(api(`/chat_conversations/${CHAT}?tree=True`));
  await soon();
  const everything = JSON.stringify(dispatched.map((event) => event.detail ?? null));
  assert.ok(!everything.includes("MY PROMPT") && !everything.includes("THE REPLY"));
  const loaded = dispatched.find((event) => event.detail?.kind === "conversation_loaded");
  assert.equal(loaded.detail.chars, "MY PROMPT".length + "THE REPLY".length);
});

/** What the real relay passes to the background worker, with developer mode as given. */
async function relayForwards(developerMode) {
  const { window } = fakeWindow(() => null);
  const sent = [];
  const chrome = {
    storage: { local: { get: async () => ({ settings: { developerMode } }) }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async (message) => void sent.push(message) },
  };
  runScript("src/content/relay.js", { window, chrome, document: { title: "Claude" } });
  await soon();
  for (const [url] of TABLE) window.dispatchEvent(new FakeCustomEvent("__claudemeter_capture__", { detail: { url, method: "GET", status: 200, responseBody: { big: "x".repeat(50_000) } } }));
  await soon();
  return sent.filter((message) => message.type === "CLAUDEMETER_CAPTURE");
}

test("the relay drops what the rules don't allow, whoever dispatched it", async () => {
  for (const developerMode of [false, true]) {
    const forwarded = new Set((await relayForwards(developerMode)).map((message) => message.capture.url));
    for (const [url] of TABLE) assert.equal(forwarded.has(url), captureAllowed(url, developerMode), `developer mode ${developerMode}: ${url}`);
  }
});

test("the relay cuts an oversized body short", async () => {
  for (const message of await relayForwards(false)) {
    assert.equal(typeof message.capture.responseBody, "string");
    assert.equal(message.capture.responseBody.length, MAX_BODY_CHARS);
  }
});
