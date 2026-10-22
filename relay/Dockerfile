# Debian 13 (trixie): the sqlite3 6.x prebuilt binary needs glibc 2.38 or
# newer, and bookworm has 2.36.
FROM node:24-trixie-slim

# Litestream replicates the SQLite database to R2 (see litestream.yml).
# Pinned and checksum-verified; bump both lines together.
ARG LITESTREAM_VERSION=0.5.17
ARG LITESTREAM_SHA256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz /tmp/litestream.tar.gz
RUN echo "${LITESTREAM_SHA256}  /tmp/litestream.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream \
 && rm /tmp/litestream.tar.gz \
 && litestream version

ENV NODE_ENV=production
WORKDIR /app

# The relay is pulled as a pinned release tarball (see package.json), so no
# git is needed in the image. sqlite3 uses a prebuilt binary for Node 24.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY litestream.yml /etc/litestream.yml
COPY entrypoint.sh /app/entrypoint.sh

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

CMD ["/app/entrypoint.sh"]
