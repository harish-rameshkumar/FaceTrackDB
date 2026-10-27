#!/usr/bin/env bash
# Loads Person B's SQL (views, queries, full-text search) into the running
# Postgres container. Run after the base files (settings, schema, seed,
# triggers, procedures) are loaded.
#   ./db/load_b.sh          load the views, queries and search files
#   ./db/load_b.sh --demo   also run the EXPLAIN before/after demo
# Credentials come from the environment or the repo-root .env file; values set
# in the environment take priority over .env.
set -euo pipefail
cd "$(dirname "$0")/.."

# Read .env, but a variable that is already set in the environment wins, so
# `POSTGRES_DB=other_db ./db/load_b.sh` really loads into other_db.
if [ -f .env ]; then
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in ''|'#'*) continue ;; esac
    value="${value%$'\r'}"; value="${value#\"}"; value="${value%\"}"
    if [ -z "${!key+x}" ]; then export "$key=$value"; fi
  done < .env
fi
: "${POSTGRES_USER:?POSTGRES_USER is not set (see .env.example)}"
: "${POSTGRES_DB:?POSTGRES_DB is not set (see .env.example)}"

run() {  # run <file> [extra psql flags]
  local file="$1"; shift
  echo "== $file" >&2
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@" < "$file"
}

run db/b_queries.sql
run db/b_search.sql
run db/b_register.sql
run db/b_reports.sql
if [ "${1:-}" = "--demo" ]; then
  run db/b_explain_demo.sql
fi
echo "Done." >&2
