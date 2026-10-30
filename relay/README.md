# relay

Container image and Fly.io config for the relay process.

## Overview

This directory does not contain the relay's code. It wraps the
`rootlessrelay` package, a pinned release tarball from the
`beriberikix/rootlessRelay` fork (`package.json`), in a Node 24 image
(`Dockerfile`) with Litestream for SQLite backups (`litestream.yml`,
`entrypoint.sh`). It also holds the Fly.io app configs for production
(`fly.toml`, app `relaynet`) and staging (`fly.staging.toml`, app
`relaynet-staging`).

## Interface

- `package.json`: dependency `rootlessrelay` (currently
  `v0.7.0-hosted.14`), script `start` = `node node_modules/rootlessrelay/relay.js`.
- `Dockerfile`: image entry `CMD ["/app/entrypoint.sh"]`; exposes `8086`
  (public WebSocket/HTTP listener, `WS_PORT`) and `8001` (admin/metrics,
  `ADMIN_PORT`); `HEALTHCHECK` on `GET /healthz` at `WS_PORT`. Defaults set via
  `ENV`: `RELAY_MODE=hosted`, `ENABLE_WSS=false`, `PROXY_BIND_ADDRESS=127.0.0.1`,
  `ADMIN_AUTH_DB_PATH=/data/relay.sqlite`, `LOG_JSON=true`. Build args
  `LITESTREAM_VERSION`, `LITESTREAM_SHA256`.
- `entrypoint.sh`: reads `ADMIN_AUTH_DB_PATH` (default `/data/relay.sqlite`),
  `LITESTREAM_ENABLED` (`auto` | `true` | `false`, default `auto`),
  `LITESTREAM_BUCKET`, `LITESTREAM_REGION` (default `auto`),
  `LITESTREAM_CONFIG` (default `/etc/litestream.yml`).
- `litestream.yml`: one S3-compatible replica of `${ADMIN_AUTH_DB_PATH}` using
  `LITESTREAM_BUCKET`, `LITESTREAM_REPLICA_PATH`, `LITESTREAM_ENDPOINT`,
  `LITESTREAM_REGION`; Litestream metrics on `:9090`.
- `fly.toml` / `fly.staging.toml`: `[env]` relay settings, `[http_service]` on
  internal port `8086` with a `/healthz` check, volume mount at `/data`,
  `[[metrics]]` on port `8001` path `/metrics`.

## Invariants

- Run at most one machine per app (`fly deploy --ha=false`): sessions and the
  IP pool live in memory and are not shared between machines. Production
  keeps one running; staging (`auto_stop_machines = "stop"`,
  `min_machines_running = 0`) sleeps when idle.
- `LITESTREAM_ENABLED` must be `auto`, `true` or `false`; any other value, or
  `true` without `LITESTREAM_BUCKET`, makes `entrypoint.sh` exit 1.
- When the database file is missing and Litestream is enabled, a failed
  `litestream restore` stops the boot (`set -eu`), so an empty database is
  never replicated over the backups.
- `fly.staging.toml` must stay in sync with `fly.toml` except for the app
  name, the lines marked `# staging` and the admin/SSO block.
- `kill_timeout = 15` leaves Litestream time for its final sync to R2 when
  the machine stops; do not lower it.
- `LITESTREAM_VERSION` and `LITESTREAM_SHA256` in `Dockerfile` are bumped
  together; the base image is pinned by digest.
- The `rootlessrelay` URL in `package.json` must point at the `npm pack`
  tarball attached to a fork release, and `package-lock.json` is regenerated
  after changing it.
- `[http_service.concurrency]` `hard_limit = 260` is sized to the 240-session
  `10.0.2.0/24` pool.

## Side Effects

- Reads and writes the SQLite database at `ADMIN_AUTH_DB_PATH` on the `/data`
  volume (`relay_data` / `relay_data_staging`).
- With Litestream enabled: restores from and continuously replicates to the
  S3-compatible bucket (`relaynet-backups` prefix `prod`,
  `relaynet-backups-staging` prefix `staging`), with daily snapshots kept for
  168 h.
- Image build downloads the Litestream release from GitHub and the
  `sqlite3` prebuilt binary (up to 4 attempts).
- Fly scrapes `/metrics` on port `8001`; the relay appends Litestream's
  metrics from `http://127.0.0.1:9090/metrics` (`METRICS_MERGE_URLS`).
