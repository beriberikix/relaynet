# relaynet

Hosted, multi-user network relay for browser VMs. The relay process is
[rootlessRelay](https://github.com/beriberikix/rootlessRelay) in hosted mode,
pinned as a dependency; this repo holds everything around it.

```
relay/   container image + Fly.io config for the relay process
web/     browser frontend (Cloudflare Pages)
infra/   setup notes for Cloudflare, Auth0 and operator access
```

Bump the relay by changing the tarball version in `relay/package.json` and
running `npm install` there to refresh the lockfile.
