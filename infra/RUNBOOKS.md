# relaynet runbooks

All operator actions go through the private admin panel:

```sh
fly proxy 8001:8001 -a relaynet
open http://localhost:8001        # localhost, not 127.0.0.1: the SSO callback host
```

Sign in with **single sign-on** (Auth0 app `relaynet-admin`, MFA required).
Operators are accounts with role `operator` whose Auth0 identity matches;
promote one from Users → **Make operator**. Production has password login off
(`ADMIN_PASSWORD_LOGIN=false`); if Auth0 is down, set it to `true` and create a
temporary operator over `fly ssh console`, then revert. Staging: `fly proxy 8002:8001 -a
relaynet-staging` (password login, credentials in `relay/.env.staging.local`).

## Invite a beta tester

1. Panel → **Invites** → note who it is for, keep the 14-day expiry → **Create invite**.
2. Copy the `RLY-XXXX-XXXX-XXXX` code (shown once) and send it with:
   sign in at https://relaynet.network, paste the code, create a token.
3. The Invites list shows when it was redeemed and by whom. Revoke unused
   codes you no longer want to honour.

A pending account can also be activated directly from **Users** → **Activate**.

## Respond to an abuse report

Reports name a destination (IP, port) and a time. Aim to answer within two
business days; act on anything ongoing immediately. Relay traffic leaves
from the dedicated egress IPs `209.71.113.1` and
`2a09:8280:e633:1:0:1b6:a721:0` (`fly ips list -a relaynet`, region sjc); a
report naming another source address is not about relaynet.

1. Panel → **Audit Log**. Enter the destination IP, the port if given, and
   the time converted to your local time zone in **At**; keep ±5 minutes,
   widen if nothing matches. Search.
2. The owner column shows the account. Check its other rows (put the owner,
   e.g. `user:7`, in **Owner**, clear **At**, last 7 days) to judge scope.
3. Clear abuse: **Ban owner** on the row. This closes its sessions and
   refuses new ones. Deleting the account (Users → Delete) also removes its
   usage history; ban first, delete later if warranted.
4. Reply to the reporter: action taken, without naming the user.
5. Nothing matches: the traffic did not come from relaynet, or is older than
   the 30-day audit retention. Say so.

Audit rows are kept 30 days; ban decisions do not expire.

## Deploy the relay

1. Tag a fork release (`vX.Y.Z-hosted.N`) after its CI is green.
2. In `relay/package.json` point the tarball at the tag, run `npm install`,
   commit and push. The **deploy relay** workflow deploys
   `relaynet-staging` and probes it.
3. If the release has a database migration, take a manual copy of
   production first (see Backups).
4. Actions → **deploy relay** → Run workflow with **production** checked.
   It redeploys staging, probes it, then deploys and probes production.
   Every production deploy closes live sessions; prefer quiet hours.
5. Check `curl -s https://relay.relaynet.network/healthz` and the Grafana
   dashboard.

By hand, if Actions is unavailable: `fly deploy --ha=false` from `relay/`
(staging: `fly deploy -c fly.staging.toml --ha=false`).

Roll back with `fly releases -a relaynet` and
`fly deploy --ha=false --image <previous image>`. A migration cannot be rolled
back by an older image; restore the pre-deploy backup instead.

The Fly deploy tokens in Actions secrets (`FLY_DEPLOY_TOKEN_*`) expire on
2027-10-14; renew with `fly tokens create deploy -a <app> -x 8760h`.

## Deploy the website

`cf deploy` from `web/`. Static files only; instant and safe to repeat.

## Backups

The database streams continuously to the R2 bucket `relaynet-backups`
(prefix `prod/`) through Litestream, which runs as the container's
entrypoint (`relay/entrypoint.sh`, `relay/litestream.yml`). Retention is 7
days with a daily snapshot. Fly also snapshots the volume daily (14 days).

- Credentials: `LITESTREAM_ACCESS_KEY_ID/SECRET` on Fly (read-write, this
  bucket only); `R2_RO_*` in `relay/.env.local` and in the repo's Actions
  secrets (read-only), both Cloudflare user tokens named `relaynet-*`.
- The **backup restore check** workflow restores weekly and opens an issue
  if it fails. Run it on demand from the Actions tab.
- Litestream metrics are scraped from port 9090 (`litestream_*` in Grafana).

## Restore the database

**Volume lost or machine replaced** (most likely case): nothing to do. On
boot, `entrypoint.sh` sees no database and restores the latest state from R2
before starting the relay. If the restore fails the machine refuses to start
(so it cannot overwrite the backups with an empty database); check
`fly logs`.

**Roll back to an earlier point** (bad migration, bad bulk change):

```sh
cd relay && set -a && . ./.env.local && set +a
export LITESTREAM_ACCESS_KEY_ID=$R2_RO_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY=$R2_RO_SECRET_ACCESS_KEY
export LITESTREAM_BUCKET=relaynet-backups LITESTREAM_REPLICA_PATH=prod ADMIN_AUTH_DB_PATH=/data/relay.sqlite
litestream restore -config litestream.yml -timestamp 2026-10-14T20:00:00Z \
  -integrity-check full -o ./restored.sqlite /data/relay.sqlite
sqlite3 ./restored.sqlite "SELECT COUNT(*) FROM users;"      # inspect it
```

