# Open the front door: anonymous demos, a bounded budget, and a public launch

*   **Author:** Jonathan Beri (beriberikix)
*   **Status:** Reviewed
*   **Date:** 2026-10-30

--------------------------------------------------------------------------------

## Overview

relaynet gives browser VMs and user-space TCP/IP stacks IPv4 TCP and UDP to the
internet over a WebSocket. It runs as one Fly.io machine at
relay.relaynet.network. The relay process is the maintainer's rootlessRelay
fork, pinned as a dependency.

This design takes relaynet from zero users to a public launch while capping what
it can cost: spend stays near $50 a month at most, whatever happens. "Opening
the front door" means public access that needs no account. The design has three
parts:

1.  **A relay-wide egress budget.** A new rootlessRelay release,
    `0.7.0-hosted.15`, counts every byte the relay forwards each month.
    *   Past a throttle threshold, new free and anonymous sessions start at a
        lower rate.
    *   Past a pause threshold, free and anonymous sessions are closed and
        refused until the month resets.

    The thresholds come from the maintainer's cost ceiling: $20 a month as the
    target, $50 a month as the hard limit. The same release fixes three gaps
    that would let a traffic spike get past the existing limits (§3):
    *   quota enforcement after a failed write;
    *   per-address limits that ignore IPv6 /64 grouping;
    *   refusals the browser can't read.
2.  **Account-free access for the demos.** Anonymous tokens are turned back on,
    so the two Zephyr demos connect a visitor with no account. Open sign-up,
    with a small `free` tier, is turned on for people who want to build on
    relaynet. The site, docs and terms stop saying "invite-only".
3.  **Publication and launch.** The repository goes public with its full
    history. A Zephyr community launch comes first, then Hacker News and Reddit
    about two weeks later.

## The Problem

