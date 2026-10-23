# License and open-core options

Decision input for #78 (part of #77, the open-source release). Written
2026-10-23. Nothing here is legal advice; a short review by a lawyer before
publishing is cheap and worth it.

## Decision (2026-10-23)

**A + D, with a DCO.**

- rootlessRelay (the fork) stays **MIT**.
- relaynet is **Apache-2.0** (`LICENSE`); `client/` stays **MIT**, as it is
  already published on npm under MIT.
- Billing and plan administration, and the production operations
  configuration, live in a **private repository** (#79, #48).
- Contributions are signed off under the **DCO** (`CONTRIBUTING.md`, the
  `dco` check in both repositories); no CLA.
- A **trademark policy** (#81) covers the name and logo.

The rest of this document is the analysis the decision was made from.

## The questions

Three questions, in this order:

1. What license does **rootlessRelay (the fork)** carry from here on?
2. What license does **relaynet (this repository)** get when it goes public?
3. Where is the **open-core line**: what, if anything, stays private, starting
   with billing (#48)?

## Where things stand

The starting point narrows the choices more than it seems.

| Piece | Where it lives | License today | Public? |
|---|---|---|---|
| Relay engine (upstream obegron/rootlessRelay) | fork | MIT | yes |
| Hosted mode: auth, orgs, invitations, tiers, metering, audit log, admin panel, OIDC | fork (`auth/`, `admin/`, `metering/`, `policy/`, `server/`) | MIT | **yes**, since the fork was made public |
| Client library | `client/`, npm `relaynet` | MIT | **yes** (npm 0.1.2) |
| Dashboard and site | `web/` | none | no |
| Deployment and operations (Fly, Cloudflare, Grafana, probes, runbooks) | `relay/`, `infra/`, `.github/` | none | no |
| Docs, threat model, audit | `docs/`, `web/docs/` | none | no |
| Billing | not written yet (#48) | — | — |

Facts that follow from this:

- **The valuable code is already MIT and public.** Everything a competitor
  needs to run a hosted relay with accounts, orgs, quotas and an operator
  panel is in the fork. Every released version stays MIT forever; a new
  license can only apply to changes from now on.
- **Upstream is MIT** and a single maintainer. The fork must keep upstream's
  notice; its own additions can carry another license, but then the
  repository has two licenses and code moving upstream gets harder.
- **Dependencies are all permissive** (MIT, ISC, Apache-2.0, BSD,
  BlueOak); none constrains the choice.
- **You are the only copyright holder of the new code** (plus upstream's MIT
  grant), so any relicensing is still your call. That stops being true the
  day you accept outside contributions without a CLA.

## What protection is actually available

A license protects code. relaynet's hosted service is mostly not code:

- a shared egress IP with a clean reputation, and the abuse handling that
  keeps it clean;
- the operations: Fly and Cloudflare setup, backups, monitoring, alerting,
  the runbooks, the security work;
- the name and the domain;
- (soon) pricing, billing and support.

A copier who takes the MIT fork still has to build all of that. The things
a license can't protect are best protected by a **trademark policy** (#81)
and by **keeping operator-specific configuration out of the public tree**
(#79).

## Options

### A. Permissive everywhere (MIT, or Apache-2.0 for relaynet)

Fork stays MIT; relaynet is MIT or Apache-2.0; billing either open or in a
private repository.

- For: matches what is already public; easiest for adopters and for
  companies to use; upstreaming stays trivial; one license to explain.
  Apache-2.0 adds an explicit patent grant and says plainly that the
  license grants no trademark rights.
- Against: anyone can run a competing hosted service from your code with no
  obligation to share changes.
- Who does this: Supabase (Apache-2.0), Tailscale's client (BSD-3, with
  the control plane closed), most developer libraries.

### B. Copyleft for the service (AGPL-3.0)

Fork's new work, or relaynet, under AGPL: anyone who runs a modified version
as a network service must publish their changes.

- For: an OSI license, so it is still "open source" without argument; stops
  closed hosted forks of *new* code; companies that would only take, not
  give, tend to stay away or buy a different license.
- Against: the already-public MIT versions remain a clean base for a closed
  fork, so the protection starts thin and grows with each release; many
  companies forbid AGPL internally, which narrows self-hosting adoption;
  mixing with upstream's MIT code is fine in that direction but upstream
  can't take AGPL patches back.
- Who does this: Grafana (moved from Apache-2.0, 2021), Plausible, Cal.com;
  Elastic and Redis added AGPL as an option after their source-available
  periods.

### C. Source-available with a delayed open license (FSL-1.1, or BSL-1.1)

New code is free to use, modify and self-host, except to offer a competing
service; each release converts to Apache-2.0 or MIT after two years (FSL)
or after a date you set (BSL).

- For: blocks the specific threat (a competing hosted relay on your newest
  code) while keeping self-hosting free; the conversion keeps a path to open
  source.
- Against: not open source by the OSI definition, which matters for the
  launch story, for being listed in some places, and for contributors;
  "competing use" invites argument; the precedent is mixed (HashiCorp's
  move to BSL produced the OpenTofu fork; Sentry's FSL was accepted more
  quietly because Sentry had always held the hosted market). Again, the
  existing MIT releases are unaffected.
- Who does this: Sentry and Codecov (FSL), HashiCorp and MariaDB MaxScale
  (BSL).

### D. Open core: permissive core, private or commercially licensed extras

The relay, self-hosting and client stay permissive; a defined set of
features is private or under a commercial license (for example an `ee/`
directory, as PostHog and GitLab do).

- For: the common model for a hosted business on an open engine; the open
  part stays simple; you choose what is worth keeping.
- Against: you have to keep the line clean in the code; features that
  self-hosters want (orgs, SSO) feel withheld if they sit on the closed side;
  the hosted-mode features are already MIT, so the closed side can only be
  new work.
- The natural candidates for the closed side here are the ones that are
  specific to *running relaynet as a business* rather than to running a
  relay: billing and Stripe (#48), revenue and plan administration in the
  admin console (#72, #73), and the operations repository (deployment
  configuration, alert rules, runbooks with real identifiers).

## Contributions: DCO or CLA

- **DCO** (a `Signed-off-by` line per commit): the norm for permissive and
  AGPL projects; no paperwork for contributors. Choosing it means you can't
  relicense contributors' code later without asking each of them.
- **CLA**: keeps relicensing possible (needed for C or for selling
  commercial licenses under B or D); adds friction and some contributor
  distrust.

## Recommendation

**A for the code, D for the business, plus a trademark policy.**

- **Fork: stay MIT.** It is already MIT and public; changing the license of
  new work now protects little, splits the repository's licensing, and
  makes upstreaming fixes (the audit lists several) harder. Treat the fork
  as the open engine.
- **relaynet: Apache-2.0** for `client/` (relicensing the next client
  release from MIT is fine, or leave the client MIT), `web/`, `docs/` and
  the self-hosting pieces from #84. Apache-2.0 over MIT for the explicit
  patent grant and trademark clause; either is defensible.
- **Keep private, in a separate repository: billing and plan
  administration, and the production operations configuration.** These are
  where relaynet-the-service differs from a self-hosted relay, and #79
  already calls for moving operator-specific configuration out of the tree.
  Self-hosters lose nothing they need.
- **DCO, not a CLA**, unless you want to keep option C open for later; in
  that case decide now, because adding a CLA after outside contributions
  arrive doesn't cover them.
- **Write the trademark policy (#81)** alongside the license: the name and
  logo are what a copycat service would otherwise borrow.

Choose **B (AGPL)** instead if the main worry is a larger company running a
modified relaynet as a closed service; choose **C (FSL)** if it is
specifically a competing hosted relay and you accept not being OSI open
source. Either way, apply it to relaynet and to the fork's new work
together, and expect the existing MIT releases to remain a usable base for
anyone.

## What happens next for each choice

| | A + D (recommended) | B | C |
|---|---|---|---|
| Fork | keep MIT; add `SECURITY.md` and DCO | add AGPL for new work beside upstream's MIT; mark files | add FSL for new work beside upstream's MIT; mark files |
| relaynet | add `LICENSE` (Apache-2.0); SPDX headers optional | `LICENSE` (AGPL-3.0) | `LICENSE` (FSL-1.1-Apache-2.0) |
| Private repo | create; move billing and ops config there (#79) | optional | optional |
| Client on npm | keep MIT, or Apache-2.0 from the next release | AGPL would deter users; keep MIT | keep MIT |
| Contributions | DCO check in CI | DCO, or CLA if dual-licensing | CLA |
| Before launch | trademark policy (#81), lawyer review | same | same, plus a clear "competing use" FAQ |
