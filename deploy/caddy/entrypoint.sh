#!/bin/sh
# Writes the site's config.js and Content-Security-Policy from the
# environment, then runs Caddy. Every variable is optional:
#
#   RELAYNET_DOMAIN           serve this name over HTTPS (default: http on :80)
#   RELAYNET_RELAY_URL        the relay's origin when it is not this one
#   RELAYNET_HOSTED_SERVICE   "true" only for relaynet.network's own text
#   OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_AUDIENCE
#                             single sign-on with any OpenID Connect provider
#   RELAY_UPSTREAM            where the relay listens (default relay:8086)
set -eu

# Values end up inside a JavaScript string and an HTTP header: allow only
# characters a URL or a client id needs.
check() {
  case "$2" in
    *[!A-Za-z0-9:/._~%+=@-]*) echo "relaynet-web: $1 has characters that are not allowed: $2" >&2; exit 1 ;;
  esac
}
origin() { printf '%s' "$1" | sed -E 's#^(https?://[^/]+).*#\1#'; }

DOMAIN="${RELAYNET_DOMAIN:-}"
RELAY_URL="${RELAYNET_RELAY_URL:-}"
ISSUER="${OIDC_ISSUER:-}"
CLIENT_ID="${OIDC_CLIENT_ID:-}"
AUDIENCE="${OIDC_AUDIENCE:-}"
for v in DOMAIN RELAY_URL ISSUER CLIENT_ID AUDIENCE; do eval "check $v \"\${$v}\""; done

HOSTED=false
[ "${RELAYNET_HOSTED_SERVICE:-false}" = "true" ] && HOSTED=true

if [ -n "$ISSUER" ] && [ -n "$CLIENT_ID" ]; then
  OIDC="{ issuer: \"$ISSUER\", clientId: \"$CLIENT_ID\", audience: \"$AUDIENCE\" }"
else
  OIDC="null"
fi

cat > /srv/config.js <<JS
// Written by the relaynet-web container at start from its environment.
window.RELAYNET_CONFIG = {
  hostedService: $HOSTED,
  relayUrl: "$RELAY_URL",
  oidc: $OIDC,
};
JS

CONNECT="'self'"
[ -n "$RELAY_URL" ] && CONNECT="$CONNECT $(origin "$RELAY_URL") $(origin "$RELAY_URL" | sed 's#^http#ws#')"
IDP=""
[ "$OIDC" != "null" ] && IDP=" $(origin "$ISSUER")"
export RELAYNET_CSP="default-src 'self'; script-src 'self'; style-src 'self'; connect-src $CONNECT$IDP; img-src 'self' data:; form-action 'self'$IDP; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
export RELAYNET_SITE="${DOMAIN:-:80}"
export RELAY_UPSTREAM="${RELAY_UPSTREAM:-relay:8086}"

echo "relaynet-web: serving ${DOMAIN:-http on :80}; relay ${RELAY_URL:-on this origin} via $RELAY_UPSTREAM; single sign-on ${ISSUER:-off}"
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
