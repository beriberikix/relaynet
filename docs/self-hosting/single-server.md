# Single server

The [quick start](quick-start.md)'s `compose.yaml`, on a server with a domain
name: HTTPS with an automatic certificate, accounts by invitation, backups,
and upgrades.

## You need

- A Linux server with Docker and the Compose plugin.
- A DNS name for it (`relay.example.org` below): an `A` (and `AAAA`, if the
  server has IPv6) record pointing at the server.
- Ports 80 and 443 open to the internet. Caddy uses them to get and renew the
  certificate and to serve the site.

Everything the relay sends to the internet leaves from this server's
address, so abuse reports about your users' traffic come to you. The relay
blocks outbound mail (port 25), private and link-local ranges, and the
usual UDP amplification ports by default.

## Configure

```sh
git clone https://github.com/beriberikix/relaynet
cd relaynet
cat > .env <<'EOF'
RELAYNET_DOMAIN=relay.example.org
RELAYNET_ORIGIN=https://relay.example.org
# Who can create accounts: invite codes from the operator panel.
SIGNUP_MODE=invite
EOF
docker compose up -d
```

- `RELAYNET_DOMAIN` makes Caddy serve `https://relay.example.org` with a
  certificate from Let's Encrypt (renewed automatically, kept in the
  `relaynet_web-data` volume) and redirect HTTP to HTTPS.
- `RELAYNET_ORIGIN` limits which web pages may call the relay's API and open
  sessions from a browser. Add more origins separated by commas if other
  sites of yours connect to it.
- `SIGNUP_MODE=invite` makes the sign-up form ask for an invite code. Use
  `USER_SIGNUP=false` instead to turn sign-up off (the operator then creates
  every account), or leave both out for open sign-up.

Clients connect to `wss://relay.example.org/`.

## First sign-in

```sh
docker compose logs relay | grep "first operator"
```

prints the `admin` password once. The operator panel listens only on the
server itself; reach it through an SSH tunnel:

```sh
ssh -L 8001:127.0.0.1:8001 you@relay.example.org
# then open http://127.0.0.1:8001 on your machine
```

Change the `admin` password there first (**Users**, the **Password** button
on the `admin` row), then create invite codes under **Invites** and send
them to people.

## Backups

The relay keeps everything in one SQLite database. With S3-compatible
storage configured, Litestream copies every change to it within a second and
the relay restores from it automatically when it starts on an empty volume.

```sh
# in .env
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_BUCKET=relaynet-backups
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto          # R2: auto; AWS S3: the bucket's region
S3_PATH=relaynet        # prefix inside the bucket
```

Give the key access to that one bucket only. relaynet.network uses
Cloudflare R2; the compose setup has also been tested against a generic
S3-compatible server. Litestream keeps a daily snapshot and 7 days of
changes.

**Restore** onto a new server, or after losing the volume: configure the
same `S3_*` settings and start. The relay's log says
`entrypoint: restored /data/relay.sqlite`. `secrets.json` is not in the
backup; a new one is generated, which only signs operators out of the panel.

**Without S3**, copy the volume while the relay is stopped:

```sh
docker compose stop relay
docker run --rm -v relaynet_relay-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/relay-data.tgz -C /data .
docker compose start relay
```

## Upgrades

```sh
git pull
docker compose up -d --build
```

Database migrations run when the relay starts. Read the release notes first,
and take a backup (above) before an upgrade that mentions a schema change.

## Single sign-on

To sign people in with an identity provider you already run (alongside or
instead of passwords), see [Single sign-on](oidc.md).

## Other relay settings

Limits per tier, egress rules, session lengths and the rest are relay
settings, listed in the
[rootlessRelay README](https://github.com/beriberikix/rootlessRelay#hosted-mode-settings).
Set them in a `compose.override.yaml` next to `compose.yaml`, which Compose
reads automatically:

```yaml
services:
  relay:
    environment:
      TIERS_JSON: '{"user":{"quotaBytes":53687091200}}'
```

## Behind another proxy or CDN

If something in front of the server (a load balancer, Cloudflare) receives
the connections, every client looks like that proxy to the relay, and
per-address limits apply to all of them together. Set `CLIENT_IP_HEADER` to
the header that proxy puts the client's address in (for example
`cf-connecting-ip`) in `compose.override.yaml`. Then allow ports 80 and 443
only from that proxy's address ranges in the server's firewall: anyone who
can reach Caddy directly could otherwise send the header themselves.
relaynet.network sits behind Cloudflare
(see [relaynet.network](relaynet-network.md)).
