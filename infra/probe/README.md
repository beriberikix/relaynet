# probe

## Overview

`probe.mjs` is the end-to-end probe of the hosted relay used from GitHub
Actions: it authenticates with an API token, gets a DHCP lease, then resolves
a name through the relay's UDP egress, exercising auth, the WebSocket path,
the virtual network and real egress. Node 22+ (built-in `WebSocket`); no
dependencies. The scheduled (every 5 min) version of the same check is the
Cloudflare Worker in [`../probe-worker`](../probe-worker/README.md).

## Interface

- Run: `RELAY_URL=wss://relay.relaynet.network RELAY_TOKEN=rr_... node probe.mjs`
- Environment (defaults in parentheses): `RELAY_TOKEN` (required),
  `RELAY_URL` (`wss://relay.relaynet.network/`), `PROBE_NAME`
  (`example.com`), `PROBE_TIMEOUT_MS` (20000).
- Exit status: 0 with `probe: OK in ... ms (lease ..., ... resolved via ...,
  N answers)`; 1 with `probe: FAIL after ... ms: <reason>` on error, early
  close, wrong subprotocol, bad DNS answer or timeout.
- Callers: `.github/workflows/relay-probe.yml` (manual dispatch) and the
  post-deploy checks in `.github/workflows/deploy-relay.yml` (up to 5 tries).
  Changes under `infra/probe/**` trigger `deploy-relay.yml`.

## Invariants

- Connects with subprotocols `relay.v1` and `relay.token.<RELAY_TOKEN>` and
  fails unless the server selects `relay.v1`.
- Uses MAC `02:70:72:6f:62:65` ("probe"); the Worker deliberately uses a
  different one (`...:66`).
- Stages run strictly in order: `connect` -> `dhcp` -> `dns` -> `done`.
- DNS server is taken from DHCP option 6, falling back to `8.8.8.8`; the
  query goes from UDP port 40053 to port 53, and success requires
  `rcode == 0` and at least one answer.

## Side Effects

- One WebSocket session to `RELAY_URL` and one DNS query through the relay's
  egress. Writes one result line to stdout or stderr. It does not ping any
  heartbeat itself; the calling workflow does.

## Verification

No automated tests. Syntax check: `node --check infra/probe/probe.mjs`.
Live check: `RELAY_TOKEN=rr_... node infra/probe/probe.mjs`.
