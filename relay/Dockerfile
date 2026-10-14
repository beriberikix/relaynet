FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# The relay is pulled as a pinned release tarball (see package.json), so no
# git is needed in the image. sqlite3 uses a prebuilt binary for Node 24.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Persistent state (accounts, tokens, usage, audit) lives on a volume at /data.
RUN mkdir -p /data && chown -R node:node /data /app

# Hosted-mode defaults. Secrets (session secret, anon token secret, bootstrap
# operator, JWT settings) come from the platform's secret store at runtime.
ENV RELAY_MODE=hosted \
    LOG_LEVEL=0 \
    LOG_JSON=true \
    ENABLE_WSS=false \
    WS_BIND_ADDRESS=0.0.0.0 \
    WS_PORT=8086 \
    ADMIN_BIND_ADDRESS=0.0.0.0 \
    ADMIN_PORT=8001 \
    PROXY_BIND_ADDRESS=127.0.0.1 \
    ADMIN_AUTH_DB_PATH=/data/relay.sqlite

USER node

EXPOSE 8086 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.WS_PORT,path:'/healthz'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "node_modules/rootlessrelay/relay.js"]
