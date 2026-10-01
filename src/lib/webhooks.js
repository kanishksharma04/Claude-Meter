// Webhooks: the same alert text that becomes a desktop notification, also sent
// to a chat channel or a phone — Slack, Discord, or ntfy. Strictly opt-in: each
// service is off until the user pastes its URL and grants the browser
// permission for that one host. Only the alert's text is sent; nothing about
// the account, the chats, or the history goes with it.
//
// This module is the pure part — checking a URL, shaping the request each
// service expects, and sending through whatever fetch it is given.

export const SERVICES = {
  slack: {
    label: "Slack",
    hosts: ["hooks.slack.com"],
    path: /^\/services\/.+/,
    placeholder: "https://hooks.slack.com/services/…",
    help: "An incoming-webhook URL from a Slack app.",
  },
  discord: {
    label: "Discord",
    hosts: ["discord.com", "discordapp.com"],
    path: /^\/api\/webhooks\/.+/,
    placeholder: "https://discord.com/api/webhooks/…",
    help: "A webhook URL from a channel's Integrations settings.",
  },
  ntfy: {
    label: "ntfy",
    hosts: ["ntfy.sh"],
    path: /^\/[\w-]{1,64}$/,
    placeholder: "https://ntfy.sh/your-topic",
    help: "Your topic's address on ntfy.sh. Anyone who knows the topic name can read it, so make it hard to guess.",
  },
};

export const DEFAULT_WEBHOOKS = Object.fromEntries(
  Object.keys(SERVICES).map((service) => [service, { enabled: false, url: "" }])
);

/** Give up on a delivery after this long; an alert that arrives a minute late is no use anyway. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Every host a webhook may go to, as match patterns — what the manifest lists as optional. */
export const WEBHOOK_ORIGINS = Object.values(SERVICES).flatMap((service) => service.hosts.map((host) => `https://${host}/*`));

/**
 * Checks a pasted URL against what its service's webhooks look like.
 * @returns {{ ok: true, url: string, origin: string } | { ok: false, problem: string }}
 *   `origin` is the match pattern to ask the browser's permission for
 */
export function checkWebhookUrl(service, value) {
  const spec = SERVICES[service];
  if (!spec) return { ok: false, problem: "Unknown service." };

  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return { ok: false, problem: `Paste the full address, starting with https://${spec.hosts[0]}/` };
  }
  if (url.protocol !== "https:" || !spec.hosts.includes(url.hostname) || url.username || url.password) {
    return { ok: false, problem: `A ${spec.label} webhook address starts with https://${spec.hosts[0]}/` };
  }
  if (!spec.path.test(url.pathname)) {
    return { ok: false, problem: `That doesn't look like a ${spec.label} webhook address (${spec.placeholder}).` };
  }
  return { ok: true, url: url.toString(), origin: `https://${url.hostname}/*` };
}

/**
 * The HTTP request one service expects for one alert.
 * @param {{ title: string, message: string }} alert
 * @returns {{ url: string, init: RequestInit }}
 */
export function buildWebhookRequest(service, url, { title, message }) {
  if (service === "ntfy") {
    // ntfy takes the message as the body and everything else as headers (which must stay ASCII).
    return { url, init: { method: "POST", headers: { Title: title, Tags: "bar_chart" }, body: message } };
  }
  const payload = service === "slack" ? { text: `*${title}*\n${message}` } : { username: title, content: message };
  return {
    url,
    init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
  };
}

/**
 * Sends an alert to every service that is switched on and has a usable URL.
 * Never throws: a service that is down must not stop the others, or the alert itself.
 * @param {Record<string, { enabled: boolean, url: string }>} webhooks - the user's settings
 * @param {{ title: string, message: string }} alert
 * @param {typeof fetch} fetchImpl
 * @param {string[]} [only] - limit to these services, switched on or not (for the test button)
 * @returns {Promise<Array<{ service: string, ok: boolean, detail: string }>>}
 */
export async function deliverWebhooks(webhooks, alert, fetchImpl, only = null) {
  const targets = Object.keys(SERVICES).filter((service) =>
    only ? only.includes(service) : webhooks?.[service]?.enabled
  );

  return Promise.all(
    targets.map(async (service) => {
      const checked = checkWebhookUrl(service, webhooks?.[service]?.url);
      if (!checked.ok) return { service, ok: false, detail: checked.problem };

      const { url, init } = buildWebhookRequest(service, checked.url, alert);
      try {
        const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) });
        return { service, ok: response.ok, detail: response.ok ? "Delivered." : `The service answered ${response.status}.` };
      } catch (err) {
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        return { service, ok: false, detail: timedOut ? "The service didn't answer in time." : "Couldn't reach the service." };
      }
    })
  );
}
