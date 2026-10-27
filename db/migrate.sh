#!/usr/bin/env bash
# Applies every file in db/migrations/ in name order to the running Postgres container.
# The files are idempotent (IF NOT EXISTS / guarded), so running this twice is harmless.
# This is the way to upgrade a database that already holds data: it never drops anything.
# (db/schema.sql contains the same changes for fresh loads, but reloading it WIPES the database.)
#   ./db/migrate.sh
# Credentials come from the environment or the repo-root .env file; the environment wins.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in ''|'#'*) continue ;; esac
    value="${value%$'\r'}"; value="${value#\"}"; value="${value%\"}"
    if [ -z "${!key+x}" ]; then export "$key=$value"; fi
  done < .env
fi
: "${POSTGRES_USER:?POSTGRES_USER is not set (see .env.example)}"
: "${POSTGRES_DB:?POSTGRES_DB is not set (see .env.example)}"

shopt -s nullglob
files=(db/migrations/*.sql)
if [ "${#files[@]}" -eq 0 ]; then echo "No migrations found." >&2; exit 0; fi
for f in "${files[@]}"; do
  echo "== $f" >&2
  docker compose exec -T -e PGOPTIONS="-c client_min_messages=warning" postgres \
    psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$f"
done
echo "Migrations applied." >&2
