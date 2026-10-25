/* relaynet account dashboard. Plain DOM, no build step. */
(function () {
  "use strict";

  const cfg = window.RELAYNET_CONFIG || {};
  const $ = (sel) => document.querySelector(sel);
  // Where the relay is: its own origin (relaynet.network's relay.), or this
  // page's origin when a proxy serves both (docker compose).
  const relayBase = (cfg.relayUrl || window.location.origin).replace(/\/$/, "");
  const relayWsUrl = relayBase.replace(/^http/, "ws");

  // relaynet.network's own text (beta, tiers, terms, support address) shows
  // only where config.js says this is that service; elsewhere the neutral
  // self-hosted text does. Relay addresses in examples follow the config.
  for (const node of document.querySelectorAll("[data-hosted]")) node.hidden = !cfg.hostedService;
  for (const node of document.querySelectorAll("[data-self-hosted]")) node.hidden = Boolean(cfg.hostedService);
  for (const node of document.querySelectorAll(".relay-ws")) node.textContent = relayWsUrl;

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

  function showStatus(message, isError, sticky) {
    const box = $("#status");
    box.textContent = message;
    box.className = `status${isError ? " error" : ""}`;
    box.hidden = !message;
    clearTimeout(showStatus.timer);
    if (message && !isError && !sticky) showStatus.timer = setTimeout(() => showStatus(""), 6000);
  }
  $("#status").addEventListener("click", () => showStatus(""));

  // --- Organizations ---------------------------------------------------------
  const ORG_KEY = "relaynet.org";
  const INVITE_KEY = "relaynet.invite";
  const ROLE_LABEL = { owner: "owner", admin: "admin", member: "member", billing: "billing", read_only: "read-only" };
  const ALL_ROLES = ["owner", "admin", "member", "billing", "read_only"];
  const INVITABLE_ROLES = ["admin", "member", "billing", "read_only"];

  // What each role may do, mirroring the relay's permission matrix. It only
  // decides which controls to show; the relay enforces the rules.
  const ROLES_CAN = {
    listSessions: ["owner", "admin", "member", "read_only"],
    createToken: ["owner", "admin", "member"],
    listMembers: ["owner", "admin", "member", "read_only"],
    manage: ["owner", "admin"],
  };

  // The relay answers with short codes; say them in words.
  const MESSAGES = {
    "owner-required": "Only an owner can give or change the owner role.",
    "cannot-change-own-role": "You can't change your own role. Ask another owner or admin.",
    "last-owner": "An organization needs at least one owner. Make someone else an owner first.",
    forbidden: "Your role in this organization doesn't allow that.",
    "not-a-member": "You aren't a member of that organization.",
    "not-found": "That organization or member wasn't found.",
    "invite-invalid": "This invitation is invalid, already used, revoked or expired. Ask for a new one.",
    "invite-email-mismatch": "This invitation was sent to a different email address than the one you signed in with.",
    "email-not-verified": "Your email address isn't verified with the sign-in provider. Verify it, then sign in again (and open the invitation link again if you were joining an organization).",
    "already-member": "You are already a member of that organization.",
    "invite-username-mismatch": "This invitation was made for a different username than the one you signed in with.",
    "invalid-credentials": "Wrong username or password.",
    "too-many-attempts": "Too many attempts. Wait a while and try again.",
    "username-taken": "That username is taken. Choose another.",
    "invite-code-required": "Sign-up needs an invite code.",
    "account-suspended": "This account is suspended. Contact the operator.",
    "account-pending": "Your account isn't active yet. Redeem your beta invite code, then reload this page to join.",
    "sole-owner": "You are the only owner of an organization that has other members. Make someone else an owner, or delete the organization first.",
    "org-suspended": "This organization is suspended. Contact the operator.",
    "role-cannot-open-sessions": "Your role in this organization can't connect.",
  };

  // localStorage and sessionStorage can be unavailable (private windows,
  // blocked site data): everything still works without them.
  function storeGet(key, area) {
    try {
      return (area || window.localStorage).getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function storeSet(key, value, area) {
    try {
      (area || window.localStorage).setItem(key, value);
    } catch (_error) {
      // not remembered; fine
    }
  }

  function storeDel(key, area) {
    try {
      (area || window.localStorage).removeItem(key);
    } catch (_error) {
      // nothing to forget
    }
  }

  let orgs = [];
  let currentOrgId = null;
  let currentRole = null;
  let me = null;
  let pendingInvite = null;

  const can = (what) => Boolean(currentRole && ROLES_CAN[what].includes(currentRole));
  const currentOrg = () => orgs.find((o) => o.id === currentOrgId) || null;
  const orgScoped = (path) => path.startsWith("/api/me") && path !== "/api/me/orgs";

  // An invitation link carries a one-time token in #invite=: a fragment is
  // never sent to the server, so the token stays out of edge logs. Links
  // made before carry ?invite=, still accepted. Take it out of the address
  // bar at once so it is not left in history, and keep it only in this tab's
  // session storage across the sign-in redirect.
  function captureInvite() {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const params = new URLSearchParams(window.location.search);
    if (!hash.has("invite") && !params.has("invite")) return;
    const token = hash.get("invite") || params.get("invite");
    params.delete("invite");
    const rest = params.toString();
    window.history.replaceState({}, document.title, window.location.pathname + (rest ? `?${rest}` : ""));
    if (token) {
      pendingInvite = token;
      storeSet(INVITE_KEY, token, window.sessionStorage);
    }
  }

  const hasInvite = () => Boolean(pendingInvite || storeGet(INVITE_KEY, window.sessionStorage));

  // Returns the invitation token once; it is single-use, so it is forgotten
  // whatever happens next.
  function takeInvite() {
    const token = pendingInvite || storeGet(INVITE_KEY, window.sessionStorage);
    pendingInvite = null;
    storeDel(INVITE_KEY, window.sessionStorage);
    return token;
  }

  // --- Sign-in ---------------------------------------------------------------
  // Two ways in, either or both, chosen at runtime:
  // - OIDC (cfg.oidc: issuer, clientId, audience): any OpenID Connect
  //   provider, authorization code with PKCE (oidc-client-ts). The access
  //   token's audience is the relay.
  // - Relay accounts (the relay's GET /api/auth/config says passwordLogin):
  //   username and password checked by the relay, which returns a sign-in
  //   token kept in this tab's session storage.
  const SIGN_IN_ERRORS = {
    access_denied: "Sign-in failed: access was denied.",
    login_required: "Sign-in failed: please sign in again.",
    consent_required: "Sign-in failed: consent is required. Please sign in again.",
    interaction_required: "Sign-in failed: please sign in again.",
    default: "Sign-in failed. Please try again.",
  };
  const RELAY_SESSION_KEY = "relaynet.session";
  let oidcManager = null;
  let authConfig = { passwordLogin: false, signup: null };
  let method = null; // "oidc" | "relay" while signed in
  let profile = null; // { name } for the top bar

  function sessionExpiredError() {
    const expired = new Error("session-expired");
    expired.sessionExpired = true;
    return expired;
  }

  function readRelaySession() {
    try {
      const saved = JSON.parse(storeGet(RELAY_SESSION_KEY, window.sessionStorage) || "null");
      if (saved && saved.token && new Date(saved.expiresAt).getTime() > Date.now()) return saved;
    } catch (_error) {
      // unreadable; treat as signed out
    }
    storeDel(RELAY_SESSION_KEY, window.sessionStorage);
    return null;
  }

  async function initAuth() {
    // Tokens cached by the Auth0 SDK this page used before: not used any more.
    try {
      for (const key of Object.keys(window.localStorage)) if (key.startsWith("@@auth0spajs@@")) window.localStorage.removeItem(key);
    } catch (_error) {
      // storage unavailable
    }
    try {
      const res = await fetch(`${relayBase}/api/auth/config`);
      if (res.ok) authConfig = await res.json();
    } catch (_error) {
      // relay unreachable: OIDC sign-in still works; data calls will say so
    }

    if (cfg.oidc && window.oidc && window.oidc.UserManager) {
      oidcManager = new oidc.UserManager({
        authority: cfg.oidc.issuer,
        client_id: cfg.oidc.clientId,
        redirect_uri: window.location.origin,
        post_logout_redirect_uri: window.location.origin,
        response_type: "code",
        scope: "openid profile email offline_access",
        extraQueryParams: cfg.oidc.audience ? { audience: cfg.oidc.audience } : {},
        userStore: new oidc.WebStorageStateStore({ store: window.localStorage }),
        loadUserInfo: false,
        automaticSilentRenew: false,
        monitorSession: false,
      });
      const params = new URLSearchParams(window.location.search);
      if (params.has("code") && params.has("state")) {
        try {
          await oidcManager.signinRedirectCallback();
        } catch (error) {
          showStatus(SIGN_IN_ERRORS.default, true);
        }
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      } else if (params.has("error")) {
        // The query is attacker-controlled (anyone can link here with
        // ?error=...), so show fixed text, never error_description.
        showStatus(SIGN_IN_ERRORS[params.get("error")] || SIGN_IN_ERRORS.default, true);
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      }
    }

    const relaySession = authConfig.passwordLogin ? readRelaySession() : null;
    if (relaySession) {
      method = "relay";
      profile = { name: relaySession.username };
      return true;
    }
    if (oidcManager) {
      const user = await oidcManager.getUser();
      if (user && (!user.expired || user.refresh_token)) {
        method = "oidc";
        profile = { name: (user.profile && (user.profile.email || user.profile.name)) || "" };
        return true;
      }
    }
    return false;
  }

  // Sign in: straight to the provider when OIDC is the only way; otherwise
  // the sign-in panel (password form, and an SSO button when OIDC is set).
  function login() {
    if (oidcManager && !authConfig.passwordLogin) return oidcManager.signinRedirect();
    openSignIn("signin");
    return null;
  }

  function loginWithOidc() {
    return oidcManager.signinRedirect();
  }

  async function finishRelaySignIn(result) {
    storeSet(RELAY_SESSION_KEY, JSON.stringify({ token: result.token, expiresAt: result.expiresAt, username: result.user.username }), window.sessionStorage);
    method = "relay";
    profile = { name: result.user.username };
    $("#signin").hidden = true;
    showView(true);
    await loadDashboard();
    offerInvite();
  }

  async function relayAuth(path, body) {
    const res = await fetch(`${relayBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error((data && data.error) || `${res.status}`);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  // Drops the local sign-in without asking anyone (expired, deleted account).
  async function forgetSignIn() {
    storeDel(RELAY_SESSION_KEY, window.sessionStorage);
    if (oidcManager) await oidcManager.removeUser();
    method = null;
    profile = null;
  }

  async function logout() {
    if (method === "relay") {
      const saved = readRelaySession();
      if (saved) {
        await fetch(`${relayBase}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${saved.token}` } }).catch(() => {});
      }
      await forgetSignIn();
      window.location.assign(window.location.pathname);
      return;
    }
    if (oidcManager) {
      let endSession = null;
      try {
        endSession = await oidcManager.metadataService.getEndSessionEndpoint();
      } catch (_error) {
        // no discovery: sign out locally
      }
      if (endSession) {
        await oidcManager.signoutRedirect();
        return;
      }
    }
    await forgetSignIn();
    window.location.assign(window.location.pathname);
  }

  async function accessToken() {
    if (method === "relay") {
      const saved = readRelaySession();
      if (!saved) throw sessionExpiredError();
      return saved.token;
    }
    if (!oidcManager) throw sessionExpiredError();
    let user = await oidcManager.getUser();
    if (user && user.expired) {
      try {
        user = await oidcManager.signinSilent();
      } catch (_error) {
        throw sessionExpiredError();
      }
    }
    if (!user || !user.access_token) throw sessionExpiredError();
    return user.access_token;
  }

  // --- Relay API -----------------------------------------------------------
  async function api(path, { method = "GET", body = null } = {}) {
    const token = await accessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (currentOrgId !== null && orgScoped(path)) headers["X-Relay-Org"] = String(currentOrgId);
    if (body !== null) headers["Content-Type"] = "application/json";
    const res = await fetch(relayBase + path, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    // A relay sign-in that expired or was ended elsewhere.
    if (res.status === 401 && method === "relay") throw sessionExpiredError();
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
      ["Signed in as", (profile && profile.name) || me.user.username],
      ["Account", me.user.username],
      ["Organization", currentOrg() ? `${currentOrg().name} (${ROLE_LABEL[currentRole] || currentRole})` : "none"],
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
    // "Opened by" only matters when someone else's sessions are in the list.
    table.classList.toggle("hide-opened-by", !sessions.some((s) => s.own === false));
    for (const s of sessions) {
      // The relay says whether this caller may close the session; a relay that
      // predates the field sends nothing, and the button stays as it was.
      const kill = s.canClose === false
        ? ""
        : el("button", { class: "btn btn-sm btn-danger", type: "button", "data-action": "kill-session", "data-id": s.sessionId }, "Close");
      const who = s.username ? (s.own ? `${s.username} (you)` : s.username) : "";
      tbody.append(el("tr", null, [
        el("td", { title: fmtDate(s.startedAt) }, fmtAgo(s.startedAt)),
        el("td", { class: "col-opened" }, who),
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
      `const ws = new WebSocket("${relayWsUrl}", [\n` +
      `  "relay.v1",\n` +
      `  "relay.token.${created.token}",\n` +
      `]);`;
    $("#modal").hidden = false;
  }

  function renderOrg() {
    const org = currentOrg();
    $("#card-org").hidden = !org;
    if (!org) return;
    $("#org-switch-label").hidden = orgs.length < 2;
    const select = $("#org-switch");
    clear(select);
    for (const o of orgs) {
      select.append(el("option", { value: String(o.id), selected: o.id === currentOrgId },
        `${o.name}${o.personal ? " (personal)" : ""}, ${ROLE_LABEL[o.role] || o.role}`));
    }
    $("#org-summary").textContent = org.personal
      ? `Your personal organization. Your role: ${ROLE_LABEL[currentRole] || currentRole}. Its limits come from the ${org.tier} tier.`
      : `${org.name}. Your role here: ${ROLE_LABEL[currentRole] || currentRole}. Its limits come from the ${org.tier} tier.`;
    const notice = $("#org-notice");
    let text = "";
    if (org.status !== "active") text = "This organization is suspended: connections are refused until an operator reopens it.";
    else if (!can("createToken")) text = "Your role here can't connect or create tokens. You can still see what your role allows below.";
    notice.textContent = text;
    notice.hidden = !text;
  }

  function memberCanBeChanged(member) {
    if (!can("manage") || member.userId === me.user.id) return false;
    return member.role !== "owner" || currentRole === "owner";
  }

  function renderMembers(members) {
    const table = $("#members-table");
    const tbody = table.querySelector("tbody");
    clear(tbody);
    table.hidden = members.length === 0;
    const roles = currentRole === "owner" ? ALL_ROLES : INVITABLE_ROLES;
    for (const m of members) {
      const self = m.userId === me.user.id;
      let roleCell;
      let action = "";
      if (memberCanBeChanged(m)) {
        const select = el("select", { "data-action": "member-role", "data-user": String(m.userId), "aria-label": `Role of ${m.username}` },
          roles.map((r) => el("option", { value: r, selected: r === m.role }, ROLE_LABEL[r])));
        roleCell = select;
        action = el("button", { class: "btn btn-sm btn-danger", type: "button", "data-action": "member-remove", "data-user": String(m.userId), "data-name": m.username }, "Remove");
      } else {
        roleCell = `${ROLE_LABEL[m.role] || m.role}`;
      }
      tbody.append(el("tr", null, [
        el("td", null, self ? `${m.username} (you)` : m.username),
        el("td", null, roleCell),
        el("td", { title: fmtDate(m.createdAt) }, fmtAgo(m.createdAt)),
        el("td", null, action),
      ]));
    }
  }

  async function loadMembers() {
    $("#card-members").hidden = false;
    const org = currentOrg();
    $("#btn-leave-org").hidden = !org || org.personal;
    const note = $("#members-note");
    const table = $("#members-table");
    if (!can("listMembers")) {
      note.textContent = "Your role can't see the member list.";
      note.hidden = false;
      table.hidden = true;
      return;
    }
    note.hidden = true;
    renderMembers(await api(`/api/orgs/${currentOrgId}/members`));
  }

  function inviteStatus(invite) {
    const kind = invite.state === "open" || invite.state === "accepted" ? "ok" : "off";
    return el("span", { class: `badge ${kind}` }, invite.state);
  }

  function renderInvites(list) {
    const table = $("#org-invites-table");
    const tbody = table.querySelector("tbody");
    clear(tbody);
    $("#org-invites-empty").hidden = list.length > 0;
    table.hidden = list.length === 0;
    for (const invite of list) {
      const revoke = invite.state === "open"
        ? el("button", { class: "btn btn-sm btn-danger", type: "button", "data-action": "invite-revoke", "data-id": String(invite.id) }, "Revoke")
        : "";
      tbody.append(el("tr", null, [
        el("td", null, invite.email),
        el("td", null, ROLE_LABEL[invite.role] || invite.role),
        el("td", null, inviteStatus(invite)),
        el("td", { title: fmtDate(invite.expiresAt) }, invite.state === "open" ? fmtDate(invite.expiresAt) : ""),
        el("td", null, revoke),
      ]));
    }
  }

  async function loadInvites() {
    const card = $("#card-invites");
    card.hidden = !can("manage");
    if (card.hidden) return;
    renderInvites(await api(`/api/orgs/${currentOrgId}/invites`));
  }

  // Two clicks for destructive actions: the first arms the button for a few seconds.
  function armed(target, armedLabel, idleLabel) {
    if (target.dataset.armed === "1") return true;
    target.dataset.armed = "1";
    target.textContent = armedLabel;
    setTimeout(() => {
      if (target.isConnected && !target.disabled) {
        target.dataset.armed = "";
        target.textContent = idleLabel;
      }
    }, 4000);
    return false;
  }

  // --- Data loading --------------------------------------------------------
  let username = null;

  async function loadDashboard() {
    orgs = await api("/api/me/orgs");
    const stored = Number(storeGet(ORG_KEY));
    const chosen = orgs.find((o) => o.id === currentOrgId) || orgs.find((o) => o.id === stored) ||
      orgs.find((o) => o.personal) || orgs[0] || null;
    currentOrgId = chosen ? chosen.id : null;
    me = await api("/api/me");
    currentRole = me.org ? me.org.role : null;
    username = me.user.username;
    $("#delete-username").textContent = username;
    const pending = me.user.status === "pending";
    $("#card-invite").hidden = !pending;
    $("#active-only").hidden = pending;
    renderOrg();
    renderAccount(me);
    if (pending) {
      renderUsage({ current: me.usage, months: [] });
      return;
    }
    const org = currentOrg();
    $("#tokens-note").textContent = can("createToken")
      ? `New tokens connect as ${org ? org.name : "this organization"}. The list shows your tokens in every organization.`
      : "Your role in this organization can't create tokens. The list shows your tokens in every organization.";
    $("#token-form").hidden = !can("createToken");
    const [usage, sessions, tokens] = await Promise.all([
      api("/api/me/usage"),
      can("listSessions") ? api("/api/me/sessions") : Promise.resolve(null),
      api("/api/me/tokens"),
    ]);
    renderUsage(usage);
    $("#card-sessions").hidden = sessions === null;
    if (sessions !== null) renderSessions(sessions);
    renderTokens(tokens);
    await loadMembers();
    await loadInvites();
  }

  // An invitation is accepted only on the user's say-so: a link someone
  // else sent must not move the account into an organization by itself.
  function offerInvite() {
    $("#card-join").hidden = !hasInvite();
  }

  async function acceptInvite(token) {
    const joined = await api("/api/invites/accept", { method: "POST", body: { token } });
    currentOrgId = joined.orgId;
    storeSet(ORG_KEY, String(joined.orgId));
    await loadDashboard();
    const org = currentOrg();
    showStatus(`You joined ${org ? org.name : "the organization"} as ${ROLE_LABEL[joined.role] || joined.role}.`, false, true);
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
          await forgetSignIn();
          showView(false);
          showStatus("Your session expired. Sign in again to see your dashboard.", false);
        } else if (error && error.status === 429) {
          showStatus("Too many attempts. Wait a while and try again.", true);
        } else if (error && MESSAGES[error.message]) {
          showStatus(MESSAGES[error.message], true);
        } else if (error && error.status === 403 && /suspended/.test(error.message)) {
          showStatus("This account is suspended. Contact the operator.", true);
        } else if (error && error.status >= 400 && error.status < 500 && error.message) {
          // The relay's 4xx messages are written for people.
          showStatus(error.message, true);
        } else {
          showStatus(`Something went wrong: ${error.message || error}`, true);
        }
      }
    };
  }

  // --- Sign-in panel (relay accounts) -------------------------------------------
  function openSignIn(mode) {
    const signup = mode === "signup" && authConfig.signup;
    $("#signin-title").textContent = signup ? "Create an account" : "Sign in";
    $("#signin-submit").textContent = signup ? "Create account" : "Sign in";
    $("#signin-code").hidden = !(signup && authConfig.signup === "invite");
    $("#signin-code").querySelector("input").required = Boolean(signup && authConfig.signup === "invite");
    $("#signin-form").elements.password.autocomplete = signup ? "new-password" : "current-password";
    $("#signin-form").dataset.mode = signup ? "signup" : "signin";
    $("#signin-to-signup").hidden = signup || !authConfig.signup;
    $("#signin-to-signin").hidden = !signup;
    $("#signin-sso-row").hidden = !oidcManager;
    $("#signin").hidden = false;
    $("#signin-form").elements.username.focus();
  }

  $("#signin-form").addEventListener("submit", withErrors(async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const body = { username: form.elements.username.value.trim(), password: form.elements.password.value };
      if (form.dataset.mode === "signup" && authConfig.signup === "invite") body.code = form.elements.code.value.trim();
      const result = await relayAuth(form.dataset.mode === "signup" ? "/api/auth/signup" : "/api/auth/login", body);
      form.reset();
      await finishRelaySignIn(result);
    } finally {
      button.disabled = false;
    }
  }));

  // --- Wiring --------------------------------------------------------------
  function showView(authed) {
    $("#landing").hidden = authed;
    $("#dashboard").hidden = !authed;
    $("#btn-login").hidden = authed;
    $("#btn-logout").hidden = !authed;
    for (const link of document.querySelectorAll(".topnav a[data-landing]")) {
      link.hidden = authed || (link.hasAttribute("data-hosted") && !cfg.hostedService);
    }
    const chip = $("#user-chip");
    chip.hidden = !authed;
    chip.textContent = authed && profile ? profile.name || "" : "";
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
      case "signin-sso":
        await loginWithOidc();
        break;
      case "signin-mode":
        openSignIn(target.dataset.mode);
        break;
      case "signin-close":
        $("#signin").hidden = true;
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
        // Two clicks: the first arms the button for a few seconds.
        if (target.dataset.armed !== "1") {
          target.dataset.armed = "1";
          target.textContent = "Confirm revoke";
          setTimeout(() => {
            if (target.isConnected && !target.disabled) {
              target.dataset.armed = "";
              target.textContent = "Revoke";
            }
          }, 4000);
          return;
        }
        target.disabled = true;
        await api(`/api/me/tokens/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE" });
        await refreshTokens();
        break;
      case "member-remove":
        if (!armed(target, "Confirm remove", "Remove")) return;
        target.disabled = true;
        await api(`/api/orgs/${currentOrgId}/members/${encodeURIComponent(target.dataset.user)}`, { method: "DELETE" });
        showStatus(`${target.dataset.name} was removed. Their tokens in this organization are revoked.`, false);
        await loadMembers();
        break;
      case "leave-org": {
        if (!armed(target, "Confirm leave", "Leave organization")) return;
        target.disabled = true;
        const left = currentOrg();
        await api(`/api/orgs/${currentOrgId}/members/${me.user.id}`, { method: "DELETE" });
        currentOrgId = null;
        storeDel(ORG_KEY);
        await loadDashboard();
        showStatus(`You left ${left ? left.name : "the organization"}.`, false);
        break;
      }
      case "invite-revoke":
        if (!armed(target, "Confirm revoke", "Revoke")) return;
        target.disabled = true;
        await api(`/api/orgs/${currentOrgId}/invites/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE" });
        await loadInvites();
        break;
      case "copy-invite":
        await navigator.clipboard.writeText($("#invite-link").textContent);
        target.textContent = "Copied";
        setTimeout(() => {
          target.textContent = "Copy";
        }, 1500);
        break;
      case "invite-join": {
        const token = takeInvite();
        $("#card-join").hidden = true;
        if (token) await acceptInvite(token);
        break;
      }
      case "invite-ignore":
        takeInvite();
        $("#card-join").hidden = true;
        showStatus("Invitation ignored. Open the link again if you change your mind.", false);
        break;
      case "dismiss-invite":
        $("#invite-reveal").hidden = true;
        $("#invite-link").textContent = "";
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

  document.addEventListener("change", withErrors(async (event) => {
    const target = event.target;
    if (target.id === "org-switch") {
      currentOrgId = Number(target.value);
      storeSet(ORG_KEY, String(currentOrgId));
      $("#invite-reveal").hidden = true;
      $("#invite-link").textContent = "";
      await loadDashboard();
    } else if (target.matches && target.matches('select[data-action="member-role"]')) {
      target.disabled = true;
      try {
        await api(`/api/orgs/${currentOrgId}/members/${encodeURIComponent(target.dataset.user)}`, { method: "PATCH", body: { role: target.value } });
        showStatus("Role updated.", false);
      } finally {
        // Reload either way, so a refused change puts the old role back.
        await loadMembers();
      }
    }
  }));

  $("#org-invite-form").addEventListener("submit", withErrors(async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const created = await api(`/api/orgs/${currentOrgId}/invites`, {
        method: "POST",
        body: { email: form.elements.email.value.trim(), role: form.elements.role.value },
      });
      form.reset();
      $("#invite-link").textContent = `${window.location.origin}/#invite=${encodeURIComponent(created.token)}`;
      $("#invite-reveal").hidden = false;
      await loadInvites();
    } finally {
      button.disabled = false;
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

  $("#invite-form").addEventListener("submit", withErrors(async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/api/me/redeem", { method: "POST", body: { code: form.elements.code.value.trim() } });
      form.reset();
      showStatus("Your account is active. Create a token to connect.", false);
      await loadDashboard();
      offerInvite();
    } finally {
      button.disabled = false;
    }
  }));

  $("#delete-form").addEventListener("submit", withErrors(async (event) => {
    event.preventDefault();
    const form = event.target;
    const confirm = form.elements.confirm.value.trim();
    if (confirm !== username) {
      showStatus("Type your account name exactly to confirm.", true);
      return;
    }
    await api("/api/me", { method: "DELETE", body: { confirm } });
    await logout();
  }));

  withErrors(async () => {
    if (cfg.oidc && !(window.oidc && window.oidc.UserManager)) {
      throw new Error("the sign-in library failed to load");
    }
    captureInvite();
    const authed = await initAuth();
    showView(authed);
    if (!authed) {
      if (pendingInvite || storeGet(INVITE_KEY, window.sessionStorage)) {
        showStatus("You have been invited to an organization. Sign in to see the invitation.", false, true);
      }
      return;
    }
    await loadDashboard();
    if (me.user.status === "pending") {
      // Keep the invitation for after activation instead of spending it on a
      // refusal; the redeem form and a reload both pick it up.
      if (hasInvite()) {
        showStatus("You have been invited to an organization, but your account isn't active yet. Enter a beta invite code below, or ask the operator to activate your account and reload this page. The invitation is kept for you.", false, true);
      }
      return;
    }
    offerInvite();
  })();
})();
