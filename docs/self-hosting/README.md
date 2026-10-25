# Self-hosting relaynet

relaynet runs anywhere Docker does. Pick the guide for what you want:

| Guide | For | Takes |
|---|---|---|
| [Quick start](quick-start.md) | Trying relaynet on your own machine | `git clone`, `docker compose up` |
| [Single server](single-server.md) | Running it for a team or the public, with a domain | A server, a domain name, a few settings in `.env` |
| [Single sign-on](oidc.md) | Signing people in with an identity provider you already use | An OpenID Connect provider |
| [relaynet.network](relaynet-network.md) | Seeing how the hosted service is deployed | Reference only |

What you get in every case:

- **relay**: the relay process ([rootlessRelay](https://github.com/beriberikix/rootlessRelay)
  in hosted mode), which carries Ethernet frames over WebSockets and gives
  each account's VMs DHCP, DNS, TCP and UDP to the internet, plus the
  account API, usage metering and the operator panel. Its data is one SQLite
  database.
- **web**: the dashboard and landing page, served by Caddy, which also passes
  the relay's API and WebSocket through on the same address.

Accounts are relay accounts (username and password) by default; single
sign-on is optional. No part of it needs Auth0, Cloudflare or Fly.io; those
are what relaynet.network happens to use.

The design behind this is in [`docs/design/self-hosting.md`](../design/self-hosting.md).
