# infra

Setup notes for the services around the relay. Nothing here is code.

## Auth0 (user logins)

Done on 2026-10-14 with the Auth0 CLI (`auth0 apis create`, `auth0 apps create`,
`auth0 api`). Current state:

| Object | Value |
|---|---|
| Tenant | `jonathanberi.us.auth0.com` |
| API (token audience) | `relaynet`, identifier `https://relay.relaynet.network`, RS256, 1 h tokens |
| SPA application | `relaynet-web`; callbacks, logout and web origins `https://relaynet.network` and `http://localhost:5173` |
| Post-login action | `add-email-claim`: copies `event.user.email` into the access token as `https://relaynet/email` |

Relay secrets set on Fly:

```sh
fly secrets set \
  JWT_ISSUER="https://jonathanberi.us.auth0.com/" \
  JWT_AUDIENCE="https://relay.relaynet.network" \
  JWT_JWKS_URL="https://jonathanberi.us.auth0.com/.well-known/jwks.json" \
  JWT_USERNAME_CLAIM="https://relaynet/email"
```

The issuer must include the trailing slash exactly as Auth0 emits it. The
frontend requests tokens with `audience: "https://relay.relaynet.network"`
and passes the **access token** (not the ID token) to the relay.

Users signing in through Auth0 are created in the relay on first connection
with the `user` tier. Operators can change tiers or ban them from the panel.

## Cloudflare (DNS, edge protection, Turnstile)

Done on 2026-10-14 with the Cloudflare CLI (`cf`). Zone `relaynet.network`:

| Item | Value |
|---|---|
| Relay host | `relay.relaynet.network`, proxied CNAME to the Fly app |
| Fly validation | DNS-only CNAME `_acme-challenge.relay` and TXT `_fly-ownership.relay`, from `fly certs setup` |
| SSL mode | Full (strict); Fly holds a Let's Encrypt cert for the host |
| Rate limit | `http_ratelimit` rule: more than 5 requests per 10 s per IP to `/api/anon/token` on the relay host are blocked for 10 s |
| Turnstile | widget `relaynet`, managed mode, domain `relaynet.network`; secret set on Fly as `TURNSTILE_SECRET` |

The relay reads the client address from `CF-Connecting-IP`
(`CLIENT_IP_HEADER` in `relay/fly.toml`). Clients that bypass Cloudflare by
connecting to `relaynet.fly.dev` directly all appear as one address and share
the per-address limits, which is acceptable; the public URL is the Cloudflare
one.

Frontend: `relaynet.network` (apex) on Cloudflare Pages, not set up yet. The
page must send `turnstileToken` in the anonymous token request body.

## Operator access

The admin port is private. `fly proxy 8001:8001` from an authenticated Fly
session is the only path in. There is no public admin URL by design.
