#!/bin/sh
# Restore the database from R2 when the volume is empty, then run the relay
# under Litestream, which replicates continuously and forwards signals.
set -eu

DB="${ADMIN_AUTH_DB_PATH:-/data/relay.sqlite}"
export ADMIN_AUTH_DB_PATH="$DB"  # litestream.yml reads it
CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"

if [ "${LITESTREAM_ENABLED:-true}" != "true" ]; then
  exec node node_modules/rootlessrelay/relay.js
fi

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
