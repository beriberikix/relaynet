# web

Account dashboard and landing page at https://relaynet.network, deployed to
Cloudflare Pages. Static files, no build step.

| File | Purpose |
|---|---|
| `index.html` | Landing page (signed out) and dashboard (signed in). |
| `app.js` | Auth0 sign-in, calls to the relay's `/api/me` routes, rendering. API data is only ever inserted as text nodes. |
| `config.js` | Public configuration: relay URL, Auth0 domain, client id and audience, Turnstile sitekey. |
| `styles.css` | Light and dark themes via CSS tokens. |
| `_headers` | Content Security Policy and other response headers applied by Pages. |

## Deploy

```sh
cf pages deploy ./web --project-name relaynet --branch main
```

The project's custom domain is the apex `relaynet.network`. The page's origin
must stay listed in `ALLOWED_ORIGINS` in `../relay/fly.toml`.

## Local development

Serve the directory on port 5173 (that origin is allowed in the Auth0 app):

```sh
python3 -m http.server 5173 -d web
```

Sign-in works locally, but the relay only accepts browser calls from the
production origin, so the dashboard's data calls return 403 unless
`http://localhost:5173` is added to `ALLOWED_ORIGINS` for a dev relay.

## Connecting a VM

```js
const ws = new WebSocket("wss://relay.relaynet.network", ["relay.v1", "relay.token." + token]);
```

`token` is an API token from the dashboard, an Auth0 access token with audience
`https://relay.relaynet.network`, or an anonymous token from
`POST https://relay.relaynet.network/api/anon/token` with a `turnstileToken`
in the JSON body.
