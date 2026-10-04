// Alerts: deciding that something is worth saying, and saying it — as a
// desktop notification, to the user's webhooks, with a sound. Every alert
// leaves through sendAlert(), which is where snooze, quiet hours and privacy
// mode are honoured.

import { getAll, getSettings, recordSpike, recordWebhookResults } from "../lib/storage.js";
import { isSnoozed } from "../lib/snooze.js";
import { describeSpike } from "../lib/spikes.js";
import { crossedThreshold, alreadyAlerted, noteAlerted } from "../lib/thresholds.js";
import { paceAlert, describePace } from "../lib/pace.js";
import { resetsToAnnounce, nextResetCheck, describeReset } from "../lib/reset-alert.js";
import { deliverWebhooks } from "../lib/webhooks.js";
import { isQuiet } from "../lib/quiet-hours.js";
import { buildDigest, nextDigestAt } from "../lib/digest.js";
import { scheduleSound } from "../lib/sounds.js";
import { refreshUsage } from "./refresh.js";
import { LOG_PREFIX, RESET_ALARM_NAME, DIGEST_ALARM_NAME, DASHBOARD_URL, openUrl } from "./shared.js";

// ------------------------------------------------------------ notifications --

function bucketsOf(snapshot) {
  if (!snapshot) return [];
  const buckets = [...(snapshot.weekly ?? [])];
  if (snapshot.session) buckets.push({ ...snapshot.session, label: snapshot.session.label ?? "Current session" });
  // The monthly extra-usage cap is alerted on like any other limit.
  const extra = snapshot.extraUsage;
  if (extra?.enabled && extra.percentUsed != null) {
    buckets.push({ label: "Extra usage", percentUsed: extra.percentUsed, subject: "Extra usage", of: " of this month's cap" });
  }
  return buckets;
}

/**
 * The one way an alert leaves the extension. It decides whether the user wants
 * to hear anything right now, and words it for the room: `discreet` is what
 * goes out in privacy mode, where a notification over a shared screen must
 * carry no figures.
 * @returns {Promise<boolean>} whether it was sent
 */
