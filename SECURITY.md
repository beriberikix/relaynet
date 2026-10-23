# Security policy

## Reporting a vulnerability

Email **security@relaynet.network**. Please don't open a public issue,
discussion or pull request for a security problem.

Include what you can of:

- what is affected (hostname, endpoint, file, version);
- steps to reproduce, or a proof of concept;
- what an attacker gains;
- whether you used any account other than your own, and what data you saw.

We'll reply from a person, not a ticket system.

## What to expect

| Step | Target |
|---|---|
| Acknowledge your report | 3 business days |
| Initial assessment and severity | 7 days |
| Fix deployed: Critical / High | 7 / 30 days |
| Fix deployed: Medium / Low | 90 days, or the next release |

We'll keep you updated as we go and tell you when the fix is live. We
disclose fixed issues in the release notes and, for anything Medium or
higher, in a short advisory. We'll credit you there unless you'd rather we
didn't. If we can't fix something within 90 days we'll agree a disclosure
date with you rather than ask you to wait indefinitely.

There is no bug bounty.

## Scope

In scope:

- the relay at `relay.relaynet.network`, including the account API;
- the dashboard and site at `relaynet.network`;
- the operator panel at `admin.relaynet.network`;
- the client library ([`relaynet` on npm](https://www.npmjs.com/package/relaynet), `client/`);
- the code in this repository and in the relay it deploys,
  [beriberikix/rootlessRelay](https://github.com/beriberikix/rootlessRelay).

Of most interest: anything that crosses tenants (seeing, reaching or spoofing
another account's VM traffic), reaches the relay's own network from a VM,
escalates a role, or yields someone else's credentials. The
[threat model](docs/security/threat-model.md) lists the boundaries and the
controls we rely on.

Out of scope:

- denial of service by volume, and anything that needs a flood to show;
- social engineering, phishing, or physical access;
- vulnerabilities in Auth0, Cloudflare, Fly.io, GitHub or other providers
  themselves (report those to the provider);
- reports from automated scanners without a demonstrated impact, such as a
  missing header or a version banner;
- abuse of the service by its users (send that to abuse@relaynet.network).

## Testing rules

- Use only accounts you own. Ask us for a second account if you need to test
  across tenants.
- Don't access, change or keep other people's data. If you reach any, stop
  and tell us.
- Don't degrade the service for others: no load testing, and keep automated
  requests to a low rate.
- Don't use the relay to probe or attack third parties.

## Safe harbor

If you follow this policy, we consider your research authorized, won't
pursue or support legal action against you for it, and will say so if anyone
else does. If you're unsure whether something is allowed, ask first.

## Supported versions

The hosted service always runs the current release. For the client library
and the relay, security fixes go into the latest release only.
