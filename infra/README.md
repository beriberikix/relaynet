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
| Post-login actions | `add-email-claim` (version 2 deployed 2026-10-14): copies `event.user.email` and `event.user.email_verified === true` into the access token as `https://relaynet/email` and `https://relaynet/email_verified`. `require-mfa-admin`: MFA for the operator panel app. Both are bound to the post-login flow. |

Relay secrets set on Fly:

```sh
fly secrets set \
  JWT_ISSUER="https://jonathanberi.us.auth0.com/" \
  JWT_AUDIENCE="https://relay.relaynet.network" \
  JWT_JWKS_URL="https://jonathanberi.us.auth0.com/.well-known/jwks.json" \
  JWT_USERNAME_CLAIM="https://relaynet/email" \
  JWT_VERIFIED_CLAIM="https://relaynet/email_verified"
```

`JWT_VERIFIED_CLAIM` is set on production. Fly shows only a digest, so the value
cannot be read back; see "Checking the verified-email claim" below.

The issuer must include the trailing slash exactly as Auth0 emits it. The
frontend requests tokens with `audience: "https://relay.relaynet.network"`
and passes the **access token** (not the ID token) to the relay.

### Verified email claim (org invitations)

The relay matches an org invitation only to an address the identity provider
has verified. Two things make that work, and both are in place:

- the `add-email-claim` action emits `https://relaynet/email_verified`
  (`event.user.email_verified === true`), deployed as version 2 on 2026-10-14;
- the relay secret `JWT_VERIFIED_CLAIM` names that claim. With it set, an
  address the provider has not verified is not used as a username for a new
  account (it falls back to the Auth0 id) and cannot accept an invitation.

Staging has no Auth0 login (`externalJwt` is off), so neither applies there.

#### Checking the verified-email claim

There are two halves to check, and they need different methods. Verified
end to end in production on 2026-10-20.

