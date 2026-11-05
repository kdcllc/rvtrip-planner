# Database (SQL Server / Azure SQL)

Schema lives in `db/migrations/*.sql` (T-SQL, idempotent). Tables: `users`, `sessions`,
`password_reset_tokens`, `trips`. `trips.data` stores the `Trip`/`TripsState` shape as JSON text.

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

## Connect

```bash
SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" sqlcmd -C -S localhost,1433 -U sa -d tripplanner
```

## Permissions note

`db_datareader` / `db_datawriter` are DML-only (SELECT/INSERT/UPDATE/DELETE). The identity that
runs migrations needs DDL rights (e.g. `db_ddladmin`, or `db_owner`); the app's runtime identity
should not.
