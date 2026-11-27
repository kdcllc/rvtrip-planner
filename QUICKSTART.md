# Local Development Guide

This guide takes a new developer from a fresh clone to a running, signed-in app (SPA, API and database) on their own machine. To deploy to Azure, see [DEPLOYMENT.md](DEPLOYMENT.md).

## How the local stack fits together

| Piece | What runs it | Port |
|---|---|---|
| SPA (React + Vite) | `npm run dev`, started for you by the SWA CLI | 5173 |
| API (Azure Functions, `api/`) | Azure Functions Core Tools, started by the SWA CLI | 7071 |
| SWA emulator: serves the SPA and proxies `/api/*` | `npm run dev:swa` | **4280** |
| SQL Server | Docker (`docker-compose.yml`) | 1433 |

**Always browse the app at <http://localhost:4280>.** Port 5173 has no API behind it, so sign-in cannot work there (see [Troubleshooting](#troubleshooting)).

## Prerequisites

- **Node.js 22** and npm. The Functions tools refuse to start on any other major version. With nvm, run `nvm use` in the repo root (`.nvmrc` pins 22); run `nvm install 22` first if you do not have it.
- **Docker** with Docker Compose (`docker compose version`).
- **Bash**.

No account or API key is needed for maps, routing, geocoding or weather. You do not need `sqlcmd` on your machine for local work; it is only used by `npm run db:migrate` (see [db/README.md](db/README.md)).

## First-time setup

### 1. Install dependencies

```bash
nvm use
npm install
(cd api && npm install)
```

The root install includes the SWA CLI and Azure Functions Core Tools.

### 2. Start and seed the database

```bash
npm run db:up
```

This starts SQL Server in Docker, waits until it is healthy, then runs the one-shot `db-init` service. `db-init` creates the `tripplanner` database, applies every file in `db/migrations/` and seeds a development account from `db/seed/dev-seed.sql`:

| Email | Password |
|---|---|
| `admin@example.com` | `local-dev-password` |

It is safe to re-run: migrations are idempotent and the seed never overwrites an existing account. The seed is applied only to the local container, never by `npm run db:migrate` and never in Azure.

The SA password comes from `MSSQL_SA_PASSWORD`; when unset, the compose file uses the development-only default `Local-Dev-Only-1`.

### 3. Configure the API

Create `api/local.settings.json` (git-ignored):

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "SQL_CONNECTION_STRING": "Server=localhost,1433;Database=tripplanner;User Id=sa;Password=Local-Dev-Only-1;TrustServerCertificate=True",
    "SESSION_SECRET": "replace-with-a-long-random-string",
    "APP_BASE_URL": "http://localhost:4280",
    "INVITE_CODE": "local-invite",
    "ADMIN_EMAILS": "admin@example.com",
    "EIA_API_KEY": ""
  }
}
```

Generate a session secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. If you set your own `MSSQL_SA_PASSWORD`, use it in the connection string.

| Setting | Required locally | Purpose |
|---|---|---|
| `SQL_CONNECTION_STRING` | yes | Database connection |
| `SESSION_SECRET` | yes | Server secret; use a long random string |
| `APP_BASE_URL` | yes | Origin the API accepts changes from; also used in emailed links. Must match the URL you browse, `http://localhost:4280` |
| `INVITE_CODE` | yes | Shared code typed when registering an extra account |
| `ADMIN_EMAILS` | no | Comma-separated emails of accounts that see "Access requests". Include `admin@example.com` to make the seeded account an admin |
| `EIA_API_KEY` | no | Free key from eia.gov/opendata for weekly fuel-price history. Leave it empty or omit it and fuel costs use today's national average as before |
| `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS` | no | Azure Communication Services email. Without them no email is sent: password-reset mail does not arrive, and for invites the admin panel reports "Email not sent" and shows the link to copy |

The same names, with a comment each, are in [.env.example](.env.example). The names come from `api/src/shared/config.ts`. The optional `EIA_API_KEY` is not yet listed in `.env.example`.

### 4. Build the API and start the app

```bash
(cd api && npm run build)
npm run dev:swa
```

`npm run dev:swa` starts the Vite dev server and the Functions API and serves both at <http://localhost:4280>.

### 5. Sign in

Open <http://localhost:4280>, choose Sign in and use `admin@example.com` / `local-dev-password`. To create another account, choose Sign up and enter the `INVITE_CODE` from step 3.

## Day-to-day

```bash
nvm use                 # once per terminal
npm run db:up           # if the database container is not running
npm run dev:swa         # then open http://localhost:4280
```

- **SPA changes** hot-reload.
- **API changes** need a rebuild, because the emulator runs the compiled output in `api/dist/`: run `(cd api && npm run build)` and restart `npm run dev:swa`.
- **Schema changes** go in a new numbered file in `db/migrations/`; run `npm run db:up` again to apply it locally.
- **UI-only work** can use `npm run dev` on <http://localhost:5173>. There is no API on that port: the app shows the signed-out landing page and sign-in, registration and trip storage do not work.

### Optional: routing fallback key

Create a `.env` file in the repo root (git-ignored) to add OpenRouteService as a third routing fallback:

```bash
VITE_OPENROUTE_API_KEY=your-api-key
```

This is the only variable the browser build reads (`src/config/env.ts`).

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

After `down -v`, `npm run db:up` gives you a fresh, migrated and seeded database.

## Troubleshooting

### "Missing CSRF token" when signing in

No API answered `/api/ping`, so the CSRF cookie was never issued. Almost always you are on port 5173 or started only `npm run dev`. Run `npm run dev:swa` and browse <http://localhost:4280>. Safari does not accept the cookie on plain `http://localhost`; use Chrome or Firefox locally.

### Sign-in or registration is rejected (403)

The API accepts changes only from the `APP_BASE_URL` origin. Browse `http://localhost:4280`, and check that `APP_BASE_URL` in `api/local.settings.json` matches it exactly.

### "Azure Functions Core Tools v4 … incompatible with your current Node.js"

You are not on Node 22. Run `nvm use` in the terminal that starts `npm run dev:swa`.

### `npm run db:up` fails with "container name … is already in use"

A `trip-planner-sqlserver` container exists from another checkout or an older folder name; Compose names its project after the folder. To keep that container's data, start it with `docker start trip-planner-sqlserver` and seed it with `docker compose -p <old-folder-name> run --rm db-init`. To start clean instead, remove it with `docker rm trip-planner-sqlserver` (its data volume is kept until you delete it) and run `npm run db:up` again.

### The API fails with "Missing required environment variable"

The message names the setting. Add it to `api/local.settings.json` and restart `npm run dev:swa`.

### API changes have no effect

The emulator runs `api/dist/`. Rebuild with `(cd api && npm run build)` and restart.

### `npm run db:migrate` cannot connect, or `sqlcmd: command not found`

You only need `db:migrate` for a database other than the local container. See [db/README.md](db/README.md).

## File Structure

```
trip-planner/
├── src/                       # SPA source (React + TypeScript)
├── api/                       # Azure Functions API (bundled for deploy by api/scripts/build-deploy.mjs)
├── db/                        # SQL migrations, local dev seed and DB notes
├── scripts/
│   ├── db-init.sh            # Runs in the db-init container: migrations + local seed
│   ├── db-migrate.sh         # Apply db/migrations to a database (Azure SQL, or by hand)
│   └── preflight-azure.sh    # Azure preflight checks (docs/AZURE-PREFLIGHT.md)
├── docker-compose.yml         # Local SQL Server and the one-shot db-init service
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
