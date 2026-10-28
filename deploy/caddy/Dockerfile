# The relaynet site (web/public) served by Caddy, which also proxies the
# relay's API and WebSocket on the same origin. Build from the repository
# root: docker build -f deploy/caddy/Dockerfile .
#
# Pinned by digest so a rebuild gets the image that was tested; Dependabot
# bumps tag and digest together.

# The site's one third-party script (oidc-client-ts) comes from its
# pinned devDependency, as in the Cloudflare deployment.
FROM node:24-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS site
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY web/public ./public
RUN npm run vendor && rm -f public/_headers

FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
COPY --from=site /web/public /srv
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/caddy/entrypoint.sh /usr/local/bin/relaynet-web
EXPOSE 80 443
ENTRYPOINT ["/usr/local/bin/relaynet-web"]
