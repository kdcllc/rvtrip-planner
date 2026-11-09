#!/usr/bin/env bash
# CI database helpers for .github/workflows/azure-dev.yml. Requires an Azure CLI login.
#
#   ci-db.sh migrate              Open a temporary SQL firewall rule for this runner and apply
#                                 db/migrations via scripts/db-migrate.sh (3 attempts).
#   ci-db.sh set-admin-emails     Set the ADMIN_EMAILS app setting to $ADMIN_EMAILS_WANTED if it differs.
#   ci-db.sh cleanup              Remove the firewall rule recorded by `migrate` (safe to run always).
#
# Env: AZURE_RESOURCE_GROUP (all); GITHUB_ENV, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT (set by Actions).
# `migrate` exports SWA_NAME, MIGRATE_FW_RULE and MIGRATE_SQL_SERVER to later steps via $GITHUB_ENV.
# The connection string and password are masked with ::add-mask:: and never echoed.
set -euo pipefail

fail() { echo "::error::$*"; exit 1; }
export_env() { echo "$1=$2" >> "${GITHUB_ENV:-/dev/null}"; export "$1=$2"; }

resolve_swa() {
  local names
  names="$(az resource list --resource-group "$AZURE_RESOURCE_GROUP" \
    --resource-type Microsoft.Web/staticSites --query "[].name" -o tsv)"
  if [ -z "$names" ] || [ "$(printf '%s\n' "$names" | wc -l)" -ne 1 ]; then
    fail "Expected exactly one Static Web App in resource group $AZURE_RESOURCE_GROUP, found: ${names:-none}"
  fi
  export_env SWA_NAME "$names"
}

app_setting() {
  az staticwebapp appsettings list --name "$SWA_NAME" --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "properties.$1" -o tsv
}

# Case-insensitive key lookup in the ADO-style SQL_CONNECTION_STRING.
conn_key() {
  printf '%s' "$SQL_CONNECTION_STRING" | tr ';' '\n' \
    | awk -F= -v k="$1" 'tolower($1) ~ "^[ ]*" tolower(k) "[ ]*$" { sub(/^[^=]*=/, ""); print; exit }'
}

load_connection_string() {
  SQL_CONNECTION_STRING="$(app_setting SQL_CONNECTION_STRING)"
  [ -n "$SQL_CONNECTION_STRING" ] && echo "::add-mask::$SQL_CONNECTION_STRING"
  if [ -z "$SQL_CONNECTION_STRING" ] || [ "$SQL_CONNECTION_STRING" = "null" ]; then
    fail "SQL_CONNECTION_STRING app setting is empty on Static Web App $SWA_NAME"
  fi
  export SQL_CONNECTION_STRING
  local pass
  pass="$(conn_key Password)"; [ -z "$pass" ] && pass="$(conn_key PWD)"
  [ -n "$pass" ] && echo "::add-mask::$pass"
  return 0
}

# Sets SQL_SERVER (no subshell, so fail's ::error:: reaches the log and exits the script).
resolve_sql_server() {
  SQL_SERVER="$(conn_key Server)"
  SQL_SERVER="${SQL_SERVER#tcp:}"; SQL_SERVER="${SQL_SERVER%%,*}"; SQL_SERVER="${SQL_SERVER%%.database.windows.net*}"
  [ -n "$SQL_SERVER" ] || fail "Could not derive the SQL server name from SQL_CONNECTION_STRING"
}

# Sets RUNNER_IP (no subshell, same reason as above).
resolve_runner_ip() {
  local url
  for url in https://api.ipify.org https://ifconfig.me; do
    RUNNER_IP="$(curl -fsS --max-time 10 "$url" 2>/dev/null || true)"
    if printf '%s' "$RUNNER_IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then return 0; fi
  done
  fail "Could not determine the runner public IPv4 address"
}

