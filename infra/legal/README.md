# Legal page drafts

Terms of Service, Acceptable Use Policy and Privacy Policy for
relaynet.network. The Markdown here is the source; `web/public/terms.html`,
`acceptable-use.html` and `privacy.html` are generated from it with
`python3 build.py` (run from this directory).

Assumptions to confirm before publishing (drafted 2026-10-14):

- Operator named as "Jonathan Beri", an individual; no postal address is
  published (contact by email only). Some laws (GDPR, some US states) expect
  a postal address for the data controller; add one or a mail-forwarding
  service if you have EU users.
- Governing law and courts: California. Change if you live elsewhere.
- Minimum age 16. Liability cap USD 50 during the free beta.
- Not reviewed by a lawyer. Get a review before paid tiers.

The email addresses used (support@, abuse@, privacy@, security@) forward
to the operator through Cloudflare Email Routing.

Facts the drafts rely on, checked against the deployment on 2026-10-14:

| Data | Where | Retention |
|---|---|---|
| Email address, Auth0 subject id, account timestamps | relay SQLite on Fly (volume `relay_data`) | until the account is deleted |
| API token hashes and prefixes (never the token) | same | until the account is deleted |
| Monthly usage: bytes in/out, session count | same | until the account is deleted |
| Connection audit: destination IP and port, protocol, verdict, bytes, start/end time, account id | same | 30 days (`AUDIT_RETENTION_DAYS`) |
| Client IP address | in memory per session; application logs on Fly | Fly log stream → Grafana Cloud Loki, 14 days (free tier) |
| Database backups (Litestream to Cloudflare R2, planned) | R2 | 7 days |
| Sign-in records | Auth0 | per Auth0's policy |

The relay forwards packets; it does not record or inspect payloads, and
encrypted traffic (TLS) stays opaque to it.
