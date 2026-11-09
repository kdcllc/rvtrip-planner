# Database (SQL Server / Azure SQL)

Schema lives in `db/migrations/*.sql` (T-SQL, idempotent). Tables: `users`, `sessions`,
`password_reset_tokens`, `trips` (legacy), `user_trips`, `invite_requests`, `invite_codes`.
`trips.data` stores the `Trip`/`TripsState` shape as JSON text; `user_trips.data` holds one `Trip` per row.

## Migration 002

Adds `user_trips` (one row per trip, `version` for optimistic concurrency), `users.current_trip_id`,
`invite_requests` and `invite_codes`. It backfills `user_trips` from every legacy `dbo.trips` blob
(newest `updated_at` first; for a duplicate trip id the newest blob wins; elements without an id or
with an id over 128 chars are skipped) and sets `users.current_trip_id` from the newest blob's
`currentTripId` only where it is NULL. `dbo.trips` is kept unchanged (legacy, read-only after 002)
for rollback safety. Re-running is a no-op. **Run it against Azure SQL before deploying the new API**
(Azure SQL serverless may need time to resume; retry if the first connection times out).

## Start the local database

```bash
docker compose up -d        # returns immediately; check readiness with: docker compose ps
```

The SA password comes from `MSSQL_SA_PASSWORD`. If unset, the compose file uses the
**development-only** default `Local-Dev-Only-1` (throwaway local container; never reuse it).
Data persists in the `sqlserver-data` volume; `docker compose down -v` wipes it.

## Run the migration

```bash
export SQL_CONNECTION_STRING='Server=localhost,1433;Database=tripplanner;User Id=sa;Password=Local-Dev-Only-1;TrustServerCertificate=True'
./scripts/db-migrate.sh
```

For `localhost` / `127.0.0.1` servers the runner waits up to ~60s for SQL Server to accept
connections and creates the database if missing (`DB_CREATE_IF_MISSING=0|1` overrides). Remote
servers (e.g. Azure SQL) get neither.

Applies every file in `db/migrations/` in lexical order; safe to re-run. It exits non-zero on
any SQL error. Needs `sqlcmd` (go-sqlcmd or `/opt/mssql-tools18/bin/sqlcmd`; override with `SQLCMD`).
Against Azure SQL use its connection string (no database creation, no retry; drop `TrustServerCertificate`).

The deploy workflow (`.github/workflows/azure-dev.yml`) runs this script against Azure SQL before its `azd deploy`, so manual runs are optional when you deploy through it. A local `azd deploy` or `azd up` does not apply migrations.

## Connect

```bash
SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" sqlcmd -C -S localhost,1433 -U sa -d tripplanner
```

## Permissions note

`db_datareader` / `db_datawriter` are DML-only (SELECT/INSERT/UPDATE/DELETE). The identity that
runs migrations needs DDL rights (e.g. `db_ddladmin`, or `db_owner`); the app's runtime identity
should not.
