#!/usr/bin/env bash
# Runs INSIDE the db-init container (docker-compose.yml), against the local `sqlserver`
# service only: creates the database, applies db/migrations/*.sql in lexical order, then
# applies db/seed/*.sql (local dev account). Safe to re-run; every script is idempotent.
set -euo pipefail

DB="${DB_NAME:-tripplanner}"
export SQLCMDPASSWORD="$MSSQL_SA_PASSWORD"   # keep the password out of argv
SQLCMD=(/opt/mssql-tools18/bin/sqlcmd -C -S sqlserver -U sa -b -x -V 1)

"${SQLCMD[@]}" -d master -Q "IF DB_ID(N'$DB') IS NULL CREATE DATABASE [$DB];"

shopt -s nullglob
for f in /db/migrations/*.sql /db/seed/*.sql; do
  echo "Applying ${f#/db/}"
  "${SQLCMD[@]}" -d "$DB" -i "$f"
done
echo "Local database ready. Sign in with admin@example.com / local-dev-password"