1. **The token carries the claim** (the Auth0 half). Sign in at
   https://relaynet.network, then in the browser console **on that page**
   (the token cache is per origin, so this fails with "undefined is not valid
   JSON" anywhere else, for example on the panel at `admin.relaynet.network`). It only
   decodes locally and sends nothing:
   ```js
   const k = Object.keys(localStorage).find(k => k.startsWith('@@auth0spajs@@') && k.includes('relay.relaynet.network'));
   JSON.parse(atob(JSON.parse(localStorage[k]).body.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
   ```
   It should contain `"https://relaynet/email_verified": true`.
2. **The relay's secret names that claim** (the Fly half). Fly shows only a
   digest of a secret, and it is not a plain truncated SHA-256, so the value
   cannot be read back or recomputed. Do not infer it from usernames: the relay
   assigns a username at an account's first sign-in only, so an email-shaped
   username says nothing about the secret if the account predates it. Instead
   set the secret again to the intended value and compare digests:
   ```sh
   fly secrets list -a relaynet | grep JWT_VERIFIED_CLAIM        # note the digest
   fly secrets set -a relaynet JWT_VERIFIED_CLAIM="https://relaynet/email_verified"
   fly secrets list -a relaynet | grep JWT_VERIFIED_CLAIM        # same digest = same value
   ```
   Observed 2026-10-20: re-setting the identical value left the digest
   unchanged (`dea4aec59b9e8ca5`). Setting a secret restarts the relay and
   closes live sessions.
3. **End to end.** In the operator panel create a shared org whose owner is
   **not you** (use the probe account; if you own it, accepting answers
   `already-member`), then on https://relaynet.network, signed in, with `ORG`
   set to the new org's id:
   ```js
   const ORG = 0;
   const API = 'https://relay.relaynet.network';
   const k = Object.keys(localStorage).find(k => k.startsWith('@@auth0spajs@@') && k.includes('relay.relaynet.network'));
   const t = JSON.parse(localStorage[k]).body.access_token;
   const claims = JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
   const H = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
   const inv = await (await fetch(`${API}/api/orgs/${ORG}/invites`, { method: 'POST', headers: H, body: JSON.stringify({ email: claims['https://relaynet/email'], role: 'member' }) })).json();
   console.log('accept:', await (await fetch(`${API}/api/invites/accept`, { method: 'POST', headers: H, body: JSON.stringify({ token: inv.token }) })).json());
   ```
   Success is `accept: {orgId, role: "member"}`. `email-not-verified` means
   the claim is missing or the secret does not match; a 404 on the invite means
   the org id does not exist (the relay answers the same for a missing org and
   one you cannot see). Delete the test org from the panel afterwards.

To change the claim name, change it in the action and in
`fly secrets set -a relaynet JWT_VERIFIED_CLAIM=...` together; setting the
secret restarts the relay. Unsetting the secret is the rollback; the claim is
harmless to leave in tokens.

Users signing in through Auth0 are created in the relay on first connection
with the `user` tier. Operators can change tiers or ban them from the panel.

## Cloudflare (DNS, edge protection)

Done on 2026-10-14 with the Cloudflare CLI (`cf`). Zone `relaynet.network`:

| Item | Value |
|---|---|
| Relay host | `relay.relaynet.network`, proxied CNAME to the Fly app |
| Fly validation | DNS-only CNAME `_acme-challenge.relay` and TXT `_fly-ownership.relay`, from `fly certs setup` |
| SSL mode | Full (strict); Fly holds a Let's Encrypt cert for the host |

The relay reads the client address from `CF-Connecting-IP`
(`CLIENT_IP_HEADER` in `relay/fly.toml`). Clients that bypass Cloudflare by
connecting to `relaynet.fly.dev` directly all appear as one address and share
the per-address limits, which is acceptable; the public URL is the Cloudflare
one.

The anonymous demo tier was removed on 2026-10-14 for the invite-only beta
(`ANON_ENABLED=false`; the Turnstile widget, its secret, the anon token secret
and the `/api/anon/token` rate-limit rule were deleted).

## Operator access

The panel is at https://admin.relaynet.network: the relay's public listener
serves the admin app for that hostname only (`ADMIN_PUBLIC_HOST`), and relay
sessions are refused there. Sign-in is Auth0 SSO with MFA (password login
off). Writes need the panel's `X-Requested-With` header and a same-origin
`Origin`; other hostnames get 421; the page has a strict CSP and cannot be
framed. `/metrics` on the public name needs a sign-in; the scraper reads it on
the private admin port 8001, which stays off the internet and serves only
`/metrics` (`ADMIN_PRIVATE_METRICS_ONLY`; other apps in the Fly org share the
private network). DNS: like
`relay`, `admin` is a proxied CNAME to `8wyq65k.relaynet.fly.dev`, with
`_acme-challenge.admin` (CNAME, DNS-only) and `_fly-ownership.admin` (TXT)
for the Fly certificate. Staging's panel stays private (`fly proxy 8002:8001`).

## Monitoring and alerting

Set up 2026-10-14. Credentials live in `infra/.env.local` (gitignored);
GitHub Actions secrets and the probe Worker's secrets hold the probe token
and heartbeat URL.

| What | Where | Alerts |
|---|---|---|
| Uptime: `relay.relaynet.network/healthz` (keyword `"ok":true`) and `relaynet.network`, every 3 min from US and EU | Better Stack Uptime (team t615516), monitors "Relay health", "Dashboard" | email + push |
| End-to-end probe: API token auth, DHCP lease, DNS lookup through the relay, every 5 min, one retry | Cloudflare Worker `relaynet-probe` (`infra/probe-worker`, cron trigger; secrets `PROBE_RELAY_TOKEN`, `BETTERSTACK_PROBE_HEARTBEAT_URL`), account `probe` (user tier). Deploy probes and manual runs use `infra/probe/probe.mjs` in GitHub Actions | Better Stack heartbeat "Relay end-to-end probe" (period 5 min, grace 5 min): `/fail` on error |
| Public status page | https://status.relaynet.network (CNAME to Better Stack, DNS-only) | — |
| Metrics: relay (`rootlessrelay_*`) and Fly platform (`fly_*`) | Grafana Cloud stack `calmwasp3063`, data source `fly-relaynet` (Fly managed Prometheus, read-only org token `grafana-metrics-readonly`), dashboard "relaynet relay" | Grafana alert rules in folder `relaynet` → contact point "relaynet email" |
| Logs | Fly app `relaynet-logs` (fly-log-shipper, subject `logs.relaynet.>`) → Grafana Cloud Loki; query `{fly_app_name="relaynet"}` | — |
| Backups | weekly `backup-restore-check.yml` | opens a GitHub issue |

Alert rules (`infra/grafana/provision.py`, re-run after edits): relay
restarted unexpectedly (a restart with no clean shutdown in the logs, so
deploys stay quiet), sessions above 200 of 240, memory under 15% free, 5xx at the
relay, authentication-failure spike, egress-denial spike (scanning), more
than 10 GB relayed per hour (cost), CPU burst balance low and CPU throttled
(see RUNBOOKS.md, Capacity).

Litestream's metrics are appended to the relay's `/metrics`
(`METRICS_MERGE_URLS`; Fly scrapes one endpoint per app) and alert on upload
or sync errors, a full disk, missing metrics and no upload in 26 h. The
weekly restore check still proves the backups restore.
