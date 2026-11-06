# Deployment Guide - Trip Planner to Azure Static Web Apps

This guide walks you through deploying the Trip Planner application to Azure Static Web Apps using the Azure Developer CLI (`azd`). The app has a managed Functions API and an Azure SQL database.

## What is Azure Static Web Apps?

Azure Static Web Apps is a service that automatically builds and deploys full-stack web apps. It provides:
- ✅ Custom domain with free HTTPS certificate
- ✅ Global CDN included
- ✅ Automatic SPA routing support
- ✅ Free tier (100 GB bandwidth/month)
- ✅ Built-in managed Functions for the API

## Architecture at a glance

- **SPA** built with Vite into `dist/`, served by Static Web Apps.
- **API**: Azure Functions (Node 22) in `api/`, deployed as the SWA built-in managed Functions. `swa-cli.config.json` sets `env: production`, `apiLocation: api/scripts`, `apiBuildCommand: node build-deploy.mjs` (an esbuild bundle), and `staticwebapp.config.json` sets `platform.apiRuntime: node:22`.
- **Database**: Azure SQL Database, serverless, free offer, auto-pause. It lives in **centralus** (`AZURE_SQL_LOCATION`, default `centralus`) while the Static Web App is in **eastus2**. The SQL server allows Azure services through the `AllowAzureServices` firewall rule.
- **Email**: Azure Communication Services with an Azure-managed domain, used for password reset.
- **Deploys go through `azd` only** (`azd up`, `azd provision`, `azd deploy`), locally or from CI. The old deployment-token workflow (`Azure/static-web-apps-deploy`) and `scripts/deploy.sh` no longer exist.

Infrastructure is in `infra/` (`main.bicep` plus modules in `infra/core/{communication,database,host,storage}`).

### Secrets and app settings

Set these in the azd environment before provisioning (names only; never commit or paste values):

- `AZURE_SQL_ADMIN_PASSWORD`, `SESSION_SECRET`, `INVITE_CODE`
- `AZURE_SQL_LOCATION` (optional, defaults to `centralus`; keep it lowercase)
- `ADMIN_EMAILS` (optional, comma-separated admin addresses that receive invite requests and see "Access requests"; defaults to `travel@kingdavidconsulting.com`; the provision workflow reads it from the optional repository variable `ADMIN_EMAILS`)

Bicep applies seven app settings to the Static Web App: `SQL_CONNECTION_STRING`, `SESSION_SECRET`, `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`, `APP_BASE_URL`, `INVITE_CODE`, `ADMIN_EMAILS`. Registration requires the shared `INVITE_CODE` or a single-use emailed invite code.

### Database schema

`azd` does not apply migrations. After the first provision, run `scripts/db-migrate.sh` once against the Azure SQL database with a connection string that has DDL rights (it is idempotent). Migration 002 (per-trip rows, invite requests and codes) must be applied before deploying the API that uses it. A freshly resumed serverless database can make the first login attempts time out, so retry. See `db/README.md`.

### Local development

`npm run db:up` (local SQL Server in Docker), `npm run db:migrate`, then `npm run dev:swa` (SWA CLI with the Vite dev server and the API). See `db/README.md` and `.env.example`.

### Cold start

The database auto-pauses when idle. The API maps a paused or resuming database to 503 with `Retry-After` (`/api/ping` is the health check); retry after a short wait.

## Prerequisites