Then put it in place: `fly ssh sftp shell -a relaynet`, upload it as
`/data/relay.restored.sqlite`; then in `fly ssh console` run
`mv /data/relay.restored.sqlite /data/relay.sqlite && rm -rf /data/.relay.sqlite-litestream /data/relay.sqlite-wal /data/relay.sqlite-shm`;
then immediately `fly machine restart` (writes between the two are lost). Litestream starts a new generation from the
restored file. Expect a few minutes of downtime; announce it.

**Manual copy before a risky change** (in addition to Litestream):

```sh
fly ssh console -a relaynet -C "node -e \"const s=require('/app/node_modules/sqlite3');const d=new s.Database('/data/relay.sqlite');d.run(\\\"VACUUM INTO '/data/backup.sqlite'\\\",e=>{console.log(e||'ok');d.close()})\""
fly ssh sftp get /data/backup.sqlite ./backup.sqlite -a relaynet
```

## Rotate a secret

| Secret | How | Effect |
|---|---|---|
| `ADMIN_SESSION_SECRET` | `fly secrets set ADMIN_SESSION_SECRET=$(openssl rand -hex 32)` | Operators are logged out of the panel |
| Operator password (staging only) | Panel → Users → your account → **Password** | None |
| `ADMIN_OIDC_CLIENT_SECRET` | Auth0 → Applications → relaynet-admin → rotate secret, then `fly secrets set ADMIN_OIDC_CLIENT_SECRET=...` | Sign-ins fail between the two steps |
| `ADMIN_BOOTSTRAP_*` | `fly secrets unset ADMIN_BOOTSTRAP_USERNAME ADMIN_BOOTSTRAP_PASSWORD` once an operator exists | None; they are only read when no operator exists |
| Auth0 signing keys | Auth0 dashboard → Settings → Signing Keys → rotate | Relay picks up the new key from the JWKS URL; existing sessions keep working until their tokens expire |
| A user's API token | Dashboard or panel → **Revoke** | Clients using it are refused on their next connection |

Each `fly secrets set` restarts the machine and closes live sessions.

## Relay is down

1. `fly status -a relaynet` and `fly logs -a relaynet`.
2. Machine stopped or crash-looping: check the last log lines for a startup
   error (config validation errors name the variable), fix, redeploy.
3. Volume full: `fly ssh console -a relaynet -C "df -h /data"`; remove old
   manual backups, or `fly volumes extend`.
4. Cloudflare in front returns 52x but `https://relaynet.fly.dev/healthz`
   works: check the Cloudflare DNS record and SSL mode (Full strict).

## Capacity

Limits on the production machine (shared-cpu-1x, 1 GB), from a load test on
2026-10-14 (staging resized to match):

| Resource | Limit | Observed |
|---|---|---|
| Sessions | 240 (address pool); session 241 gets HTTP 503 | 240 open, 5 refused cleanly |
| Memory | 1 GB | ~270 MB RSS at 240 sessions with 100 downloading |
| CPU | Fly shared CPU: 6% baseline plus a burst balance earned while idle | 240 sessions + 48 DNS q/s + 3 MiB/s used ~30%; the balance ran out after ~2 min, then Fly throttled the machine (steal 91%, event-loop lag 1.4 s, DNS p95 4 s) |

CPU is the binding limit. Grafana alerts **CPU burst balance low** and
**CPU throttled** fire first. To scale:

```sh
fly scale vm shared-cpu-2x -a relaynet      # doubles the baseline; cheap
fly scale vm performance-1x -a relaynet     # a dedicated core; no throttling
```

Both restart the machine (live sessions drop). Scale before inviting a large
batch rather than during an incident.

Also seen: the relay's TCP sender starts at a 10 KB congestion window and
grows by one segment per round trip (no slow start), so a client 250 ms away
gets tens of KB/s for the first seconds of each connection. Upstream code;
an improvement candidate for rootlessRelay.

## Load test

`infra/load/load.mjs` opens many sessions from one process: DHCP, a DNS query
every 5 s each, and optionally HTTP downloads through a minimal TCP client.
Run it against staging only, with the caps raised for the probe account:

```sh
fly scale memory 1024 -a relaynet-staging    # match production
fly secrets set -a relaynet-staging TIERS_JSON='{"user":{"maxSessionsPerOwner":300,"maxSessionsPerIP":300}}'
fly proxy 8002:8001 -a relaynet-staging &    # /metrics for RSS, CPU, event-loop lag
set -a; . relay/.env.staging.local; set +a
RELAY_TOKEN=$STAGING_PROBE_RELAY_TOKEN SESSIONS=245 DOWNLOADERS=100 HOLD_S=180 node infra/load/load.mjs
# afterwards, always:
fly secrets unset -a relaynet-staging TIERS_JSON
fly scale memory 512 -a relaynet-staging
```

Watch Fly's CPU throttling in Grafana (`fly_instance_cpu_balance`,
`fly_instance_cpu_throttle`). Downloads come from speed.cloudflare.com and
count against Fly egress.
