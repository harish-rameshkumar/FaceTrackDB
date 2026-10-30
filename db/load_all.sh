#!/usr/bin/env bash
# Rebuilds the whole PostgreSQL database from the SQL files (macOS / Linux equivalent of
# load_all.ps1, which keeps working on Windows). Run from anywhere, with the containers up
# (docker compose up -d):
#   ./db/load_all.sh          rebuild; refuses if face_profiles holds enrolled faces
#   ./db/load_all.sh --yes    rebuild even then
# WARNING: schema.sql drops and recreates every table, so ALL data is replaced by the seed
# data. Loading it also empties face_profiles, which leaves the face vectors in Qdrant
# orphaned: afterwards run   cd app && npm run qdrant:reset -- --yes   and enrol everyone again.
# To upgrade a database you want to keep, do NOT use this: run ./db/migrate.sh instead.
# Order: settings, schema, seed, triggers, procedures, migrations, demo_passwords, then
# db/load_b.sh (views, reports, search, registration functions).
# Credentials come from the environment or the repo-root .env file; the environment wins.
set -euo pipefail
cd "$(dirname "$0")/.."

YES=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    *) echo "Unknown argument: $a (only --yes is accepted)" >&2; exit 2 ;;
  esac
done

if [ -f .env ]; then
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in ''|'#'*) continue ;; esac
    value="${value%$'\r'}"; value="${value#\"}"; value="${value%\"}"
    if [ -z "${!key+x}" ]; then export "$key=$value"; fi
  done < .env
fi
: "${POSTGRES_USER:?POSTGRES_USER is not set (see .env.example)}"
: "${POSTGRES_DB:?POSTGRES_DB is not set (see .env.example)}"

psql_q() { docker compose exec -T -e PGOPTIONS="-c client_min_messages=warning" postgres psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }

# Is anything there that this would destroy and orphan?
has_table=$(psql_q -tA -c "SELECT to_regclass('public.face_profiles') IS NOT NULL" 2>/dev/null || echo "f")
if [ "$has_table" = "t" ]; then
  faces=$(psql_q -tA -c "SELECT count(*) FROM face_profiles")
  if [ "$faces" -gt 0 ] && [ "$YES" -ne 1 ]; then
    echo "REFUSING: face_profiles holds $faces enrolled face sample(s)." >&2
    echo "Reloading schema.sql deletes them and leaves their vectors orphaned in Qdrant." >&2
    echo "If that is what you want, run again with --yes, then run: cd app && npm run qdrant:reset -- --yes" >&2
    echo "To keep your data, use ./db/migrate.sh instead." >&2
    exit 1
  fi
fi

# b_meta, b_consents and b_demo_rows come from load_b.sh, not schema.sql, so a schema reload would leave their old
# rows behind (a stale "generated history" label, consent rows for students that no longer exist).
# load_b.sh below creates them again, empty.
psql_q -c "DROP TABLE IF EXISTS b_consents, b_meta, b_demo_rows" >/dev/null 2>&1 || true

for name in settings schema seed triggers procedures; do
  echo "== db/$name.sql" >&2
  psql_q < "db/$name.sql" >/dev/null
done
./db/migrate.sh
echo "== db/demo_passwords.sql" >&2
psql_q < db/demo_passwords.sql >/dev/null
./db/load_b.sh

cat >&2 <<'EOF'

Done. The database is rebuilt with the schema, seed data, migrations, demo passwords and the
reporting / registration SQL.
NEXT: the Qdrant face vectors no longer match face_profiles. Run
    cd app && npm run qdrant:reset -- --yes
and enrol everyone again (Admin > Students > Enrol face, or /enrol).
EOF
