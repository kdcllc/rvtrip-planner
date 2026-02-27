# Deployment Guide - Trip Planner to Azure Static Web Apps

This guide walks you through deploying the Trip Planner application to Azure Static Web Apps using the Azure Developer CLI (`azd`).

## What is Azure Static Web Apps?

Azure Static Web Apps is a service that automatically builds and deploys full-stack web apps. It provides:
- ✅ Custom domain with free HTTPS certificate
- ✅ Global CDN included
- ✅ Automatic SPA routing support
- ✅ Free tier (100 GB bandwidth/month)
- ✅ Built-in CI/CD with GitHub Actions

## Deployment Approaches

This project supports two deployment approaches for GitHub Actions CI/CD:

### 🚀 Token-Based Deployment (Current Active Approach)

**Workflow:** `.github/workflows/azure-dev.yml`

**How it works:**
- Uses the `Azure/static-web-apps-deploy@v1` GitHub Action
- Authenticates with a deployment token from Azure Static Web Apps
- Directly uploads built files to Azure
- Simple setup with minimal configuration

**Advantages:**
- ✅ Simple and straightforward setup
- ✅ Fewer moving parts (no service principal needed)
- ✅ Works perfectly for static web apps
- ✅ Fast deployment process

**Required GitHub Secrets:**
- `AZURE_STATIC_WEB_APPS_TOKEN` - Deployment token from Azure

**Optional GitHub Secrets:**
- `VITE_GOOGLE_DRIVE_CLIENT_ID` - Enable Google Drive cloud sync
- `VITE_OPENROUTE_API_KEY` - Add third routing fallback

**Best for:** Most scenarios, especially when you only need to deploy a static web app.

### 🔧 OIDC-Based Deployment with Azure Developer CLI

**Workflow:** Previously used `azure-deploy.template.yml` (now removed)

**How it works:**
- Uses `azd` CLI with federated credentials (OIDC)
- Authenticates via service principal with OpenID Connect
- Runs `azd provision` and `azd deploy` commands
- More infrastructure control

**Advantages:**
- ✅ No long-lived secrets (uses federated credentials)
- ✅ More control over infrastructure provisioning
- ✅ Azure best practice for enterprise scenarios
- ✅ Can manage multiple Azure resources beyond static web apps

**Required GitHub Configuration:**
- Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- Variables: `AZURE_ENV_NAME`, `AZURE_LOCATION`
- Plus optional application secrets: `VITE_GOOGLE_DRIVE_CLIENT_ID`, `VITE_OPENROUTE_API_KEY`

**Best for:** Complex infrastructure, multiple Azure services, or enterprise security requirements.

**Note:** This approach is available in git history if needed. The token-based approach was chosen for simplicity.

## Prerequisites

