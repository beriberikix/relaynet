#!/usr/bin/env python3
"""Provision relaynet's Grafana Cloud alerting and dashboard. Idempotent.

Reads GRAFANA_URL, GRAFANA_SA_TOKEN and ALERT_EMAIL from the environment
(infra/.env.local). The data source "fly-relaynet" (Fly's managed Prometheus,
read-only org token) must already exist; see infra/README.md.

    cd infra && set -a && . ./.env.local && set +a && python3 grafana/provision.py
"""

import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

URL = os.environ["GRAFANA_URL"].rstrip("/")
TOKEN = os.environ["GRAFANA_SA_TOKEN"]
EMAIL = os.environ["ALERT_EMAIL"]
DS = "fly-relaynet"
FOLDER_UID = "relaynet"
HERE = pathlib.Path(__file__).parent


def api(method, path, body=None, ok=(200, 201, 202, 204)):
    req = urllib.request.Request(
        URL + path,
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "X-Disable-Provenance": "true",  # keep everything editable in the UI
        },
    )
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as error:
        if error.code in ok:
            return error.code, None
        return error.code, error.read().decode(errors="replace")[:300]


# name, PromQL, comparison, threshold, pending period, severity, summary
RULES = [
    ("Sessions near capacity", 'sum(rootlessrelay_sessions{app="relaynet"})',
     "gt", 200, "5m", "warning",
     "More than 200 of the 240 addresses in the session pool are in use."),
    ("Memory pressure", 'min(fly_instance_memory_mem_available{app="relaynet"} / fly_instance_memory_mem_total{app="relaynet"})',
     "lt", 0.15, "10m", "critical",
     "Less than 15% of the machine's memory is available."),
    ("CPU burst balance low", 'min(fly_instance_cpu_balance{app="relaynet"})',
     "lt", 600, "10m", "warning",
     "The shared CPU's burst credit is nearly spent; Fly will throttle the relay to its 6% baseline. See RUNBOOKS.md, Capacity."),
    ("CPU throttled", 'max(rate(fly_instance_cpu_throttle{app="relaynet"}[5m]))',
     "gt", 1, "5m", "critical",
     "Fly is throttling the relay's CPU: DNS and TCP latency climb into seconds. Scale the machine (RUNBOOKS.md, Capacity)."),
    ("Relay 5xx responses", 'sum(increase(fly_app_http_responses_count{app="relaynet",status=~"5.."}[10m]))',
     "gt", 20, "5m", "warning",
     "The relay answered more than 20 requests with 5xx in 10 minutes."),
    ("Authentication failures spike", 'sum(increase(rootlessrelay_auth_failures_total{app="relaynet"}[10m]))',
     "gt", 300, "0s", "warning",
     "More than 300 rejected upgrades in 10 minutes: token guessing or a broken client."),
    ("Egress denials spike", 'sum(increase(rootlessrelay_egress_denied_total{app="relaynet"}[10m]))',
     "gt", 3000, "0s", "warning",
     "More than 3000 denied outbound connections in 10 minutes: likely a VM scanning. Check the audit log."),
    ("High egress volume", 'sum(increase(rootlessrelay_bytes_total{app="relaynet",direction="to_vm"}[1h]) + increase(rootlessrelay_bytes_total{app="relaynet",direction="from_vm"}[1h]))',
     "gt", 10 * 1024**3, "0s", "warning",
     "More than 10 GB relayed in the last hour. Fly bills egress; check who is using it."),
]


def rule(name, expr, op, threshold, pending, severity, summary):
    return {
        "uid": "relaynet-" + "".join(c if c.isalnum() else "-" for c in name.lower())[:30],
        "title": name,
        "condition": "B",
        "data": [
            {
                "refId": "A",
                "relativeTimeRange": {"from": 900, "to": 0},
                "datasourceUid": DS,
                "model": {"refId": "A", "expr": expr, "instant": True, "intervalMs": 1000, "maxDataPoints": 43200},
            },
            {
                "refId": "B",
                "datasourceUid": "__expr__",
                "model": {
                    "refId": "B",
                    "type": "threshold",
                    "expression": "A",
                    "conditions": [{"evaluator": {"type": op, "params": [threshold]}}],
                },
            },
        ],
        "noDataState": "OK",
        "execErrState": "Error",
        "for": pending,
        "labels": {"team": "relaynet", "severity": severity},
        "annotations": {"summary": summary, "runbook_url": "https://github.com/beriberikix/relaynet/blob/main/infra/RUNBOOKS.md"},
        "folderUID": FOLDER_UID,
        "ruleGroup": "relaynet",
    }


