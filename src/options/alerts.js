// Options > Alerts, the parts with a list to them: the weekly-reset calendar file,
// quiet hours by weekday, and the webhooks an alert is also sent to.

import { getAll, getSettings, setSettings, updateSettings } from "../lib/storage.js";
import { formatClock, timeAgo } from "../lib/time-format.js";
import { SERVICES, checkWebhookUrl } from "../lib/webhooks.js";
import { buildResetCalendar, weeklyResets, reminderLabel, CALENDAR_FILENAME, REMINDER_OPTIONS } from "../lib/ics.js";
import {
  isQuiet,
  quietUntil,
  addWindow,
  removeWindow,
  updateWindow,
  copyToAllDays,
  toTimeValue,
  fromTimeValue,
  windowNote,
  MAX_WINDOWS_PER_DAY,
} from "../lib/quiet-hours.js";

// ---------------------------------------------------------- reset calendar --

const calendarReminderSelect = document.getElementById("calendarReminderSelect");

const calendarNote = document.getElementById("calendarNote");

export function renderCalendar(settings) {
  calendarReminderSelect.replaceChildren(
    ...REMINDER_OPTIONS.map((minutes) => new Option(reminderLabel(minutes), String(minutes)))
  );
  calendarReminderSelect.value = String(settings.calendarReminder);
}

calendarReminderSelect.addEventListener("change", async () => {
  await setSettings({ calendarReminder: Number(calendarReminderSelect.value) });
});

document.getElementById("calendarBtn").addEventListener("click", async () => {
  const { latestSnapshot, settings } = await getAll({ logs: false });
  const calendar = buildResetCalendar(latestSnapshot, { reminderMinutes: settings.calendarReminder });
  if (!calendar) {
    calendarNote.textContent = "No weekly reset time is known yet. Sign in to claude.ai, then try again.";
    return;
  }

  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  link.download = CALENDAR_FILENAME;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);

  const [next] = weeklyResets(latestSnapshot);
  const when = new Date(next.resetsAt).toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" });
  calendarNote.textContent = `Saved ${CALENDAR_FILENAME} to your downloads: every week on ${when}. Open it to add it to your calendar.`;
});

// ------------------------------------------------------------- quiet hours --

const quietToggle = document.getElementById("quietToggle");

const quietDays = document.getElementById("quietDays");

const quietStatus = document.getElementById("quietStatus");

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function renderQuietStatus(quietHours) {
  const until = quietUntil(quietHours);
  quietStatus.textContent = !quietHours.enabled
    ? ""
    : isQuiet(quietHours)
      ? until
        ? `Quiet now, until ${formatClock(until)}.`
        : "Quiet now, and all week — no alert will get through."
      : "Not in a quiet window right now.";
}

