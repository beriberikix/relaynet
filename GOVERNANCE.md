# Governance

relaynet is run by one maintainer, Jonathan Beri (@beriberikix), who also
operates the hosted service at relaynet.network. This page says how
decisions get made today and how that changes as more people get involved.

## Decisions

- **Day to day:** the maintainer reviews and merges pull requests, triages
  issues, and cuts releases.
- **Bigger changes** (a new protocol or transport, a breaking API change, a
  new dependency on a third-party service, licensing): open an issue first.
  Discussion happens there, in the open; the maintainer decides and writes
  down why.
- **Security:** reports and fixes follow `SECURITY.md` and may be handled in
  private until a fix ships.

## Open source and the hosted service

The code in this repository and in
[rootlessRelay](https://github.com/beriberikix/rootlessRelay) is open source.
Running relaynet.network also involves things that aren't: billing,
production configuration and operating notes, kept in a private repository.
Nothing a self-hosted relay needs lives only there. The reasoning is in
`docs/design/license-options.md`.

The name is covered by `TRADEMARKS.md`.

## Becoming a maintainer

Regular contributors whose changes show good judgement may be invited to
become maintainers, with merge rights for an area such as the client, the
dashboard or the docs. When there is more than one maintainer, this page
will say how they decide together.

## Conduct

Be respectful and assume good faith. The maintainer may hide comments, lock
threads, or block people who harass others or disrupt the project. A fuller
code of conduct will come with the public launch (#80).
