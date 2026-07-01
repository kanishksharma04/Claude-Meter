# ClaudeMeter

A Manifest V3 browser extension that will show your claude.ai Pro/Max plan usage
(session %, weekly %, reset countdowns) from the toolbar, without opening claude.ai's
own account menu.

**Status: Phase 1 — discovery mode.** Anthropic doesn't publish a documented API for
this data, so before building the real popup UI, this build first needs to observe
the exact request/response the claude.ai web app itself uses to render its own "Plan
usage limits" panel. Phase 1 is a diagnostic extension that passively watches network
traffic on `claude.ai` tabs and logs anything usage-related to a debug page.

There is no production usage UI yet — the popup currently just confirms discovery
mode is running and shows how many requests have been captured.

## How it works (and its limits)

- A content script is injected into `claude.ai` in the page's own **main JS world**
  at `document_start`, patching `window.fetch` and `XMLHttpRequest` so it can see
  requests the page makes with its own logged-in session — no credentials are ever
  read, stored, or replayed by the extension itself.
- Only requests whose URL contains `usage`, `limit`, `quota`, `rate`,
  `organizations`, or `billing` are captured (Phase 1 keyword match — Phase 2 will
  narrow this to the exact endpoint once known).
- Captured request/response pairs are relayed to the background service worker and
  stored locally (`chrome.storage.local`, capped at the last 20 captures). Nothing
  leaves the browser — there's no external server this extension talks to.
- Because refresh works by observing the page's own authenticated requests, later
  phases will require an open `claude.ai` tab to actively refresh — this extension
  cannot fetch usage data on its own.

## Project structure

```
claudemeter/
├── manifest.json
├── src/
│   ├── background/service-worker.js   # relays captures into storage, alarm skeleton
│   ├── content/
│   │   ├── inject-hook.js             # MAIN world: patches fetch/XHR, dispatches captures
│   │   └── relay.js                   # ISOLATED world: forwards captures to the background worker
│   ├── popup/                         # toolbar popup (placeholder until Phase 2)
│   ├── options/                       # options page, currently just Developer mode + debug link
│   ├── debug/                         # debug.html — human-readable capture viewer
│   ├── lib/
│   │   ├── storage.js                 # chrome.storage.local schema + helpers
│   │   └── time-format.js             # relative-time / duration formatting helpers
│   └── icons/                         # placeholder icons — swap in real art later
└── README.md
```

## Load it locally (Chrome / Edge)

Requires **Chrome/Edge 111+** — the content script uses the `"world": "MAIN"` key in
`manifest.json` (needed so the hook patches the page's *real* `fetch`/`XMLHttpRequest`
rather than an isolated copy that the page never calls).

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `claudemeter/` folder.
4. The ClaudeMeter icon should appear in your toolbar.

## Reproduce a capture (what I need from you before Phase 2)

1. Load the extension as above.
2. Open a new tab to `https://claude.ai` and open DevTools → Console. You should see
   `[ClaudeMeter:discovery] network hooks installed (fetch + XHR) — watching for...`
   and, from the isolated-world relay, `[ClaudeMeter:discovery] relay content script ready`.
3. In the claude.ai UI itself, open your account/profile menu and click into whatever
   shows your **Plan usage limits** panel (session % / weekly % / reset times) — this
   is the action that makes claude.ai's frontend fetch the real usage data.
4. Click the ClaudeMeter toolbar icon → **View debug captures**, or go to
   `chrome://extensions` → ClaudeMeter → Details → Extension options → **Open Debug
   Captures**.
5. You should see one or more captured entries with method, URL, HTTP status, and the
   raw JSON response body. Use **Copy as JSON** on the relevant entry(ies).
6. Paste that captured JSON back so Phase 2 can add a precise endpoint matcher and a
   normalizer into the real `UsageSnapshot` schema.

If nothing appears: check the DevTools console for `[ClaudeMeter:discovery]` warnings
(the hook logs failures instead of throwing), and confirm the extension has permission
on `claude.ai` (it should, host permissions are pre-granted at install since
`https://claude.ai/*` is declared in the manifest).

## Known limitations (Phase 1)

- No real usage popup yet — this build only proves out the capture mechanism.
- Capture matching is a broad keyword filter, not the real endpoint — expect some
  noise or false negatives depending on what claude.ai's frontend actually calls.
- The background alarm is wired up but currently a no-op; active/background refresh
  logic ships in Phase 2 once there's real data to refresh.
- This will break if Anthropic changes their internal API shape, since it isn't a
  documented, versioned API.

## Next: Phase 2

Once you paste back the real endpoint + sample response JSON, Phase 2 will:

- Replace the keyword filter with a precise match on the real endpoint.
- Add a normalizer mapping the raw response into a clean `UsageSnapshot`.
- Store only normalized snapshots (plus a capped rolling history) by default, and
  move raw debug capture logging behind the (already-built) Developer mode toggle.
- Build out the real popup UI (session/weekly progress bars, plan badge, refresh
  button, relative "last updated" time) and the rest of the options page (refresh
  interval, notification thresholds, theme).
