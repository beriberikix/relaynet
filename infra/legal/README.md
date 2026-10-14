# Legal page drafts

Drafts of the Terms of Service, Acceptable Use Policy and Privacy Policy for
relaynet.network. They are **not published**. Before they go live:

1. Fill in every `[[…]]` placeholder (operator name as it should appear,
   jurisdiction, contact address or mail-forwarding service).
2. Have a lawyer review them, especially before paid tiers launch.
3. Set up `support@`, `abuse@`, `privacy@` and `security@relaynet.network`
   (Cloudflare Email Routing), which the pages reference.
4. Then they become `web/public/terms.html`, `acceptable-use.html` and
   `privacy.html`, linked from the footer and the sign-in flow.

Facts the drafts rely on, checked against the deployment on 2026-10-14:

| Data | Where | Retention |
|---|---|---|
| Email address, Auth0 subject id, account timestamps | relay SQLite on Fly (volume `relay_data`) | until the account is deleted |
| API token hashes and prefixes (never the token) | same | until the account is deleted |
| Monthly usage: bytes in/out, session count | same | until the account is deleted |
| Connection audit: destination IP and port, protocol, verdict, bytes, start/end time, account id | same | 30 days (`AUDIT_RETENTION_DAYS`) |
| Client IP address | in memory per session; application logs on Fly | logs: [[log retention once shipping is set up]] |
| Database backups (Litestream to Cloudflare R2, planned) | R2 | 7 days |
| Sign-in records | Auth0 | per Auth0's policy |

The relay forwards packets; it does not record or inspect payloads, and
encrypted traffic (TLS) stays opaque to it.