/** One row per weekday: its windows as pairs of time fields, with add, remove and copy-to-all. */
export function renderQuietHours(quietHours, refocus = null) {
  quietToggle.checked = quietHours.enabled;
  quietDays.classList.toggle("disabled", !quietHours.enabled);
  renderQuietStatus(quietHours);

  const button = (text, action, label, disabled = false) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = text;
    node.dataset.action = action;
    node.setAttribute("aria-label", label);
    node.disabled = disabled || !quietHours.enabled;
    return node;
  };
  const time = (minutes, end, label) => {
    const input = document.createElement("input");
    input.type = "time";
    input.value = toTimeValue(minutes);
    input.dataset.end = end;
    input.setAttribute("aria-label", label);
    input.disabled = !quietHours.enabled;
    return input;
  };

  quietDays.replaceChildren(
    ...quietHours.days.map((windows, day) => {
      const name = DAY_NAMES[day];
      const list = document.createElement("ul");
      list.className = "quiet-windows";
      list.setAttribute("aria-label", `${name}'s quiet windows`);
      list.append(
        ...windows.map((window, index) => {
          const item = document.createElement("li");
          item.dataset.index = String(index);
          const ordinal = windows.length > 1 ? ` ${index + 1}` : "";
          item.append(
            time(window.from, "from", `${name} window${ordinal} starts`),
            "to",
            time(window.to, "to", `${name} window${ordinal} ends`),
            button("\u00d7", "remove", `Remove ${name} window${ordinal}`)
          );
          const note = document.createElement("span");
          note.className = "quiet-note";
          note.textContent = windowNote(window);
          item.lastChild.before(note);
          return item;
        })
      );

      // Under the windows: what can be done with the day, led by a word when it has none.
      const actions = document.createElement("div");
      actions.className = "quiet-day-actions";
      if (windows.length === 0) {
        const none = document.createElement("span");
        none.className = "none";
        none.textContent = "No quiet time";
        actions.append(none);
      }
      actions.append(
        button("Add", "add", `Add a quiet window on ${name}`, windows.length >= MAX_WINDOWS_PER_DAY),
        button("Copy to all", "copy", `Give every day ${name}'s windows`)
      );

      const body = document.createElement("div");
      body.className = "quiet-day-body";
      body.append(list, actions);

      const row = document.createElement("div");
      row.className = "quiet-day";
      row.dataset.day = String(day);
      const heading = document.createElement("span");
      heading.className = "quiet-day-name";
      heading.textContent = name.slice(0, 3);
      heading.title = name;
      row.append(heading, body);
      return row;
    })
  );

  // The row was rebuilt under the button that was pressed; put focus back somewhere sensible in it.
  if (refocus) quietDays.querySelector(`[data-day="${refocus.day}"] [data-action="${refocus.action}"]:not(:disabled)`)?.focus();
}

async function saveQuietHours(quietHours, refocus) {
  renderQuietHours((await setSettings({ quietHours })).quietHours, refocus);
}

quietToggle.addEventListener("change", async () => {
  const { quietHours } = await getSettings();
  await saveQuietHours({ ...quietHours, enabled: quietToggle.checked });
});

quietDays.addEventListener("click", async (event) => {
  const action = event.target.closest("button")?.dataset.action;
  if (!action) return;
  const day = Number(event.target.closest(".quiet-day").dataset.day);
  const { quietHours } = await getSettings();

  if (action === "add") return saveQuietHours(addWindow(quietHours, day), { day, action: "add" });
  if (action === "copy") return saveQuietHours(copyToAllDays(quietHours, day), { day, action: "copy" });
  const index = Number(event.target.closest("li").dataset.index);
  await saveQuietHours(removeWindow(quietHours, day, index), { day, action: "add" });
});

quietDays.addEventListener("change", async (event) => {
  if (!event.target.matches('input[type="time"]')) return;
  const minutes = fromTimeValue(event.target.value);
  const { quietHours } = await getSettings();
  // A cleared field isn't a time: put back what was there.
  if (minutes == null) return renderQuietHours(quietHours);
  const day = Number(event.target.closest(".quiet-day").dataset.day);
  const index = Number(event.target.closest("li").dataset.index);
  await saveQuietHours(updateWindow(quietHours, day, index, { [event.target.dataset.end]: minutes }));
});

// "Quiet now, until…" goes stale by itself as the clock moves.
setInterval(async () => renderQuietStatus((await getSettings()).quietHours), 30_000);

// ---------------------------------------------------------------- webhooks --

const webhookList = document.getElementById("webhookList");

function setWebhookStatus(service, text, problem = false) {
  const status = webhookList.querySelector(`[data-service="${service}"] .webhook-status`);
  status.textContent = text;
  status.classList.toggle("problem", problem);
}

