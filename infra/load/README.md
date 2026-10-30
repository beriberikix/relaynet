# load

## Overview

`load.mjs` is a load generator for the relay. One Node process opens many
WebSocket sessions; each takes a DHCP lease and sends a DNS query on an
interval, and a subset also runs a minimal user-space TCP client that
downloads over plain HTTP in a loop, exercising the relay's TCP termination,
pacing and rate limiting. Node 22+ (built-in `WebSocket`); no dependencies.

## Interface

- Run: `RELAY_URL=... RELAY_TOKEN=rr_... node load.mjs`
- Environment (defaults in parentheses):
  - `RELAY_TOKEN` (required; exits 1 if unset)
  - `RELAY_URL` (`wss://relay-staging.relaynet.network/`)
  - `SESSIONS` (50), `DOWNLOADERS` (0), `RAMP_PER_SEC` (10), `HOLD_S` (60)
  - `DNS_INTERVAL_MS` (5000)
  - `DOWNLOAD_HOST` (`speed.cloudflare.com`), `DOWNLOAD_PATH`
    (`/__down?bytes=2000000`)
  - `ACK_DELAY_MS` (0): delays every TCP segment the client sends, to
    simulate a distant user.
- Output: a status line every 10 s from `report()` (open, leased, connect
  failures, early closes, DNS success and p50/p95 latency, downloads,
  MiB/s, out-of-order segments) and a final summary with close codes and
  download time percentiles.

## Invariants

- Sessions connect with WebSocket subprotocols `relay.v1` and
  `relay.token.<RELAY_TOKEN>`.
- Session `i` uses MAC `02:6c:6f:<i hi>:<i lo>:01`; the first `DOWNLOADERS`
  sessions (`i < DOWNLOADERS`) run `downloadLoop()`.
- Each session waits for a DHCP reply (source port 67) before sending any
  other traffic; the DNS server comes from DHCP option 6, falling back to
  `8.8.8.8`.
- TCP SYNs carry an MSS option of 1460 (the relay otherwise falls back to
  536-byte segments). A download times out after 60 s; a DNS query after 5 s.
- All sessions share one account and one client IP, so the target relay's
  per-account and per-IP caps must be raised first (see "Load test" in the
  private operator runbooks).

## Side Effects

- Opens up to `SESSIONS` WebSocket connections to `RELAY_URL` and sends real
  DNS and HTTP traffic through the relay's egress to the internet (default
  download host `speed.cloudflare.com`).
- Writes progress to stdout; exits 0 after `HOLD_S` and closing all sessions.

## Verification

No automated tests. Syntax check: `node --check infra/load/load.mjs`
