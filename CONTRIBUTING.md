# Contributing

Thanks for helping. Issues and pull requests are both welcome. Everyone
taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Where things go

- **The relay itself** (IP stack, egress policy, accounts, orgs, metering,
  operator panel) lives in
  [beriberikix/rootlessRelay](https://github.com/beriberikix/rootlessRelay).
  Send relay changes there; this repository pins its releases.
- **This repository** holds the site and dashboard (`web/`), the client
  library (`client/`), the relay's container and deployment (`relay/`), and
  operations notes (`infra/`).
- **Security problems:** don't open an issue; see [SECURITY.md](SECURITY.md).

## Pull requests

- Keep each pull request to one change, and say why in the description.
- Include tests where the change has behaviour (`client/` has `npm test`;
  the relay's tests live in the fork).
- Update the docs the change touches: `web/docs/docs.md` for anything users
  see (then `python3 web/docs/build.py`), the nearest README otherwise.
- CI must pass, including the DCO check below.

## Sign your commits (DCO)

Every commit must be signed off under the
[Developer Certificate of Origin](https://developercertificate.org): a
statement that you wrote the change, or otherwise have the right to submit
it under the project's license. You sign off by adding a line to the commit
message with your real name and the email of the commit's author:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it for you. To sign off commits you have already made
on a branch:

```sh
git rebase --signoff main
git push --force-with-lease
```

The **dco** check fails a pull request with any commit that lacks a
matching sign-off. Bot commits (Dependabot) are exempt.
