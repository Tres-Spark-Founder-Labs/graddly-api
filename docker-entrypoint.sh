#!/bin/sh
set -e

# Run pending migrations before the app starts.
#
# Previously the image started api+worker and never migrated, so every deploy
# carrying a schema change needed someone to remember a manual step. That has
# already shipped a broken release: `POST /qip-actions/export` returned
# "invalid input value for enum pdf_job_template" in production because the
# code was deployed and migration 35 was not.
#
# Failing loudly here is deliberate. A container that starts against a schema
# it does not match will serve 500s on some routes and work on others, which
# is far harder to diagnose than a deploy that refuses to go live.
if [ "${RUN_MIGRATIONS_ON_BOOT:-true}" = "true" ]; then
  echo "[entrypoint] Running database migrations..."
  node node_modules/typeorm/cli.js \
    -d dist/src/config/data-source.js \
    migration:run
  echo "[entrypoint] Migrations complete."
else
  echo "[entrypoint] RUN_MIGRATIONS_ON_BOOT is not 'true' — skipping migrations."
fi

exec "$@"