/** One block per service: a switch, the address, a test button, and how the last delivery went. */
export async function renderWebhooks() {
  const { webhooks } = await getSettings();
  const { webhookStatus = {} } = await chrome.storage.local.get("webhookStatus");

  if (webhookList.childElementCount === 0) {
    webhookList.replaceChildren(
      ...Object.entries(SERVICES).map(([service, spec]) => {
        const block = document.createElement("div");
        block.className = "webhook";
        block.dataset.service = service;
        block.innerHTML = `
          <label class="row">
            <span><span class="webhook-name"></span><small></small></span>
            <input type="checkbox" class="webhook-toggle" />
          </label>
          <div class="webhook-url">
            <input type="url" class="webhook-address" spellcheck="false" autocomplete="off" />
            <button type="button" class="secondary inline webhook-test">Send test</button>
          </div>
          <small class="webhook-status" role="status"></small>`;
        block.querySelector(".webhook-name").textContent = spec.label;
        block.querySelector("small").textContent = spec.help;
        const address = block.querySelector(".webhook-address");
        address.placeholder = spec.placeholder;
        address.setAttribute("aria-label", `${spec.label} webhook address`);
        return block;
      })
    );
  }

  for (const [service, { enabled, url }] of Object.entries(webhooks)) {
    const block = webhookList.querySelector(`[data-service="${service}"]`);
    block.querySelector(".webhook-toggle").checked = enabled;
    const address = block.querySelector(".webhook-address");
    if (document.activeElement !== address) address.value = url;
    const last = webhookStatus[service];
    if (last && !block.querySelector(".webhook-status").textContent) {
      setWebhookStatus(service, `Last delivery ${timeAgo(last.at)}: ${last.detail}`, !last.ok);
    }
  }
}

async function saveWebhook(service, change) {
  await updateSettings(({ webhooks }) => ({ webhooks: { ...webhooks, [service]: { ...webhooks[service], ...change } } }));
}

webhookList.addEventListener("change", async (event) => {
  const block = event.target.closest(".webhook");
  const service = block.dataset.service;
  const toggle = block.querySelector(".webhook-toggle");
  const checked = checkWebhookUrl(service, block.querySelector(".webhook-address").value);

  if (event.target.matches(".webhook-address")) {
    // A changed address may be on a different host, which the earlier permission doesn't cover: start again.
    toggle.checked = false;
    await saveWebhook(service, { url: checked.ok ? checked.url : event.target.value.trim(), enabled: false });
    return setWebhookStatus(service, checked.ok ? "Address saved. Switch it on to start sending." : checked.problem, !checked.ok);
  }

  if (!toggle.checked) {
    await saveWebhook(service, { enabled: false });
    if (checked.ok) chrome.permissions.remove({ origins: [checked.origin] }).catch(() => {});
    return setWebhookStatus(service, "Off. Nothing is sent to it.");
  }

  if (!checked.ok) {
    toggle.checked = false;
    return setWebhookStatus(service, checked.problem, true);
  }
  // Asked straight from the click: the browser only shows its prompt in answer to a user's own action.
  const granted = await chrome.permissions.request({ origins: [checked.origin] }).catch(() => false);
  if (!granted) {
    toggle.checked = false;
    return setWebhookStatus(service, `The browser wasn't given permission to contact ${new URL(checked.url).hostname}.`, true);
  }
  await saveWebhook(service, { url: checked.url, enabled: true });
  setWebhookStatus(service, "On. Alerts will be sent here too.");
});

webhookList.addEventListener("click", async (event) => {
  if (!event.target.matches(".webhook-test")) return;
  const service = event.target.closest(".webhook").dataset.service;
  const checked = checkWebhookUrl(service, event.target.closest(".webhook").querySelector(".webhook-address").value);
  if (!checked.ok) return setWebhookStatus(service, checked.problem, true);

  const granted = await chrome.permissions.request({ origins: [checked.origin] }).catch(() => false);
  if (!granted) return setWebhookStatus(service, "The browser wasn't given permission to contact that site.", true);

  await saveWebhook(service, { url: checked.url });
  setWebhookStatus(service, "Sending…");
  const result = await chrome.runtime.sendMessage({ type: "CLAUDEMETER_TEST_WEBHOOK", service }).catch(() => null);
  setWebhookStatus(service, result?.ok ? "Test sent. Check the channel." : `Test failed: ${result?.detail ?? "no answer from the extension."}`, !result?.ok);
});
