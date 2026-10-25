# Quick start

Run relaynet on your own machine with nothing to configure. Needs Docker
with the Compose plugin, and ports 80 and 443 free (see
[Changing ports](#changing-ports) if they are not).

```sh
git clone https://github.com/beriberikix/relaynet
cd relaynet
docker compose up
```

The first start builds two images, which takes a minute or two. When the
log shows the relay as healthy, open **http://localhost**.

## Sign in

- **Create an account**: Sign in → *Create one*. Sign-up is open in the quick
  start, so anyone who can reach the page can make an account.
- **Or use the operator account**: on its first start the relay creates
  `admin` with a random password and prints it once:

  ```sh
  docker compose logs relay | grep "first operator"
  ```

  Change it in the operator panel (below) after signing in.

## Connect something

In the dashboard, create an API token, then connect with it:

```js
const ws = new WebSocket("ws://localhost/", ["relay.v1", "relay.token." + token]);
```

Hand `ws` to a VM's network card or a user-space TCP/IP stack. The
[docs page](http://localhost/docs.html) covers the protocol, limits and
examples.

To check the whole path from the command line (sign-up, a token, a DHCP
lease and a DNS lookup through the relay; needs Node 22 or later):

```sh
deploy/compose-check.sh
```

## Operator panel

http://127.0.0.1:8001, reachable only from this machine. Sign in as `admin`
to manage users, tiers, invite codes, sessions, usage and the audit log.

## Stop, start, reset

```sh
docker compose down          # stop; accounts and data are kept
docker compose up -d         # start again in the background
docker compose down -v       # stop and delete all data
```

Data lives in the `relaynet_relay-data` volume: the SQLite database and
`secrets.json` (generated signing secrets).

## Changing ports

Set them in a `.env` file next to `compose.yaml`:

```sh
HTTP_PORT=8080
HTTPS_PORT=8443
ADMIN_PORT=8002
```

The site is then at http://localhost:8080.

## Next

- Put it on a server with a domain and HTTPS: [Single server](single-server.md).
- Sign people in with an identity provider: [Single sign-on](oidc.md).
