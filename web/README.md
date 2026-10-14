# web

Browser frontend, deployed to Cloudflare Pages. Not started yet.

Requirements already known:

- Serve with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (via a `_headers` file) so the
  VM can use shared memory.
- Connect to the relay with the token in the subprotocol list, since browsers
  cannot set headers on WebSocket upgrades:

  ```js
  const { token } = await fetch("https://relaynet.fly.dev/api/anon/token", {
    method: "POST",
  }).then((r) => r.json());
  const ws = new WebSocket("wss://relaynet.fly.dev", ["relay.v1", "relay.token." + token]);
  ```

  Signed-in users pass their Auth0 access token the same way.
- The page's origin must be listed in `ALLOWED_ORIGINS` in `../relay/fly.toml`.
