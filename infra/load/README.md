# load

## Overview

`load.mjs` is a load generator for the relay. One Node process opens many
WebSocket sessions; each takes a DHCP lease and sends a DNS query on an
interval, and a subset also runs a minimal user-space TCP client that
downloads over plain HTTP in a loop, exercising the relay's TCP termination,
pacing and rate limiting. Node 22+ (built-in `WebSocket`); no dependencies.

## Interface

- Run: `RELAY_URL=... RELAY_TOKEN=rr_... node load.mjs`, or
  `RELAY_URL=... ANON=1 node load.mjs` for anonymous sessions.
- Environment (defaults in parentheses):
  - `RELAY_TOKEN` (required unless `ANON=1`; exits 1 if neither is set)
  - `ANON` (unset): `1` gives every session its own anonymous token from
    `POST <relay>/api/anon/token`, as a demo visitor gets.
  - `RELAY_URL` (`wss://relay-staging.relaynet.network/`)
  - `SESSIONS` (50), `DOWNLOADERS` (0), `RAMP_PER_SEC` (10), `HOLD_S` (60)
  - `CONNS_PER_SESSION` (1): parallel downloads in each downloading session,
    to fill one session's TCP connections.
  - `DNS_INTERVAL_MS` (5000)
  - `DOWNLOAD_HOST` (`speed.cloudflare.com`), `DOWNLOAD_PATH`
    (`/__down?bytes=2000000`)
  - `ACK_DELAY_MS` (0): delays every TCP segment the client sends, to
    simulate a distant user.
- Output: a status line every 10 s from `report()` (open, leased, connect
  failures, early closes, token failures, DNS success and p50/p95 latency,
  downloads, MiB/s, out-of-order segments) and a final summary with close
  codes, token errors, download time percentiles, the bytes relayed over the
  WebSockets in both directions (total and per session) and the peak number
  of open sessions.

## Invariants

- Sessions connect with WebSocket subprotocols `relay.v1` and
  `relay.token.<token>`: `RELAY_TOKEN`, or with `ANON=1` a fresh anonymous
  token per session (an anonymous token allows one session).
- Parallel downloads in one session use separate source-port ranges, and
  each TCP connection is tracked by its source port.
- Session `i` uses MAC `02:6c:6f:<i hi>:<i lo>:01`; the first `DOWNLOADERS`
  sessions (`i < DOWNLOADERS`) run `downloadLoop()`.
- Each session waits for a DHCP reply (source port 67) before sending any
  other traffic; the DNS server comes from DHCP option 6, falling back to
  `8.8.8.8`.
- TCP SYNs carry an MSS option of 1460 (the relay otherwise falls back to
  536-byte segments). A download times out after 60 s; a DNS query after 5 s.
- All sessions share one client IP (and, without `ANON`, one account), so the
  target relay's per-account, per-IP and anonymous limits must be raised
  first (see "B1" below, or "Load test" in the private operator runbooks).

## Side Effects

- Opens up to `SESSIONS` WebSocket connections to `RELAY_URL` and sends real
  DNS and HTTP traffic through the relay's egress to the internet (default
  download host `speed.cloudflare.com`).
- Writes progress to stdout; exits 0 after `HOLD_S` and closing all sessions.

## Verification

No automated tests. Syntax check: `node --check infra/load/load.mjs`

## B1: the staging load test before the public launch

`docs/design/open-front-door.md` (Verification Plan, "B1") uses this to set
production's budget thresholds and `TCP_SEND_QUEUE_HIGH_WATER_BYTES`. It runs
against `relaynet-staging` with temporary settings, then puts staging back.

### 1. Temporary staging settings (about an hour)

From `relay/`, deploy staging sized like production (1 GB) with the budget
out of reach (thresholds of 1 and 2 PB, so it never throttles or pauses but
still counts), the anonymous per-address limits raised, and no anonymous
daily quota.
`TIERS_JSON` repeats staging's `free` tier, because `BUDGET_TIERS` and
`JWT_DEFAULT_TIER` name it:

