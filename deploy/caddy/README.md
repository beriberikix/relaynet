# caddy (relaynet-web image)

## Overview

The container image for the `web` service in the repository's
[`compose.yaml`](../../compose.yaml). It serves the static site from
`web/public` with Caddy and reverse-proxies the relay's API, health check and
WebSocket sessions, so the site and relay share one origin. At start,
`entrypoint.sh` writes the site's `config.js` and Content-Security-Policy from
environment variables, then runs Caddy.

## Interface

- `Dockerfile`: two-stage build, run from the repository root
  (`docker build -f deploy/caddy/Dockerfile .`).
  - Stage `site` (`node:24-trixie-slim`, pinned by digest): `npm ci
    --ignore-scripts` in `web/`, copies `web/public`, runs `npm run vendor`,
    and deletes `public/_headers`.
  - Final stage (`caddy:2.11.6-alpine`, pinned by digest): copies the site to
    `/srv`, `Caddyfile` to `/etc/caddy/Caddyfile`, and `entrypoint.sh` to
    `/usr/local/bin/relaynet-web` (the `ENTRYPOINT`). Exposes ports 80 and 443.
- `entrypoint.sh` (`relaynet-web`): reads these environment variables, all
  optional. In the compose quick start only `RELAYNET_DOMAIN` and `OIDC_*` are
  passed through from `.env` (`compose.yaml`); the others take their defaults:

  | Variable                                       | Effect                                                                   |
  | ---------------------------------------------- | ------------------------------------------------------------------------ |
  | `RELAYNET_DOMAIN`                              | Caddy site address, used as given. A host name gets HTTPS with an automatic certificate; unset means HTTP on `:80` (a value such as `:8080` or `http://host` also serves plain HTTP). |
  | `RELAYNET_RELAY_URL`                           | `relayUrl` in `config.js`. Also adds the relay's http/ws origins to CSP `connect-src`. |
  | `RELAYNET_HOSTED_SERVICE`                      | `hostedService: true` only when this is exactly `"true"`.               |
  | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE` | `oidc` object in `config.js` when issuer and client id are both set (otherwise `null`). Adds the issuer origin to `connect-src` and `form-action`. |
  | `RELAY_UPSTREAM`                               | Proxy target for the relay (default `relay:8086`).                       |

  It exports `RELAYNET_SITE`, `RELAY_UPSTREAM` and `RELAYNET_CSP` for the
  Caddyfile.
- `Caddyfile`: one site block at `{$RELAYNET_SITE}`.
  - Requests with an `Upgrade: websocket` header (case-insensitive, any path)
    and the paths `/api/*` and `/healthz` go through `reverse_proxy
    {$RELAY_UPSTREAM}`.
  - Everything else is served from `/srv` by `file_server`, with gzip and the
    security headers (proxied relay responses get none of these) `Content-Security-Policy "{$RELAYNET_CSP}"`,
    `X-Content-Type-Options`, `X-Frame-Options DENY`, `Referrer-Policy`,
    `Permissions-Policy` and `Cache-Control no-cache`.
  - `/docs.md` is served as `text/markdown` and `/llms.txt` as `text/plain`.

## Invariants

- `entrypoint.sh:check` rejects any value of `RELAYNET_DOMAIN`,
  `RELAYNET_RELAY_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID` or `OIDC_AUDIENCE`
  that has a character outside `A-Za-z0-9:/._~%+=@-`, and exits 1. The values
  end up inside a JavaScript string and an HTTP header.
- The WebSocket `handle @upgrade` matcher comes before `handle @relay` and the
  catch-all site `handle`, so an upgrade on any path reaches the relay.
- The non-CSP security headers duplicate `web/public/_headers` (used on
  Cloudflare). The Dockerfile deletes `_headers` from the image, so keep those
  in step by hand. The CSP is built from the environment and differs from
  `_headers` on purpose: its relay and OIDC origins come from
  `RELAYNET_RELAY_URL` and `OIDC_ISSUER` rather than relaynet.network's.
- The Caddy global option `admin off` turns off Caddy's admin API.
- Both base images are pinned by tag and digest. Dependabot updates them
  (`.github/dependabot.yml` includes `/deploy/caddy`).

## Side Effects

- At container start, `entrypoint.sh` overwrites `/srv/config.js`
  (`window.RELAYNET_CONFIG`).
- When `RELAYNET_DOMAIN` is set, Caddy gets a TLS certificate automatically
  (ports 80 and 443 must reach the host; `compose.yaml` maps them from
  `HTTP_PORT` and `HTTPS_PORT`, default 80 and 443). In `compose.yaml` its
  state is kept on the `web-data` volume at `/data`.
- Network: proxies HTTP and WebSocket traffic to `RELAY_UPSTREAM`. Caddy
  sets `X-Forwarded-For`, which the relay trusts from `TRUSTED_PROXY_CIDRS`.
- Logs one `relaynet-web: serving ...` line to stdout, then `exec`s
  `caddy run`.

## Verification

- Run: `docker compose up -d --build --wait && deploy/compose-check.sh` (from
  the repository root; see [`../compose-check.sh`](../compose-check.sh)).
