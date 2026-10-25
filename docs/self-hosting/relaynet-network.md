# Reference: relaynet.network

How the hosted service is deployed, as one worked example of running the
same code on managed platforms. Nothing here is required to self-host; the
[single-server](single-server.md) guide covers the same ground with one
machine.

| Part | relaynet.network | Defined in |
|---|---|---|
| Relay | Fly.io app `relaynet` (one machine, a volume for SQLite), staging app `relaynet-staging` | `relay/fly.toml`, `relay/fly.staging.toml`, `relay/Dockerfile` |
| Relay releases | The relay is the attested `npm pack` tarball of a [rootlessRelay](https://github.com/beriberikix/rootlessRelay) release | `relay/package.json` |
| Site | Cloudflare Worker with static assets at `relaynet.network` (the same `web/public` as the compose image, with `hostedService: true`) | `web/wrangler.jsonc`, `web/public/config.js`, `web/public/_headers` |
| TLS and DNS | Cloudflare proxies `relay.` and `admin.relaynet.network` to Fly; the relay reads the client address from `CF-Connecting-IP`, trusted only from Cloudflare's ranges | `relay/fly.toml` (`CLIENT_IP_HEADER`, `TRUSTED_PROXY_CIDRS`), `infra/README.md` |
| Sign-in | Auth0 as the OpenID Connect provider (dashboard: SPA client; operator panel: confidential client with MFA); relay accounts off | `web/public/config.js`, relay secrets `JWT_*` and `ADMIN_OIDC_*`, `infra/README.md` |
| Operator panel | Public at `admin.relaynet.network`, single sign-on only; the private port answers only `/metrics` | `ADMIN_PUBLIC_HOST`, `ADMIN_PASSWORD_LOGIN=false`, `ADMIN_PRIVATE_METRICS_ONLY` in `relay/fly.toml` |
| Backups | Litestream to Cloudflare R2, required at start; weekly restore check in CI | `relay/litestream.yml`, `LITESTREAM_ENABLED=true`, `.github/workflows/backup-restore-check.yml` |
| Monitoring | Fly's Prometheus and Grafana Cloud (dashboards, alerts), logs to Grafana Loki, Better Stack uptime checks, an end-to-end probe every 5 minutes from a Cloudflare Worker | `infra/grafana/`, `infra/log-shipper/`, `infra/probe-worker/`, `infra/probe/` |
| Deploys | GitHub Actions: merging to `main` deploys staging (relay) or production (site); the relay reaches production by a manual run after staging passes its probe | `.github/workflows/deploy-*.yml`, `relay-rollback.yml` |

Operator-specific details (account identifiers, runbooks) are kept outside
this repository.

## What carries over to other platforms

- The relay image is ordinary: any host that runs a container with a
  persistent volume and passes WebSocket upgrades works. Fly-specific parts
  are only `fly.toml` and the IPv6 bind address it sets for the private
  admin port (Fly's private network is IPv6-only).
- The site is static files plus `config.js`; any static host or CDN works,
  with the headers from `_headers` (the compose image's Caddyfile applies the
  same ones).
- Auth0 is configuration: [Single sign-on](oidc.md) lists what another
  provider needs.
