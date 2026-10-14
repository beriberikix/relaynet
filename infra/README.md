# infra

Setup notes for the services around the relay. Nothing here is code.

## Auth0 (user logins)

1. Create an **API** in Auth0 with identifier `https://relaynet.fly.dev`
   (any URI; it becomes the token audience). Signing algorithm RS256.
2. Create a **Single Page Application** for the frontend. Allowed callback,
   logout and web origins: the Pages URL.
3. Access tokens carry `sub` but not `email` by default. Either set
   `JWT_USERNAME_CLAIM=sub`, or add a post-login Action that sets a custom
   claim such as `https://relaynet/email` and point `JWT_USERNAME_CLAIM` at it.
4. Relay secrets:

   ```sh
   fly secrets set \
     JWT_ISSUER="https://<tenant>.<region>.auth0.com/" \
     JWT_AUDIENCE="https://relaynet.fly.dev" \
     JWT_JWKS_URL="https://<tenant>.<region>.auth0.com/.well-known/jwks.json" \
     JWT_USERNAME_CLAIM=sub
   ```

   The issuer must include the trailing slash exactly as Auth0 emits it.

Users signing in through Auth0 are created in the relay on first connection
with the `user` tier. Operators can change tiers or ban them from the panel.

## Cloudflare (DNS, edge protection, Turnstile)

1. Point a proxied CNAME at `relaynet.fly.dev`; add the custom domain on Fly
   with `fly certs add <host>` and set SSL mode to Full (strict).
2. Switch `CLIENT_IP_HEADER` in `relay/fly.toml` to `cf-connecting-ip` and
   redeploy. Update `ALLOWED_ORIGINS` and `JWT_AUDIENCE` if the public host
   changes.
3. Add a WAF rate-limiting rule for `POST /api/anon/token` (for example 10
   per minute per IP) so token requests never reach the relay in bulk.
4. Optional: create a Turnstile widget for the frontend host, set
   `TURNSTILE_SECRET` on Fly, and have the page send `turnstileToken` in the
   anonymous token request body.

## Operator access

The admin port is private. `fly proxy 8001:8001` from an authenticated Fly
session is the only path in. There is no public admin URL by design.
