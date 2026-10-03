# Releasing to the browser stores

`node scripts/build.mjs` makes a package for each browser in `dist/`:

| Target | Folder to load unpacked | Zip to upload | Checked how |
|---|---|---|---|
| Chrome | `dist/chrome` | `claudemeter-chrome-<version>.zip` | Run in Chromium |
| Edge | `dist/edge` | `claudemeter-edge-<version>.zip` | Run in Chromium (Edge uses the same engine and manifest) |
| Firefox | `dist/firefox` | `claudemeter-firefox-<version>.zip` | Mozilla's `web-ext lint`: no errors. **Not yet run in Firefox** |
| Safari | `dist/safari` | — (it goes through Xcode) | Manifest only. **Not yet converted or run in Safari** |

What is different in each is in [`scripts/manifest-targets.mjs`](../scripts/manifest-targets.mjs).
The listing text for all three stores is in [`listing.md`](listing.md).

Publishing needs your own developer account with each store, and each reviews what
you submit. None of that can be done from this repository: the steps below are yours
to carry out.

## Firefox — addons.mozilla.org (AMO)

1. Try it first: `about:debugging` → This Firefox → Load Temporary Add-on → pick
   `dist/firefox/manifest.json`. Check the popup, Options, the sidebar
   (View → Sidebar → ClaudeMeter) and that usage appears with claude.ai signed in.
2. `npx web-ext lint --source-dir dist/firefox` should report no errors. The warnings
   it gives are for Chrome-only calls (`sidePanel`, `offscreen`,
   `windows.onBoundsChanged`) that the code checks for before using.
3. Sign in at <https://addons.mozilla.org/developers/> and submit
   `claudemeter-firefox-<version>.zip` as a new add-on, listed on AMO.
4. Source code: the package is the source — there is no build step, minifier or
   bundler — so answer "no" to "do you use any of these tools". If asked for
   sources anyway, point at the repository and `scripts/build.mjs`.
5. Fill in the listing from `listing.md`, link `PRIVACY.md`, and paste the reviewer
   notes.

What works differently in Firefox: the dashboard is a **sidebar** rather than a side
panel; alert sounds are played by the background page itself; the mini window opens
at its default size each time (Firefox doesn't report window moves); and the Claude
Code companion is installed with `node companion/install.mjs --firefox`.

The add-on's id is `claudemeter@kanishksharma04.github.io` (`GECKO_ID` in
`src/lib/platform.js`). It must stay the same from the first upload onwards.

## Edge — Microsoft Edge Add-ons

1. Try it first: `edge://extensions` → Developer mode → Load unpacked → `dist/edge`.
2. Register at <https://partner.microsoft.com/dashboard/microsoftedge/> (free), create
   a new extension and upload `claudemeter-edge-<version>.zip`.
3. Fill in the listing from `listing.md`: Edge wants the description, a category
   (Productivity), at least one screenshot (1280×800 or 640×400) and a 300×300 logo —
   `src/icons/icon128.png` needs scaling up for that.
4. Privacy: link `PRIVACY.md`, and paste the permission justifications and the
   notes for certification.

Nothing works differently in Edge. The companion's installer already registers with
Edge alongside Chrome.

## Safari — Mac App Store

Safari extensions ship inside a Mac app, built with Xcode. This needs a Mac with
Xcode installed and, to publish, a paid Apple Developer account.

1. Make the Xcode project:

   ```sh
   node scripts/build.mjs safari
   xcrun safari-web-extension-converter dist/safari --project-location safari --app-name ClaudeMeter --bundle-identifier io.github.kanishksharma04.ClaudeMeter
   ```

2. Open the project, run it, and enable the extension in Safari → Settings →
   Extensions (with "Allow unsigned extensions" on in the Develop menu while testing).
3. Check it against claude.ai. The converter prints a warning for each manifest key
   Safari doesn't support; the Safari manifest has already had the known ones removed.
4. Archive and submit through App Store Connect, with the listing from `listing.md`.

What is missing in Safari, because Safari has no such API: desktop notifications (so
alerts reach webhooks and play a sound, but show nothing), the side panel, the `cm`
address-bar keyword, and the Claude Code companion. This port is the least certain of
the three: it has not been built or run, and Safari's support for running a content
script in the page's own world — which ClaudeMeter relies on to see when a message is
sent — should be the first thing checked.

## Chrome Web Store

Not on this list, but for completeness: upload `claudemeter-chrome-<version>.zip` at
<https://chrome.google.com/webstore/devconsole>, with the same listing.
