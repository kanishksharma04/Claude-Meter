import { getAll, clearDebugCaptures, onStorageChanged } from "../lib/storage.js";

const listEl = document.getElementById("captureList");
const template = document.getElementById("captureTemplate");

async function render() {
  const { __debug_captures: captures } = await getAll();

  listEl.innerHTML = "";

  if (!captures.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent =
      "No captures yet. Open claude.ai in a tab and trigger the account usage panel there.";
    listEl.appendChild(empty);
    return;
  }

  for (const capture of captures) {
    const node = template.content.cloneNode(true);
    node.querySelector(".method").textContent = capture.method;
    node.querySelector(".url").textContent = capture.url;
    node.querySelector(".status").textContent = `HTTP ${capture.status ?? "?"}`;
    node.querySelector(".timestamp").textContent = new Date(capture.timestamp).toLocaleString();
    node.querySelector(".source").textContent = capture.source;
    node.querySelector(".page-url").textContent = capture.pageUrl ?? "";

    const bodyText =
      typeof capture.responseBody === "string"
        ? capture.responseBody
        : JSON.stringify(capture.responseBody, null, 2);
    node.querySelector(".body").textContent = bodyText;

    node.querySelector(".copy-btn").addEventListener("click", async (event) => {
      await navigator.clipboard.writeText(JSON.stringify(capture, null, 2));
      const btn = event.target;
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 1200);
    });

    listEl.appendChild(node);
  }
}

document.getElementById("refreshBtn").addEventListener("click", render);

document.getElementById("clearBtn").addEventListener("click", async () => {
  if (!confirm("Clear all captured requests? This cannot be undone.")) return;
  await clearDebugCaptures();
  await render();
});

onStorageChanged((changes) => {
  if (changes.__debug_captures) render();
});

render();