1. **Azure Developer CLI** - [Install azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
2. **Azure Subscription** - You need an active Azure subscription (the free SQL offer region locks per subscription at first free database creation)
3. **Node.js 22 and npm**
4. **(Optional)** OpenRouteService API key - See `.env.example` for details

## Phase 1: Initial Setup and Provisioning

### Step 1: Login to Azure

```bash
azd auth login
```

### Step 2: Initialize the Azure Environment

```bash
azd env new
```

You'll be prompted for an environment name (used in resource naming), subscription and region. Then set the secrets listed above with `azd env set`.

### Step 3: Provision Azure Resources

```bash
azd provision
```

This creates the resource group `rg-{environmentName}`, the Static Web App, the SQL server and database, the Communication Services email resources, and applies the app settings.

### Step 4: Apply the database schema

Run `scripts/db-migrate.sh` as described above. When upgrading an existing deployment to the per-trip and invite-request release, apply migration 002 **before** deploying the new API; it backfills existing trips into `dbo.user_trips` and keeps the legacy `dbo.trips` table.

### Step 5: Deploy the Application

```bash
azd deploy
```

This builds the SPA and the bundled API (via `swa-cli.config.json`) and deploys them to the Static Web App.

### Step 6: Verify Deployment

- `GET /api/ping` returns 200 `application/json` (`{"ok":true}`)
- `GET /api/trips` without a session returns 401
- The site root shows the landing page for signed-out visitors (Sign up, Log in, Request an invite); register with the shared invite code or an emailed single-use invite code
- A signed-in admin (an address in `ADMIN_EMAILS`) sees "Access requests"; trips are saved per trip through `PUT /api/trips/{tripId}`

---

## Phase 2: Custom Domain with HTTPS

Azure Static Web Apps makes it easy to add a custom domain with automatic HTTPS.

### Step 7: Add Custom Domain

#### Option A: Using Azure Portal (Easiest)

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to your Static Web App resource
3. Click "Custom domains" in the left menu
4. Click "+ Add"
5. Enter your domain (e.g., `www.yourdomain.com` or `yourdomain.com`)
6. Follow the instructions to add the required DNS records
7. Click "Add"

Azure will automatically provision an SSL certificate (takes 5-10 minutes).

#### Option B: Using Azure CLI

```bash
# Get your Static Web App details
az staticwebapp show \
  --name <your-static-web-app-name> \
  --resource-group rg-trip-planner

# Add custom domain
az staticwebapp hostname set \
  --name <your-static-web-app-name> \
  --resource-group rg-trip-planner \
  --hostname www.yourdomain.com
```

### Step 8: Configure DNS

Add the required DNS records at your domain provider:

**For www subdomain:**
```
Type: CNAME
Name: www
Value: <your-app-name>.azurestaticapps.net
TTL: 3600
```

**For apex/root domain (yourdomain.com):**

Azure Static Web Apps provides a verification TXT record and either:
- ALIAS record (if supported by your DNS provider)
- A record with specific IP addresses

The exact records will be shown in the Azure Portal when you add the domain.

### Step 9: Wait for SSL Certificate

After DNS propagation (5-15 minutes), Azure automatically provisions a free SSL certificate. This takes an additional 5-10 minutes.

You can check the status in Azure Portal under "Custom domains."

---

## Phase 3: GitHub Actions CI/CD Setup

**Workflow:** `.github/workflows/azure-dev.yml` (push to `master` or manual `workflow_dispatch`).

It checks out, verifies the required repository variables, installs Node 22, runs `npm ci --ignore-scripts` in the root and in `api/`, then lint, `npm test`, API tests (`npm test` in `api/`), installs `azd`, logs in with a federated (OIDC) credential, creates a minimal azd environment (`azd env new` plus `AZURE_RESOURCE_GROUP`; no `azd env refresh`, which would demand the secure provision inputs), and finishes with `azd deploy --no-prompt`. It does not provision; run `azd provision` locally for infrastructure changes. `.github/workflows/pr-checks.yml` runs type check, lint, tests, API tests and build on pull requests.

Infrastructure is provisioned manually: run `azd provision` locally, or the **Provision Azure infrastructure (manual)** workflow (`.github/workflows/azure-provision.yml`) from the Actions tab on `master`. It always runs `azd provision --preview`, refuses to apply a preview that deletes or replaces a resource, and applies only when the `apply` box is checked. It needs the repository secrets `AZURE_SQL_ADMIN_PASSWORD`, `SESSION_SECRET` and `INVITE_CODE` (the same values as your azd environment; different values rotate them) and, for a custom domain, the repository variable `APP_BASE_URL`.

### Step 10: Configure repository variables

`azd pipeline config` creates the federated credential and sets these, or add them under Settings > Secrets and variables > Actions > Variables:

| Variable | Purpose |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the identity with the federated credential |
| `AZURE_TENANT_ID` | Azure tenant |
| `AZURE_SUBSCRIPTION_ID` | Subscription |
| `AZURE_ENV_NAME` | azd environment name |
| `AZURE_LOCATION` | azd region |
| `AZURE_RESOURCE_GROUP` | Resource group holding the Static Web App (`rg-trip-planner`) |

The workflow fails fast with an error if any is empty. The identity needs a role assignment on the resource group.

Optional secret: `VITE_OPENROUTE_API_KEY` (third routing fallback).

### Step 11: Test Automated Deployment

Push to `master`, or use GitHub > Actions > "Deploy to Azure Static Web Apps" > "Run workflow". When the run is green, check `GET /api/ping` on the live URL (200 JSON).

---

## Common Commands

### One-Command Deployment
After initial setup, you can provision and deploy in one command:

```bash
azd up
```

### View Current Environment
```bash
azd env list
azd env show
```

### View Deployed Resources
```bash
azd show
```

### Manual Deploy (after code changes)
```bash
azd deploy
```

### View Logs
```bash
azd monitor --logs
```

### Clean Up Resources
To delete all Azure resources:

```bash
azd down
```

**Warning:** This will delete the resource group and all resources within it!

---

## Environment Variables

### Local Development
Optional `.env` for the SPA: `VITE_OPENROUTE_API_KEY` (routing fallback).
Server-side settings for the API (`SQL_CONNECTION_STRING`, `SESSION_SECRET`, `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`, `APP_BASE_URL`, `INVITE_CODE`, `ADMIN_EMAILS`) are listed by name in `.env.example`; use `api/local.settings.json` (git-ignored) or your shell.

### azd environment (provisioning)
`AZURE_ENV_NAME`, `AZURE_LOCATION`, `AZURE_SQL_LOCATION` (optional), `APP_BASE_URL` (optional — set it to your custom domain, e.g. `https://trip.moedim.dev`; the API accepts sign-in and other changes only from this origin and uses it in reset links), `AZURE_SQL_ADMIN_PASSWORD`, `SESSION_SECRET`, `INVITE_CODE`, `ADMIN_EMAILS` (optional, see `infra/main.parameters.json`).

### GitHub Actions
Repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_ENV_NAME`, `AZURE_LOCATION`, `AZURE_RESOURCE_GROUP`; optional variable `ADMIN_EMAILS` (used by the provision workflow); optional secret `VITE_OPENROUTE_API_KEY`.

---

## Troubleshooting

### CI fails with "Repository variable ... is required and is empty"
Set the five repository variables listed in Step 10 (for example with `azd pipeline config`).

### GitHub Actions: "azd auth login" Browser Authentication Error
CI must log in with the federated credential (the workflow passes `--federated-credential-provider github`). If you see an `xdg-open` / browser error, the federated credential step is not being used or the credential does not exist for this repo and branch.

### `/api/ping` returns HTML instead of JSON
The API was not deployed, or the deploy targeted the wrong SWA environment. `swa-cli.config.json` must have `env: production` and `apiLocation: api/scripts`; re-run `azd deploy`.

### First request after idle returns 500/503 or login times out
The serverless database auto-pauses and takes up to about a minute to resume. Retry. The API returns 503 with `Retry-After` for this case; migrations run during a resume may time out at login and succeed on retry.

### Workflow Doesn't Trigger Automatically
1. Check the workflow file exists: `.github/workflows/azure-dev.yml`
2. Verify the workflow is enabled: GitHub > Actions > Select workflow > Enable if disabled
3. Check branch name matches: the workflow triggers on `master`

### Static Website Returns 404
This project uses Azure Static Web Apps (not Blob Storage static websites). Check Azure Portal > Static Web App > Overview for the URL; SPA routing is handled by `staticwebapp.config.json`.

---

## Next Steps

- **Custom Domain**: Configure a custom domain for your static website
- **Azure CDN**: Add CDN for global distribution and caching
- **Multiple Environments**: Create separate `dev` and `prod` environments using `azd env new`
- **Monitoring**: Set up Application Insights for monitoring (requires additional Bicep changes)

---

## Architecture

```
GitHub (push to master)
   |
   v
GitHub Actions: lint, tests, azd deploy (federated credential)
   |
   v
Azure Static Web App (eastus2): SPA from dist/ + managed Functions from api/scripts bundle
   |  /api/* (same origin)
   v
Azure SQL Database, serverless free offer (centralus)       Azure Communication Services (password-reset email)
```

## Files in This Project

### Configuration Files
- `azure.yaml` - Azure Developer CLI configuration (defines services and hooks)
- `.github/workflows/azure-dev.yml` - GitHub Actions workflow (azd deploy with federated credential)
- `swa-cli.config.json` - SWA CLI deploy settings used by `azd` (`env`, `apiLocation`, build commands)
- `staticwebapp.config.json` - SWA routing, headers, `platform.apiRuntime`
- `DEPLOYMENT.md` - This deployment guide

### Infrastructure as Code (Bicep)
- `infra/main.bicep` - Main infrastructure template (Static Web App, SQL, Communication Services, app settings)
- `infra/main.parameters.json` - Infrastructure parameters
- `infra/core/host/staticwebapp.bicep` - Azure Static Web App module
- `infra/core/host/staticwebapp-appsettings.bicep` - SWA app settings module
- `infra/core/database/sql-server.bicep` - SQL server, free-offer database, `AllowAzureServices` rule
- `infra/core/communication/communication-services.bicep` - Communication Services email
- `infra/core/storage/storage-account.bicep` - Storage account module (not used by the current deployment)

### Build Configuration
- `vite.config.ts` - Vite build configuration
- `package.json` - Node.js dependencies and build scripts
- `tsconfig.json` - TypeScript configuration

### Removed Files
- `.github/workflows/azure-deploy.template.yml` - Removed earlier (superseded by the azd-based `azure-dev.yml`)
- `scripts/deploy.sh` - Removed; deploy with `azd deploy`

## Resources

- [Azure Developer CLI Documentation](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
- [Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/)
- [Bicep Documentation](https://learn.microsoft.com/azure/azure-resource-manager/bicep/)
- [GitHub Actions with Azure](https://learn.microsoft.com/azure/developer/github/connect-from-azure)
