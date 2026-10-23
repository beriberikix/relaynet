# relay

Container image and Fly.io config for the relay process.

## First deploy

```sh
brew install flyctl && fly auth login
cd relay
fly apps create relaynet --org <org>
fly volumes create relay_data --size 1 --region sjc -a relaynet --yes

fly secrets set \
  ADMIN_SESSION_SECRET="$(openssl rand -hex 32)" \
  ANON_TOKEN_SECRET="$(openssl rand -hex 32)" \
  ADMIN_BOOTSTRAP_USERNAME=admin \
  ADMIN_BOOTSTRAP_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=')"

fly deploy --ha=false     # one machine; sessions and the IP pool are in memory
curl -s https://relay.relaynet.network/healthz
```

Always pass `--ha=false`; without it Fly starts two machines and clients get
split across two relays that do not share state.

Note the bootstrap password somewhere safe; it is used once to create the
first operator and can be unset afterwards with `fly secrets unset`.

Optional secrets, set the same way:

| Secret | Purpose |
|---|---|
| `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_JWKS_URL`, `JWT_USERNAME_CLAIM` | External logins (see `../infra/README.md`). |
| `TIERS_JSON` | Override tier limits, e.g. `{"user":{"maxSessionMs":3600000}}`. |

Non-secret settings live in `fly.toml` under `[env]`.

## Backups

Litestream runs as the entrypoint and streams `/data/relay.sqlite` to the R2
bucket `relaynet-backups` (`litestream.yml`, prefix from
`LITESTREAM_REPLICA_PATH`). On boot with an empty volume it restores first
and refuses to start if the restore fails. Credentials are the Fly secrets
`LITESTREAM_ACCESS_KEY_ID` and `LITESTREAM_SECRET_ACCESS_KEY`. Set
`LITESTREAM_ENABLED=false` to run the relay without it (local experiments).
Restore procedures: `../infra/RUNBOOKS.md`.

## Operator panel

Production: https://admin.relaynet.network (`ADMIN_PUBLIC_HOST`; Auth0 SSO
with MFA). Staging stays private: `fly proxy 8002:8001 -a relaynet-staging`,
then http://localhost:8002.

The admin port 8001 itself is only reachable over Fly's private network.
Metrics are scraped there by Fly automatically and show up under the app's
Grafana dashboard.

## Updating the relay

The relay is the `npm pack` tarball attached to a fork release
(`releases/download/vX.Y.Z-hosted.N/rootlessrelay-X.Y.Z-hosted.N.tgz`), not
GitHub's generated source archive. Change both version numbers in that URL in
`package.json`, then:

```sh
npm install --package-lock-only --ignore-scripts   # refreshes package-lock.json
docker build --network host .                     # optional local check
```

Merging to `main` deploys staging (see `infra/RUNBOOKS.md`, "Deploy the
relay"). To check where a tarball came from:

```sh
gh release download vX.Y.Z-hosted.N -R beriberikix/rootlessRelay -p '*.tgz'
gh attestation verify rootlessrelay-X.Y.Z-hosted.N.tgz -R beriberikix/rootlessRelay
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
