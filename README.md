# relaynet

Hosted, multi-user network relay at https://relaynet.network (relay endpoint
`wss://relay.relaynet.network`). Clients with their own TCP/IP stack (browser
VMs, or user-space stacks for SSH, USB/IP, debug and custom protocols) send
Ethernet frames over a WebSocket and get IPv4 TCP and UDP to the internet;
sessions of one account share a private network. The docs page
(`web/docs/docs.md`) lists use cases and when to use something else.

The relay process is
[rootlessRelay](https://github.com/beriberikix/rootlessRelay) in hosted mode,
pinned as a dependency; this repo holds everything around it.

```
relay/   container image + Fly.io config for the relay process
web/     browser frontend (Cloudflare Worker, static assets)
client/  relaynet.js, the reconnecting client helper (npm: relaynet)
infra/   setup notes for Cloudflare, Auth0 and operator access
```

Bump the relay by changing the tarball version in `relay/package.json` and
running `npm install` there to refresh the lockfile.

## License

Apache-2.0 (see `LICENSE`), except `client/`, which is MIT (`client/LICENSE`).
The relay, [rootlessRelay](https://github.com/beriberikix/rootlessRelay), is
MIT. The names "relaynet" and "relaynet.network" are not licensed; see
`TRADEMARKS.md` for how to use them, `GOVERNANCE.md` for how the project is
run, and `docs/design/license-options.md` for why the licensing is set up
this way. Contributions are signed off under the DCO (`CONTRIBUTING.md`).
