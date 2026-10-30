# relaynet Privacy Policy

_Effective October 30, 2026._

This policy explains what relaynet, operated by Jonathan Beri, collects
and why. Contact: privacy@relaynet.network.

## What is collected

- **Account**: your email address and an identifier from the sign-in provider
  (Auth0), when the account was created and last used, your tier and status.
- **API tokens**: a one-way hash and short prefix of each token, its name,
  creation, last-use and expiry times. The token itself is never stored.
- **Usage**: bytes sent and received and number of sessions, per month.
- **Connection records**: for each connection your sessions open, the
  destination address and port, protocol, whether it was allowed, bytes
  transferred and start and end time. These are kept for **30 days** to
  investigate abuse reports, then deleted.
- **Network data**: your IP address while a session is open, and in
  operational logs used to run and secure the service (kept 14 days).

## Anonymous use

Demo pages can use relaynet without an account. No account data is
collected. IP addresses are processed for anonymous rate limits: each
anonymous token works only from the address (or IPv6 /64) that requested it,
and per-address session and daily data limits are counted in the relay's
memory, not stored. IP addresses appear in operational logs kept for 14 days.
Connection records for anonymous sessions are kept for 30 days, like any
other, under a random session identifier rather than an account.

relaynet does not record or inspect the contents of your traffic, and cannot
read encrypted (TLS) traffic.

## Why

To provide and secure the service, enforce limits (including anonymous rate
limits and the free tiers' monthly budget) and the Acceptable Use Policy, answer abuse reports, and contact you about your account. Nothing is
sold, and nothing is used for advertising.

## Legal bases

Where data-protection law such as the GDPR applies: account, token and usage
data are processed to provide the service you signed up for (contract);
connection records and network data, including the IP addresses of anonymous
users, are processed to keep the service and the internet safe from abuse and to answer abuse reports (legitimate
interests); emails about your account are part of the service.

## Cookies and tracking

The dashboard stores your sign-in session in your browser (Auth0) and sets
no advertising or analytics cookies. There are no third-party trackers.

## Security

Traffic to relaynet is encrypted (TLS). API tokens are stored only as
hashes. The operator panel is not reachable from the internet and requires
multi-factor authentication. Database backups are kept in a private bucket.

## Who processes it

| Provider | Role |
|---|---|
| Fly.io | Hosts the relay and its database |
| Cloudflare | DNS, network edge, website hosting, encrypted backups (R2) |
| Auth0 (Okta) | Sign-in |
| Better Stack | Uptime monitoring and status page |
| Grafana Labs | Metrics and operational logs |

Data may be processed in the United States and other countries where these
providers operate, under their data-processing terms.

## Retention and deletion

Account, token and usage data are kept until you delete your account. You can
do that from the dashboard; it removes them immediately. Connection records
expire after 30 days, and database backups after 7 days. Records may be kept
longer when needed for an open abuse investigation or a legal obligation.

## Your rights

You can see your account data on the dashboard, and ask for a copy, a
correction or deletion at privacy@relaynet.network. Depending on where you
live you may have further rights, including complaining to a data
protection authority.

## Children

relaynet is not meant for anyone under 16, and I do not knowingly collect
data from children.

## Changes

Material changes will be announced on the site or by email before they apply.
