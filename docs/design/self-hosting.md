# Self-hosting

Design for running relaynet anywhere, with relaynet.network as one
deployment among several rather than the only one. Written 2026-10-24.
Tracks #84 (easy self-hosting) and #90 (docs and quick start), and
replaces #86's framing (local auth or generic OIDC) with "both".

## Goal

```sh
git clone https://github.com/beriberikix/relaynet
cd relaynet && docker compose up
```

Then open http://localhost, sign in, create a token, connect a VM. No
accounts with any third party, no configuration file to write, no
identity provider, no cloud. Everything the hosted service uses (Auth0,
Cloudflare, Fly, R2, Grafana) becomes an option, not a requirement.

## Targets

| Target | Who | What it takes | Promise |
|---|---|---|---|
| **Quick start** | Anyone trying relaynet | `git clone`, `docker compose up` | Works on localhost with zero configuration. Not for the internet. |
| **Single server** | Someone running it for a team or the public | The same compose file, a domain, a `.env` with a handful of values | HTTPS (automatic certificates), backups to any S3-compatible store, optional OIDC sign-in. |
| **Reference: relaynet.network** | Us | Fly, Cloudflare, Auth0, R2, Grafana | Today's production, documented as one worked example. Not the default. |

More targets (Kubernetes, another PaaS) can be added as guides under the same
structure. Nothing in the code may assume Fly, Cloudflare or Auth0.

## What the quick start runs

```
browser ── http://localhost ──▶ caddy ──┬─ /api/*, /healthz, WebSocket upgrades ──▶ relay :8086
                                        └─ everything else ──▶ static site (web/public)
operator ── http://localhost:8001 (bound to 127.0.0.1) ──▶ relay admin port
```

- **One origin.** Caddy serves the site and proxies the relay's API and
  WebSocket on the same host, so there is no CORS to configure and the site
  needs no relay URL. (relaynet.network keeps its separate `relay.` host;
  the site reads its relay URL from runtime configuration.)
- **relay**: the existing image, hosted mode, data on a named volume.
- **caddy**: serves `web/public`, writes `config.js` from environment
  variables at start, and sets the security headers that `_headers` sets on
  Cloudflare. With a domain set, the same container gets certificates
  automatically (single-server target).
- **No Litestream** unless an S3 bucket is configured.

## Relay accounts (built-in sign-in)

The dashboard signs people in against the relay itself by default. OIDC is
the alternative, not a prerequisite.

**Accounts.** The relay already stores users with bcrypt password hashes
(`auth/users.js`; today only operators use them, in the operator panel).
Regular users get the same: a username, a password, a status and a tier.

**Sign-in.** `POST /api/auth/login {username, password}` returns a
relay-issued **session token**: an opaque bearer token stored hashed, like
API tokens, with an expiry (12 hours, renewed on use) and revoked at
sign-out. The dashboard keeps it in `sessionStorage` and sends it exactly as
it sends the Auth0 access token today, so every account-API route and the
WebSocket accept it through the existing authenticator with no other
changes. It works whether the site and relay share an origin (compose) or
not (relaynet.network). Login is rate-limited per address and per username,
and uses the constant-work password check from AD-1.

**Getting accounts.**

- **First start:** the relay creates an operator account with a random
  password and prints it once in the logs (`docker compose logs relay`).
  That account can sign in to the dashboard and the operator panel.
- **More users:** the operator creates them in the panel (exists today), or
  turns on sign-up: with `SIGNUP_MODE=invite` (exists) a person signs up
  with a username, password and an invite code; `SIGNUP_MODE=open` lets
  anyone sign up (for a private network only).
- **Org invitations** keep working; without a verified email, an invitation
  is accepted by username instead of address (to be specified in the fork).
- **Password reset:** by an operator, in the panel. No email is needed;
  email-based reset can come later as an option.

**Switches.**

| Setting | Quick start | relaynet.network |
|---|---|---|
| Relay accounts for the dashboard (`USER_PASSWORD_LOGIN`) | on | off |
| OIDC for the dashboard (`OIDC_ISSUER`, client id, audience) | off | on (Auth0) |
| Operator password login (`ADMIN_PASSWORD_LOGIN`) | on | off |
| Operator OIDC (`ADMIN_OIDC_*`) | off | on (Auth0) |

Both dashboard methods can be on at once; the sign-in page shows what is
enabled (`GET /api/auth/config`).

## OIDC, provider-neutral