# A restart with no clean shutdown logged just before it: a crash, an
# out-of-memory kill or a host failure, not a deploy. On a deploy or a
# `fly machine restart`, Fly sends SIGINT and the relay logs
# {"msg":"shutting down",...,"code":0}; a crash logs code 1 or nothing.
# fly-log-shipper re-serializes the relay's JSON with sorted keys ("code"
# before "msg") and may add spaces, so the two are matched separately.
UNEXPECTED_RESTART = {
    "uid": "relaynet-relay-restarted",  # same uid as the old "Relay restarted" rule, replaced in place
    "title": "Relay restarted unexpectedly",
    "condition": "C",
    "data": [
        {
            "refId": "A",
            "relativeTimeRange": {"from": 900, "to": 0},
            "datasourceUid": DS,
            "model": {"refId": "A", "instant": True, "intervalMs": 1000, "maxDataPoints": 43200,
                      "expr": 'sum(changes(rootlessrelay_process_start_time_seconds{app="relaynet"}[10m]))'},
        },
        {
            "refId": "B",
            "relativeTimeRange": {"from": 900, "to": 0},
            "datasourceUid": "{loki}",
            "model": {"refId": "B", "queryType": "instant", "intervalMs": 1000, "maxDataPoints": 43200,
                      "expr": 'sum(count_over_time({fly_app_name="relaynet"} |= `shutting down` |~ `"code\\W{1,4}0\\b` [15m])) or vector(0)'},
        },
        {
            "refId": "C",
            "datasourceUid": "__expr__",
            "model": {"refId": "C", "type": "math", "expression": "$A > 0 && $B == 0"},
        },
    ],
    "noDataState": "OK",
    "execErrState": "Error",
    "for": "1m",
    "labels": {"team": "relaynet", "severity": "critical"},
    "annotations": {
        "summary": "The relay restarted without a clean shutdown (crash, out-of-memory kill or host failure); live sessions were dropped. Check `fly logs -a relaynet` around the restart.",
        "runbook_url": "https://github.com/beriberikix/relaynet/blob/main/infra/RUNBOOKS.md",
    },
    "folderUID": FOLDER_UID,
    "ruleGroup": "relaynet",
}


def loki_uid():
    status, sources = api("GET", "/api/datasources")
    # Grafana Cloud stacks also carry alert-state-history and usage-insights
    # Loki data sources; the application logs are the one ending in "-logs".
    for source in sources if isinstance(sources, list) else []:
        if source.get("type") == "loki" and source["uid"].endswith("-logs"):
            return source["uid"]
    raise SystemExit("no Loki data source found")


def main():
    status, _ = api("POST", "/api/folders", {"uid": FOLDER_UID, "title": "relaynet"}, ok=(200, 409, 412))
    print("folder", status)

    contact = {
        "uid": "relaynet-email",
        "name": "relaynet email",
        "type": "email",
        "settings": {"addresses": EMAIL, "singleEmail": True},
        "disableResolveMessage": False,
    }
    status, _ = api("PUT", "/api/v1/provisioning/contact-points/relaynet-email", contact)
    if status == 404 or (isinstance(_, str) and "not found" in _):
        status, _ = api("POST", "/api/v1/provisioning/contact-points", contact)
    print("contact point", status)

    status, policy = api("GET", "/api/v1/provisioning/policies")
    policy = policy if isinstance(policy, dict) else {}
    policy["receiver"] = "relaynet email"
    policy.setdefault("group_by", ["grafana_folder", "alertname"])
    policy["group_wait"] = "30s"
    policy["group_interval"] = "5m"
    policy["repeat_interval"] = "4h"
    print("policy", api("PUT", "/api/v1/provisioning/policies", policy)[0])

    # Upsert rule by rule (the group endpoint rejects new rules wholesale).
    for spec in RULES:
        r = {**rule(*spec), "orgID": 1}
        status, body = api("PUT", f"/api/v1/provisioning/alert-rules/{r['uid']}", r)
        if status == 404:
            status, body = api("POST", "/api/v1/provisioning/alert-rules", r)
        print("rule", r["title"], status, "" if status in (200, 201) else body)

    r = json.loads(json.dumps(UNEXPECTED_RESTART).replace("{loki}", loki_uid()))
    r["orgID"] = 1
    status, body = api("PUT", f"/api/v1/provisioning/alert-rules/{r['uid']}", r)
    if status == 404:
        status, body = api("POST", "/api/v1/provisioning/alert-rules", r)
    print("rule", r["title"], status, "" if status in (200, 201) else body)

    dashboard = json.loads((HERE / "relay-dashboard.json").read_text())
    status, body = api("POST", "/api/dashboards/db", {"dashboard": dashboard, "folderUid": FOLDER_UID, "overwrite": True})
    print("dashboard", status, (body or {}).get("url") if isinstance(body, dict) else body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
