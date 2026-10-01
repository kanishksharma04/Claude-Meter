// The offscreen document: a page with no window, opened by the service worker
// for one job — a service worker can't play audio, and this can. It plays the
// sound it is asked for and answers when the sound has finished, at which
// point the worker closes it again.

import { scheduleSound } from "../lib/sounds.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen" || message.type !== "CLAUDEMETER_PLAY_SOUND") return false;

  play(message.sound, message.volume)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, detail: String(err?.message ?? err) }));
  return true; // the answer comes once the sound is over
});

async function play(sound, volume) {
  const context = new AudioContext();
  await context.resume();
  if (context.state !== "running") {
    await context.close();
    return { ok: false, detail: "The browser wouldn't start audio." };
  }

  const seconds = scheduleSound(context, sound, volume);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100));
  await context.close();
  return { ok: true };
}
