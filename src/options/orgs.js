// Options > Organisations: which one everything is about, and which others are read alongside.

import { getAll, setSettings } from "../lib/storage.js";
import { MAX_EXTRA_ORGS } from "../lib/orgs.js";

// ------------------------------------------------------------ organisations --

const orgListEl = document.getElementById("orgList");

const orgNote = document.getElementById("orgNote");

/** One row per organisation: its name, whether it is the main one, and whether it is shown alongside. */
export async function renderOrgs() {
  const { settings, orgList, orgCache } = await getAll({ logs: false });
  const mainId = orgCache?.orgId ?? null;
  const extras = settings.trackedOrgs.filter((id) => id !== mainId && orgList.some((org) => org.id === id));

  orgListEl.replaceChildren(
    ...orgList.map((org) => {
      const name = document.createElement("span");
      name.className = "org-name";
      name.textContent = org.name;
      if (!org.chat) name.append(Object.assign(document.createElement("small"), { textContent: "No claude.ai chat on this one, so it has no plan limits to read." }));

      const main = Object.assign(document.createElement("input"), { type: "radio", name: "mainOrg", value: org.id, checked: org.id === mainId });
      const track = Object.assign(document.createElement("input"), { type: "checkbox", value: org.id });
      // The main one is always shown; the others up to the limit.
      track.checked = org.id === mainId || extras.includes(org.id);
      track.disabled = org.id === mainId || settings.demoMode || (!track.checked && extras.length >= MAX_EXTRA_ORGS);
      main.disabled = settings.demoMode;
      const label = (input, text) => {
        const wrap = document.createElement("label");
        wrap.append(input, text);
        return wrap;
      };

      const row = document.createElement("div");
      row.className = "org-row";
      row.append(name, label(main, "Main"), label(track, "Show"));
      return row;
    })
  );

  if (settings.demoMode) orgNote.textContent = "Demo mode is on: these are made-up organisations.";
  else if (orgList.length === 0) orgNote.textContent = "No organisations listed yet. Sign in to claude.ai, then refresh the list.";
  else if (orgList.length === 1) orgNote.textContent = "This sign-in belongs to one organisation, so there is nothing to put beside it.";
  else if (extras.length >= MAX_EXTRA_ORGS) orgNote.textContent = `That's the most that can be shown alongside (${MAX_EXTRA_ORGS}): each one is another request at every refresh.`;
  else orgNote.textContent = "";
  orgNote.classList.remove("problem");
}

orgListEl.addEventListener("change", async (event) => {
  const { settings, orgCache } = await getAll({ logs: false });
  if (event.target.type === "radio") {
    // The new main one stops being an "extra"; the old one doesn't become one unless ticked later.
    await setSettings({ primaryOrg: event.target.value, trackedOrgs: settings.trackedOrgs.filter((id) => id !== event.target.value) });
    orgNote.textContent = "Switching. Each organisation keeps its own history.";
    return; // the worker swaps the stored readings over; the list is redrawn when it has
  }
  const id = event.target.value;
  const tracked = new Set(settings.trackedOrgs.filter((other) => other !== orgCache?.orgId));
  if (event.target.checked) tracked.add(id);
  else tracked.delete(id);
  await setSettings({ trackedOrgs: [...tracked] });
  renderOrgs();
});

document.getElementById("orgRefreshBtn").addEventListener("click", async () => {
  orgNote.textContent = "Asking claude.ai…";
  const result = await chrome.runtime.sendMessage({ type: "CLAUDEMETER_LIST_ORGS" }).catch(() => null);
  await renderOrgs();
  if (!result?.ok) {
    orgNote.textContent = result?.error?.code === "NOT_LOGGED_IN" ? "You're not signed in to claude.ai in this browser." : "Couldn't get the list from claude.ai just now.";
    orgNote.classList.add("problem");
  }
});
