/* relaynet account dashboard. Plain DOM, no build step. */
(function () {
  "use strict";

  const cfg = window.RELAYNET_CONFIG;
  const $ = (sel) => document.querySelector(sel);

  // --- DOM helpers (text nodes only; API data never becomes HTML) ----------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined) continue;
        if (key === "class") node.className = value;
        else if (key.startsWith("data-")) node.setAttribute(key, value);
        else node[key] = value;
      }
    }
    for (const child of [].concat(children || [])) {
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fmtBytes(n) {
    if (n === null || n === undefined) return "unlimited";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = Number(n) || 0;
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
      v /= 1000;
      i += 1;
    }
    return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
  }

  function fmtRate(bps) {
    return bps === null || bps === undefined ? "unlimited" : `${fmtBytes(bps)}/s`;
  }

  function fmtDuration(ms) {
    if (ms === null || ms === undefined) return "unlimited";
    const h = ms / 3600000;
    if (h >= 1) return `${Math.round(h)} h`;
    return `${Math.round(ms / 60000)} min`;
  }

  function fmtDate(iso) {
    if (!iso) return "never";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
  }

  function fmtAgo(iso) {
    if (!iso) return "";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${Math.round(s)} s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  function showStatus(message, isError) {
    const box = $("#status");
    box.textContent = message;
    box.className = `status${isError ? " error" : ""}`;
    box.hidden = !message;
  }

  // --- Auth0 ---------------------------------------------------------------
  let auth0Client = null;
  let profile = null;

  async function initAuth() {
    auth0Client = await auth0.createAuth0Client({
      domain: cfg.auth0.domain,
      clientId: cfg.auth0.clientId,
      cacheLocation: "localstorage",
      useRefreshTokens: true,
      // Sessions cached before refresh tokens were enabled have none; fall
      // back to a silent iframe exchange instead of failing.
      useRefreshTokensFallback: true,
      authorizationParams: {
        redirect_uri: window.location.origin,
        audience: cfg.auth0.audience,
      },
    });

    const params = new URLSearchParams(window.location.search);
    if (params.has("code") && params.has("state")) {
      try {
        await auth0Client.handleRedirectCallback();
      } catch (error) {
        showStatus(`Sign-in failed: ${error.message || error}`, true);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.has("error")) {
      showStatus(`Sign-in failed: ${params.get("error_description") || params.get("error")}`, true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const authed = await auth0Client.isAuthenticated();
    if (authed) profile = await auth0Client.getUser();
    return authed;
  }

  function login() {
    return auth0Client.loginWithRedirect();
  }

  function logout() {
    return auth0Client.logout({ logoutParams: { returnTo: window.location.origin } });
  }

  // Errors that mean "the stored session can no longer mint tokens".
  const SESSION_EXPIRED = new Set(["login_required", "missing_refresh_token", "invalid_grant", "consent_required", "interaction_required"]);

  async function accessToken() {
    try {
      return await auth0Client.getTokenSilently({ authorizationParams: { audience: cfg.auth0.audience } });
    } catch (error) {
      if (error && (SESSION_EXPIRED.has(error.error) || /Missing Refresh Token/i.test(error.message || ""))) {
        const expired = new Error("session-expired");
        expired.sessionExpired = true;
        throw expired;
      }
      throw error;
    }
  }

  // --- Relay API -----------------------------------------------------------
  async function api(path, { method = "GET", body = null } = {}) {
    const token = await accessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== null) headers["Content-Type"] = "application/json";
    const res = await fetch(cfg.relayUrl + path, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    let data = null;
    try {
      data = await res.json();
    } catch (_error) {
      data = null;
    }
    if (!res.ok) {
      const error = new Error((data && data.error) || `${res.status} ${res.statusText}`);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  // --- Rendering -----------------------------------------------------------
  function renderAccount(me) {
    const dl = $("#account-kv");
    clear(dl);
    const rows = [
      ["Signed in as", (profile && (profile.email || profile.name)) || me.user.username],
      ["Account", me.user.username],
      ["Tier", me.tier.name],
      ["Status", el("span", { class: `badge ${me.user.status === "active" ? "ok" : "warn"}` }, me.user.status)],
      ["Member since", fmtDate(me.user.createdAt)],
      ["Sessions", `${me.activeSessions} active, up to ${me.tier.maxSessionsPerOwner ?? "unlimited"} at once`],
      ["Bandwidth", `${fmtRate(me.tier.uploadBps)} up, ${fmtRate(me.tier.downloadBps)} down`],
      ["Session length", `${fmtDuration(me.tier.maxSessionMs)} max, idle ${fmtDuration(me.tier.idleMs)}`],
      ["TCP ports", Array.isArray(me.tier.allowedTcpPorts) ? me.tier.allowedTcpPorts.join(", ") : "any except mail"],
    ];
    for (const [k, v] of rows) {
      dl.append(el("dt", null, k), el("dd", null, v));
    }
  }

  function renderUsage(usage) {
    const { current, months } = usage;
    const bar = $("#usage-bar");
    const quota = current.quotaBytes;
    const pct = quota ? Math.min(100, (current.bytes / quota) * 100) : 0;
    bar.style.width = `${pct}%`;
    bar.className = `meter-fill${pct >= 90 ? " warn" : ""}`;
    $("#usage-text").textContent = quota
      ? `${fmtBytes(current.bytes)} of ${fmtBytes(quota)} this ${current.period} (${Math.round(pct)}%)`
      : `${fmtBytes(current.bytes)} this ${current.period}, no quota`;

    const table = $("#usage-table");
    const tbody = table.querySelector("tbody");
    clear(tbody);
    const rows = (months || []).filter((m) => m.bytesIn || m.bytesOut || m.sessions);
    table.hidden = rows.length === 0;
    for (const m of rows) {
      tbody.append(el("tr", null, [
        el("td", null, m.month),
        el("td", null, fmtBytes(m.bytesOut)),
        el("td", null, fmtBytes(m.bytesIn)),
        el("td", null, String(m.sessions)),
      ]));
    }
  }

  function renderSessions(sessions) {
    const table = $("#sessions-table");
    const tbody = table.querySelector("tbody");
    clear(tbody);
    $("#sessions-empty").hidden = sessions.length > 0;
    table.hidden = sessions.length === 0;
    for (const s of sessions) {
      const kill = el("button", { class: "btn btn-sm btn-danger", type: "button", "data-action": "kill-session", "data-id": s.sessionId }, "Close");
      tbody.append(el("tr", null, [
        el("td", { title: fmtDate(s.startedAt) }, fmtAgo(s.startedAt)),
        el("td", null, s.clientIP || ""),
        el("td", null, s.vmIP || "no address yet"),
        el("td", null, `${s.tcpConnections} TCP, ${s.udpFlows} UDP`),
        el("td", null, fmtBytes(s.bytesSent)),
        el("td", null, fmtBytes(s.bytesReceived)),
        el("td", null, kill),
      ]));
    }
  }

  function tokenStatus(t) {
    if (t.revokedAt) return el("span", { class: "badge off" }, "revoked");
    if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) return el("span", { class: "badge off" }, "expired");
    return el("span", { class: "badge ok" }, "active");
  }

  function renderTokens(tokens) {
    const table = $("#tokens-table");
    const tbody = table.querySelector("tbody");
    clear(tbody);
    const visible = tokens.filter((t) => !t.revokedAt);
    $("#tokens-empty").hidden = visible.length > 0;
    table.hidden = visible.length === 0;
    for (const t of visible) {
      const active = !(t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now());
      const revoke = el("button", { class: "btn btn-sm btn-danger", type: "button", "data-action": "revoke-token", "data-id": String(t.id), disabled: !active }, "Revoke");
      tbody.append(el("tr", null, [
        el("td", null, t.name),
        el("td", null, el("code", null, `${t.prefix}…`)),
        el("td", { title: fmtDate(t.createdAt) }, fmtAgo(t.createdAt)),
        el("td", null, t.lastUsedAt ? fmtAgo(t.lastUsedAt) : "never"),
        el("td", null, t.expiresAt ? fmtDate(t.expiresAt) : "never"),
        el("td", null, tokenStatus(t)),
        el("td", null, revoke),
      ]));
    }
  }

  function revealToken(created) {
    $("#modal-token").textContent = created.token;
    $("#modal-snippet").textContent =
      `const ws = new WebSocket("${cfg.relayWsUrl}", [\n` +
      `  "relay.v1",\n` +
      `  "relay.token.${created.token}",\n` +
      `]);`;
    $("#modal").hidden = false;
  }

  // --- Data loading --------------------------------------------------------
  async function loadDashboard() {
    const [me, usage, sessions, tokens] = await Promise.all([
      api("/api/me"),
      api("/api/me/usage"),
      api("/api/me/sessions"),
      api("/api/me/tokens"),
    ]);
    renderAccount(me);
    renderUsage(usage);
    renderSessions(sessions);
    renderTokens(tokens);
  }

  async function refreshSessions() {
    renderSessions(await api("/api/me/sessions"));
  }

  async function refreshTokens() {
    renderTokens(await api("/api/me/tokens"));
  }

  function withErrors(fn) {
    return async (...args) => {
      try {
        showStatus("");
        await fn(...args);
      } catch (error) {
        if (error && error.sessionExpired) {
          // Drop the stale local session and offer a fresh sign-in.
          await auth0Client.logout({ openUrl: false });
          profile = null;
          showView(false);
          showStatus("Your session expired. Sign in again to see your dashboard.", false);
        } else if (error && error.status === 403 && /suspended/.test(error.message)) {
          showStatus("This account is suspended. Contact the operator.", true);
        } else {
          showStatus(`Something went wrong: ${error.message || error}`, true);
        }
      }
    };
  }

  // --- Wiring --------------------------------------------------------------
  function showView(authed) {
    $("#landing").hidden = authed;
    $("#dashboard").hidden = !authed;
    $("#btn-login").hidden = authed;
    $("#btn-logout").hidden = !authed;
    for (const link of document.querySelectorAll(".topnav a[data-landing]")) link.hidden = authed;
    const chip = $("#user-chip");
    chip.hidden = !authed;
    chip.textContent = authed && profile ? (profile.email || profile.name || "") : "";
  }

  document.addEventListener("click", withErrors(async (event) => {
    const target = event.target.closest("[data-action], #btn-login, #btn-logout");
    if (!target) return;
    const action = target.dataset.action || target.id;
    switch (action) {
      case "login":
      case "btn-login":
        await login();
        break;
      case "btn-logout":
        await logout();
        break;
      case "refresh-sessions":
        await loadDashboard();
        break;
      case "kill-session":
        target.disabled = true;
        await api(`/api/me/sessions/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE" });
        // The close handshake finishes a moment after the request returns.
        target.closest("tr").remove();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await loadDashboard();
        break;
      case "revoke-token":
        if (!window.confirm("Revoke this token? Clients using it will be disconnected on their next connection.")) return;
        target.disabled = true;
        await api(`/api/me/tokens/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE" });
        await refreshTokens();
        break;
      case "copy-token":
        await navigator.clipboard.writeText($("#modal-token").textContent);
        target.textContent = "Copied";
        setTimeout(() => {
          target.textContent = "Copy";
        }, 1500);
        break;
      case "close-modal":
        $("#modal").hidden = true;
        $("#modal-token").textContent = "";
        $("#modal-snippet").textContent = "";
        break;
      default:
        break;
    }
  }));

  $("#token-form").addEventListener("submit", withErrors(async (event) => {
    event.preventDefault();
    const form = event.target;
    const name = form.elements.name.value.trim();
    const days = form.elements.expiresInDays.value;
    const body = { name };
    if (days) body.expiresInDays = Number(days);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const created = await api("/api/me/tokens", { method: "POST", body });
      form.reset();
      revealToken(created);
      await refreshTokens();
    } finally {
      button.disabled = false;
    }
  }));

  withErrors(async () => {
    if (!window.auth0 || typeof auth0.createAuth0Client !== "function") {
      throw new Error("the sign-in library failed to load");
    }
    const authed = await initAuth();
    showView(authed);
    if (authed) await loadDashboard();
  })();
})();