- Pushes to `main` that touch `relay/**`, `infra/probe/**` or the workflow
  deploy staging and probe it (`.github/workflows/deploy-relay.yml`).
  Production deploys only from a manual run with `production` checked, and
  only after the staging deploy and probe pass.

## Verification

- Run from the repository root, as the `relay-image` job of
  `.github/workflows/ci.yml` does (CI retries `/healthz` for up to 30 s while
  the relay starts):

  ```sh
  docker build -t relaynet-relay:ci relay
  docker run -d --name relay --network host \
    -e LITESTREAM_ENABLED=false -e WS_PORT=18086 -e ADMIN_PORT=18001 \
    -e ADMIN_BIND_ADDRESS=127.0.0.1 -e ADMIN_AUTH_DB_PATH=/tmp/relay.sqlite \
    -e ADMIN_SESSION_SECRET=ci-session-secret-0123456789abcdef \
    -e ANON_TOKEN_SECRET=ci-anon-secret-0123456789abcdef \
    -e ALLOWED_ORIGINS=https://example.test \
    relaynet-relay:ci
  curl -fsS http://127.0.0.1:18086/healthz
  ```

## First deploy

```sh
brew install flyctl && fly auth login
cd relay
fly apps create relaynet --org <org>
fly volumes create relay_data --size 1 --region sjc -a relaynet --yes

fly secrets set \
  ADMIN_SESSION_SECRET="$(openssl rand -hex 32)" \
  ANON_TOKEN_SECRET="$(openssl rand -hex 32)" \
  ADMIN_BOOTSTRAP_USERNAME=admin \
  ADMIN_BOOTSTRAP_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=')"

# fly.toml sets LITESTREAM_ENABLED=true, so the first boot needs the backup
# credentials too (see Backups).
fly secrets set \
  LITESTREAM_ACCESS_KEY_ID=... \
  LITESTREAM_SECRET_ACCESS_KEY=... \
  LITESTREAM_ENDPOINT=https://<account id>.r2.cloudflarestorage.com

# fly.toml sets ADMIN_PASSWORD_LOGIN=false (operator SSO only), so the panel
# needs the OIDC client of the relaynet-admin Auth0 app.
fly secrets set ADMIN_OIDC_CLIENT_ID=... ADMIN_OIDC_CLIENT_SECRET=...

fly deploy --ha=false     # one machine; sessions and the IP pool are in memory
curl -s https://relay.relaynet.network/healthz
```

Always pass `--ha=false`; without it Fly starts two machines and clients get
split across two relays that do not share state.

Note the bootstrap password somewhere safe; it is used once to create the
first operator and can be unset afterwards with `fly secrets unset`. In
production the panel's password form and `POST /api/login` are disabled
(`ADMIN_PASSWORD_LOGIN = "false"`), so operators sign in through SSO.

Optional secrets, set the same way:

| Secret | Purpose |
|---|---|
| `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_JWKS_URL`, `JWT_USERNAME_CLAIM` | External logins (see `../infra/README.md`). |
| `JWT_VERIFIED_CLAIM` | Claim that must be true before an external login is accepted; set on production (see `../infra/README.md`). |
| `TIERS_JSON` | Override tier limits, e.g. `{"user":{"maxSessionMs":3600000}}`. |

Non-secret settings live in `fly.toml` under `[env]`.

## Backups

When enabled, `entrypoint.sh` starts the relay under `litestream replicate
-exec`, which streams `/data/relay.sqlite` to the R2
bucket `relaynet-backups` (`litestream.yml`, prefix from
`LITESTREAM_REPLICA_PATH`). On boot with an empty volume it restores first
and refuses to start if the restore fails. Credentials are the Fly secrets
`LITESTREAM_ACCESS_KEY_ID` and `LITESTREAM_SECRET_ACCESS_KEY`, and the R2
endpoint (`https://<account id>.r2.cloudflarestorage.com`) is the secret
`LITESTREAM_ENDPOINT`.
Litestream runs when `LITESTREAM_BUCKET` is set (`LITESTREAM_ENABLED=auto`,
the default); `true` refuses to start without a bucket (relaynet.network sets
it), `false` never runs it.
Restore procedures are in the operator runbooks in the private relaynet-private repository.

## Free tiers and the egress budget

Both apps run the plan in `docs/design/open-front-door.md`:

- **Anonymous tokens** (`ANON_ENABLED = "true"`) for the demos on
  `https://beriberikix.github.io`, which is in `ALLOWED_ORIGINS`. The secret
  `ANON_TOKEN_SECRET` must be set on each app (`fly secrets set -a <app>
  ANON_TOKEN_SECRET="$(openssl rand -hex 32)"`); without it the relay keeps a
  generated one on the volume, which changes if the volume is lost.
- **Open sign-up** (`SIGNUP_MODE = "open"`): new Auth0 accounts are active on
  the `free` tier (`JWT_DEFAULT_TIER`). Invited accounts keep `user`; an
  operator moves an account between tiers in the panel.
- **Tiers** (`TIERS_JSON`): `free` with every field set, and `free` and
  `anon` at 128 KiB/s each way. The rate is low because `shared-cpu-1x`
  throttles to about 6% of a CPU under sustained load (load test,
  2026-10-30).
- **Monthly egress budget** on `free` and `anon` (`BUDGET_TIERS`). It counts
  every tier's bytes for the UTC month and stores them in the database:
  - past `BUDGET_THROTTLE_BYTES` (production 300 GB, staging 50 MiB), new
    sessions of those tiers start at 64 KiB/s;
  - past `BUDGET_PAUSE_BYTES` (production 840 GB, staging 100 MiB), they are
    closed with `1008 "free tier paused until <date>"` and refused until the
    month resets, and `POST /api/anon/token` answers
    `503 {"error":"free-tier-paused"}`.

  `user` and `operator` sessions are never slowed or closed.

The budget's state and override are on the operator panel's API, behind its
sign-in (production: Auth0 SSO at https://admin.relaynet.network; staging:
`fly proxy 8002:8001 -a relaynet-staging`, then `http://localhost:8002`).
With the panel's session cookie (from the browser's developer tools):

```sh
curl -s -b 'admin.sid=<cookie>' https://admin.relaynet.network/api/budget
curl -s -b 'admin.sid=<cookie>' -H 'X-Requested-With: relaynet-admin' \
  -H 'Content-Type: application/json' -d '{"forced":"paused"}' \
  https://admin.relaynet.network/api/budget
```

`{"forced":"paused"}` stops the free tiers now, `{"forced":"open"}` reopens
them (for example after someone used up the budget on purpose), and
`{"forced":null}` returns to the computed state. The override is stored and
lasts until cleared or the month rolls over. Alerts on the budget come from
Grafana (`infra/grafana`).

## Operator panel

Production: https://admin.relaynet.network (`ADMIN_PUBLIC_HOST`; Auth0 SSO
with MFA). Staging stays private: `fly proxy 8002:8001 -a relaynet-staging`,
then http://localhost:8002.

The admin port 8001 itself is only reachable over Fly's private network.
In production it answers only `/metrics` (`ADMIN_PRIVATE_METRICS_ONLY`),
because other apps in the Fly org share that network; staging serves the
panel there. Metrics are scraped there by Fly automatically and show up
under the app's Grafana dashboard.

## Updating the relay

The relay is the `npm pack` tarball attached to a fork release
(`releases/download/vX.Y.Z-hosted.N/rootlessrelay-X.Y.Z-hosted.N.tgz`), not
GitHub's generated source archive. Change both version numbers in that URL in
`package.json`, then:

```sh
npm install --package-lock-only --ignore-scripts   # refreshes package-lock.json
docker build --network host .                     # optional local check
```

Merging to `main` deploys staging; production is a manual run of the
**deploy relay** workflow with "production" checked. To check where a tarball came from:

```sh
gh release download vX.Y.Z-hosted.N -R beriberikix/rootlessRelay -p '*.tgz'
gh attestation verify rootlessrelay-X.Y.Z-hosted.N.tgz -R beriberikix/rootlessRelay
```

## Running locally

```sh
docker build -t relaynet-relay .
docker run --rm -p 8086:8086 -p 127.0.0.1:8001:8001 \
  -e ADMIN_SESSION_SECRET=dev-only-$(openssl rand -hex 8) \
  -e ANON_TOKEN_SECRET=dev-only-$(openssl rand -hex 8) \
  -e ADMIN_BOOTSTRAP_USERNAME=admin -e ADMIN_BOOTSTRAP_PASSWORD=changeme \
  -e TRUST_PROXY=false relaynet-relay
```