async function sendAlert({ id, message, discreet }) {
  const { settings, snoozeUntil } = await getAll({ logs: false });
  if (!settings.notificationsEnabled || isSnoozed(snoozeUntil) || isQuiet(settings.quietHours)) return false;

  const text = settings.privacyMode ? discreet : message;
  // Safari has no notifications API; there the alert still reaches webhooks and plays its sound.
  chrome.notifications?.create(`claudemeter-${id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("src/icons/icon128.png"),
    title: "ClaudeMeter",
    message: text,
    priority: 1,
  });
  // Awaited, so the worker isn't put to sleep with a delivery half sent or a sound half played.
  await Promise.all([
    sendToWebhooks(text),
    settings.soundAlerts ? playAlertSound(settings.soundName, settings.soundVolume) : null,
  ]);
  return true;
}

// ------------------------------------------------------------------ digest --
// One notification a day, at a time the user picks, summing the day up.
/** Arms (or disarms) the alarm for the next digest. Runs at start-up and whenever its settings change. */
export async function scheduleDigest() {
  const { dailyDigest, digestTime } = await getSettings();
  if (dailyDigest) chrome.alarms.create(DIGEST_ALARM_NAME, { when: nextDigestAt(digestTime) });
  else chrome.alarms.clear(DIGEST_ALARM_NAME);
}

export async function sendDigest() {
  await scheduleDigest(); // tomorrow's, before anything below can fail
  const { dailyDigest, demoMode } = await getSettings();
  if (!dailyDigest) return;

  // An alarm that was missed while the browser was closed fires at start-up; one digest a day is enough.
  const today = new Date().toDateString();
  const { digestDay } = await chrome.storage.local.get("digestDay");
  if (digestDay === today) return;

  if (!demoMode) await refreshUsage(); // sum up the day as it stands now, not as of the last refresh
  const digest = buildDigest(await getAll());
  if (!digest) return;
  const sent = await sendAlert({ id: `digest-${today}`, ...digest });
  if (sent) await chrome.storage.local.set({ digestDay: today });
}

// A digest is an invitation to look closer: clicking it opens the dashboard.
chrome.notifications?.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("claudemeter-digest-")) return;
  chrome.notifications.clear(notificationId);
  openUrl(DASHBOARD_URL);
});

// ------------------------------------------------------------------- sound --
// A service worker has no audio output. The sound is played by an offscreen
// document — a page with no window — opened for as long as the sound lasts.
const OFFSCREEN_URL = "src/offscreen/offscreen.html";

let soundQueue = Promise.resolve();

/** Plays a sound from this page — only possible where the background is a page and not a service worker. */
async function playSoundHere(sound, volume) {
  if (typeof AudioContext === "undefined") return { ok: false, detail: "This browser can't play alert sounds." };
  const context = new AudioContext();
  await context.resume();
  if (context.state !== "running") {
    await context.close();
    return { ok: false, detail: "The browser wouldn't start audio." };
  }
  await new Promise((resolve) => setTimeout(resolve, scheduleSound(context, sound, volume) * 1000 + 100));
  await context.close();
  return { ok: true };
}

/** @returns {Promise<{ ok: boolean, detail?: string }>} */
export function playAlertSound(sound, volume) {
  // One at a time: two alerts landing together would otherwise fight over the one offscreen document.
  soundQueue = soundQueue.then(async () => {
    // Firefox has no offscreen documents and doesn't need one: its background is a page, which can play sound itself.
    if (!chrome.offscreen) return playSoundHere(sound, volume);
    try {
      if (!(await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: ["AUDIO_PLAYBACK"],
          justification: "Play a short sound when a usage alert fires.",
        });
      }
      const played = await chrome.runtime.sendMessage({ target: "offscreen", type: "CLAUDEMETER_PLAY_SOUND", sound, volume });
      return played ?? { ok: false, detail: "The sound page didn't answer." };
    } catch (err) {
      console.warn(LOG_PREFIX, "could not play the alert sound", err);
      return { ok: false, detail: String(err?.message ?? err) };
    } finally {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  });
  return soundQueue;
}

/**
 * Sends a line of text to the webhooks the user has switched on (or, for the
 * test button, to the ones named) and remembers how each delivery went.
 */
export async function sendToWebhooks(text, only = null) {
  const { webhooks } = await getSettings();
  const results = await deliverWebhooks(webhooks, { title: "ClaudeMeter", message: text }, fetch, only);
  await recordWebhookResults(results);
  for (const result of results.filter((r) => !r.ok)) console.warn(LOG_PREFIX, "webhook", result.service, result.detail);
  return results;
}

export async function maybeNotify(previousSnapshot, snapshot) {
  const { settings } = await getAll({ logs: false });
  // Skip the very first successful fetch — there's no prior reading to
  // compare against, so "crossing" a threshold isn't meaningful yet.
  if (!previousSnapshot) return;

  const previousByLabel = new Map(bucketsOf(previousSnapshot).map((b) => [b.label, b.percentUsed]));
  // What has been said already, by limit: a figure that dips and comes back must not announce the same crossing twice.
  const { alertedThresholds = {} } = await chrome.storage.local.get("alertedThresholds");
  let alerted = alertedThresholds;

  for (const bucket of bucketsOf(snapshot)) {
    // A limit the last reading didn't have hasn't crossed anything: it has only just been seen
    // (a new model limit, extra usage switched on, a reading that had been partial).
    if (!previousByLabel.has(bucket.label)) continue;
    const before = previousByLabel.get(bucket.label);
    const crossed = crossedThreshold(settings.notifyThresholds, before, bucket.percentUsed);
    if (crossed == null || alreadyAlerted(alerted, bucket, crossed, snapshot.fetchedAt)) continue;

    const sent = await sendAlert({
      id: `${bucket.label}-${crossed}`,
      message: `${bucket.subject ?? `${bucket.label} usage`} just crossed ${crossed}%${bucket.of ?? ""} (now ${bucket.percentUsed}%).`,
      discreet: "A usage alert you set has been reached.",
    });
    // Only an alert that went out counts as said: one that was snoozed away can still come later.
    if (sent) alerted = noteAlerted(alerted, bucket, crossed, snapshot.fetchedAt);
  }
  if (alerted !== alertedThresholds) await chrome.storage.local.set({ alertedThresholds: alerted });
}

/** Logs a sudden jump in any limit and, if alerts are on, says so. */
export async function watchForSpike(snapshot) {
  const spike = await recordSpike(snapshot, (await getSettings()).spikePercent);
  if (!spike) return;
  console.log(LOG_PREFIX, "spike:", spike.label, describeSpike(spike));
  await sendAlert({
    id: `spike-${spike.at}`,
    message: `${spike.label} jumped: ${describeSpike(spike)}.`,
    discreet: "A sudden jump in usage was detected.",
  });
}

/** "Your session has reset" — for limits that were near their ceiling, and only when it just happened (lib/reset-alert.js). */
export async function announceResets(previousSnapshot, snapshot) {
  if (!previousSnapshot) return;
  const { resetAlertPercent } = await getSettings();
  const resets = resetsToAnnounce(bucketsOf(previousSnapshot), bucketsOf(snapshot), {
    percent: resetAlertPercent,
    gapMs: snapshot.fetchedAt - previousSnapshot.fetchedAt,
    at: snapshot.fetchedAt,
  });
  for (const reset of resets) {
    await sendAlert({
      id: `reset-${reset.label}-${snapshot.fetchedAt}`,
      message: describeReset(reset),
      discreet: "A usage limit has reset.",
    });
  }
}

/**
 * A limit that is high enough to be announced gets a refresh timed for just
 * after it resets — otherwise the news waits for the next scheduled one.
 */
export async function scheduleResetCheck(snapshot) {
  const { resetAlertPercent } = await getSettings();
  const when = nextResetCheck(bucketsOf(snapshot), { percent: resetAlertPercent });
  if (when) chrome.alarms.create(RESET_ALARM_NAME, { when });
  else chrome.alarms.clear(RESET_ALARM_NAME);
}

/** Says so, once a day, when today is running well above a usual one (lib/pace.js). */
export async function watchPace() {
  const { settings, usageLog } = await getAll();
  const { paceAlertDay } = await chrome.storage.local.get("paceAlertDay");
  const alert = paceAlert(usageLog, { factor: settings.paceAlertFactor, lastAlertDay: paceAlertDay });
  if (!alert) return;

  const sent = await sendAlert({
    id: `pace-${alert.day}`,
    message: describePace(alert),
    discreet: "You're using Claude well above your usual pace today.",
  });
  // Only a delivered alert uses up the day's one: if alerts were snoozed, it can still come later.
  if (sent) await chrome.storage.local.set({ paceAlertDay: alert.day });
}
