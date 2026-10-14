# relaynet runbooks

All operator actions go through the private admin panel:

```sh
fly proxy 8001:8001 -a relaynet
open http://127.0.0.1:8001
```

## Invite a beta tester

1. Panel → **Invites** → note who it is for, keep the 14-day expiry → **Create invite**.
2. Copy the `RLY-XXXX-XXXX-XXXX` code (shown once) and send it with:
   sign in at https://relaynet.network, paste the code, create a token.
3. The Invites list shows when it was redeemed and by whom. Revoke unused
   codes you no longer want to honour.

A pending account can also be activated directly from **Users** → **Activate**.

## Respond to an abuse report

Reports name a destination (IP, port) and a time. Aim to answer within two
business days; act on anything ongoing immediately.

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

1. Tag a fork release (`vX.Y.Z-hosted.N`) after CI is green.
2. In `relay/package.json` point the tarball at the tag, run `npm install`.
3. If the release has a database migration, back up first (see below).
4. `fly deploy --ha=false` from `relay/`. Every deploy closes live sessions;
   prefer quiet hours. Clients reconnect on their own.
5. Check `curl -s https://relay.relaynet.network/healthz` and `fly logs`.

Roll back with `fly releases -a relaynet` and
`fly deploy --ha=false --image <previous image>`. A migration cannot be rolled
back by an older image; restore the pre-deploy backup instead.

## Deploy the website

`cf deploy` from `web/`. Static files only; instant and safe to repeat.

## Back up the database by hand

Until Litestream is running, take a consistent copy before risky changes:

```sh
fly ssh console -a relaynet -C "node -e \"const s=require('/app/node_modules/sqlite3');const d=new s.Database('/data/relay.sqlite');d.run(\\\"VACUUM INTO '/data/backup-$(date +%Y%m%d).sqlite'\\\",e=>{console.log(e||'ok');d.close()})\""
fly ssh sftp get /data/backup-$(date +%Y%m%d).sqlite ./backup.sqlite -a relaynet
sqlite3 ./backup.sqlite "PRAGMA integrity_check; SELECT COUNT(*) FROM users;"
```

Delete old copies from `/data` afterwards; the volume is 1 GB.

## Restore the database

[[To be written with the Litestream setup: restore from R2 onto a fresh
volume, verify, swap.]]

## Rotate a secret

| Secret | How | Effect |
|---|---|---|
| `ADMIN_SESSION_SECRET` | `fly secrets set ADMIN_SESSION_SECRET=$(openssl rand -hex 32)` | Operators are logged out of the panel |
| Operator password | Panel → Users → your account → **Password** | None |
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
