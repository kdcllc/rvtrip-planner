# Quick Start Guide - Local Setup

This guide gets the full app (SPA, API and database) running on your machine. To deploy to Azure, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Prerequisites Check

Before starting, ensure you have:

- [ ] Node.js 22 and npm (`node --version`). `api/package.json` sets `engines.node` to `>=22 <23`, the runtime the deployed API uses.
- [ ] Docker with Docker Compose (`docker compose version`), for the local SQL Server
- [ ] `sqlcmd` (go-sqlcmd or `/opt/mssql-tools18/bin/sqlcmd`), used by `scripts/db-migrate.sh`
- [ ] Bash, to run `scripts/db-migrate.sh`

No account or API key is needed for maps, routing, geocoding or weather.

## Setup

### 1. Install dependencies

```bash
npm install
(cd api && npm install)
```

The root install includes the SWA CLI and Azure Functions Core Tools used by `npm run dev:swa`.

### 2. Start the local database

```bash
npm run db:up
```

This starts SQL Server in Docker (`docker-compose.yml`, service `sqlserver`, port 1433) and waits until it is healthy. The SA password comes from `MSSQL_SA_PASSWORD`; when unset, the compose file uses a development-only default. See [db/README.md](db/README.md) for the default, the data volume and how to connect.

### 3. Apply the schema

```bash
export SQL_CONNECTION_STRING='Server=localhost,1433;Database=tripplanner;User Id=sa;Password=your-local-db-password;TrustServerCertificate=True'
npm run db:migrate
```

Replace `your-local-db-password` with the SA password from step 2. The script creates the `tripplanner` database if it is missing and applies every file in `db/migrations/` in order. It is safe to re-run.

### 4. Configure the API

The API reads its settings from `process.env`. For local runs, create `api/local.settings.json` (git-ignored):

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "SQL_CONNECTION_STRING": "Server=localhost,1433;Database=tripplanner;User Id=sa;Password=your-local-db-password;TrustServerCertificate=True",
    "SESSION_SECRET": "your-long-random-string",
    "APP_BASE_URL": "http://localhost:4280",
    "INVITE_CODE": "your-invite-code",
    "ADMIN_EMAILS": "admin@example.com"
  }
}
```

| Setting | Required locally | Purpose |
|---|---|---|
| `SQL_CONNECTION_STRING` | yes | Database connection (same value as step 3) |
| `SESSION_SECRET` | yes | Server secret; use a long random string |
| `APP_BASE_URL` | yes | Origin the API accepts changes from; also used in emailed links. Must match the URL you browse, `http://localhost:4280` |
| `INVITE_CODE` | yes | Shared code you type when registering |
| `ADMIN_EMAILS` | no | Comma-separated emails of accounts that see "Access requests" |
| `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS` | no | Azure Communication Services email. Without them no email is sent: password-reset mail does not arrive, and for invites the admin panel reports "Email not sent" and shows the link to copy |

The same names, with a comment each, are in [.env.example](.env.example). The names come from `api/src/shared/config.ts`.

### 5. (Optional) Routing fallback key

Create a `.env` file in the repo root (git-ignored) to add OpenRouteService as a third routing fallback:

```bash
VITE_OPENROUTE_API_KEY=your-api-key
```

This is the only variable the browser build reads (`src/config/env.ts`).

### 6. Build the API and start the app

```bash
(cd api && npm run build)
npm run dev:swa
```

`npm run dev:swa` starts the SWA CLI, which runs the Vite dev server (`npm run dev`, port 5173) and the Functions API from `api/`, and serves both at <http://localhost:4280>. The API runs the compiled output in `api/dist/`, so run the API build again after changing API code.

### 7. Register and sign in

1. Open <http://localhost:4280>. Signed-out visitors see the landing page.
2. Choose Sign up and register with the `INVITE_CODE` value from step 4.
3. To see the admin "Access requests" panel, register with an address listed in `ADMIN_EMAILS`.

## Frontend only

`npm run dev` starts just the Vite dev server on <http://localhost:5173>. There is no API on that port, so sign-in, registration and trip storage do not work; use it for UI work that does not need an account.

## Checks

Run these before opening a pull request (see [CONTRIBUTING.md](CONTRIBUTING.md)):

```bash
npx tsc -b               # type check
npm run lint             # ESLint
npm test                 # SPA tests (Vitest)
(cd api && npm test)     # API tests (Vitest)
npm run build            # type check + production build into dist/
```

## Stopping and resetting

```bash
docker compose down        # stop the database, keep the data
docker compose down -v     # stop it and delete the data volume
```

## Troubleshooting

### `npm run db:migrate` cannot connect

For `localhost` the script waits up to about 60 seconds for SQL Server. Check the container with `docker compose ps`, and check that the password in `SQL_CONNECTION_STRING` matches `MSSQL_SA_PASSWORD`.

### `sqlcmd: command not found`

Install go-sqlcmd or the SQL Server command-line tools, or point the `SQLCMD` variable at the binary. See [db/README.md](db/README.md).

### Sign-in or registration is rejected locally

The API accepts changes only from the `APP_BASE_URL` origin. Browse the app at `http://localhost:4280` (the SWA CLI port), not at the Vite port 5173.

### The API fails with "Missing required environment variable"

The message names the setting. Add it to `api/local.settings.json` and restart `npm run dev:swa`.

## File Structure

```
trip-planner/
├── src/                       # SPA source (React + TypeScript)
├── api/                       # Azure Functions API (bundled for deploy by api/scripts/build-deploy.mjs)
├── db/                        # SQL migrations and local DB notes
├── scripts/
│   ├── db-migrate.sh         # Apply db/migrations to a database
│   └── preflight-azure.sh    # Azure preflight checks (docs/AZURE-PREFLIGHT.md)
├── docker-compose.yml         # Local SQL Server
├── infra/                     # Bicep infrastructure templates (see DEPLOYMENT.md)
├── azure.yaml                 # azd configuration
├── swa-cli.config.json        # SWA CLI deploy settings used by azd
├── staticwebapp.config.json   # SWA routing, headers, API runtime
├── .azure/                    # azd environment config (git-ignored)
└── dist/                      # Build output (git-ignored)
```

## Useful Links

- [README](README.md): features, npm scripts and project layout
- [Deployment Guide](DEPLOYMENT.md): Azure provisioning, deploy and CI/CD
- [Database notes](db/README.md)
- [Azure Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/)
