#!/usr/bin/env bash
# Apply every db/migrations/*.sql in lexical order. Works for local SQL Server and Azure SQL.
# Requires SQL_CONNECTION_STRING (ADO style: Server=host,port;Database=db;User Id=u;Password=p;
# optional TrustServerCertificate=True). The database is created if missing only for localhost /
# 127.0.0.1 servers (with a ~60s startup wait); override with DB_CREATE_IF_MISSING=0|1. Any SQL error exits non-zero.
set -euo pipefail

if [ -z "${SQL_CONNECTION_STRING:-}" ]; then
  echo "SQL_CONNECTION_STRING is not set (see db/README.md)" >&2
  exit 2
fi

SQLCMD="${SQLCMD:-$(command -v sqlcmd || true)}"
[ -z "$SQLCMD" ] && [ -x /opt/mssql-tools18/bin/sqlcmd ] && SQLCMD=/opt/mssql-tools18/bin/sqlcmd
if [ -z "$SQLCMD" ]; then echo "sqlcmd not found (set SQLCMD)" >&2; exit 2; fi

get() { # case-insensitive key lookup in the connection string
  printf '%s' "$SQL_CONNECTION_STRING" | tr ';' '\n' \
    | awk -F= -v k="$1" 'tolower($1) ~ "^[ ]*" tolower(k) "[ ]*$" { sub(/^[^=]*=/, ""); print; exit }'
}

SERVER="$(get Server)"; SERVER="${SERVER#tcp:}"; SERVER="${SERVER//,/ }"
SERVER="${SERVER// /,}"
DB="$(get Database)"; [ -z "$DB" ] && DB="$(get 'Initial Catalog')"
USER_ID="$(get 'User Id')"; [ -z "$USER_ID" ] && USER_ID="$(get UID)"
PASS="$(get Password)"; [ -z "$PASS" ] && PASS="$(get PWD)"
TRUST="$(get TrustServerCertificate)"

if [ -z "$SERVER" ] || [ -z "$DB" ] || [ -z "$USER_ID" ]; then
  echo "Connection string must include Server, Database and User Id" >&2
  exit 2
fi

ARGS=(-S "$SERVER" -U "$USER_ID" -b -V 1)
case "$(printf '%s' "$TRUST" | tr '[:upper:]' '[:lower:]')" in true|yes) ARGS+=(-C);; esac
export SQLCMDPASSWORD="$PASS"   # keep the password out of argv

HOST="${SERVER%%,*}"
IS_LOCAL=0
case "$HOST" in localhost|127.0.0.1) IS_LOCAL=1;; esac
CREATE_DB="${DB_CREATE_IF_MISSING:-$IS_LOCAL}"   # default on for local servers only; 0/1 overrides

if [ "$CREATE_DB" = "1" ]; then
  DB_BRACKET="${DB//]/]]}"; DB_LIT="${DB//\'/\'\'}"
  CREATE_SQL="IF DB_ID(N'$DB_LIT') IS NULL CREATE DATABASE [$DB_BRACKET];"
  if [ "$IS_LOCAL" = "1" ]; then   # local container may still be starting: retry up to ~60s
    deadline=$((SECONDS + 60))
    until "$SQLCMD" "${ARGS[@]}" -l 5 -d master -Q "$CREATE_SQL"; do
      if [ "$SECONDS" -ge "$deadline" ]; then
        echo "Could not connect/create database on $SERVER within 60s (server down or bad credentials)" >&2
        exit 1
      fi
      echo "Waiting for local SQL Server..." >&2
      sleep 3
    done
  else
    "$SQLCMD" "${ARGS[@]}" -d master -Q "$CREATE_SQL"
  fi
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../db/migrations" && pwd)"
shopt -s nullglob
files=("$DIR"/*.sql)
[ ${#files[@]} -gt 0 ] || { echo "No migrations in $DIR" >&2; exit 2; }
for f in "${files[@]}"; do   # glob expansion is lexical
  echo "Applying $(basename "$f")"
  "$SQLCMD" "${ARGS[@]}" -d "$DB" -i "$f"
done
echo "Migrations complete."
