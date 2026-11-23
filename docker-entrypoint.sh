#!/bin/sh
set -e

# Apply pending migrations before serving. Prisma takes a Postgres advisory
# lock, so concurrent task starts are safe. Set RUN_MIGRATIONS=false to skip.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  ./node_modules/.bin/prisma migrate deploy
fi

exec node dist/main
