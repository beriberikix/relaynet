# web

Browser frontend, deployed to Cloudflare Pages. Not started yet.

Requirements already known:

- Serve with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (via a `_headers` file) so the
  VM can use shared memory.
- Connect to the relay with the token in the subprotocol list, since browsers
  cannot set headers on WebSocket upgrades:

  ```js
  const { token } = await fetch("https://relay.relaynet.network/api/anon/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnstileToken }), // from the Turnstile widget
  }).then((r) => r.json());
  const ws = new WebSocket("wss://relay.relaynet.network", ["relay.v1", "relay.token." + token]);
  ```

  Signed-in users pass their Auth0 access token (audience
  `https://relay.relaynet.network`) the same way and skip the token endpoint.
- The page's origin must be listed in `ALLOWED_ORIGINS` in `../relay/fly.toml`
  (currently `https://relaynet.network`).
- Turnstile sitekey for the widget: `0x4AAAAAAFW5Y8RGhjrzmHGg` (public).
- Auth0 SPA client id: `D8OrEtccuAnIumemWVjUMf6wTWhZzwgr` (public), domain
  `jonathanberi.us.auth0.com`.
