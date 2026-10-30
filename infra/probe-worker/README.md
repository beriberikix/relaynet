# probe-worker

## Overview

Cloudflare Worker `relaynet-probe` that runs the relay's end-to-end probe on
a cron trigger every 5 minutes (GitHub's scheduled workflows were too
unreliable for a heartbeat). It performs the same checks as
[`../probe/probe.mjs`](../probe/README.md) (API token auth, DHCP lease, DNS
lookup through the relay's UDP egress) and reports to a Better Stack
heartbeat. Code is in `src/index.ts`; configuration in `wrangler.jsonc`.

## Interface

- `src/index.ts`:
  - default export `{ scheduled(controller, env, ctx) }`: runs `run(env)`
    under `ctx.waitUntil`.
  - `interface Env { RELAY_URL; PROBE_RELAY_TOKEN; BETTERSTACK_PROBE_HEARTBEAT_URL }`
  - `run(env)`: one probe, one retry after 15 s, then reports.
  - `probe(env)`: opens the WebSocket via `fetch` with an `Upgrade` header and
    resolves with an `OK in ... ms` detail string or rejects with a reason.
  - Packet helpers: `udpFrame`, `dhcpDiscover`, `dnsQuery`, `dhcpOption`,
    `checksum`.
- `wrangler.jsonc`: `name: relaynet-probe`, `main: src/index.ts`,
  `vars.RELAY_URL = wss://relay.relaynet.network/`, `triggers.crons:
  ["*/5 * * * *"]`, `workers_dev: false`, `preview_urls: false`,
  observability on.
- `package.json`: script `deploy` (`wrangler deploy`); dev dependency
  `wrangler`.

## Invariants

- Secrets `PROBE_RELAY_TOKEN` and `BETTERSTACK_PROBE_HEARTBEAT_URL` are not in
  the repository; `.github/workflows/deploy-probe-worker.yml` copies them from
  the repository's Actions secrets on deploy. It deploys on pushes to `main`
  touching `infra/probe-worker/**` or the workflow, and on a manual run, which
  is how secrets are rotated (`gh secret set …`, then
  `gh workflow run deploy-probe-worker.yml`). The deploy runs in the GitHub
  environment `cloudflare` with secret `CLOUDFLARE_API_TOKEN` and variable
  `CLOUDFLARE_ACCOUNT_ID`.
- Fails unless the relay selects subprotocol `relay.v1`.
- Uses MAC `02:70:72:6f:62:66`, distinct from the GitHub probe's.
- Incoming binary frames (Blobs in Workers) are handled strictly in arrival
  order through a promise queue.
- Each attempt times out after 20 s (`TIMEOUT_MS`); query name is
  `example.com`; DNS falls back to `8.8.8.8` without DHCP option 6.
- Only a failure of both attempts is reported as a failure, so a single
  dropped packet or deploy restart does not page.

## Side Effects

- Every 5 minutes: up to two WebSocket sessions to `RELAY_URL` and DNS
  queries through the relay's egress.
- `POST` to `BETTERSTACK_PROBE_HEARTBEAT_URL` with the result on success, or
  to `<url>/fail` with the reason after two failures.
- Logs via `console.log` / `console.warn` / `console.error` (Workers
  observability).

## Verification

No automated tests. Build check without deploying (after `npm ci`):

```sh
cd infra/probe-worker && npx wrangler deploy --dry-run
```
