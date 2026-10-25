#!/bin/sh
# Restore the database from S3-compatible storage (R2 on relaynet.network)
# when the volume is empty, then run the relay under Litestream, which
# replicates continuously and forwards signals. Without a bucket
# (LITESTREAM_BUCKET), or with LITESTREAM_ENABLED=false, the relay runs on
# its own: backups are then the volume's.
set -eu

DB="${ADMIN_AUTH_DB_PATH:-/data/relay.sqlite}"
export ADMIN_AUTH_DB_PATH="$DB"  # litestream.yml reads it
CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"

case "${LITESTREAM_ENABLED:-auto}" in
  false) exec node node_modules/rootlessrelay/relay.js ;;
  auto) [ -n "${LITESTREAM_BUCKET:-}" ] || exec node node_modules/rootlessrelay/relay.js ;;
  true) [ -n "${LITESTREAM_BUCKET:-}" ] || { echo "entrypoint: LITESTREAM_ENABLED=true needs LITESTREAM_BUCKET" >&2; exit 1; } ;;
  *) echo "entrypoint: LITESTREAM_ENABLED must be auto, true or false" >&2; exit 1 ;;
esac

if [ ! -f "$DB" ]; then
  echo "entrypoint: no database on the volume; restoring from the replica if one exists"
  # A failed restore must stop the boot: starting with an empty database would
  # bootstrap a fresh one and replicate it over the backups.
  litestream restore -config "$CONFIG" -if-replica-exists -integrity-check quick "$DB"
  if [ -f "$DB" ]; then
    echo "entrypoint: restored $DB"
  else
    echo "entrypoint: no replica found; starting with a new database"
  fi
fi

exec litestream replicate -config "$CONFIG" -exec "node node_modules/rootlessrelay/relay.js"
