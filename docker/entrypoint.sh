#!/bin/sh
set -e

echo "Ensuring citext extension..."
npx prisma db execute --schema prisma/schema.prisma --stdin <<'SQL'
CREATE SCHEMA IF NOT EXISTS kreate;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA kreate;
SQL

echo "Applying Prisma migrations..."
until npx prisma migrate deploy; do
  echo "Database not ready yet — retrying in 2s..."
  sleep 2
done

exec "$@"
