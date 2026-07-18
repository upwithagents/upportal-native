const { listen } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;

const PORTAL_SLUG = "portal";
const PORTAL_URL = "http://localhost:3000";
const ICONS = { pending: "○", ready: "✓", timeout: "✗", exited: "✗" };

// slug -> { port, state }
const apps = new Map();

function render() {
  const list = document.querySelector("#status-list");
  list.innerHTML = "";
  for (const [slug, info] of apps) {
    const li = document.createElement("li");
    li.className = `state-${info.state}`;
    li.textContent = `${ICONS[info.state] ?? "○"} ${slug} (:${info.port})`;
    list.appendChild(li);
  }
}

function showPortal() {
  const frame = document.querySelector("#portal-frame");
  // Cache-bust: the app window's WebView data store persists across
  // launches (unlike a fresh browser tab), so a stale cached response -
  // e.g. a transient 404 caught mid-restart during dev-mode iteration -
  // could otherwise keep being served instead of a fresh request.
  frame.src = `${PORTAL_URL}/?_t=${Date.now()}`;
  document.body.classList.add("portal-ready");
}

function showBootScreen() {
  const frame = document.querySelector("#portal-frame");
  frame.src = "about:blank";
  document.body.classList.remove("portal-ready");
}

function handleStatus(payload) {
  if (payload.type === "manifest") {
    apps.clear();
    for (const app of payload.apps) {
      apps.set(app.slug, { port: app.port, state: "pending" });
    }
    render();
    return;
  }

  const existing = apps.get(payload.slug);
  apps.set(payload.slug, { port: payload.port ?? existing?.port, state: payload.state });
  render();

  if (payload.slug === PORTAL_SLUG && payload.state === "ready") {
    showPortal();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  // Register listeners before pulling the snapshot below, so nothing
  // that arrives in between is missed.
  listen("app-status", (event) => handleStatus(event.payload));
  listen("restarting", () => {
    for (const info of apps.values()) info.state = "pending";
    render();
    showBootScreen();
  });

  // The orchestrator can emit its manifest and early ready events before
  // this page has finished loading and registered the listeners above -
  // Tauri doesn't replay missed events. Pull current state explicitly to
  // catch up on anything already missed. HashMap iteration order on the
  // Rust side isn't guaranteed, so apply the manifest first regardless of
  // array order, then the rest.
  invoke("get_status").then((payloads) => {
    const manifest = payloads.find((p) => p.type === "manifest");
    if (manifest) handleStatus(manifest);
    for (const payload of payloads) {
      if (payload.type !== "manifest") handleStatus(payload);
    }
  });
});
