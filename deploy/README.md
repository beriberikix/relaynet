# deploy

## Overview

Self-hosting deployment assets for the `docker compose` quick start defined
in the repository's [`compose.yaml`](../compose.yaml). The `web` service's
image is built from `caddy/`. `compose-check.sh` is the end-to-end smoke test
that CI runs against a running stack.

## Interface

- [caddy](./caddy/README.md): the `relaynet-web` image. Caddy serves
  `web/public` and proxies the relay's `/api/*`, `/healthz` and WebSocket
  upgrades on the same origin. `entrypoint.sh` writes `config.js` and the CSP
  from `RELAYNET_DOMAIN`, `RELAYNET_RELAY_URL`, `RELAYNET_HOSTED_SERVICE`,
  `OIDC_*` and `RELAY_UPSTREAM`.
- `compose-check.sh`: a POSIX `sh` script, run after `docker compose up -d`.

  | Variable   | Default                 | Meaning                                                   |
  | ---------- | ----------------------- | --------------------------------------------------------- |
  | `BASE`     | `http://localhost`      | Site and relay origin.                                     |
  | `ADMIN`    | `http://127.0.0.1:8001` | Relay operator panel.                                      |
  | `INSECURE` | `0`                     | `1` passes `curl -k` and sets `NODE_TLS_REJECT_UNAUTHORIZED=0` (for Caddy's local CA). |

  The script checks, in order:
  1. `$BASE/healthz` returns `"ok":true`.
  2. `$BASE/` returns `<title>relaynet</title>`.
  3. `$BASE/config.js` contains `hostedService: false`.
  4. `$BASE/api/auth/config` returns `"passwordLogin":true`.
  5. `$ADMIN/api/auth/status` is reachable.
  6. `docker compose logs relay` contains `created the first operator`.
  7. Signing up at `POST $BASE/api/auth/signup` succeeds.
  8. Creating an API token at `POST $BASE/api/me/tokens` succeeds.
  9. [`infra/probe/probe.mjs`](../infra/probe/probe.mjs) succeeds over
     `ws(s)://` with `RELAY_URL` and `RELAY_TOKEN` set.

## Invariants

- `compose-check.sh` uses `set -eu`. Any failed check calls `fail`, which
  exits 1 with a `compose-check:` message.
- The script expects `node`, `curl` and `docker compose` on `PATH`, and must
  run from the repository root: check 6 reads `docker compose logs relay`,
  which needs the compose project. It finds the probe relative to its own
  directory (`$here/../infra/probe/probe.mjs`).
- The checks expect the zero-config quick start: password sign-in on, the
  hosted service off, and a first operator created at relay start.

## Side Effects

- Creates a real account on the target relay with username `check<epoch>`
  and a random password, plus an API token named `compose-check`. Neither is
  cleaned up.
- Network: HTTP requests to `BASE` and `ADMIN`, and a WebSocket session
  through the relay (via the probe).
- Reads `docker compose logs relay`.

## Verification

- Run from the repository root, as the CI job `compose` in
  `.github/workflows/ci.yml` does:

  ```sh
  docker compose up -d --build --wait --wait-timeout 180
  deploy/compose-check.sh
  docker compose down -v   # deletes the stack's volumes, including the relay database
  ```

  With `HTTP_PORT` set, pass `BASE=http://localhost:$HTTP_PORT`.
