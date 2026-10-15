# Fly.io policy review for relaynet

Reviewed 2026-10-14 against https://fly.io/legal/acceptable-use-policy and
https://fly.io/legal/terms-of-service (effective 2026-04-29). Not legal
advice.

## Fine as is

- **No ban on proxies, VPNs or relays.** The AUP does not mention them. It
  does prohibit *proxying spam*, which relaynet blocks at the network level
  (port 25 denied) and in its own Acceptable Use Policy.
- **Prohibited uses relaynet already forbids its users:** network or
  application scanning, penetration testing, phishing, spam, cryptomining.
  relaynet's AUP covers each, and the relay denies private and metadata
  addresses and caps connection rates.
- **Abuse reports to Fly** go to abuse@fly.io and are forwarded to the
  customer. relaynet can attribute any destination and time to an account
  (audit log, 30 days) and ban it; see the runbook.

## Flagged

1. **"Solely for Customer's internal use" (ToS §1.1) and "use the Fly.io
   Services for the benefit of a third party" (§1.4(d)).** Read literally,
   these would forbid serving any end users. In context (§1.4(d) sits with
   sublicensing) they are standard anti-reselling language that every
   public app on Fly lives with. relaynet is closer to the line than a
   typical web app because what it sells is, in effect, network egress.
   **Action:** ask Fly support for a written yes before inviting users
   (draft below).
2. **Suspension "with or without notice" in Fly's sole discretion (AUP).**
   Abuse by one relaynet user can take the whole service down. Mitigations:
   strict AUP, fast abuse handling, egress caps, and a documented way to
   redeploy elsewhere (the relay is a container; data is in R2).
3. **Customer indemnifies Fly (ToS §8)** for suits arising from use not in
   accordance with the agreement, which includes end users' misuse. Another
   reason to form an LLC before paid tiers, and to keep the AUP strict.
4. **Shared egress reputation.** Without a dedicated egress IP, relaynet
   traffic leaves from addresses shared with other Fly apps. A dedicated
   egress IP (`fly ips allocate-egress`, app-scoped, billed monthly) keeps
   relaynet's reputation separate and makes abuse reports unambiguous.
   Done 2026-10-14: `209.71.113.1` and `2a09:8280:e633:1:0:1b6:a721:0` (sjc).

## Draft note to Fly support

> Hi, I run relaynet (app "relaynet", org "relaynet"), a hosted network
> relay that gives browser-based clients raw TCP/UDP (e.g. Zephyr/v86 VMs,
> SSH clients, USB/IP and debug tools). Invited users connect over WebSocket
> and their clients make outbound TCP/UDP connections through the app. We block SMTP, private/metadata ranges and
> scanning patterns, rate-limit per account, log destinations for 30 days
> to handle abuse reports, and require accounts (no anonymous use). Is this
> use acceptable under your Terms (§1.1/§1.4(d)) and AUP? We use
> a dedicated egress IP. Anything you'd like us to do differently?