open_firewall() {
  local server="$1" ip="$2" rule="gha-migrate-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
  # Record before creating so `cleanup` still runs if creation half-succeeds.
  export_env MIGRATE_FW_RULE "$rule"
  export_env MIGRATE_SQL_SERVER "$server"
  az sql server firewall-rule create --resource-group "$AZURE_RESOURCE_GROUP" --server "$server" \
    --name "$rule" --start-ip-address "$ip" --end-ip-address "$ip" -o none \
    || fail "Could not create the SQL firewall rule. The deploy identity needs Microsoft.Sql/servers/firewallRules/write (for example Contributor or SQL Server Contributor on resource group $AZURE_RESOURCE_GROUP)."
  sleep 20 # firewall propagation
}

ensure_sqlcmd() {
  if [ -z "${SQLCMD:-}" ]; then SQLCMD="$(command -v sqlcmd || true)"; fi
  if [ -z "$SQLCMD" ] && [ -x /opt/mssql-tools18/bin/sqlcmd ]; then SQLCMD=/opt/mssql-tools18/bin/sqlcmd; fi
  if [ -z "$SQLCMD" ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    # --batch --yes: the runner image may already have this keyring; without them gpg prompts and fails (no TTY).
    curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/microsoft-prod.gpg
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/${VERSION_ID}/prod ${VERSION_CODENAME} main" \
      | sudo tee /etc/apt/sources.list.d/mssql-release.list > /dev/null
    sudo apt-get update -y
    sudo ACCEPT_EULA=Y apt-get install -y mssql-tools18 unixodbc-dev
    SQLCMD=/opt/mssql-tools18/bin/sqlcmd
  fi
  export SQLCMD
}

run_migrations() {
  local attempt
  for attempt in 1 2 3; do
    echo "Migration attempt $attempt of 3"
    if "$(dirname "$0")/db-migrate.sh"; then return 0; fi
    if [ "$attempt" -lt 3 ]; then
      echo "Attempt $attempt failed (serverless database may be resuming); retrying in 30s"
      sleep 30
    fi
  done
  fail "Database migrations failed after 3 attempts"
}

cmd_migrate() {
  resolve_swa
  load_connection_string
  resolve_sql_server
  resolve_runner_ip
  open_firewall "$SQL_SERVER" "$RUNNER_IP"
  ensure_sqlcmd
  run_migrations
}

cmd_set_admin_emails() {
  : "${ADMIN_EMAILS_WANTED:?ADMIN_EMAILS_WANTED is required}"
  [ -n "${SWA_NAME:-}" ] || resolve_swa
  if [ "$(app_setting ADMIN_EMAILS)" = "$ADMIN_EMAILS_WANTED" ]; then
    echo "ADMIN_EMAILS already up to date"
  else
    az staticwebapp appsettings set --name "$SWA_NAME" --resource-group "$AZURE_RESOURCE_GROUP" \
      --setting-names "ADMIN_EMAILS=$ADMIN_EMAILS_WANTED" -o none
    echo "ADMIN_EMAILS updated"
  fi
}

cmd_cleanup() {
  if [ -z "${MIGRATE_FW_RULE:-}" ] || [ -z "${MIGRATE_SQL_SERVER:-}" ]; then
    echo "No migration firewall rule was recorded; nothing to remove"
    return 0
  fi
  az sql server firewall-rule delete --resource-group "$AZURE_RESOURCE_GROUP" \
    --server "$MIGRATE_SQL_SERVER" --name "$MIGRATE_FW_RULE" -o none \
    || echo "::warning::Could not delete firewall rule $MIGRATE_FW_RULE (already removed or missing permission)"
}

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
case "${1:-}" in
  migrate) cmd_migrate ;;
  set-admin-emails) cmd_set_admin_emails ;;
  cleanup) cmd_cleanup ;;
  *) echo "Usage: $0 {migrate|set-admin-emails|cleanup}" >&2; exit 2 ;;
esac
