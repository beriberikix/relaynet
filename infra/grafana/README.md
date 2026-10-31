# grafana

## Overview

Provisioning for the relay's Grafana Cloud alerting and dashboard.
`provision.py` is an idempotent script that upserts the alert folder, email
contact point, notification policy, alert rules and the "relaynet relay"
dashboard (`relay-dashboard.json`) through the Grafana HTTP API. Re-run it
after editing either file.

## Interface

- `provision.py` (run as a script; standard library only):
  - Environment: `GRAFANA_URL`, `GRAFANA_SA_TOKEN`, `ALERT_EMAIL`,
    `NTFY_URL` and `NTFY_TOKEN` (all required; read at import, so a missing
    one raises `KeyError`). Usually sourced from `infra/.env.local`.
    `NTFY_URL` is the private ntfy topic with `?template=grafana`, and
    `NTFY_TOKEN` an ntfy access token that may only publish to it.
  - Constants: `DS = "fly-relaynet"` (Prometheus data source uid),
    `FOLDER_UID = "relaynet"`.
  - `RULES`: list of `(name, PromQL, comparison, threshold, pending, severity,
    summary)` tuples, turned into rule bodies by `rule(...)`. Covers sessions
    near capacity, memory pressure, CPU burst balance, CPU throttling, relay
    5xx, authentication-failure spike, egress-denial spike, high egress volume
    and the Litestream backup rules (upload errors, sync errors, disk full,
    metrics missing, no upload in 26 h), and the egress budget on
    production: 50%, 80% and 100% of the pause threshold
    (`BUDGET_RATIO`), any change of `rootlessrelay_budget_state`, and an
    operator override (`rootlessrelay_budget_forced`).
  - `UNEXPECTED_RESTART`: a three-query rule (Prometheus restart count, Loki
    count of clean `shutting down` logs with code 0, math `$A > 0 && $B == 0`)
    that fires only on restarts with no clean shutdown.
  - `api(method, path, body=None, ok=...)`: HTTP helper; returns
    `(status, json_or_error_text)` and never raises on HTTP errors.
  - `loki_uid()`: picks the Loki data source whose uid ends in `-logs`;
    exits with "no Loki data source found" otherwise.
  - `main()`: performs the provisioning steps in order and prints a status
    line for each.
- `relay-dashboard.json`: dashboard model (uid `relaynet-relay`, title
  "relaynet relay") whose panels query data source `fly-relaynet`.

## Invariants

- The Prometheus data source `fly-relaynet` must already exist; the script
  does not create it.
- Rule uids are derived from the rule name (`"relaynet-" +` slug, truncated to
  30 characters), so renaming a rule in `RULES` creates a new rule rather
  than updating the old one.
- `UNEXPECTED_RESTART` keeps uid `relaynet-relay-restarted` so it replaces
  the older "Relay restarted" rule in place.
- Rules are upserted one at a time (`PUT`, falling back to `POST` on 404);
  the comment notes the group endpoint rejects new rules wholesale.
- Requests send `X-Disable-Provenance: true` so provisioned objects stay
  editable in the Grafana UI.
- All rules use folder `relaynet`, rule group `relaynet`, label
  `team=relaynet`, `noDataState: OK`, and a `runbook_url` pointing at the
  private operator runbooks.

## Side Effects

- Network writes to the Grafana Cloud API at `GRAFANA_URL`: creates folder
  `relaynet` (409/412 accepted), upserts contact points `relaynet-email` and
  `relaynet-push` (a webhook to `NTFY_URL` with `Authorization: Bearer
  NTFY_TOKEN`), overwrites the notification policy's receiver and timing
  (`group_wait` 30s, `group_interval` 5m, `repeat_interval` 4h), replaces its
  `relaynet push` child routes with two (`alertname=~"budget.*"` and
  `severity="critical"`, both `continue: true`, so email still gets them), upserts every alert rule, and
  posts the dashboard with `overwrite: True`.
- Reads `relay-dashboard.json` from disk.

## Verification

No automated tests. Syntax check:

```sh
python3 -c "import ast; ast.parse(open('infra/grafana/provision.py').read())"
```

Run for real (writes to Grafana Cloud):

```sh
cd infra && set -a && . ./.env.local && set +a && python3 grafana/provision.py
```