```sh
cd relay
fly deploy -c fly.staging.toml --ha=false --remote-only --vm-memory 1024 \
  --env BUDGET_THROTTLE_BYTES=1000000000000000 --env BUDGET_PAUSE_BYTES=2000000000000000 \
  --env ANON_TOKENS_PER_IP_PER_HOUR=1000 \
  --env TIERS_JSON='{"anon":{"maxSessionsPerIP":300,"quotaBytes":null},"free":{"uploadBps":262144,"downloadBps":262144,"maxTcpConnections":32,"synPerSec":5,"dnsQps":20,"maxUdpFlows":32,"connectTimeoutMs":10000,"allowedTcpPorts":[80,443],"allowedUdpPorts":[443],"dnsServers":["8.8.8.8"],"vmToVm":false,"maxSessionMs":1800000,"idleMs":300000,"maxSessionsPerOwner":1,"maxSessionsPerIP":2,"quotaBytes":1073741824,"quotaPeriod":"month"}}'
```

Note the start time (UTC) for the cost comparison in step 4.

### 2. Watch memory and CPU

In a second terminal, reach the admin port and sample the relay's own metrics
every 5 s (Ctrl-C to stop):

```sh
fly proxy 8002:8001 -a relaynet-staging &
while sleep 5; do
  curl -s localhost:8002/metrics | awk -v t="$(date -u +%T)" '
    /^rootlessrelay_process_resident_memory_bytes / { rss = $2 / 1048576 }
    /^rootlessrelay_process_cpu_seconds_total / { cpu = $2 }
    /^rootlessrelay_sessions\{/ { s += $2 }
    /^rootlessrelay_budget_bytes / { b = $2 / 1048576 }
    END { printf "%s rss=%.0f MiB cpu=%.1f s sessions=%d relayed=%.0f MiB\n", t, rss, cpu, s, b }'
done
```

### 3. Runs

Each run lasts about 2-3 minutes. From the repository root, one at a time:

```sh
export RELAY_URL=wss://relay-staging.relaynet.network/ ANON=1
SESSIONS=60  DOWNLOADERS=10 HOLD_S=120 node infra/load/load.mjs
SESSIONS=120 DOWNLOADERS=20 HOLD_S=120 node infra/load/load.mjs
SESSIONS=240 DOWNLOADERS=40 HOLD_S=180 node infra/load/load.mjs
SESSIONS=1   DOWNLOADERS=1  CONNS_PER_SESSION=32 HOLD_S=120 node infra/load/load.mjs
```

During the 240-session run, while the summary lines show `open=240`, check
that a newcomer is told the relay is full instead of getting a bare failure:

```sh
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://relay-staging.relaynet.network/api/anon/token   # expect {"error":"relay-full"}
```

The last run (one session, 32 parallel downloads) is the worst case for one
visitor's TCP buffers. Repeat it with `TCP_SEND_QUEUE_HIGH_WATER_BYTES` set
lower (`--env TCP_SEND_QUEUE_HIGH_WATER_BYTES=524288`, then `262144`, then
`131072`, redeploying with the step 1 command each time) until it passes.

### 4. Pass and record

- **Pass:** no out-of-memory restart (`fly logs -a relaynet-staging`, and the
  machine's restart count in `fly status -a relaynet-staging`), and peak
  `rss` below 700 MiB with 240 sessions open and during the 32-connection run.
- **Pass:** `relay-full` from the token endpoint at 240 sessions.
- **Record:** peak `rss` and the CPU growth for each run; each run's
  `relayed … per session` line; and `/data` growth (`fly ssh console -a
  relaynet-staging -C "du -sk /data"` before and after), per 1,000 sessions.
- **Compare with Fly:** the next day, in the Fly dashboard's Cost Explorer
  (relaynet organization, per-app view), take `relaynet-staging`'s egress for
  the test day and compare it with the `relayed=` total from step 2. Within
  10% passes. If Fly's figure is higher, use the ratio as the blended rate
  when setting production's thresholds.

### 5. Put staging back

```sh
gh workflow run deploy-relay.yml --repo beriberikix/relaynet
```

This redeploys staging from `relay/fly.staging.toml` (512 MB, test budget
thresholds, normal anonymous limits) and probes it. Production is not
touched.
