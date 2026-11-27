# Deployment Guide - Trip Planner to Azure Static Web Apps

This guide walks you through deploying the Trip Planner application to Azure Static Web Apps using the Azure Developer CLI (`azd`). The app has a managed Functions API and an Azure SQL database.

It covers Azure provisioning, deploy, custom domains and CI/CD only. To run the app on your machine, see [QUICKSTART.md](QUICKSTART.md).

## What is Azure Static Web Apps?

Azure Static Web Apps is a service that automatically builds and deploys full-stack web apps. It provides:
- Custom domain with free HTTPS certificate
- Global CDN included
- Automatic SPA routing support
- Free tier (100 GB bandwidth/month)
- Built-in managed Functions for the API

## Architecture at a glance

- **SPA** built with Vite into `dist/`, served by Static Web Apps.
- **API**: Azure Functions (Node 22) in `api/`, deployed as the SWA built-in managed Functions. `swa-cli.config.json` sets `env: production`, `apiLocation: api/scripts`, `apiBuildCommand: node build-deploy.mjs` (an esbuild bundle), and `staticwebapp.config.json` sets `platform.apiRuntime: node:22`.
- **Database**: Azure SQL Database, serverless, free offer, auto-pause. It lives in **centralus** (`AZURE_SQL_LOCATION`, default `centralus`) while the Static Web App is in **eastus2**. The SQL server allows Azure services through the `AllowAzureServices` firewall rule.
- **Email**: Azure Communication Services with an Azure-managed domain (always kept; sender `DoNotReply@<guid>.azurecomm.net`), used for password reset, invite emails and admin invite-request notifications. An optional custom email domain can be linked as the sender (see [Custom email domain](#custom-email-domain)).
- **Deploys go through `azd` only** (`azd up`, `azd provision`, `azd deploy`), locally or from CI. The old deployment-token workflow (`Azure/static-web-apps-deploy`) and `scripts/deploy.sh` no longer exist.

Infrastructure is in `infra/` (`main.bicep` plus modules in `infra/core/{communication,database,host,storage}`).

### Secrets and app settings

Set these in the azd environment before provisioning (names only; never commit or paste values):

- `AZURE_SQL_ADMIN_PASSWORD`, `SESSION_SECRET`, `INVITE_CODE`
- `AZURE_SQL_LOCATION` (optional, defaults to `centralus`; keep it lowercase)
- `EIA_API_KEY` (optional; a free key from eia.gov/opendata that enables weekly fuel-price history; omit it to keep the current national-average fuel price)
- `ADMIN_EMAILS` (optional, comma-separated admin addresses that receive invite requests and see "Access requests"; defaults to `travel@kingdavidconsulting.com`; the provision and deploy workflows read it from the optional repository variable `ADMIN_EMAILS`; the deploy workflow reapplies it on every run, defaulting to `travel@kingdavidconsulting.com` when the variable is unset, so if you customize it also set the repository variable or the value set via azd/Bicep reverts on the next deploy)

Bicep applies seven app settings to the Static Web App: `SQL_CONNECTION_STRING`, `SESSION_SECRET`, `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`, `APP_BASE_URL`, `INVITE_CODE`, `ADMIN_EMAILS`, plus an optional eighth, `EIA_API_KEY`, added only when it is set. Registration requires the shared `INVITE_CODE` or a single-use invite code, which arrives by email or as the link an admin copies from Access requests. If ACS email fails or `ACS_CONNECTION_STRING`/`ACS_SENDER_ADDRESS` are not set, invites still work: the panel reports "Email not sent" and the admin copies the link (the code stays valid for 14 days, single use).

### Database schema

`azd` does not apply migrations, but the deploy workflow (`.github/workflows/azure-dev.yml`) applies them automatically before the `azd deploy` it runs (see Phase 3; a local `azd deploy` does not apply them). After the first provision you can also run `scripts/db-migrate.sh` manually against the Azure SQL database with a connection string that has DDL rights (it is idempotent). Migration 002 (per-trip rows, invite requests and codes) must be applied before deploying the API that uses it; so must migration 003 (`vehicle_profiles` and `fuel_price_weekly`, idempotent). A freshly resumed serverless database can make the first login attempts time out, so retry. See `db/README.md`.

### Local development

Local setup is not part of this guide. Follow [QUICKSTART.md](QUICKSTART.md).

### Cold start

The database auto-pauses when idle. The API maps a paused or resuming database to 503 with `Retry-After` (`/api/ping` is the health check); retry after a short wait.

## Prerequisites

1. **Azure Developer CLI** - [Install azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
2. **Azure Subscription** - You need an active Azure subscription (the free SQL offer region locks per subscription at first free database creation)
3. **Node.js 22 and npm** (`api/package.json` sets `engines.node` to `>=22 <23`)
4. **Azure CLI (`az`)** - used by the custom domain commands, the role assignment and the email domain verification script. [Install it](https://learn.microsoft.com/cli/azure/install-azure-cli)
5. **(Optional)** OpenRouteService API key - See `.env.example` for details

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

This creates the resource group `rg-{environmentName}`, the Static Web App, the SQL server and database, the Communication Services email resources (including the custom email domain and its DNS records, which the defaults enable; see [Custom email domain](#custom-email-domain)), and applies the app settings.

### Step 4: Apply the database schema

Run `scripts/db-migrate.sh` as described above (or let the deploy workflow apply it on the next push to `master`). When upgrading an existing deployment to the per-trip and invite-request release, apply migration 002 **before** deploying the new API; it backfills existing trips into `dbo.user_trips` and keeps the legacy `dbo.trips` table. Likewise apply migration 003 (RV profiles and weekly fuel prices) before deploying the API that uses it; the deploy workflow applies it automatically.

### Step 5: Deploy the Application

```bash
azd deploy
```

This builds the SPA and the bundled API (via `swa-cli.config.json`) and deploys them to the Static Web App.

### Step 6: Verify Deployment

- `GET /api/ping` returns 200 `application/json` (`{"ok":true}`)
- `GET /api/trips` without a session returns 401
- The site root shows the landing page for signed-out visitors (Sign up, Log in, Request an invite); register with the shared invite code or a single-use invite link (emailed, or copied by an admin from Access requests)
- A signed-in admin (an address in `ADMIN_EMAILS`) sees "Access requests"; trips are saved per trip through `PUT /api/trips/{tripId}`
- To check email delivery, a signed-in admin opens Access requests, then Email delivery, then "Send test email"; the test email goes to the admin's own address, at most once a minute

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

It checks out, verifies the required repository variables, installs Node 22, runs `npm ci --ignore-scripts` in the root and in `api/`, then lint, `npm test`, API tests (`npm test` in `api/`), installs `azd`, logs in with a federated (OIDC) credential, creates a minimal azd environment (`azd env new` plus `AZURE_RESOURCE_GROUP`; no `azd env refresh`, which would demand the secure provision inputs), then applies migrations and `ADMIN_EMAILS` before `azd deploy --no-prompt`. The migration steps: `azure/login` (OIDC); find the Static Web App (the resource group must contain exactly one) and read `SQL_CONNECTION_STRING` from its app settings (masked); open a temporary SQL firewall rule `gha-migrate-<run_id>-<attempt>` for the runner IP (from api.ipify.org, fallback ifconfig.me); install `sqlcmd` on the runner if missing; run `scripts/db-migrate.sh` (3 attempts, 30 s apart, since a serverless database may be resuming); set the `ADMIN_EMAILS` app setting only when it differs from the repository variable `ADMIN_EMAILS` (default `travel@kingdavidconsulting.com`); deploy; and always remove the firewall rule. A migration failure skips the deploy. The deploy identity needs, on the resource group, firewall-rule write and delete on the SQL server (SQL Server Contributor or Contributor) and Static Web App app-settings read/write (Contributor). It does not provision; run `azd provision` locally for infrastructure changes. `.github/workflows/pr-checks.yml` runs type check, lint, tests, API tests and build on pull requests. `.github/workflows/secret-scan.yml` runs gitleaks on pull requests and on pushes to `master`.

Infrastructure is provisioned manually: run `azd provision` locally, or the **Provision Azure infrastructure (manual)** workflow (`.github/workflows/azure-provision.yml`) from the Actions tab on `master`. It always runs `azd provision --preview`, refuses to apply a preview that deletes or replaces a resource, and applies only when the `apply` box is checked. It needs the repository secrets `AZURE_SQL_ADMIN_PASSWORD`, `SESSION_SECRET` and `INVITE_CODE` (the same values as your azd environment; different values rotate them), optionally the secret `EIA_API_KEY` (set into the azd environment only when non-empty), and, for a custom domain, the repository variable `APP_BASE_URL`.

### Custom email domain

Linked as the sender only when `USE_CUSTOM_EMAIL_DOMAIN` is `true`. By default mail is sent from the Azure-managed domain (`DoNotReply@<guid>.azurecomm.net`), which is always kept. With a custom domain, `infra/core/communication/communication-services.bicep` adds a CustomerManaged ACS email domain (`CUSTOM_EMAIL_DOMAIN`, default `moedim.dev`) and a sender username (`rvtrip`, display name `RV Trip Planner`). When `USE_CUSTOM_EMAIL_DOMAIN` is `true` the domain is linked and the sender becomes `rvtrip@<domain>` (output `ACS_SENDER_ADDRESS`); otherwise the sender stays the managed one.

Note that `infra/main.parameters.json` defaults `CUSTOM_EMAIL_DOMAIN`, `EMAIL_DNS_ZONE_NAME` and `EMAIL_DNS_ZONE_RESOURCE_GROUP` to `moedim.dev` / `moedim-rg`, so every `azd provision` creates the custom domain and writes the DNS records, which requires DNS Zone Contributor on `moedim-rg`. A deployment without this zone must change those defaults in `infra/main.parameters.json`; an empty value skips the custom domain and the DNS module (see the `if` in `infra/main.bicep`).

- **DNS records**: when the domain, `EMAIL_DNS_ZONE_NAME` (default `moedim.dev`) and `EMAIL_DNS_ZONE_RESOURCE_GROUP` (default `moedim-rg`) are all non-empty, `infra/core/communication/email-dns-records.bicep` writes into that existing Azure DNS zone (cross resource group) the apex `@` TXT record set (including the ACS `ms-domain-verification` value) and two DKIM CNAMEs. It also writes a separate `_dmarc` TXT record (`v=DMARC1; p=none; rua=mailto:rvtrip@moedim.dev` with the defaults), only when the DMARC policy is non-empty. The policy is the `emailDmarcPolicy` param in `infra/main.bicep` (default `none`; allowed `none`, `quarantine`, `reject`, or empty to skip the record); it has no azd env var, so change it by editing that default. The deployment owns `_dmarc` whenever it writes it, so a manually created `_dmarc` value is overwritten.
- **Warning, apex TXT ownership**: the deployment fully owns the apex TXT set, so any apex TXT value not listed is removed on each provision. The values to keep are the `existingApexTxtValues` default in `infra/main.bicep` (the zone's current SPF, `MS=` and site-verification values). To add a new apex TXT value, add it to that array and provision again.
- **Permission (manual step)**: the deploying identity, both your local login and the CI federated identity (`AZURE_CLIENT_ID`), needs **DNS Zone Contributor** on the zone's resource group:

  ```bash
  az role assignment create --assignee <AZURE_CLIENT_ID> --role "DNS Zone Contributor" \
    --scope $(az group show -n moedim-rg --query id -o tsv)
  ```

- **Verification**: the postprovision hook runs `scripts/acs-verify-domain.sh`, which starts ACS verification (Domain, SPF, DKIM, DKIM2) for any type not yet Verified and prints the status. It never fails the deploy and skips when `az` is missing or not logged in. CI logs in with azd only, so CI skips it: start verification with a local `az login` and `azd provision`.

Rollout:

1. Provision with `USE_CUSTOM_EMAIL_DOMAIN` off: the records are written and verification starts, while mail keeps the managed sender.
2. Wait until all four types (Domain, SPF, DKIM, DKIM2) are Verified; the script prints the status on each provision.
3. Set `USE_CUSTOM_EMAIL_DOMAIN=true` (`azd env set USE_CUSTOM_EMAIL_DOMAIN true` locally, or the repository variable for CI) and provision again.

Turning the toggle on before verification completes makes the ACS update fail.

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
| `USE_CUSTOM_EMAIL_DOMAIN` (optional) | Provision workflow only: forwarded with `azd env set` when non-empty; `true` sends mail from the custom domain (see [Custom email domain](#custom-email-domain)) |

The workflow fails fast with an error if any required variable is empty (`USE_CUSTOM_EMAIL_DOMAIN` is optional). The identity needs a role assignment on the resource group. To write the custom email domain's DNS records it also needs the **DNS Zone Contributor** role on the DNS zone's resource group (`moedim-rg`); see [Custom email domain](#custom-email-domain).

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

### View azd Environment Values
```bash
azd env get-values
```

After provisioning, `azd` stores the Bicep outputs here, including `AZURE_RESOURCE_GROUP`, `STATIC_WEB_APP_NAME` and `STATIC_WEB_APP_URL` (the site URL).

### Manual Deploy (after code changes)
```bash
azd deploy
```

### Releasing a new version

The app version is the `version` in `package.json` plus the short git commit (`GITHUB_SHA`, else `git rev-parse --short HEAD`). Every build writes `version.json` at the site root, and `staticwebapp.config.json` serves `/version.json` with `Cache-Control: no-store`.

1. Bump `version` in `package.json`, then update the lockfile with `npm install --package-lock-only`.
2. Deploy as usual (`azd deploy` or a push to `master`).
3. Verify with `curl https://<host>/version.json` (it returns `version`, `commit` and `buildTime`).

Each deploy has a unique commit, so open tabs show the "New version available" reload prompt even without a semver bump. Tabs check on load, every 5 minutes and when they regain focus.

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
See [QUICKSTART.md](QUICKSTART.md) for where local values go. The variables the code reads are listed with a comment in [.env.example](.env.example): `VITE_OPENROUTE_API_KEY` for the SPA build, and the server-side settings `SQL_CONNECTION_STRING`, `SESSION_SECRET`, `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`, `APP_BASE_URL`, `INVITE_CODE`, `ADMIN_EMAILS` (optional) read by `api/src/shared/config.ts`. The optional `EIA_API_KEY` (free key from eia.gov/opendata; without it fuel costs use the national average) is also read there but is not yet listed in `.env.example`.

### azd environment (provisioning)
`AZURE_ENV_NAME`, `AZURE_LOCATION`, `AZURE_SQL_LOCATION` (optional), `APP_BASE_URL` (optional — set it to your custom domain, e.g. `https://trip.moedim.dev`; the API accepts sign-in and other changes only from this origin and uses it in reset links), `AZURE_SQL_ADMIN_PASSWORD`, `SESSION_SECRET`, `INVITE_CODE`, `ADMIN_EMAILS` (optional, see `infra/main.parameters.json`), `EIA_API_KEY` (optional; app setting added only when non-empty), and the custom email domain variables `CUSTOM_EMAIL_DOMAIN` (default `moedim.dev`), `USE_CUSTOM_EMAIL_DOMAIN` (default `false`), `EMAIL_DNS_ZONE_NAME` (default `moedim.dev`), `EMAIL_DNS_ZONE_RESOURCE_GROUP` (default `moedim-rg`).

### GitHub Actions
Repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_ENV_NAME`, `AZURE_LOCATION`, `AZURE_RESOURCE_GROUP`; optional variable `ADMIN_EMAILS` (used by the provision and deploy workflows; the deploy workflow reapplies it on every run, default `travel@kingdavidconsulting.com`); optional variable `USE_CUSTOM_EMAIL_DOMAIN` (provision workflow); optional secret `VITE_OPENROUTE_API_KEY`.

---

## Troubleshooting

### CI fails with "Repository variable ... is required and is empty"
Set the six required repository variables listed in Step 10 (for example with `azd pipeline config`).

### GitHub Actions: "azd auth login" Browser Authentication Error
CI must log in with the federated credential (the workflow passes `--federated-credential-provider github`). If you see an `xdg-open` / browser error, the federated credential step is not being used or the credential does not exist for this repo and branch.

### "azd: command not found" or "az: command not found"
Install the [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli).

### `/api/ping` returns HTML instead of JSON
The API was not deployed, or the deploy targeted the wrong SWA environment. `swa-cli.config.json` must have `env: production` and `apiLocation: api/scripts`; re-run `azd deploy`.

### First request after idle returns 500/503 or login times out
The serverless database auto-pauses and takes up to about a minute to resume. Retry. The API returns 503 with `Retry-After` for this case; migrations run during a resume may time out at login and succeed on retry (the deploy workflow retries the migration step up to 3 times, 30 s apart).

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
GitHub Actions: lint, tests, DB migrations, azd deploy (federated credential)
   |
   v
Azure Static Web App (eastus2): SPA from dist/ + managed Functions from api/scripts bundle
   |  /api/* (same origin)
   v
Azure SQL Database, serverless free offer (centralus)       Azure Communication Services (email)
```

## Files in This Project

### Configuration Files
- `azure.yaml` - Azure Developer CLI configuration (defines services and hooks)
- `.github/workflows/azure-dev.yml` - GitHub Actions workflow (DB migrations, then azd deploy with federated credential)
- `scripts/acs-verify-domain.sh` - azd postprovision step that starts ACS email domain verification and prints its status (never fails the deploy)
- `scripts/ci-db.sh` - CI database steps called by the deploy workflow: `migrate` (temporary firewall rule + `scripts/db-migrate.sh`), `set-admin-emails`, `cleanup`
- `swa-cli.config.json` - SWA CLI deploy settings used by `azd` (`env`, `apiLocation`, build commands)
- `staticwebapp.config.json` - SWA routing, headers, `platform.apiRuntime`
- `.github/workflows/azure-provision.yml` - Manual provision workflow (`azd provision` preview, applied on request)
- `.github/workflows/pr-checks.yml`, `.github/workflows/secret-scan.yml` - Pull request checks and the gitleaks secret scan
- `DEPLOYMENT.md` - This deployment guide

### Infrastructure as Code (Bicep)
- `infra/main.bicep` - Main infrastructure template (Static Web App, SQL, Communication Services, app settings)
- `infra/main.parameters.json` - Infrastructure parameters
- `infra/core/host/staticwebapp.bicep` - Azure Static Web App module
- `infra/core/host/staticwebapp-appsettings.bicep` - SWA app settings module
- `infra/core/database/sql-server.bicep` - SQL server, free-offer database, `AllowAzureServices` rule
- `infra/core/communication/communication-services.bicep` - Communication Services email (Azure-managed domain, optional custom domain and sender)
- `infra/core/communication/email-dns-records.bicep` - Apex TXT, DMARC and DKIM CNAME records in an existing Azure DNS zone for the custom email domain
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
