#!/bin/sh
# Checks a running `docker compose up` end to end, as a new user would use
# it: the site and relay on one origin, an account from the sign-up form, an
# API token, and a VM-style session through the relay (DHCP lease, DNS
# lookup). Used by CI; run it locally after `docker compose up -d`.
#
#   BASE=http://localhost ADMIN=http://127.0.0.1:8001 deploy/compose-check.sh
#
# INSECURE=1 accepts an untrusted certificate (RELAYNET_DOMAIN=localhost uses
# Caddy's local CA).
set -eu

if [ "${INSECURE:-0}" = 1 ]; then
  curl() { command curl -k "$@"; }
  export NODE_TLS_REJECT_UNAUTHORIZED=0
fi

BASE="${BASE:-http://localhost}"
ADMIN="${ADMIN:-http://127.0.0.1:8001}"
here=$(dirname "$0")
fail() { echo "compose-check: $*" >&2; exit 1; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];if(v===undefined)process.exit(1);console.log(v)})' "$1"; }

curl -fsS "$BASE/healthz" | grep -q '"ok":true' || fail "relay /healthz through the site failed"
curl -fsS "$BASE/" | grep -q '<title>relaynet</title>' || fail "the site did not answer"
curl -fsS "$BASE/config.js" | grep -q 'hostedService: false' || fail "config.js was not written"
curl -fsS "$BASE/api/auth/config" | grep -q '"passwordLogin":true' || fail "password sign-in is off"
curl -fsS "$ADMIN/api/auth/status" >/dev/null || fail "operator panel not reachable on $ADMIN"
docker compose logs relay 2>/dev/null | grep -q 'created the first operator' || fail "no first-operator password in the logs"

user="check$(date +%s)"
pass="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
session=$(curl -fsS -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"$user\",\"password\":\"$pass\"}" "$BASE/api/auth/signup" | json token) || fail "sign-up failed"
api=$(curl -fsS -X POST -H "Authorization: Bearer $session" -H 'Content-Type: application/json' \
  -d '{"name":"compose-check"}' "$BASE/api/me/tokens" | json token) || fail "creating an API token failed"
echo "compose-check: signed up $user and created an API token"

RELAY_URL="$(echo "$BASE" | sed 's#^http#ws#')/" RELAY_TOKEN="$api" node "$here/../infra/probe/probe.mjs" \
  || fail "probe through the relay failed"
echo "compose-check: ok"
