# Quick Start Guide - Azure Static Web Apps Deployment

## Prerequisites Check

Before starting, ensure you have:

- [ ] Azure CLI installed (`az --version`)
- [ ] Azure Developer CLI installed (`azd version`)
- [ ] Node.js and npm installed (`node --version`)
- [ ] Azure subscription access
- [ ] Environment secrets set in the azd environment: `AZURE_SQL_ADMIN_PASSWORD`, `SESSION_SECRET`, `INVITE_CODE` (see `infra/main.parameters.json`; never commit values)

## Quick Start Commands

### 1. Login to Azure

```bash
azd auth login
```

### 2. One-Command Setup and Deploy

```bash
azd up
```

This single command will:

- Prompt for environment name (e.g., "prod")
- Prompt for Azure region (e.g., "eastus2")
- Create the Azure Static Web App, Azure SQL server and database (`AZURE_SQL_LOCATION`, default `centralus`), and Azure Communication Services email
- Apply the app settings (`SQL_CONNECTION_STRING`, `SESSION_SECRET`, `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`, `APP_BASE_URL`, `INVITE_CODE`) to the Static Web App
- Build the SPA and the bundled API (`swa-cli.config.json`: `env: production`, `apiLocation: api/scripts`)
- Deploy to Azure

After the first provision, apply the database schema once with `scripts/db-migrate.sh` (see `db/README.md`) using a connection string with DDL rights. `azd` does not run it.

**Expected time:** a few minutes (a deploy alone took about 1 minute in the recorded run)

### 3. Get Your Website URL

After deployment completes, look for output like:

```
🌐 URL: https://your-app.azurestaticapps.net/
```

Visit that URL to see your deployed Trip Planner!

---

## Alternative: Step-by-Step Deployment

If you prefer more control:

### Step 1: Create Environment

```bash
azd env new prod
```

### Step 2: Provision Infrastructure

```bash
azd provision
```

### Step 3: Deploy Application

```bash
azd deploy
```

---

## After Initial Deployment

### Update After Code Changes

```bash
# Build and deploy
azd deploy

# Or do both provision + deploy
azd up
```

### View Deployed Resources

```bash
azd show
```

### View Environment Variables

```bash
azd env get-values
```

### Clean Up (Delete All Resources)

```bash
azd down
```

---

## Adding Custom Domain with HTTPS

Azure Static Web Apps makes custom domains easy with free SSL:

### Step 1: Add Domain in Azure Portal

1. Navigate to your Static Web App in Azure Portal
2. Click "Custom domains"
3. Click "+ Add"
4. Enter your domain (e.g., `www.yourdomain.com`)

### Step 2: Configure DNS

Add CNAME record at your DNS provider:

```
Type: CNAME
Name: www
Value: your-app.azurestaticapps.net
TTL: 3600
```

### Step 3: Wait for SSL

Azure automatically provisions a free SSL certificate (5-10 minutes).

**Alternative: Using Azure CLI**

```bash
az staticwebapp hostname set \
  --name <static-web-app-name> \
  --resource-group rg-trip-planner \
  --hostname www.yourdomain.com
```

---

## Environment Variables

The deployment reads these outputs from Azure:

- `AZURE_RESOURCE_GROUP` - Resource group name
- `STATIC_WEB_APP_NAME` - Static Web App name
- `STATIC_WEB_APP_URL` - Website URL

These are automatically set by `azd` after provisioning.

---

## Troubleshooting

### "azd: command not found"

Install Azure Developer CLI: <https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd>

### "az: command not found"

Azure CLI is useful for checks such as `az staticwebapp` and `az sql`. Install it: <https://learn.microsoft.com/cli/azure/install-azure-cli>

### `/api/ping` returns 500 or 503 right after a long idle period

The serverless database auto-pauses when idle and takes up to about a minute to resume. Retry after a short wait.

### Build Succeeds

The app uses free, open-source mapping services by default - no API keys required!

Optional enhancements can be added via `.env` file:

```bash
cat .env.example  # See available optional keys
```

---

## Next: Setup CI/CD

After manual deployment works, set up GitHub Actions:

1. Run `azd pipeline config`
2. Follow prompts to connect GitHub repository
3. Confirm the repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_ENV_NAME`, `AZURE_LOCATION`, `AZURE_RESOURCE_GROUP` are set
4. (Optional) Add `VITE_OPENROUTE_API_KEY` as a GitHub secret for the routing fallback
5. Push code to trigger automated deployment

Full instructions in [DEPLOYMENT.md](DEPLOYMENT.md)

---

## File Structure

```
trip-planner/
├── azure.yaml                 # azd configuration
├── infra/                     # Bicep infrastructure templates
│   ├── main.bicep
│   ├── main.parameters.json
│   └── core/                  # communication, database, host, storage modules
├── api/                       # Azure Functions API (bundled by api/scripts/build-deploy.mjs)
├── db/                        # SQL migrations and local DB notes
├── scripts/
│   ├── db-migrate.sh         # Apply db/migrations to a database
│   └── preflight-azure.sh    # Azure preflight checks (docs/AZURE-PREFLIGHT.md)
├── swa-cli.config.json        # SWA CLI deploy settings used by azd
├── .azure/                    # azd environment config (git-ignored)
├── dist/                      # Build output (git-ignored)
└── src/                       # Application source
```

---

## Useful Links

- [Azure Developer CLI Docs](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
- [Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/)
- [Full Deployment Guide](DEPLOYMENT.md)
