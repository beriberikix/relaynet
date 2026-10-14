# relay

Container image and Fly.io config for the relay process.

## First deploy

```sh
brew install flyctl && fly auth login
cd relay
fly launch --no-deploy --copy-config --name relaynet   # creates the app, keeps fly.toml
fly volumes create relay_data --size 1 --region sjc

fly secrets set \
  ADMIN_SESSION_SECRET="$(openssl rand -hex 32)" \
  ANON_TOKEN_SECRET="$(openssl rand -hex 32)" \
  ADMIN_BOOTSTRAP_USERNAME=admin \
  ADMIN_BOOTSTRAP_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=')"

fly deploy
curl -s https://relaynet.fly.dev/healthz
```

Note the bootstrap password somewhere safe; it is used once to create the
first operator and can be unset afterwards with `fly secrets unset`.

Optional secrets, set the same way:

| Secret | Purpose |
|---|---|
| `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_JWKS_URL`, `JWT_USERNAME_CLAIM` | External logins (see `../infra/README.md`). |
| `TURNSTILE_SECRET` | Require a Cloudflare Turnstile check for anonymous tokens. |
| `TIERS_JSON` | Override tier limits, e.g. `{"anon":{"maxSessionMs":600000}}`. |

Non-secret settings live in `fly.toml` under `[env]`.

## Operator panel

```sh
fly proxy 8001:8001
open http://127.0.0.1:8001
```

The admin port is only reachable over Fly's private network. Metrics are
scraped by Fly automatically and show up under the app's Grafana dashboard.

## Updating the relay

Change the tarball tag in `package.json`, then:

```sh
npm install          # refreshes package-lock.json
docker build .       # optional local check
fly deploy
```

## Running locally

```sh
docker build -t relaynet-relay .
docker run --rm -p 8086:8086 -p 127.0.0.1:8001:8001 \
  -e ADMIN_SESSION_SECRET=dev-only-$(openssl rand -hex 8) \
  -e ANON_TOKEN_SECRET=dev-only-$(openssl rand -hex 8) \
  -e ADMIN_BOOTSTRAP_USERNAME=admin -e ADMIN_BOOTSTRAP_PASSWORD=changeme \
  -e TRUST_PROXY=false relaynet-relay
```