**A stranger can't use relaynet today.** Both launch demos need a relay:
[zephyr-v86](https://beriberikix.github.io/zephyr-v86/) and
[zephyr-wasm-soc](https://beriberikix.github.io/zephyr-wasm-soc/).

*   zephyr-v86 sends visitors to relaynet.network to sign in, create a token
    and paste it in.
*   Production runs with `SIGNUP_MODE = "invite"`, so a new account is pending
    until it redeems an invite code.
*   The anonymous tier, which needs no account, was turned off on 2026-10-14
    (`ANON_ENABLED = "false"`) when the beta went invite-only.

So a visitor who clicks "Try the demo" gets a sign-in page, then a request for
an invite code they don't have. relaynet has no beta users.

**Opening up without a ceiling risks an open-ended bill.** The relay limits each
session and each account, but nothing limits the total:

*   **Admission has no relay-wide limit.** It checks the per-session limits
    and the per-org monthly quota.
*   **Accounts are cheap to make.** Each one only needs a Google identity.
    Per-address session limits use the exact IP string, so one IPv6 /64 counts
    as many separate users. Token issuance already groups by /64; session
    limits do not.
*   **The only relay-wide numbers are the 240-session address pool times the
    per-session rate.** The `user` tier allows 1 MiB/s each way. With both
    directions counted, that is about 1.8 TB an hour. At Fly's egress prices
    (below) that is $36 an hour or more.
*   **Nobody may see the alert for hours.** The 10 GB/hour Grafana alert only
    sends an email, and the maintainer works on relaynet part-time.

**Egress costs more outside North America and Europe.** The October 2026 Fly
invoice bills egress per region where traffic leaves Fly's network near the
client:

*   `sjc`, `nrt`, `gru`, `syd`, `cdg` and nine others appear as separate lines,
    even though the machine runs only in `sjc`.
*   Fly's rates are $0.02/GB for North America and Europe, $0.04/GB for
    Asia-Pacific and South America, and $0.12/GB for India. Sources disagree on
    Africa: Fly's original price-cut post puts it at $0.04/GB, and 2026
    secondary sources at $0.12/GB.
*   Cloudflare in front of the relay doesn't change this.

**Three failure modes appear before cost does:**

*   **Pool exhaustion.** With 4 sessions per account and 30-minute idle
    timeouts, about 60 users fill the 240-address pool. Abandoned emulator tabs
    keep their slots.
*   **Unreadable refusals.** The next visitor is refused with an HTTP 503
    before the WebSocket opens. Browsers report that only as close code 1006,
    so the demo can't say why.
*   **Quota enforcement stops on write failures.** If the usage flush can't
    write to SQLite (for example, on a full disk), it throws before closing the
    sessions that went over quota.

**Funding is uncertain.** The maintainer wants relaynet to pay for itself and
no more, through sponsors if they appear. Costs must therefore be bounded by
design, not by sponsorship.

## Goals

*   **G1. A demo visitor gets online without an account.** No sign-in and no
    token pasting, through relay.relaynet.network:
    *   **zephyr-v86:** after booting, the guest gets a DHCP lease, completes
        a DNS lookup and completes an HTTP GET.
    *   **zephyr-wasm-soc:** in the `dhcp` sample, after one click on "Real
        network (relaynet)" and Run, the board gets a DHCP lease and completes
        a DNS lookup (`net dns`). The sample has no HTTP client.
    *   **Pass:** 60 seconds or less from page load to the last step for that
        demo.
    *   **Measured as:** the median of 3 timed runs by someone who hasn't used
        it before.
*   **G2. An adopter gets a token in three actions or fewer.** An action is a
    click or a paste, starting from a signed-in session on relaynet.network:
    create a token, name it, copy it. Signing in with Google is not counted.
*   **G3. Monthly cost stays under the ceiling with no maintainer action.**
    *   **Throttle threshold (sized for a $20 month):** sessions in the budget
        tiers (`free` and `anon`) that start after it is crossed get a lower
        rate.
    *   **Pause threshold (sized to stay under $50):** budget-tier sessions are
        closed, and new ones are refused until the month resets.
    *   Neither step needs the maintainer, a config change or a restart.
    *   Traffic outside the budget tiers is never slowed or closed: the `user`
        tier (invited accounts and the probe accounts) and the `operator` tier.
*   **G4. Every refusal after authentication is readable.** The demo receives
    a plain-language reason for each of these refusals:
    *   "relay full";
    *   "free tier paused until <date>";
    *   quota exceeded;
    *   the per-address and per-account session limits.

    For anonymous visitors:
    *   the token endpoint returns these reasons as JSON before connecting;
    *   a token refused at connect time is handled by the demos' reconnect
        rule (§8).
*   **G5. The existing limits hold under a spike.**
    *   Quota and budget enforcement keep working when the SQLite write fails.
    *   Per-address limits treat an IPv6 /64 as one address.
    *   One account opening its maximum TCP connections doesn't run the machine
        out of memory.
*   **G6. The repository is public, with three checks done first:**
    *   gitleaks finds no secrets in the full history;
    *   each identifier listed by the 2026-10-21 security audit has an
        accept-or-rotate decision;
    *   branch protection and a required production reviewer are in place.

    The audit is `docs/security/audit-2026-10-21.md`. Its identifiers are
    account and app names, not credentials.
*   **G7. Adoption is measured.** On day 30 and day 90 after launch, these
    counts are recorded for the previous 14 days:
    *   distinct anonymous tokens with a session longer than 60 seconds;
    *   accounts that connected on 2 or more different days;
    *   month-to-date budget bytes compared with the pause threshold.

## Non-Goals

*   **Billing and pricing.** No Stripe, plans, invoices or paid tiers (epics
    #48, #56). relaynet is funded by sponsors if they appear, and its cost is
    bounded either way.
*   **More capacity.** No second machine, no multi-region and no bigger pool
    (#98). When the budget or pool runs out, people are refused with a clear
    reason rather than served.
*   **Other transports.** No WebTransport or WebRTC (#92).
*   **An admin console** (#70). The budget has one admin route, which can be
    called with curl; no new console screens.
*   **Per-destination allowlists.** The free and anonymous tiers limit ports,
    not host names.
*   **Third-party integrations** (#99, #101). Anonymous tokens are for the
    maintainer's own demo origins only. Other pages use account tokens.
*   **A new client library release.** `relaynet` on npm stays at 0.1.2.
*   **Product Hunt and LinkedIn launches.**

## Open Questions

*   **Fly's acceptable-use policy.** Whether Fly allows a public egress relay.
    A "no" stops the launch, so this is a launch gate (§9).
*   **History identifiers.** Accept or rotate each identifier the audit listed.

## Decisions Made While Drafting and Reviewing

*   **Cost ceiling:** $20 a month as the target, $50 a month as the hard limit.
*   **What the budget counts:** all relay traffic, every tier, because the
    ceiling is the whole Fly bill.
*   **Throttle:** applies to new sessions only.
*   **Pause:** closes live budget-tier sessions immediately, with no grace
    period.
*   **Refusals:** the WebSocket handshake completes, then closes at once with
    a readable reason. Before connecting, anonymous visitors see the same
    reasons from the token endpoint. No separate status endpoint.
*   **`free` tier:**
    *   1 session, 30 minutes maximum, 5 minutes idle;
    *   128 KiB/s each way (lowered from 256 KiB/s after the load test; see
        "Load test results");
    *   TCP 80 and 443, UDP 443;
    *   1 GiB a month.

    `anon` keeps its built-in values.
*   **Override:** a sticky value stored in the database, set through an admin
    route.
*   **Thresholds:** sized at a blended $0.04/GB. Fixed costs are $8 a month,
    from the October 2026 invoice.
*   **Alert channel:** a private ntfy topic, through a Grafana webhook contact
    point.
*   **Token hand-off for adopters:** paste, which already works.
*   **Demos:** both need small changes in their own repositories (§8), checked
    against their code on 2026-10-30.
    *   zephyr-v86 fetches an anonymous token when the guest boots, and stops
        v86's automatic reconnects after a close.
    *   zephyr-wasm-soc keeps its simulated network as the default. It gains a
        one-click "Real network (relaynet)" choice, and its uplink gains the
        `relay.v1` and `relay.token.<t>` subprotocols.

## Critical User Journeys (CUJs)

### CUJ 1: A demo visitor boots Zephyr and reaches the internet

*   **Given**:
    *   anonymous access is on;
    *   the budget is below the pause threshold;
    *   the address pool has a free slot.
*   **When**: a first-time visitor opens the zephyr-v86 or zephyr-wasm-soc
    demo page.
*   **Then**:
    *   When networking starts, the page calls `POST /api/anon/token` and
        connects with the token. In zephyr-v86, networking starts when the
        visitor boots. In zephyr-wasm-soc, it starts when the visitor picks
        "Real network (relaynet)" and clicks Run.
    *   The guest gets a DHCP lease and resolves a name. zephyr-v86's guest
        also completes an HTTP GET.
    *   This takes 60 seconds or less, with no sign-in and no pasting.

### CUJ 2: A visitor arrives while the free tier is paused or the relay is full

*   **Given**: month-to-date egress is past the pause threshold, or all 240
    addresses are in use.
*   **When**: a visitor opens a demo page.
*   **Then**:
    *   `POST /api/anon/token` answers with `503` and a JSON reason.
    *   The page shows "Free tier paused until 2026-12-01", or "The relay is
        full, try again in a few minutes", and a Reconnect button.
    *   If the state changes between the token and the connect, the WebSocket
        closes with 1008 and the paused reason, or 1013 "relay full". The page
        shows that reason and the same button.

### CUJ 3: The budget crosses its thresholds while the maintainer is offline

*   **Given**: free and anonymous traffic is heavy.
*   **When**: month-to-date egress (all tiers) crosses the throttle threshold,
    and later the pause threshold.
*   **Then**:
    *   **At the throttle threshold:** budget-tier sessions that start
        afterwards get the lower rate, and a push alert fires.
    *   **At the pause threshold:**
        *   live `free` and `anon` sessions close with
            `1008 "free tier paused until <date>"`;
        *   new ones are refused;
        *   a push alert fires.
    *   **On the first day of the next UTC month:** the state returns to `open`
        with no restart.
    *   **Throughout:** `user` and `operator` sessions are not slowed or
        closed.

### CUJ 4: An adopter signs up and builds on relaynet

*   **Given**: open sign-up is on, and the visitor has a Google account.
*   **When**: they sign up at relaynet.network and create a token.
*   **Then**:
    *   The new account is active on the `free` tier, with no invite code.
    *   They create and copy a token in three actions.
    *   Their traffic counts toward the relay budget, and is throttled and
        paused with the anonymous tier.
    *   Invite codes only activate pending accounts. An operator moves an
        account to the `user` tier with the admin tier route.

## Technical Plan (Architecture)

The work happens in four repositories, plus GitHub settings:

| Repository | What changes |
|---|---|
| rootlessRelay fork (`../rootlessRelay`), release `0.7.0-hosted.15` | Budget, readable refusals, safety fixes. This repo never patches the relay, so relay behaviour changes ship there. |
| relaynet (this repo) | Pins the new release. Turns on anonymous tokens and open sign-up in `relay/fly.toml`. Updates site, docs and legal text. Adds the alerts. |
| beriberikix/zephyr-v86 | Fetches anonymous tokens and shows refusal reasons. |
| beriberikix/zephyr-wasm-soc | Same, plus the subprotocols. |

### Data flow

```text
 demo page                                        Fly machine (one, sjc)
 ─────────                                        ───────────────────────────────────────────
 POST /api/anon/token ──────────────────────────► budget paused?  ──► 503 {free-tier-paused}
                                                  pool full?      ──► 503 {relay-full}
                                                  per-/64 limit   ──► 429 (existing)
                                                  else            ──► { token }
 WebSocket relay.v1 + relay.token.<t> ──────────► origin ─► authenticate ─► admission
                                                    admission order: budget, per-/64, per-owner, pool
                                   refused? ◄────── handshake completes, then close 1013 / 1008 + reason
                                   admitted ──────► session (budget tiers start throttled if state = throttled)
                                                       │ bytes in + out
                                                       ▼
                                                 usage meter, 30 s flush
                                                   ├─ per-org / per-/64 quotas (existing)
                                                   └─ relay-wide month counter (new) ─► relay_egress_monthly
                                                       │ finally: close over-quota sessions, budget.evaluate()
                                                       ▼
                                   budget state: open ─► throttled ─► paused ─► (next UTC month) open
                                                       │                        (or forced by POST /api/budget)
                                                       ▼
                                   metrics ─► Grafana alert rules ─► ntfy (push) and email
```

### 1. The relay-wide budget (fork)

**What it counts.** One counter of `bytes_in + bytes_out`, for every session of
every tier, for the current UTC calendar month. This approximates Fly's billed
egress:

*   Traffic into Fly is free.
*   Every byte the relay forwards leaves Fly, either to the browser or to the
    internet.

**Where it lives.**

*   The usage meter already computes per-session byte deltas every 30 seconds.
    It also keeps the relay-wide month total in memory, and that total is
    authoritative.
*   On each flush with a non-zero delta, it adds the delta to the month's row
    in a new table, `relay_egress_monthly`. This happens even when there are no per-org rows
    to write, for example when all traffic is anonymous.
*   If the write fails, the delta is kept for the next flush.
*   At startup, the meter reads the current month's row, so deploys and
    restarts don't reset the counter.
*   Litestream replicates the table with the rest of the database.

**States.** The budget is off unless both thresholds are set, so self-hosters
are unaffected.

| State | When | Effect on budget-tier sessions (`BUDGET_TIERS`) |
|---|---|---|
| `open` | counter below the throttle threshold, or a new month | normal tier rates |
| `throttled` | counter at or above the throttle threshold | sessions that start now get `min(tier rate, BUDGET_THROTTLE_BPS)` in each direction; running sessions keep their rate |
| `paused` | counter at or above the pause threshold | live budget-tier sessions close with `1008 "free tier paused until <YYYY-MM-DD>"`; new ones are refused |

*   **Evaluation.** The state machine is a pure function of the counter, the
    date and the override. It runs:
    *   after every flush, in a `finally` block, so it runs even when the
        write failed;
    *   at every admission, so month rollover is caught without waiting for a
        flush.
*   **Overshoot.** The counter can pass a threshold by at most one flush
    interval (30 s) of traffic before the state changes.
*   **Month rollover.** It happens at 00:00 UTC on the 1st. The counter starts
    at zero and the state returns to `open`.

**Operator override.** A value `forced: "open" | "paused" | null`, stored in a
`forced` column of the current month's row:

*   It replaces the computed state until it is cleared, or until the month
    rolls over.
*   `paused` is the kill switch: it stops all free and anonymous traffic at
    once.
*   `open` reopens the free tier early. For example, after someone has
    deliberately used up the budget (see Risks).
*   It is set and cleared through an admin route that can be called with curl.

**Thresholds for relaynet.network.**

*   **Inputs:**
    *   The October 2026 invoice shows $7.82 of fixed costs: machines, a
        dedicated egress IP and volumes. Use $8 a month.
    *   Egress is sized at a blended $0.04/GB, because it is billed per edge
        region (see The Problem).
*   **Throttle threshold:** ($20 − $8) / $0.04 = 300 GB.
*   **Pause threshold:** ($50 − $8) / $0.04 × 0.8 = 840 GB. The 0.8 leaves
    room for overshoot and for `user`-tier traffic after the pause.
*   **Re-checking:** the load test (step B1 in the Verification Plan) and the
    first launch weeks compare the counter with the invoice. If the blended
    rate differs, the same formula is recomputed.

### 2. Readable refusals (fork)

**At the token endpoint.** `POST /api/anon/token` already returns JSON errors
with CORS for `ALLOWED_ORIGINS`. It gains two refusals, checked before issuing
a token:

*   `503 {"error": "free-tier-paused", "pausedUntil": "2026-12-01"}` when the
    budget is `paused`;
*   `503 {"error": "relay-full"}` when the address pool is full.

**At the WebSocket upgrade.** When the relay refuses an upgrade after
authentication succeeds, it completes the WebSocket handshake, selecting the
`relay.v1` subprotocol, and closes at once with a code and reason the browser
can read. Today these refusals are HTTP errors, which browsers show only as
1006.

`admit()` checks the budget first, so a paused visitor always gets the paused
reason:

| Order | Refusal | Today | After |
|---|---|---|---|
| 1 | Budget `paused` (budget tiers only) | none | close 1008 `free tier paused until 2026-12-01` |
| 2 | Per-address session limit | HTTP 429 | close 1013 `connection limit reached for this address` |
| 3 | Per-account session limit | HTTP 429 | close 1013 `session limit reached for this account` |
| 4 | Address pool exhausted | HTTP 503 | close 1013 `relay full` |
| 5 | Quota exceeded (after the registry checks) | HTTP 429 | close 1008 `quota exceeded` |

Some refusals stay as HTTP responses, because they happen before
authentication, and completing handshakes for unauthenticated clients would make
refusing strangers more expensive:

*   shutting down;
*   wrong path;
*   origin not allowed;
*   a missing or invalid token;
*   an anonymous token used from a different /64.

If the client didn't offer `relay.v1`, a refusal after authentication stays
an HTTP response with the same status as today.

Code 1013 means "try again later". Code 1008 means "policy refused, don't
retry".

### 3. Safety fixes (fork)

*   **Enforcement survives a failed write.** In the usage meter's flush, the
    over-quota closes and `budget.evaluate()` run in a `finally` block, so a
    SQLite error (full disk, locked database) still closes sessions and still
    pauses the free tier.
*   **IPv6 grouping everywhere.** The fork already has `rateKey(ip)`, which
    keeps IPv4 as is and groups IPv6 by /64. Token issuance and sign-in rate
    limits already use it.
    *   The upgrade handler computes `clientKey = rateKey(clientIP)` once.
    *   It uses that key for:
        *   the registry's per-address session counts;
        *   the per-address connection map;
        *   the in-memory anonymous quota key;
        *   the anonymous token's address binding.
    *   The raw IP stays in logs.
*   **Adoption data.** The existing `"session closed"` log line gains the
    session's `tier`. G7 is computed from that log.

### 4. Configuration (this repo)

`relay/fly.toml` and `relay/fly.staging.toml`:

*   **Settings changed:**

    | Setting | Value | Note |
    |---|---|---|
    | `ANON_ENABLED` | `"true"` | |
    | `SIGNUP_MODE` | `"open"` | |
    | `JWT_DEFAULT_TIER` | `"free"` | New Auth0 accounts land on `free`. Existing accounts keep their stored tier. |
    | `BUDGET_TIERS` | `"free,anon"` | |
    | `BUDGET_THROTTLE_BYTES`, `BUDGET_PAUSE_BYTES`, `BUDGET_THROTTLE_BPS` | integers | Throttle 300 GB, pause 840 GB, throttled rate 64 KiB/s. A comment gives each value in GB. |

*   **`TIERS_JSON` defines `free` with every field set,** so nothing is
    inherited from `user`:
    *   `uploadBps` and `downloadBps` 131072 (`anon` gets the same rates);
    *   `maxTcpConnections` 32, `synPerSec` 5, `dnsQps` 20, `maxUdpFlows` 32;
    *   `connectTimeoutMs` 10000;
    *   `allowedTcpPorts` [80, 443], `allowedUdpPorts` [443];
    *   `dnsServers` ["8.8.8.8"], the relay's default `DNS_SERVER_IP`;
    *   `vmToVm` false;
    *   `maxSessionMs` 1800000, `idleMs` 300000;
    *   `maxSessionsPerOwner` 1, `maxSessionsPerIP` 2;
    *   `quotaBytes` 1073741824, `quotaPeriod` "month".

    `anon` keeps its other built-in values.
*   **Memory headroom.** `TCP_SEND_QUEUE_HIGH_WATER_BYTES` stays at its
    default (1 MiB): the load test peaked at 205 MiB of 1 GB, including one
    session with 32 parallel connections.
*   **Fly connection limits.** `[http_service.concurrency]` `hard_limit` goes
    from 260 to 300, and `soft_limit` to 260. Otherwise, with the pool full,
    Fly's proxy refuses connections before the relay can send "relay full".
*   **Relay password accounts stay off in production.** That means no
    `USER_PASSWORD_LOGIN` and no `USER_SIGNUP`. Sign-up is through Auth0
    (Google), so each account is tied to a Google identity.
*   **Allowed origins.** Staging's `ALLOWED_ORIGINS` gains
    `https://beriberikix.github.io`. Production already has it.
*   **Turnstile stays off at first.** The per-/64 issuance limit and the budget
    bound the cost. `TURNSTILE_SECRET` turns it on if bots appear.
*   **Accounts still pending from the invite-only beta.** These are "legacy
    pending accounts". `SIGNUP_MODE = "open"` doesn't change existing rows, so
    the launch checklist activates them and sets their tier through the
    existing admin routes.

### 5. Client library (this repo)

`relaynet.js` doesn't change. Its README gains one sentence:

> Anonymous tokens are for relaynet's own demo pages and are not supported by
> this library. Use an account token.

Reason: `relaynet.js` checks a refused token through `/api/me`. That endpoint
answers 403 for every anonymous token, and the library treats 403 as final.

### 6. Site, docs and legal (this repo)

*   **Landing page:**
    *   Remove the invite-only wording for new visitors. The "redeem your
        invite" card stays for legacy pending accounts.
    *   Add a "Boot Zephyr in your browser" link to each demo.
    *   Show a banner when the budget is paused. `GET /api/auth/config`, which
        the page already calls, gains `"budget"` and `"pausedUntil"` fields.
*   **Docs:**
    *   A quick start with an account token.
    *   The close codes 1008 and 1013, and what each means.
    *   A "Cost and limits" section: the tiers, the budget and the pause.
    *   A pointer to self-hosting.
*   **Legal:**
    *   Anonymous use is allowed without an account, under the acceptable-use
        rules.
    *   Free and anonymous service may be slowed and then paused when the
        monthly budget runs out.
    *   IP addresses are processed for anonymous rate limits, and appear in
        operational logs kept for 14 days.
    *   Remove the invite-code requirement.

### 7. Ops (this repo)

*   **Metrics.** The relay exports:
    *   `rootlessrelay_budget_bytes` (gauge, month to date);
    *   `rootlessrelay_budget_threshold_bytes{threshold="throttle|pause"}`;
    *   `rootlessrelay_budget_state{state}`;
    *   `rootlessrelay_budget_forced{state}`.
*   **Alert rules (Grafana).** These are ratios of the budget bytes to the pause
    threshold, for both `relaynet` and `relaynet-staging`:
    *   50%, 80% and 100% of the pause threshold;
    *   any change of state;
    *   any override being set.
*   **Routing.** A child notification route sends the budget alerts, and every
    `severity=critical` alert, to a webhook contact point that posts to a
    private ntfy topic. Email stays the default route.
*   **Load generator.** It gains an anonymous-token mode, used by step B1.

### 8. Demos (external repos)

**Reconnect rule.** A demo fetches an anonymous token only when networking
starts or when the visitor clicks Reconnect. It never reconnects
automatically. After any close, it shows the reason (or "Connection failed."
for a 1006) and a Reconnect button. This rule:

*   avoids reusing an expired token (tokens and `anon` sessions both last
    15 minutes);
*   frees an abandoned tab's slot after at most `maxSessionMs`;
*   covers anonymous tokens refused before authentication.

**zephyr-v86** (Buildroot Linux guest; `web/main.js`).

*   **How it connects today.** v86 opens the relay socket itself, and its
    network adapter reconnects on its own: on close it calls `connect()` at
    once and again after 10 seconds, and every frame the guest sends also
    calls `connect()`, at most once every 10 seconds.
    `install_relay_token_shim` wraps the global `WebSocket` once per page, with
    the token captured when it is installed.
*   **Changes:**
    *   **Token fetch:** `start_buildroot()` fetches the anonymous token for a
        relaynet host with no saved token.
    *   **Shim:** reads the token from a variable that Reconnect can change.
    *   **Stopping retries:** after a close, a `stopped` flag makes the shim's
        constructor throw. v86 catches the error in `connect()` and logs it,
        so its own retries go nowhere until the visitor clicks Reconnect.
    *   **Reconnect:** fetches a new token, updates that variable and clears
        the flag. v86's next retry, within 10 seconds, connects without
        rebooting the guest.

**zephyr-wasm-soc** (`host/uplink.mjs`, `host/web/worker.js`,
`host/web/index.html`).

*   **How it works today.** Only the `dhcp` sample (`dhcpv4_client`) can use
    a relay. By default it runs on the page's simulated network, and the
    Uplink field is empty.
*   **Changes:**
    *   **Uplink choice:** a "Real network (relaynet)" choice next to the
        Uplink field, also selected by `?uplink=relaynet`. On Run, the page
        fetches an anonymous token and passes it to the worker with the
        relay URL.
    *   **Subprotocols:** `connectUplink` sends `relay.v1` and
        `relay.token.<t>` when it has a token.
    *   **Status messages:** close reasons go to the existing terminal status
        lines.
    *   **No reconnect change needed:** it never reconnects on its own. Each
        Run opens one socket, and Run is the Reconnect.

### 9. Publication and launch gates

The repository goes public, and the launch begins, only when all of these are
true:

1.  Fly has confirmed in writing that a public egress relay is acceptable
    under its acceptable-use policy.
2.  gitleaks over the full history is clean, and each audit identifier has an
    accept-or-rotate decision.
3.  `0.7.0-hosted.15` and the budget config are live in production, and the
    budget alerts reach ntfy.

When the repository is made public:

*   branch protection is turned on for `main`: the CI checks are required, and
    the single maintainer can bypass as admin;
*   a required reviewer is added to the `production` environment (GitHub
    offers both only for public repos on the current plan);
*   private vulnerability reporting is turned on.

**Launch watch.** For 14 days after the Zephyr community post, check these
every day:

*   peak pool use;
*   budget percentage;
*   peak memory;
*   relay bytes against the Fly invoice.

The watch passes when there has been no out-of-memory restart and the budget
is below 25%. Then post to Hacker News and Reddit, with a deploy freeze and the
maintainer online for about three hours afterwards.

The rest of the checklist is tracked in #83.

## Alternatives Considered

### Alternative A: Build billing first (Stripe, plans, customer dashboard)

*   **Pros**: Heavy users would pay for their use, so cost could grow with use.
*   **Cons**:
    *   About 20 open issues across #48, #56 and #63.
    *   Payment work needs its own security review: webhooks, card-data scope
        and tax.
    *   There are no users to bill.
*   **Reason for Rejection**: The maintainer wants relaynet to pay for itself
    and no more. Sponsors plus a hard budget do that, and heavy users can
    self-host.

### Alternative B: Stay invite-only and do outreach

*   **Pros**: No abuse or cost risk, and no relay changes.
*   **Cons**: Outreach sends people to demo links that end at an invite code.
*   **Reason for Rejection**: It blocks the first step of adoption.

### Alternative C: Open sign-up only, no anonymous tokens

*   **Pros**: Every session is tied to a Google identity.
*   **Cons**: Signing in, creating a token and pasting it into a demo takes
    9-11 clicks and pastes across two tabs.
*   **Reason for Rejection**: It fails G1. Open sign-up stays as the route for
    adopters.

### Alternative D: An alert and a manual runbook instead of a budget in the relay

*   **Pros**: No fork release, because the alert and the config settings
    already exist.
*   **Cons**:
    *   Every config change restarts the relay and drops every session.
    *   Alerts go only to email, and the maintainer is part-time.
    *   The worst case is about $36 an hour or more while nobody responds.
*   **Reason for Rejection**: It fails G3. The runbook stays as the fallback if
    the fork release slips.

### Alternative E: A relay-wide rate cap instead of a monthly budget

*   **Pros**: No state, no counter and no table. Just a ceiling on total
    bandwidth.
*   **Cons**: A cap that keeps a whole month under $42 of egress at $0.04/GB is
    about 400 KB/s for the whole relay. That is too low for even a few
    simultaneous demos.
*   **Reason for Rejection**: Demand is bursty. A monthly budget allows bursts
    and still bounds the month.

### Alternative F: Count only free and anonymous bytes toward the budget

*   **Pros**: Strangers can't be paused because of `user`-tier traffic.
*   **Cons**: `user`, probe and operator traffic would be invisible to the
    budget, so the bill could pass $50 while the counter looked fine.
*   **Reason for Rejection**: The ceiling is the whole bill. Separate counters
    for budget tiers and for all traffic were also rejected: two sets of
    thresholds, and pause reasons that are harder to explain, while `user`
    traffic is small.

### Alternative G: Throttle live sessions too

*   **Pros**: The slowdown takes effect immediately.
*   **Cons**:
    *   It needs in-place changes to running sessions' rate limiters, and new
        tests for TCP behaviour when the rate drops mid-transfer.
    *   It doesn't bound cost: 240 sessions × 64 KiB/s × 2 directions is about
        113 GB an hour. Only the pause enforces the ceiling.
    *   It barely speeds things up: budget-tier sessions end within 30 minutes
        anyway, so throttling new sessions only takes full effect within half
        an hour.
*   **Reason for Rejection**: The maintainer first chose live throttling. They
    accepted the reviewers' arithmetic and changed to new sessions only.

### Alternative H: A grace period with a notice before the pause closes sessions

*   **Pros**: Users get two minutes' warning before being cut off.
*   **Cons**:
    *   It needs a new `notice:` text message that every client must
        understand. The relay and `relaynet.js` handle only `ping:` and
        `pong:` text today, and v86's adapter may not tolerate other text.
    *   It adds a fourth state, a timer, and edge cases for restarts and month
        rollover during the grace period.
    *   It saves about 2 GB a month.
*   **Reason for Rejection**: A readable 1008 close meets G4. The maintainer
    first chose the grace period, then accepted the reviewers' case for
    removing it.

### Alternative I: A public status endpoint the demos check before connecting

*   **Pros**: Pages can show a banner before trying to connect.
*   **Cons**:
    *   It adds a route and an extra request. Two of its fields repeat existing
        routes.
    *   It needs new access to the registry's private pool counts.
*   **Reason for Rejection**: The demos already call `POST /api/anon/token`
    first. Having it refuse with JSON reasons gives the same warning without a
    new route. The landing-page banner reads two fields added to
    `GET /api/auth/config`. The maintainer first chose a status endpoint as
    well, then accepted this.

### Alternative J: Client library 0.2.0 with anonymous-token helpers

*   **Pros**: Third-party pages could get online in a few lines.
*   **Cons**:
    *   Neither launch demo uses `relaynet.js`.
    *   Anonymous tokens are issued only to the maintainer's demo origins.
    *   The library would need a token-refresh callback and a fix for its
        `/api/me` check, which treats every anonymous token as revoked.
*   **Reason for Rejection**: No launch user needs it. The maintainer first
    chose the helpers, then deferred them until a third-party user appears.

### Alternative K: Launch on Hacker News first, with more channels

*   **Pros**: The most attention, soonest.
*   **Cons**: One machine, a 240-address pool and untested memory behaviour
    would meet the largest spike first, in public.
*   **Reason for Rejection**: A Zephyr community launch and 14 days of watching
    come first.

### Alternative L: Other transports, an admin console or multi-region before launch

*   **Pros**: More capacity, more options, easier operations.
*   **Cons**: None is needed for a visitor's first minute, and each adds
    operational work for one part-time maintainer.
*   **Reason for Rejection**: Out of scope (#92, #70, #98). Revisit once the
    launch shows what fills up first.

### Alternative M: Publish with a fresh git history

*   **Pros**: Old identifiers in the history never become public.
*   **Cons**:
    *   It loses the project's history and attribution.
    *   The audit's full-history scan found identifiers but no credentials.
*   **Reason for Rejection**: The maintainer chose full history, after gitleaks
    and an accept-or-rotate decision for each identifier.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| **Budget griefing.** One person with many /64s, or many Google accounts, uses up the budget and pauses the free tier for the rest of the month. | Per-/64 token issuance limits. Turnstile can be turned on with `TURNSTILE_SECRET`. A Loki query over the session-closed log finds the top consumers. `forced: "open"` reopens the tier. Residual risk: the free tier is paused until the operator acts. |
| **Egress-IP abuse.** Scanning or brute-forcing from the relay's shared egress IP gets it blocklisted, which breaks every tier. | `free` and `anon` allow only TCP 80/443 and UDP 443, with SYN limits. The existing acceptable-use and abuse process applies. |
| **Regional egress pricing.** Traffic from India, and possibly Africa, costs $0.12/GB, three times the blended $0.04/GB the thresholds assume. | The launch watch and B1 compare relay bytes with the invoice. Recompute the thresholds if the blended rate is higher. |
| **The counter drifts from the bill.** Fly's metered egress may differ from relay bytes. | B1 and the launch watch reconcile them, with a 10% tolerance. |
| **CPU under a spike.** `shared-cpu-1x` throttles to about 6% of a CPU once its burst is spent; the load test then relayed about 1.4 MiB/s in total, and at 240 heavy sessions token requests failed (Cloudflare 520). | Free and anon capped at 128 KiB/s each way, so the throttled capacity is shared among more visitors; demo traffic (DHCP, DNS, a page) is light. Soft launch first, watching CPU. Moving to a dedicated CPU (`performance-1x`, about $31-33 a month) is the fallback, at the cost of the $20 target. Residual risk: a viral spike slows everyone. |
| **Memory at 240 sessions.** One machine with 1 GB, under a spike. | Measured: 205 MiB peak (load test). Tier connection caps. |
| **Single machine and SQLite file.** | Accepted, as today. Litestream backups and the restore check stay. |
| **The fork release slips.** | Fall back to Alternative D's runbook, and keep anonymous access off until the release ships. |
| **Fly doesn't allow a public egress relay.** | A launch gate (§9). If the answer is no, this design is void. |

## Load test results (B1, 2026-10-30)

Run against `relaynet-staging` (`0.7.0-hosted.15`, 1 GB, `shared-cpu-1x`)
from one client, anonymous tokens, the budget out of reach, following
`infra/load/README.md`:

| Run | Sessions held | Relayed throughput | DNS p50 | Peak memory | Relay CPU |
|---|---|---|---|---|---|
| 60 sessions, 10 downloading | 60 | ~3.8 MiB/s | 137 ms | not sampled | within its burst |
| 120 sessions, 20 downloading | 120 | 1.4 MiB/s, falling to 0.2 | 413 ms | 185 MiB | 6-8% after the burst |
| 240 sessions, 40 downloading | 208 at most; 24 token requests got HTTP 520 | 0.1-1.4 MiB/s | 913 ms | 205 MiB | 6-8% |
| 1 session, 32 connections | 1 | low (see below) | 130 ms | 162 MiB | ~7% |

*   **Memory is not the limit.** 205 MiB at most, with no out-of-memory
    restart (a restart between runs was staging's idle auto-stop, a clean
    shutdown). `TCP_SEND_QUEUE_HIGH_WATER_BYTES` stays at its default.
*   **CPU is.** `shared-cpu-1x` bursts, then is held to about 6% of a CPU.
    Throttled, the relay moved about 1.4 MiB/s in total, and at 240 heavy
    sessions it could not keep up with token requests.
*   **Decision:** stay on `shared-cpu-1x` and cap `free` and `anon` at
    128 KiB/s each way (risk table). The cap shares capacity rather than
    adding it; the budget still bounds the bill.
*   **Not completed:**
    *   The "relay full" check did not trigger, because the pool never
        reached 240 sessions.
    *   The 32-connection run's downloads mostly failed in the test tool:
        each of its 32 loops looks up DNS before every download and runs
        into the anonymous tier's 20 queries a second. Memory was measured.
    *   The comparison with Fly's Cost Explorer (relay bytes against
        billed egress for 17:16-17:31 UTC, about 1.3 GB relayed) is done
        the next day; the thresholds stay at 300 GB and 840 GB unless it
        shows a different blended rate.

## Non-Functional Requirements

*   **Security and privacy.**
    *   Anonymous tokens stay bound to the client's /64 and expire after 15
        minutes, as today.
    *   The token endpoint's new errors expose no byte counts.
    *   `/api/budget` is an admin route behind the operator panel's existing
        sign-on and request checks.
    *   The privacy policy states how IP addresses are used and how long they
        are kept.
*   **Performance.**
    *   The budget adds one addition per session per flush, and one row write
        per flush.
    *   Evaluating the budget is constant-time.
    *   Completing a handshake before refusing costs one WebSocket handshake
        per authenticated refusal.
*   **Rollout and rollback.**
    *   The budget is off unless both thresholds are set, so `0.7.0-hosted.15`
        can be deployed with the current config first.
    *   The new table is migration version 7, which only adds a table. Rolling
        back the image leaves an unused table.
    *   Run `.github/workflows/migration-rehearsal.yml` before deploying. It
        restores a production backup on a GitHub runner and runs the new
        migration on it.
    *   Rolling back the config (anonymous access and sign-up) is a
        `fly.toml` revert and a deploy, which drops all sessions.

## Additional Resources

*   `docs/security/audit-2026-10-21.md`: findings AU-3 (anonymous per-address
    map), CI-1 (production deploy approval) and WB-9 (header hygiene).
*   `docs/security/threat-model.md`
*   `infra/README.md`: Cloudflare and client IP, operator access, monitoring.
*   [Fly.io pricing](https://fly.io/docs/about/pricing/), and the relaynet
    organization's October 2026 Cost Explorer (per-region egress lines).

## Future Improvements

*   **Anonymous-token helpers in `relaynet.js`**, with a token-refresh callback
    and a fixed `/api/me` check, once a third-party page wants them.
*   **Demo sign-in with Auth0 PKCE**, so an adopter's own token reaches a demo
    without pasting.
*   **Turnstile on anonymous token issuance**, if bots appear.
*   **A bigger pool or a second region**, if the pool fills before the budget
    does.
*   **A sponsors page** (GitHub Sponsors or Open Collective) and a support
    policy.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Work happens in four repositories:

| Repository | Path | Default branch |
|---|---|---|
| Fork | `../rootlessRelay` (beriberikix/rootlessRelay). Work on a new branch from `username-invites`. | `main` |
| relaynet | this repo | `main` |
| zephyr-v86 | https://github.com/beriberikix/zephyr-v86 | `main` |
| zephyr-wasm-soc | https://github.com/beriberikix/zephyr-wasm-soc | `main` |

Paths below are relative to each repository.

Deploy order:

1.  **Release** `0.7.0-hosted.15` (items 1-12). Then run the migration
    rehearsal in relaynet:
    `gh workflow run migration-rehearsal.yml -f ref=v0.7.0-hosted.15`.
2.  **Pin and deploy** the release (the pin part of item 13a) to staging, then
    production, with the budget variables unset. The budget is off.
3.  **Apply the staging config** (the rest of item 13a).
4.  **Ship the demo changes** (items 21-22), and test them against staging.
5.  **Run the staging load test, B1** (Verification Plan). Then set the final
    values.
6.  **Apply the production config** (item 13b), with items 14-20 in the same
    pull request.
7.  **Run the launch checklist** (item 23).

### Target Files to Create/Modify

#### Fork: rootlessRelay `0.7.0-hosted.15`

##### 1. `metering/budget.js` (Create)

*   **Type / Scope**: Node module. A pure state machine with no I/O and no
    timers.
*   **Proposed Changes**:
    *   `createBudget({ throttleBytes, pauseBytes, throttleBps, tiers })`
        returns an object with:
        *   `enabled`, which is true when both thresholds are set;
        *   `evaluate({ bytes, forced, now })`, which returns
            `{ state, pausedUntil }`;
        *   `appliesTo(tierName)`;
        *   `throttledRates(tier)`, which returns
            `{ uploadBps: min(tier.uploadBps ?? Infinity, throttleBps), downloadBps: min(tier.downloadBps ?? Infinity, throttleBps) }`.
    *   **State rule:**
        *   when the budget is disabled, the state is always `open` and
            `forced` is ignored;
        *   otherwise, if `forced` is set, that is the state;
        *   otherwise `paused` when `bytes >= pauseBytes`, `throttled` when
            `bytes >= throttleBytes`, and `open` otherwise.
    *   **`pausedUntil`** is the first day of the next UTC month as
        `YYYY-MM-DD`, or `null` when the state isn't `paused`. Wherever this
        plan writes `<date>`, it means this value.
    *   **`createDisabledBudget()`** returns an object whose `evaluate` always
        returns `{ state: "open", pausedUntil: null }`, and whose `appliesTo`
        always returns `false`.

##### 2. `metering/usage.js` (Modify)

*   **Type / Scope**: Usage meter. It owns the relay-wide counter, the budget
    state and the budget gauges.
*   **Proposed Changes**:
    *   **New options:**
        *   `budget`, defaulting to `createDisabledBudget()`;
        *   `onBudgetChange(prev, next)`, which receives two `budgetStatus()`
            objects.
    *   **New state:**
        *   `relayMonth`, the UTC month as `YYYY-MM`;
        *   `relayBytes`;
        *   `relayPending`, the bytes not yet written;
        *   `forced`;
        *   `lastStatus`.
    *   **`rollover(now)`** runs first in `applyDelta`, `flush()` and
        `evaluateBudget()`. If the UTC month differs from `relayMonth`:
        1.  it writes any `relayPending` to `relayMonth`'s row with the upsert
            below, keeping the bytes in `relayPending` if the write fails;
        2.  it sets `relayBytes`, `relayPending` and `forced` to zero or null;
        3.  it sets `relayMonth`.
    *   **`applyDelta`** adds `delta.in + delta.out` to `relayBytes` and
        `relayPending` for every session, whatever its tier.
    *   **`flush()`** runs its transaction when `pendingDb.size > 0` or
        `relayPending > 0`:
        1.  snapshot `relayPending` into a local `delta` and set
            `relayPending` to 0;
        2.  after the org rows, inside the transaction, upsert the delta:

            ```sql
            INSERT INTO relay_egress_monthly (month, bytes) VALUES (?, ?)
            ON CONFLICT(month) DO UPDATE SET bytes = bytes + excluded.bytes
            ```

        3.  on rollback, add `delta` back to `relayPending`.
    *   **The `finally` block of `flush()`** does three things, whether or not
        the write failed:
        *   closes the `exceeded` sessions, as before;
        *   calls `evaluateBudget()`;
        *   rethrows any error.
    *   **`isOverQuota({ identity, clientKey })`** builds its lookup object
        with `clientKey`.
    *   **`quotaKey`** uses `session.clientKey` for the in-memory (anonymous)
        key.
    *   **New `evaluateBudget(now = Date.now())`:**
        1.  calls `rollover(now)`;
        2.  computes `{ state, pausedUntil }` with `budget.evaluate`;
        3.  sets the gauges (item 11);
        4.  if the state changed, calls `onBudgetChange(lastStatus, budgetStatus())`
            and stores the new status.
    *   **New `loadBudget(now = Date.now())`:**
        1.  sets `relayMonth`;
        2.  reads that month's row and adds it: `relayBytes += row.bytes`, and
            `forced = row.forced`;
        3.  calls `evaluateBudget(now)`.
    *   **New `setForced(value, by)`:**
        *   `value` is `"open"`, `"paused"` or `null`. Any other value throws a
            `RangeError`.
        *   It upserts `forced` with
            `INSERT INTO relay_egress_monthly (month, forced) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET forced = excluded.forced`.
        *   It sets `forced` in memory, calls `evaluateBudget()`, and logs
            `budget override` with `{ forced: value, by }`.
        *   It returns `budgetStatus()`.
    *   **New `budgetStatus()`** returns:

        ```
        { month, bytes: relayBytes, throttleBytes, pauseBytes,
          state, forced, pausedUntil }
        ```

        `state` is `"open" | "throttled" | "paused"`, and `forced` is
        `"open" | "paused" | null`.
    *   **`noopUsage()`** gains four methods:
        *   `evaluateBudget()`, which does nothing;
        *   `loadBudget()`, which resolves;
        *   `setForced()`, which throws `Error("starting")`;
        *   `budgetStatus()`, which returns
            `{ month: null, bytes: 0, throttleBytes: null, pauseBytes: null, state: "open", forced: null, pausedUntil: null }`.

##### 3. `auth/db.js` and `scripts/check-migration.js` (Modify)

*   **Type / Scope**: Schema migration.
*   **Proposed Changes**:
    *   Add migration `version: 7`, which creates:

        ```sql
        CREATE TABLE relay_egress_monthly (
          month TEXT PRIMARY KEY,
          bytes INTEGER NOT NULL DEFAULT 0,
          forced TEXT CHECK (forced IN ('open', 'paused'))
        )
        ```

        It adds one table and alters none.
    *   `check-migration.js` asserts the table exists after migrating.

##### 4. `server/client_ip.js` and `auth/tokens.js` (Modify)

*   **Type / Scope**: Address grouping.
*   **Proposed Changes**:
    *   Move `rateKey` from `auth/tokens.js` to `server/client_ip.js`, next to
        `normalizeAddress`. `tokens.js` imports and re-exports it, so existing
        imports keep working.
    *   The anonymous token's address binding (`iph` at issue and at verify,
        which raises `anon-token-ip-mismatch`) is computed from `rateKey(ip)`
        instead of the raw IP. `authenticate` keeps receiving the raw
        `clientIP`, which it logs.

##### 5. `server/connection.js` (Modify)

*   **Type / Scope**: Session registry and connection handler.
*   **Proposed Changes**:
    *   **Constructor:** `createSessionRegistry({ ctx, tiers, budget, budgetStatus })`.
        `budgetStatus` is a function that returns `usage.budgetStatus()`.
    *   **Grouped address key:** the per-address maps (`perIP`,
        `reservedByIP` and `ctx.connectionsPerIP`) are keyed by `clientKey`,
        and `admit`, `add`, `remove` and `countForIP` use it.
    *   **Connection handler:** reads `clientKey` from the `connection`
        event's info object and sets `session.clientKey` next to
        `session.clientIP`.
    *   **`admit({ identity, clientKey })`** checks in this order:
        1.  If `budget.appliesTo(identity.tier)` and
            `budgetStatus().state === "paused"`:
            `{ ok: false, status: 503, close: 1008, reason: "free tier paused until <date>" }`.
        2.  Per-address limit:
            `{ ok: false, status: 429, close: 1013, reason: "connection limit reached for this address" }`.
        3.  Per-owner limit:
            `{ ok: false, status: 429, close: 1013, reason: "session limit reached for this account" }`.
        4.  Pool full:
            `{ ok: false, status: 503, close: 1013, reason: "relay full" }`.

        Refused verdicts hold no reservation.
    *   **New `poolFull()`** returns `poolInUse() + reservedTotal >= poolCapacity()`.
    *   **New `closeTier(tierNames, code, reason)`** loops over
        `sessions.values()` and closes each session whose `identity.tier` is
        in `tierNames`, in the same style as `killUser`
        (`connection.js:111-131`).
    *   **Session-closed log:** the `"session closed"` log line gains
        `tier: session.identity?.tier`.

##### 6. `policy/session_policy.js` (Modify)

*   **Type / Scope**: Rate limits for new sessions.
*   **Proposed Changes**:
    *   `createPolicyFactory` takes `budget` and `budgetStatus`.
    *   In `forSession`, when `budgetStatus().state === "throttled"` and
        `budget.appliesTo(tier name)`, the policy is built from
        `{ ...tier, ...budget.throttledRates(tier) }`.
    *   Sessions that already exist keep the policy they started with.

##### 7. `server/public.js` (Modify)

*   **Type / Scope**: Public listener.
*   **Proposed Changes**:
    *   **New options:** `budgetStatus` and `poolFull`.
    *   **Upgrade handler:**
        *   computes `clientKey = rateKey(clientIP)` once;
        *   passes the raw `clientIP` to `authenticate`, and `clientKey` to
            `admission.admit`;
        *   passes `{ identity, clientIP, clientKey, release }` in the
            `connection` event.
    *   **When a verdict has `close`, and `selectProtocol` returned `relay.v1`:**
        *   call
            `wss.handleUpgrade(req, socket, head, (ws) => ws.close(verdict.close, truncate(verdict.reason, 123)))`;
        *   don't emit `connection`;
        *   increment `upgradeRejections{status: String(verdict.status)}`.
    *   **When a verdict has `close`, but the client didn't offer `relay.v1`:**
        call `rejectUpgrade(socket, verdict.status, verdict.reason)`.
    *   **`POST /api/anon/token`** checks in this order:
        1.  method (405);
        2.  origin (403);
        3.  anonymous access enabled (404);
        4.  `budgetStatus().state === "paused"`:
            `503 {"error": "free-tier-paused", "pausedUntil": "<date>"}`;
        5.  `poolFull()`: `503 {"error": "relay-full"}`;
        6.  issue the token.

        All responses carry the existing CORS headers.
    *   **New `truncate(text, bytes)`** cuts at a UTF-8 character boundary.
        The 123-byte limit is the WebSocket protocol's maximum close-reason
        length.

##### 8. `hosted.js` (Modify)

*   **Type / Scope**: Wiring. One owner for passing the budget around.
*   **Proposed Changes**:
    *   Import `ConfigError` and `createBudget`. Build `budget` from config
        before the registry. The `usage` forwarder list gains
        `evaluateBudget`, `loadBudget`, `setForced` and `budgetStatus`.
    *   **Shared function:** `budgetStatus = () => usage.budgetStatus()`. It is
        passed to:
        *   `createSessionRegistry({ …, budget, budgetStatus })`;
        *   `createPolicyFactory({ …, budget, budgetStatus })`;
        *   `createPublicServer({ …, budgetStatus, poolFull: () => registry.poolFull() })`;
        *   `createAuthApi({ …, budgetStatus })`.
    *   **`initializeIdentity`** passes `budget` and `onBudgetChange` to
        `createUsageMeter`, then awaits `usage.loadBudget()`. Until then, the
        placeholder `noopUsage()` reports `open`.
    *   **`admission.admit({ identity, clientKey })`:**
        *   calls `usage.evaluateBudget()` first, to catch month rollover;
        *   then `registry.admit`;
        *   then the quota check, returning
            `{ ok: false, status: 429, close: 1008, reason: "quota exceeded" }`.

        `hosted.js` owns this quota mapping.
    *   **`onBudgetChange(prev, next)`:**
        *   when `next.state === "paused"`, calls
            `registry.closeTier(BUDGET_TIERS, 1008, "free tier paused until " + next.pausedUntil)`;
        *   always logs `budget state` with `prev.state`, `next.state` and
            `next.bytes`.
    *   **Startup check:** after tiers are resolved, every name in
        `BUDGET_TIERS`, and `JWT_DEFAULT_TIER` when set, must exist in
        `tiers`. Otherwise startup throws a `ConfigError`.

##### 9. `config.js` and `server/auth_api.js` (Modify)

*   **Type / Scope**: Configuration, and the public sign-in config route.
*   **Proposed Changes**:
    *   **`config.js` parses:**
        *   `BUDGET_THROTTLE_BYTES` and `BUDGET_PAUSE_BYTES`, as positive
            integers in bytes. Both are set or neither is, and
            `BUDGET_THROTTLE_BYTES < BUDGET_PAUSE_BYTES`.
        *   `BUDGET_THROTTLE_BPS`, a positive integer, default 65536.
        *   `BUDGET_TIERS`, comma-separated, default `anon`.
    *   **`createAuthApi`** takes `budgetStatus`. `GET /api/auth/config` gains
        `"budget": "open" | "throttled" | "paused"` and
        `"pausedUntil": "<date>" | null`.

##### 10. `admin/app.js` (Modify)

*   **Type / Scope**: Operator panel API.
*   **Proposed Changes**:
    *   `GET /api/budget` returns `usage.budgetStatus()`.
    *   `POST /api/budget` takes the body
        `{"forced": "open" | "paused" | null}`:
        *   it is behind the same session and `X-Requested-With` checks as the
            other write routes;
        *   `by` is the signed-in operator's username, as in the existing tier
            route;
        *   it returns 200 with `usage.setForced(value, by)`;
        *   it returns 400 `{"error": "forced must be open, paused or null"}`
            for any other value.
    *   No panel UI.

##### 11. `metrics.js` (Modify)

*   **Type / Scope**: Prometheus metrics.
*   **Proposed Changes**: four gauges, each with a no-op version when metrics
    are disabled:
    *   `rootlessrelay_budget_bytes`;
    *   `rootlessrelay_budget_threshold_bytes{threshold="throttle"|"pause"}`;
    *   `rootlessrelay_budget_state{state="open"|"throttled"|"paused"}`. Each
        series is 1 or 0, and exactly one is 1;
    *   `rootlessrelay_budget_forced{state="open"|"paused"}`. Both are 0 when
        `forced` is null.

    Only the usage meter sets them, in `evaluateBudget()`.

##### 12. Tests, README, `.env.example`, `CHANGELOG.md`, `package.json`

*   **Type / Scope**: `node --test` suites, and release documentation.
*   **Proposed Changes**:
    *   **Create `tests/budget.test.js`:**
        *   each state at, below and above each threshold;
        *   `forced` wins when enabled and is ignored when disabled;
        *   `pausedUntil` on the last day of a month, including 31 December
            (year rollover);
        *   `throttledRates` never raises a tier's rate. With a 64 KiB/s
            throttle, `anon` upload is 64 KiB/s; with a 1 MiB/s throttle, it
            stays 256 KiB/s.
    *   **Modify `tests/metering.test.js`:**
        *   with only anonymous traffic, the bytes are still written to
            `relay_egress_monthly`;
        *   a failing transaction still closes over-quota sessions and still
            changes the budget state, and the bytes are written on the next
            successful flush;
        *   `loadBudget` adds the stored bytes and restores `forced`;
        *   rollover with an injected clock writes last month's pending bytes
            to last month's row, then resets, even with no traffic;
        *   `setForced` is stored and rejects invalid values;
        *   `isOverQuota` groups anonymous addresses by /64.
    *   **Modify `tests/public-server.test.js`:**
        *   each refusal in the §2 table is a close with that exact code and
            reason, and no `connection` event;
        *   a bad token is still HTTP 401;
        *   a refused client that didn't offer `relay.v1` gets an HTTP
            response with the verdict's status;
        *   `POST /api/anon/token` returns the exact paused and full bodies,
            in the stated check order.
    *   **Modify `tests/registry.test.js`:**
        *   `close` verdicts;
        *   a test asserting item 5's check order, with paused first;
        *   `closeTier` closes only the listed tiers;
        *   `poolFull`.
    *   **Modify `tests/hosted-network.test.js`:** replace its HTTP 429 and
        503 assertions with close codes.
    *   **Modify `tests/session-policy.test.js`:** while throttled, new `anon`
        and `free` sessions get the throttled rates, `user` sessions don't,
        and existing sessions keep theirs.
    *   **Modify `tests/tokens.test.js`:** two addresses in one /64 share an
        anonymous token's binding, and a different /64 is refused.
    *   **Modify `tests/client-ip.test.js`:** `rateKey` cases for IPv4,
        IPv4-mapped, IPv6 /64 and a zone index.
    *   **Modify `tests/config.test.js`:** `BUDGET_*` parsing and its
        validation errors.
    *   **Modify `tests/zero-config.test.js`:** startup fails for an unknown
        `BUDGET_TIERS` name or `JWT_DEFAULT_TIER`.
    *   **Modify `tests/admin-hardening.test.js`:** `POST /api/budget`
        requires a session and `X-Requested-With`, returns 200 with the new
        status, and returns 400 for an invalid `forced`.
    *   **Modify `tests/metrics.test.js`:** the four gauges, including both
        `forced` series being 0 when `forced` is null.
    *   **Release documentation:**
        *   document the `BUDGET_*` variables, the close codes, the token
            endpoint errors and `/api/budget` in the README and
            `.env.example`;
        *   add a changelog entry;
        *   bump the version to `0.7.0-hosted.15`;
        *   attach the `npm pack` tarball to the fork release
            `v0.7.0-hosted.15`.

#### relaynet (this repo)

##### 13a. `relay/package.json`, `relay/package-lock.json`, `relay/fly.staging.toml` (Modify)

*   **Type / Scope**: Relay pin (deploy step 2) and staging config (deploy
    step 3).
*   **Proposed Changes**:
    *   **Pin:** `rootlessrelay` points to
        `https://github.com/beriberikix/rootlessRelay/releases/download/v0.7.0-hosted.15/rootlessrelay-0.7.0-hosted.15.tgz`.
        Then run `npm install` to refresh the lockfile.
    *   **Staging config:** the §4 settings, with test thresholds
        `BUDGET_THROTTLE_BYTES = "52428800"` (50 MiB) and
        `BUDGET_PAUSE_BYTES = "104857600"` (100 MiB).
    *   **`ALLOWED_ORIGINS`** gains `https://beriberikix.github.io`.
    *   **`[http_service.concurrency]`:** `soft_limit = 260` and
        `hard_limit = 300`.
    *   **`ANON_TOKEN_SECRET`:** set it as a Fly secret on `relaynet-staging`.

##### 13b. `relay/fly.toml` (Modify)

*   **Type / Scope**: Production config (deploy step 6).
*   **Proposed Changes**:
    *   The §4 settings, with the values B1 produces. The starting values are
        `BUDGET_THROTTLE_BYTES = "300000000000"` (300 GB) and
        `BUDGET_PAUSE_BYTES = "840000000000"` (840 GB).
    *   `TCP_SEND_QUEUE_HIGH_WATER_BYTES` from B1.
    *   The same `[http_service.concurrency]` change as staging.
    *   A comment on each value giving its derivation.
    *   **`ANON_TOKEN_SECRET`:** set it as a Fly secret on `relaynet`.

##### 14. `relay/README.md` (Modify)

*   **Type / Scope**: Contract README.
*   **Proposed Changes**:
    *   Document the budget variables, the `free` and `anon` tiers, and the
        concurrency change.
    *   **New "Budget" section:**
        *   `GET /api/budget`;
        *   a curl example that clears or sets the override:
            `curl -X POST https://admin.relaynet.network/api/budget -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' -b '<panel session cookie>' -d '{"forced": null}'`;
        *   the token endpoint's 503 errors.
    *   Note that `migration-rehearsal.yml` must pass before deploying
        `0.7.0-hosted.15`.

##### 15. `client/README.md` (Modify)

*   **Type / Scope**: npm README. The version doesn't change.
*   **Proposed Changes**: add two paragraphs:
    *   "Anonymous tokens are for relaynet's own demo pages and are not
        supported by this library. Use an account token."
    *   "From relay `0.7.0-hosted.15`, a refusal after authentication arrives
        as an open followed by a close. `onOpen` fires, then `onClose` with
        code 1008 (final, no retry) or 1013 (retried with backoff)."

##### 16. `web/public/index.html`, `web/public/app.js`, `web/public/styles.css`, `web/README.md` (Modify)

*   **Type / Scope**: Landing page.
*   **Proposed Changes**:
    *   **Reword two strings for new visitors:**
        *   "This relay is invite-only" (`index.html:183`);
        *   the hosted-service notice near line 59.

        Keep the redeem card, which `app.js` shows only to pending accounts.
    *   **Demo links:** "Boot Zephyr in your browser" links to
        https://beriberikix.github.io/zephyr-v86/ and
        https://beriberikix.github.io/zephyr-wasm-soc/.
    *   **Banner:** `app.js` reads `budget` and `pausedUntil` from its existing
        `GET /api/auth/config` call. When `budget === "paused"`, it shows "The
        free tier is paused until <date>." in a new `.banner` element, set with
        `textContent`.
    *   **`web/README.md`** lists the two new fields.

##### 17. `web/docs/docs.md` (Modify), then `python3 web/docs/build.py`

*   **Type / Scope**: Public docs.
*   **Proposed Changes**: extend existing sections:
    *   **`## Quick start`:** use an account token.
    *   **The close-code table under `### Errors`:** add 1008 (policy, don't
        retry), 1013 (try again later), and 1006 (network failure, or refused
        before the WebSocket upgrade).
    *   **`## Limits`:** the `free` and `anon` tiers, and the monthly budget,
        throttle and pause.
    *   **Self-hosting:** link it to `docs/self-hosting/`.
    *   **Rebuild** `web/public/docs.html`, `web/public/docs.md` and
        `web/public/llms.txt`.

##### 18. `infra/legal/terms.md`, `infra/legal/privacy.md`, `infra/legal/acceptable-use.md` (Modify), then `python3 infra/legal/build.py`

*   **Type / Scope**: Legal pages.
*   **Proposed Changes**:
    *   **`terms.md`:**
        *   anonymous use is allowed without an account;
        *   free and anonymous service may be slowed and then paused when the
            monthly budget is used;
        *   remove the invite-code requirement.
    *   **`privacy.md`:** "IP addresses are processed for anonymous rate
        limits and appear in operational logs kept for 14 days."
    *   **`acceptable-use.md`:** the rules apply to anonymous use too.
    *   **Rebuild** `web/public/terms.html`, `web/public/privacy.html` and
        `web/public/acceptable-use.html`.

##### 19. `infra/grafana/provision.py`, `infra/grafana/README.md` (Modify)

*   **Type / Scope**: Alerting.
*   **Proposed Changes**:
    *   **`RULES`** gains three tuples in the existing
        `(name, PromQL, op, threshold, pending, severity, summary)` shape:
        *   `("budget 50pct", RATIO, ">", 0.5, "5m", "warning", …)`;
        *   `("budget 80pct", RATIO, ">", 0.8, "5m", "warning", …)`;
        *   `("budget 100pct", RATIO, ">", 1.0, "1m", "critical", …)`.

        `RATIO` is
        `max by (app) (rootlessrelay_budget_bytes{app=~"relaynet|relaynet-staging"}) / max by (app) (rootlessrelay_budget_threshold_bytes{app=~"relaynet|relaynet-staging", threshold="pause"})`.
    *   **Two more tuples:**
        *   `("budget paused", 'max by (app) (changes(rootlessrelay_budget_state{app=~"relaynet|relaynet-staging", state="paused"}[10m]))', ">", 0, "0m", "critical", …)`;
        *   `("budget forced", 'max by (app) (rootlessrelay_budget_forced{app=~"relaynet|relaynet-staging"})', ">", 0, "0m", "warning", …)`.

        All five names are unique in their first 30 characters.
    *   **Contact point:** a webhook `relaynet-push` to `NTFY_URL`, a new
        required environment variable.
    *   **Notification policy:** two child routes, each sending to
        `relaynet-push` with `continue: true` so email still gets the alert:
        *   one matching `alertname=~"budget.*"`;
        *   one matching `severity="critical"`.
    *   The README documents `NTFY_URL`.

##### 20. `infra/load/load.mjs`, `infra/load/README.md`, `infra/README.md`, `README.md`, `docs/security/threat-model.md`, `docs/self-hosting/relaynet-network.md` (Modify)

*   **Type / Scope**: Load generator and docs.
*   **Proposed Changes**:
    *   **`load.mjs`:**
        *   with `ANON=1`, `RELAY_TOKEN` is not required, and each session
            fetches its own anonymous token from the relay's HTTP origin;
        *   a new `CONNS_PER_SESSION` setting (default 1) opens that many
            parallel downloads in each downloader session;
        *   the summary adds bytes per session and the peak open sessions;
        *   the README documents all of these.
    *   **`infra/README.md` and `relaynet-network.md`:** record that anonymous
        access and open sign-up are on. Document the `free` tier, the budget,
        the ntfy alerts, and how to activate legacy pending accounts.
    *   **Threat model:** add anonymous access and budget griefing, with the
        mitigations from §Risks.
    *   **Root `README.md`:** add the budget to Global Invariants.

#### Demo repos

##### 21. zephyr-v86: `web/main.js`, `web/index.html`, `README.md` (Modify)

*   **Type / Scope**: Demo page at https://beriberikix.github.io/zephyr-v86/.
    The guest is a Buildroot Linux shell. v86's network adapter reconnects on
    its own (see §8).
*   **Proposed Changes**:
    *   **Relay selection:**
        *   the default relay stays `wss://relay.relaynet.network/`
            (`DEFAULT_NETWORK_RELAY_URL`);
        *   a new `?relay=staging` parameter sets the relay field to
            `wss://relay-staging.relaynet.network/`;
        *   the relaynet hosts are `relay.relaynet.network` and
            `relay-staging.relaynet.network`.
    *   **Token in a variable:** `install_relay_token_shim(relay_url, token)`
        stores the token in a module variable, `relay_token_current`. The
        wrapped constructor reads that variable each time it opens a socket to
        the relay host, instead of the value captured at install time.
    *   **In `start_buildroot()`:** if the relay URL is a relaynet host and the
        token field (saved under `zephyr-v86-network-token`) is empty:
        1.  call `POST https://<host>/api/anon/token` before installing the
            shim;
        2.  on success, use the returned token, and don't save it;
        3.  on 503, install the shim anyway with `relay_stopped = true`, so
            v86's network device exists and Reconnect can start it later. Set
            the network status to the paused or full message below, and show
            the Reconnect button.
    *   **Messages:**
        *   `free-tier-paused` shows "The free tier is paused until
            <pausedUntil>."
        *   `relay-full` shows "The relay is full. Try again in a few
            minutes."
    *   **The shim's `close` listener** sets `relay_stopped = true`, shows the
        Reconnect button, and replaces today's messages with:
        *   **closed before open:** "Connection failed. Click Reconnect to try
            again." This replaces "Relay refused connection (check token)" for
            anonymous tokens, and keeps the token hint when a token was pasted.
        *   **1008:** "Session closed by relay: <reason>", as today.
        *   **1013:** "Relay busy: <reason>. Click Reconnect to try again."
        *   **1001:** "Relay restarting". Here `relay_stopped` stays false, so
            v86's own retry reconnects with the same token.
    *   **While `relay_stopped` is true,** the wrapped constructor throws
        `Error("relay stopped")` for the relay host. v86's `connect()` catches
        it and logs it, so its automatic retries open no sockets.
    *   **Reconnect button:**
        1.  for an anonymous session, fetch a new token as above and set
            `relay_token_current`;
        2.  set `relay_stopped = false`;
        3.  set the status to "Connecting".

        v86's next `connect()` (at most 10 seconds later, or at the guest's
        next frame) opens the socket. The guest isn't rebooted.
    *   **README:**
        *   drop the sign-in and paste steps for the default relay;
        *   the guest steps become `udhcpc`, then `nslookup example.com`, then
            `wget -O- http://example.com/`;
        *   the guest's BusyBox already has `udhcpc`, `nslookup` and `wget`
            (checked on the live demo on 2026-10-30). It has no `nc`.

##### 22. zephyr-wasm-soc: `host/uplink.mjs`, `host/web/worker.js`, `host/web/index.html`, `scripts/apps.json`, `README.md` (Modify)

*   **Type / Scope**: The `dhcp` sample's uplink, page at
    https://beriberikix.github.io/zephyr-wasm-soc/. The simulated network
    stays the default.
*   **Proposed Changes**:
    *   **`connectUplink(host, url, onStatus, { token } = {})`:**
        *   with a token, open
            `new WebSocket(url, ["relay.v1", "relay.token." + token])`;
        *   `ws.onclose` passes `event.code` and `event.reason` on:
            *   before open, it rejects with
                `could not reach the relay at <url> (<code> <reason>)`;
            *   after open, it calls
                `onStatus("*** the relay closed the link (<code>): <reason> ***")`.
    *   **`worker.js`:** reads `msg.uplinkToken` and passes it as
        `{ token: msg.uplinkToken }`.
    *   **`index.html`:**
        *   a "Real network (relaynet)" button in `#uplinkRow` sets the Uplink
            field to `relaynet`;
        *   `?uplink=relaynet` does the same;
        *   `uplinkUrl()` maps `relaynet` to `wss://relay.relaynet.network/`,
            and `relaynet-staging` to `wss://relay-staging.relaynet.network/`.
    *   **On Run, when the uplink is a relaynet host:**
        1.  the page calls `POST https://<host>/api/anon/token`;
        2.  on success it sends `uplinkToken` in the run message;
        3.  on 503 it doesn't start the uplink, and shows the paused or full
            message in `#status`.
    *   **The status line** reads "Running, on a real network through
        relaynet." for this case.
    *   **`scripts/apps.json`:** the `dhcp` sample's hint adds one sentence:
        "Or choose Real network (relaynet) to put it on the internet with no
        setup; in its shell try `net dns zephyrproject.org`."
    *   **README:** document the relaynet choice next to the
        local-relay instructions.

#### Outside the repositories

##### 23. Launch checklist (tracked in #83)

*   **Type / Scope**: Operations.
*   **Proposed Changes**: in order:
    1.  **Fly acceptable-use confirmation:** ask Fly support, and record the
        written answer in #83.
    2.  **History check:** gitleaks over the full history, then an
        accept-or-rotate decision for each identifier listed in
        `docs/security/audit-2026-10-21.md`.
    3.  **Production config:** deploy item 13b, then send a test alert to
        ntfy.
    4.  **Legacy pending accounts:** list them in the operator panel. For
        each one, call `POST /api/users/:id/activate`, then
        `POST /api/users/:id/tier` with `{"tier": "free"}`.
    5.  **Publish:** make the repository public, then turn on:
        *   branch protection on `main`;
        *   a required reviewer on the `production` environment;
        *   private vulnerability reporting (§9).
    6.  **Soft launch:** post to the Zephyr community. That date is day 0.
        Then run the 14-day launch watch (§9).
    7.  **Wider launch:** Hacker News and Reddit posts. A deploy freeze lasts
        until three hours after the Hacker News post, with the maintainer
        online.

### Verification Plan

*   **Fork:**
    *   `npm test` in `../rootlessRelay`: all new and existing suites pass.
    *   In relaynet,
        `gh workflow run migration-rehearsal.yml -f ref=v0.7.0-hosted.15`
        passes. It restores the latest production backup and runs the
        migrations on it.
*   **relaynet CI** (`.github/workflows/ci.yml`):
    *   `client` job;
    *   `web` job: `node --check` and the `build.py` diff;
    *   `relay-image` job: the image build and a `/healthz` check;
    *   `compose` job: `deploy/compose-check.sh`, with the budget off.
*   **Staging end to end,** with the test thresholds from item 13a:
    *   **G1:** a timer starts at page navigation for each demo.
        *   **zephyr-v86:** it stops when `wget -O- http://example.com/`
            prints the page.
        *   **zephyr-wasm-soc:** it stops when `net dns zephyrproject.org`
            prints an address, after one click on "Real network (relaynet)"
            and Run.

        Pass: 60 seconds or less, median of 3 runs by someone new to the
        demo.
    *   **G2:** on a test account, count the clicks and pastes from the signed-in
        dashboard to a copied token. Pass: 3 or fewer.
    *   **G3 and G4,** with no restart at any point:
        1.  Load traffic until `rootlessrelay_budget_bytes` passes 50 MiB.
            A new `anon` session's download rate, measured in the guest over
            30 s, is within 10% of 64 KiB/s.
        2.  Load past 100 MiB. Live `anon` and `free` sessions close with
            `1008 "free tier paused until <date>"`.
        3.  `POST /api/anon/token` returns `503 free-tier-paused`.
        4.  The zephyr-v86 page shows "The free tier is paused until <date>."
            both on load and after the close.
        5.  The `budget 50pct`, `budget 100pct` and `budget paused` alerts
            reach ntfy.
    *   **Override:**
        *   `POST /api/budget {"forced": "open"}` reopens the tier;
        *   after `fly machine restart`, `GET /api/budget` still shows
            `forced: "open"`;
        *   `{"forced": null}` clears it.
    *   **G6:** gitleaks exits 0. The repository's Settings → Branches shows
        the `main` ruleset, and Settings → Environments → `production` shows
        a required reviewer.
*   **B1, the staging load test:**
    *   **Before, on `relaynet-staging`.** Revert all of these afterwards:
        *   resize the machine to 1 GB, matching production;
        *   unset `BUDGET_THROTTLE_BYTES` and `BUDGET_PAUSE_BYTES`;
        *   set `ANON_TOKENS_PER_IP_PER_HOUR = "1000"`;
        *   set `TIERS_JSON` `anon.maxSessionsPerIP: 300` and
            `anon.quotaBytes: null`.
    *   **Run, one command at a time:**
        *   `ANON=1 SESSIONS=60 node infra/load/load.mjs`;
        *   `ANON=1 SESSIONS=120 node infra/load/load.mjs`;
        *   `ANON=1 SESSIONS=240 node infra/load/load.mjs`;
        *   `ANON=1 SESSIONS=1 DOWNLOADERS=1 CONNS_PER_SESSION=32 node infra/load/load.mjs`.
    *   **While 240 sessions are open:**
        *   `POST /api/anon/token` returns `503 relay-full`;
        *   a client using an account token gets close 1013 `relay full`, not
            1006.
    *   **Pass:**
        *   no out-of-memory restart;
        *   peak memory below 700 MB at 240 sessions;
        *   relay bytes (`rootlessrelay_budget_bytes`) within 10% of the Fly
            Cost Explorer egress for the test's start and end dates.
    *   **Record:** `/data` growth in MB per 1,000 sessions. If a month at the
        pause threshold would use more than half of the 1 GB volume, run
        `fly volumes extend` before launch.
    *   **Set:**
        *   `TCP_SEND_QUEUE_HIGH_WATER_BYTES`: try 1 MiB, 512 KiB, 256 KiB and
            128 KiB in that order, and keep the first value that passes the
            700 MB memory line;
        *   the thresholds from the formula in §1, using the measured blended
            rate if it differs from $0.04/GB.
*   **G7 (adoption):** on day 30 and day 90, counting from the soft-launch
    post, run two Loki queries over the `"session closed"` log for the
    previous 14 days. Record the results and the budget percentage in #83:
    *   distinct anonymous token IDs (the `jti` in `anon:<jti>` owners) with
        `durationMs > 60000`;
    *   accounts with sessions on 2 or more distinct days.

--------------------------------------------------------------------------------

*Drafted with EGM*