1. **Azure Developer CLI** - [Install azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
2. **Azure Subscription** - You need an active Azure subscription
3. **Node.js and npm** - Already installed (required for building the app)
4. **(Optional)** OpenRouteService API key or Google Drive Client ID - See `.env.example` for details

## Phase 1: Initial Setup and Provisioning

### Step 1: Login to Azure

```bash
azd auth login
```

This will open a browser window for you to authenticate with your Azure account.

### Step 2: Initialize the Azure Environment

```bash
azd env new
```

You'll be prompted to enter:
- **Environment name**: Choose a name like `prod` or `dev` (this will be used in resource naming)
- **Azure subscription**: Select your subscription
- **Azure region**: Choose a region close to your users (e.g., `eastus`, `westus2`, `westeurope`)

### Step 3: Provision Azure Resources

```bash
azd provision
```

This command will:
- Create a resource group named `rg-{environmentName}`
- Create an Azure Static Web App with a unique name
- Configure the Static Web App for manual deployment

**Expected output:**
- Resource group name
- Static Web App name
- Static Web App URL (https://your-app.azurestaticapps.net)

### Step 4: Deploy the Application

```bash
azd deploy
```

This command will:
1. Run `npm install`
2. Run `npm run build`
3. Upload the `dist/` folder contents to Azure Static Web Apps

**Expected output:**
- Deployment status
- Static Web App URL where your app is live

### Step 5: Verify Deployment

Open the Static Web App URL in your browser. You should see the Trip Planner application running.

**Test checklist:**
- ✅ Application loads without errors
- ✅ Can add trip stops
- ✅ Google Maps displays correctly
- ✅ Weather data loads for stops
- ✅ Can save/load trip data

---

## Phase 2: Custom Domain with HTTPS

Azure Static Web Apps makes it easy to add a custom domain with automatic HTTPS.

### Step 6: Add Custom Domain

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

### Step 7: Configure DNS

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

### Step 8: Wait for SSL Certificate

After DNS propagation (5-15 minutes), Azure automatically provisions a free SSL certificate. This takes an additional 5-10 minutes.

You can check the status in Azure Portal under "Custom domains."

---

## Phase 3: GitHub Actions CI/CD Setup

After verifying manual deployment works, set up automated deployment from GitHub using the token-based approach.

### Step 9: Get Azure Static Web App Deployment Token

The GitHub Actions workflow needs a deployment token to authenticate with Azure Static Web Apps.

**Option A: Via Azure Portal (Recommended)**

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to your Static Web App resource
3. In the left menu, click **Overview**
4. Click **Manage deployment token** in the top toolbar
5. Copy the deployment token that appears

**Option B: Via Azure CLI**

```bash
# First, list your static web apps to find the name and resource group
az staticwebapp list --query "[].{name:name, resourceGroup:resourceGroup}" -o table

# Then get the deployment token
az staticwebapp secrets list \
  --name <your-static-web-app-name> \
  --resource-group <your-resource-group> \
  --query "properties.apiKey" -o tsv
```

**Note:** Keep this token secure - it provides deployment access to your Static Web App.

### Step 10: Configure GitHub Secrets

Add the required secrets to your GitHub repository.

**Steps:**

1. Go to your repository on GitHub: `https://github.com/kdcllc/trip-planner`
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Add the following secrets:

**Required Secrets:**

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `AZURE_STATIC_WEB_APPS_TOKEN` | Token from Step 9 | Deployment token for Azure Static Web Apps |

**Optional Secrets (for enhanced features):**

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `VITE_GOOGLE_DRIVE_CLIENT_ID` | OAuth 2.0 Client ID | Enable Google Drive cloud sync for trips |
| `VITE_OPENROUTE_API_KEY` | OpenRouteService API key | Add third routing fallback (free tier: 2,000 req/day) |

**Note:** The app works with **no API keys required by default**. These are optional enhancements only.

### Step 11: Verify Workflow Configuration

The workflow is already configured in `.github/workflows/azure-dev.yml`. Let's verify it's correct:

```yaml
# Key parts of the workflow:
name: Deploy to Azure Static Web Apps

on:
  push:
    branches:
      - master
  workflow_dispatch:

steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
  - run: npm ci
  - run: npm run build
  - uses: Azure/static-web-apps-deploy@v1
    with:
      azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_TOKEN }}
      app_location: '/'
      output_location: 'dist'
```

The workflow will automatically run when you push to the `master` branch.

### Step 12: Test Automated Deployment

Now test that the automated deployment works:

**Option A: Push a change (Recommended)**

```bash
# Make a small change (e.g., update README)
git add .
git commit -m "Test automated deployment"
git push origin master
```

**Option B: Manual workflow trigger**

1. Go to GitHub → **Actions** tab
2. Click **"Deploy to Azure Static Web Apps"** workflow
3. Click **"Run workflow"** button
4. Select `master` branch
5. Click **"Run workflow"**

**Verify Deployment:**

1. Go to GitHub → **Actions** tab
2. You should see the workflow running with your commit message
3. Watch the workflow steps:
   - ✅ Checkout
   - ✅ Install Node.js
   - ✅ Install dependencies
   - ✅ Build application
   - ✅ Deploy to Azure Static Web Apps
4. Once complete (green checkmark), visit your Static Web App URL
5. Verify the latest changes are deployed

**Troubleshooting:** If the deployment fails, check the "Troubleshooting" section below.

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
Set in `.env` file (all optional):
- `VITE_GOOGLE_DRIVE_CLIENT_ID` - Enable Google Drive cloud sync
- `VITE_OPENROUTE_API_KEY` - Add third routing fallback (free tier)

**Note:** The app works with no environment variables - these are optional enhancements only.

### GitHub Actions (Token-Based Approach)
Set as repository secrets:
- `AZURE_STATIC_WEB_APPS_TOKEN` - **Required** - Deployment token from Azure
- `VITE_GOOGLE_DRIVE_CLIENT_ID` - Optional - Enable Google Drive sync
- `VITE_OPENROUTE_API_KEY` - Optional - Add routing fallback

### GitHub Actions (OIDC Approach - Alternative)
**Note:** Not currently used. Available in git history if needed.

Would be automatically configured by `azd pipeline config`:
- `AZURE_CLIENT_ID` (secret)
- `AZURE_TENANT_ID` (secret)
- `AZURE_SUBSCRIPTION_ID` (secret)
- `AZURE_ENV_NAME` (variable)
- `AZURE_LOCATION` (variable)
- Plus optional: `VITE_GOOGLE_DRIVE_CLIENT_ID` (secret), `VITE_OPENROUTE_API_KEY` (secret)

---

## Troubleshooting

### GitHub Actions: "azd auth login" Browser Authentication Error

**Error Message:**
```
/usr/bin/xdg-open: 882: www-browser: not found
azd was unable to open the next url. Please try it manually: https://login.microsoftonline.com/...
```

**Cause:** This error occurs when the workflow attempts interactive browser authentication with `azd auth login` in a headless CI/CD environment (GitHub Actions runner).

**Solution:**

The active workflow (`.github/workflows/azure-dev.yml`) uses token-based authentication and should **not** encounter this error. If you're seeing this error:

1. **Verify correct workflow is running:**
   - Go to GitHub → Actions tab
   - Check which workflow file is executing
   - Should be: "Deploy to Azure Static Web Apps" from `azure-dev.yml`

2. **Ensure required secrets are configured:**
   - Go to GitHub → Settings → Secrets and variables → Actions
   - Verify `AZURE_STATIC_WEB_APPS_TOKEN` secret exists
   - Optional: Add `VITE_GOOGLE_DRIVE_CLIENT_ID` or `VITE_OPENROUTE_API_KEY` for enhanced features

3. **If you need the OIDC/azd approach:**
   - The OIDC-based workflow was removed for simplicity
   - Available in git history: `azure-deploy.template.yml`
   - Requires running `azd pipeline config` locally to set up federated credentials
   - Requires additional secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`

### Build Completes Successfully

**Note:** The app uses free, open-source mapping services by default - no API keys required!

Optional enhancements only:
1. Google Drive sync: Add `VITE_GOOGLE_DRIVE_CLIENT_ID` secret
2. Routing fallback: Add `VITE_OPENROUTE_API_KEY` secret

If builds fail, check the workflow logs for specific errors.

### Deployment Token Invalid or Expired

**Error:** "Authentication failed" or "Invalid token" during deployment.

**Solution:**
1. Deployment tokens don't expire, but can be regenerated
2. Get a fresh token from Azure Portal or CLI (see Step 9)
3. Update the `AZURE_STATIC_WEB_APPS_TOKEN` GitHub secret
4. Retry the deployment

### Workflow Doesn't Trigger Automatically

**Issue:** Pushing to master doesn't trigger the workflow.

**Solution:**
1. Check the workflow file exists: `.github/workflows/azure-dev.yml`
2. Verify the workflow is enabled: GitHub → Actions → Select workflow → Enable if disabled
3. Check branch name matches: workflow triggers on `master`, verify your default branch name
4. Look for workflow errors: GitHub → Actions → Check for failed runs

### Static Website Returns 404

**Note:** This project uses Azure Static Web Apps (not Azure Blob Storage static websites).

**Solution:**
1. Verify deployment completed successfully in GitHub Actions
2. Check Azure Portal → Static Web App → Overview for the correct URL
3. Ensure `output_location: 'dist'` matches your build output directory
4. Check SPA routing: Azure Static Web Apps automatically handles client-side routing

### Local "azd auth login" Works but GitHub Actions Fails

**Explanation:** Local `azd auth login` uses interactive browser authentication, which works on your machine but fails in GitHub Actions (headless environment).

**Solution:**
- For local development: `azd auth login` is correct (opens browser)
- For GitHub Actions: Use token-based authentication (already configured in `azure-dev.yml`)
- These are two different authentication methods for different environments

---

## Next Steps

- **Custom Domain**: Configure a custom domain for your static website
- **Azure CDN**: Add CDN for global distribution and caching
- **Multiple Environments**: Create separate `dev` and `prod` environments using `azd env new`
- **Monitoring**: Set up Application Insights for monitoring (requires additional Bicep changes)

---

## Architecture

### Current Token-Based Deployment

```
┌─────────────────────────────────────────────────┐
│  GitHub Repository (kdcllc/trip-planner)       │
│  ├── src/                                       │
│  ├── azure.yaml                                 │
│  ├── infra/                                     │
│  │   ├── main.bicep                             │
│  │   └── core/host/staticwebapp.bicep           │
│  └── .github/workflows/azure-dev.yml            │
└──────────────────┬──────────────────────────────┘
                   │
                   │ Push to master
                   ▼
┌─────────────────────────────────────────────────┐
│  GitHub Actions Workflow                        │
│  ├── Checkout code                              │
│  ├── Setup Node.js                              │
│  ├── Install dependencies (npm ci)              │
│  ├── Build application (npm run build)          │
│  └── Deploy to Azure (token auth)               │
└──────────────────┬──────────────────────────────┘
                   │
                   │ Token Authentication
                   │ (AZURE_STATIC_WEB_APPS_TOKEN)
                   ▼
┌─────────────────────────────────────────────────┐
│  Azure Static Web Apps                          │
│  ├── CDN + Global Distribution                  │
│  ├── Automatic HTTPS                            │
│  ├── Custom Domain Support                      │
│  ├── SPA Routing (automatic)                    │
│  └── Deployed Files:                            │
│      ├── index.html                             │
│      ├── assets/*.js (React + Vite)             │
│      ├── assets/*.css                           │
│      └── assets/* (images, fonts)               │
└─────────────────────────────────────────────────┘
        │
        │ Public Internet
        ▼
    https://your-app.azurestaticapps.net
    (or your custom domain)
```

## Files in This Project

### Configuration Files
- `azure.yaml` - Azure Developer CLI configuration (defines services and hooks)
- `.github/workflows/azure-dev.yml` - **Active** GitHub Actions workflow (token-based deployment)
- `DEPLOYMENT.md` - This deployment guide

### Infrastructure as Code (Bicep)
- `infra/main.bicep` - Main infrastructure template (provisions Azure Static Web App)
- `infra/main.parameters.json` - Infrastructure parameters
- `infra/core/host/staticwebapp.bicep` - Azure Static Web App module
- `infra/core/storage/storage-account.bicep` - Storage account module (alternative deployment)

### Build Configuration
- `vite.config.ts` - Vite build configuration
- `package.json` - Node.js dependencies and build scripts
- `tsconfig.json` - TypeScript configuration

### Removed Files
- `.github/workflows/azure-deploy.template.yml` - ❌ Removed (OIDC-based template, available in git history if needed)

## Resources

- [Azure Developer CLI Documentation](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
- [Azure Blob Storage Static Websites](https://learn.microsoft.com/azure/storage/blobs/storage-blob-static-website)
- [Bicep Documentation](https://learn.microsoft.com/azure/azure-resource-manager/bicep/)
- [GitHub Actions with Azure](https://learn.microsoft.com/azure/developer/github/connect-from-azure)
