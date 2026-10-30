# relaynet

Hosted, multi-user network relay at https://relaynet.network (relay endpoint
`wss://relay.relaynet.network`). Clients with their own TCP/IP stack (browser
VMs, or user-space stacks for SSH, USB/IP, debug and custom protocols) send
Ethernet frames over a WebSocket and get IPv4 TCP and UDP to the internet;
sessions of one account share a private network. The docs page
(`web/docs/docs.md`) lists use cases and when to use something else.

## Run your own

```sh
git clone https://github.com/beriberikix/relaynet
cd relaynet && docker compose up
```

Then open http://localhost and create an account (or sign in as `admin` with
the password printed once in `docker compose logs relay`); the operator panel
is on http://127.0.0.1:8001. No configuration or third-party accounts are
needed. `compose.yaml` lists the optional settings: a domain for HTTPS,
single sign-on with any OpenID Connect provider, S3 backups. The guides are
in [`docs/self-hosting/`](docs/self-hosting/): quick start, single server,
single sign-on, and how relaynet.network itself is deployed.

## This repository

The relay process is
[rootlessRelay](https://github.com/beriberikix/rootlessRelay) in hosted mode,
pinned as a dependency; this repo holds everything around it.

```
compose.yaml  quick start: the relay and the site on one machine
deploy/  the site's container (Caddy) for compose and other hosts
relay/   container image + Fly.io config for the relay process
web/     browser frontend (Cloudflare Worker, static assets)
client/  relaynet.js, the reconnecting client helper (npm: relaynet)
infra/   operator tooling (probes, load test, Grafana, legal pages) and setup
         notes for Cloudflare, Auth0 and operator access
docs/    self-hosting guides, design notes, security audit and threat model
```

Bump the relay by changing the tarball version in `relay/package.json` and
running `npm install` there to refresh the lockfile.

## System Overview

Three deployable pieces sit around the pinned relay. Self-hosted, they run on
one origin. On relaynet.network, they are split across Cloudflare and Fly.io.

- **Relay** (`relay/`): the `rootlessrelay` process in a container. It serves
  the `relay.v1` WebSocket (Ethernet frames), the `/api/*` account routes and
  `/healthz` on port 8086, and `/metrics` (plus the operator panel in compose)
  on port 8001. Its SQLite database is at `/data/relay.sqlite` and is
  replicated with Litestream when `LITESTREAM_BUCKET` is set.
- **Site** (`web/`, plus `deploy/caddy/` for self-hosting): static landing
  page and account dashboard. `web/public/app.js` calls the relay's `/api/*`
  routes with a Bearer token from a relay sign-in or an OIDC provider.
  `config.js` (`window.RELAYNET_CONFIG`) tells it where the relay is. The
  Caddy image serves the same files and reverse-proxies `/api/*`, `/healthz`
  and WebSocket upgrades to the relay.
- **Clients** (`client/`): `relaynet.js`, a reconnecting WebSocket transport
  that speaks `relay.v1` and passes the token as the `relay.token.<token>`
  subprotocol.

`infra/` holds operator tooling that drives those pieces from outside:
probes, a load generator, Grafana provisioning, and the legal-page generator.

## Subdirectories & System Boundaries

- client: [`./client/README.md`](./client/README.md) - `relaynet` npm package
  (MIT): `connectRelay` / `RelayConnection`, a reconnecting `relay.v1`
  transport with heartbeat, backoff and close classification.
- deploy: [`./deploy/README.md`](./deploy/README.md) - Docker compose
  self-hosting assets: the `relaynet-web` Caddy image
  ([`./deploy/caddy/README.md`](./deploy/caddy/README.md)) and
  `compose-check.sh`, the end-to-end smoke test for the compose quick start.
- infra: [`./infra/README.md`](./infra/README.md) - operator tooling: Grafana
  alerts and dashboard, legal-page build, load generator, CLI probe and its
  Cloudflare Worker version, staging operator script, Fly log shipper config.
- relay: [`./relay/README.md`](./relay/README.md) - relay container image,
  Litestream backups, Fly.io production and staging configs. It has no relay
  code of its own.
- web: [`./web/README.md`](./web/README.md) - relaynet.network Cloudflare
  Worker (static assets) and dashboard `app.js`; docs source and generator in
  [`./web/docs/README.md`](./web/docs/README.md).
- `docs/`: design notes, security audit and threat model, and the
  [self-hosting guides](./docs/self-hosting/README.md). Prose only, so it has
  no contract.

## Global Invariants

- The relay is a pinned dependency (`relay/package.json`). This repository
  changes it only by bumping the version, never by patching it.
- One relay machine per deployment: sessions and the IP pool are in memory
  (`relay/fly.toml`, `fly deploy --ha=false`).
- Tokens travel only as the `relay.token.<token>` WebSocket subprotocol or as
  `Authorization: Bearer` on `/api/*`. `client/relaynet.js` refuses to send a
  token over `ws://` to a non-loopback host.
- The site's non-CSP security headers are duplicated by hand in
  `web/public/_headers` (Cloudflare) and `deploy/caddy/Caddyfile`. The Caddy
  CSP is generated from the environment by `deploy/caddy/entrypoint.sh`, and
  it differs from `_headers` on purpose.
- Files in `web/public/` generated from Markdown (`docs.html`, `docs.md`,
  `llms.txt`, `terms.html`, `acceptable-use.html`, `privacy.html`) are never
  edited by hand. Edit `web/docs/docs.md` or `infra/legal/*.md` and rebuild.
- `infra/probe/probe.mjs` and `infra/probe-worker/src/index.ts` run the same
  end-to-end check (connect, DHCP, DNS) and must stay in step.
- Base images and downloaded binaries are pinned by digest or checksum
  (`relay/Dockerfile`, `deploy/caddy/Dockerfile`, `infra/log-shipper/fly.toml`).

## Global Side Effects

- Relay SQLite database on the `/data` volume, replicated to S3-compatible
  storage (Cloudflare R2 on relaynet.network) when Litestream is enabled.
- Outbound internet egress (IPv4 TCP/UDP) on behalf of relay sessions. The
  probes and load generator cause real DNS and HTTP egress through it.
- Deploys from GitHub Actions: Fly.io (relay, staging first; log shipper),
  Cloudflare Workers (site, probe worker), npm (`client/`).
  `relay-rollback.yml` redeploys an earlier relay image by hand; schema
  migrations are not undone.
- Production data read by GitHub Actions: `backup-restore-check.yml` (weekly)
  and `migration-rehearsal.yml` (by hand) restore the production replica from
  R2 with a read-only key onto the runner. Neither writes back; a failed
  weekly check opens an issue.
- Monitoring: Grafana Cloud alerts and dashboard (`infra/grafana/provision.py`),
  Better Stack heartbeat from the probe worker and from manual
  `relay-probe.yml` runs.
- Browser storage on the site: `localStorage` (selected org, OIDC user store)
  and `sessionStorage` (relay session, pending invite).

## System Verification

There is no root build. Run what CI runs (`.github/workflows/ci.yml`), from
the repository root:

```sh
(cd client && npm test)
for f in web/public/*.js; do node --check "$f"; done
python3 web/docs/build.py && git diff --exit-code -- web/public
docker compose up -d --build --wait --wait-timeout 180 && deploy/compose-check.sh
docker compose down -v   # deletes the stack's volumes, including the relay database
```

The `relay-image` job's build and `/healthz` smoke test is in
[`./relay/README.md`](./relay/README.md#verification).

## License

Apache-2.0 (see `LICENSE`), except `client/`, which is MIT (`client/LICENSE`).
The relay, [rootlessRelay](https://github.com/beriberikix/rootlessRelay), is
MIT. The names "relaynet" and "relaynet.network" are not licensed; see
`TRADEMARKS.md` for how to use them, `GOVERNANCE.md` for how the project is
run, and `docs/design/license-options.md` for why the licensing is set up
this way. Contributions are signed off under the DCO (`CONTRIBUTING.md`).
