# relaynet Privacy Policy

_Draft, not in effect. Last updated [[date]]._

This policy explains what relaynet, operated by [[operator name]], collects
and why. Contact: privacy@relaynet.network.

## What is collected

- **Account**: your email address and an identifier from the sign-in provider
  (Auth0), when the account was created and last used, your tier and status.
- **API tokens**: a one-way hash and short prefix of each token, its name,
  creation, last-use and expiry times. The token itself is never stored.
- **Usage**: bytes sent and received and number of sessions, per month.
- **Connection records**: for each connection your virtual machine opens, the
  destination address and port, protocol, whether it was allowed, bytes
  transferred and start and end time. These are kept for **30 days** to
  investigate abuse reports, then deleted.
- **Network data**: your IP address while a session is open, and in
  operational logs used to run and secure the service (kept 14 days).

relaynet does not record or inspect the contents of your traffic, and cannot
read encrypted (TLS) traffic.

## Why

To provide and secure the service, enforce limits and the Acceptable Use
Policy, answer abuse reports, and contact you about your account. Nothing is
sold, and nothing is used for advertising.

## Who processes it

| Provider | Role |
|---|---|
| Fly.io | Hosts the relay and its database |
| Cloudflare | DNS, network edge, website hosting, encrypted backups (R2) |
| Auth0 (Okta) | Sign-in |
| Better Stack | Uptime monitoring and status page |
| Grafana Labs | Metrics and operational logs |

Data may be processed in the United States.

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

## Changes

Material changes will be announced on the site or by email before they apply.