- **Relay:** already provider-neutral. It verifies JWTs against any issuer's
  JWKS with configurable audience and claims (`JWT_*`), and the operator
  panel's SSO uses OIDC discovery (`admin/oidc.js`). No change needed beyond
  documenting it for a second provider.
- **Dashboard:** replace the Auth0 SPA SDK with a standards-based OIDC
  client (authorization code + PKCE, discovery). Same flow relaynet.network
  uses today; Auth0 becomes configuration (`issuer`, `client_id`,
  `audience`) instead of code. Moving relaynet.network to another provider
  later (Keycloak, Authentik, Zitadel, Pocket ID) is then a configuration
  change plus migrating users' `external_sub`.
- The dashboard's CSP keeps `script-src 'self'`; the OIDC client is vendored
  like the Auth0 SDK is today.

## Zero-configuration relay

Changes in the fork so hosted mode starts with nothing set:

- **Secrets.** `ADMIN_SESSION_SECRET` (and `ANON_TOKEN_SECRET` when anon is
  on) are generated on first start if unset and kept in the data volume
  (`/data/secrets.json`, mode 600). Set explicitly, the environment wins, as
  relaynet.network does today.
- **First operator.** If there are no operators and `ADMIN_BOOTSTRAP_*` is
  unset, create `admin` with a random password and log it once.
- **Cookies.** `ADMIN_COOKIE_SECURE` follows the scheme: off for the
  loopback-only admin port, on behind HTTPS.
- **Litestream.** Off unless a bucket is configured (`LITESTREAM_BUCKET`);
  the entrypoint stops requiring R2.
- **Origins.** With the site and relay on one origin, `ALLOWED_ORIGINS`
  defaults to that origin.

relaynet.network sets all of these explicitly and is unaffected.

## Configuration surface (single-server target)

One `.env` beside `compose.yaml`:

```sh
RELAYNET_DOMAIN=relay.example.org   # empty: http://localhost
# Optional
OIDC_ISSUER=https://id.example.org/
OIDC_CLIENT_ID=...
OIDC_AUDIENCE=...
S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
SIGNUP_MODE=invite
```

Everything else has a default that is safe for the internet.

## Repository layout

```
compose.yaml            quick start and single-server target
deploy/
  caddy/                Caddyfile, config.js template, headers
  fly/                  fly.toml, fly.staging.toml (relaynet.network)
  cloudflare/           wrangler.jsonc for the site (relaynet.network)
relay/                  the relay image (Dockerfile, entrypoint, litestream.yml)
web/                    the site, deployment-neutral
docs/self-hosting/
  quick-start.md
  single-server.md      domain, TLS, backups, OIDC
  oidc.md               provider notes: Auth0, Keycloak, Authentik, ...
  relaynet-network.md   the reference deployment (pointers to deploy/fly, deploy/cloudflare)
```

The deploy workflows move with their files; nothing about relaynet.network's
behaviour changes.

## Images

Publish to GitHub's container registry on release:

- `ghcr.io/beriberikix/relaynet-relay`: the relay image (from `relay/`),
  tagged with the rootlessRelay version.
- `ghcr.io/beriberikix/relaynet-web`: Caddy plus `web/public`.

`compose.yaml` uses the published images, with `build:` entries so a clone
also works offline from source. Images are signed with build-provenance
attestations, as the fork's tarball is.

## Order of work

1. **Fork (rootlessRelay):** zero-configuration start (secrets, first
   operator, Litestream optional), relay accounts (login, session tokens,
   sign-up with password, `GET /api/auth/config`), tests. Release.
2. **relaynet, the site:** runtime configuration (`config.js` from the
   environment), sign-in that supports relay accounts and generic OIDC,
   Auth0 SDK replaced. relaynet.network keeps working through Auth0 as OIDC.
3. **relaynet, compose:** `compose.yaml`, the Caddy container, the relay
   entrypoint without required Litestream. CI runs `docker compose up` and
   checks sign-in, token creation and a probe through the relay.
4. **Layout and images:** `deploy/`, GHCR publishing, attestation.
5. **Docs:** the four guides above, written against what step 3 tests.

Steps 1 and 2 change relaynet.network (new relay release, new sign-in code)
and go through staging first; 3–5 don't touch production.

## Out of scope for now

- Email (verification, password reset by mail). Operators reset passwords.
- Billing in self-hosted deployments; billing stays in relaynet-private.
- Moving relaynet.network off Auth0, Fly or Cloudflare. This design makes
  each a configuration and deployment change; deciding to do it is separate.
