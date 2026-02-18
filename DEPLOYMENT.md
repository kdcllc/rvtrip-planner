# Deployment Guide - Trip Planner to Azure Static Web Apps

This guide walks you through deploying the Trip Planner application to Azure Static Web Apps using the Azure Developer CLI (`azd`).

## What is Azure Static Web Apps?

Azure Static Web Apps is a service that automatically builds and deploys full-stack web apps. It provides:
- ✅ Custom domain with free HTTPS certificate
- ✅ Global CDN included
- ✅ Automatic SPA routing support
- ✅ Free tier (100 GB bandwidth/month)
- ✅ Built-in CI/CD with GitHub Actions

## Prerequisites

1. **Azure Developer CLI** - [Install azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
2. **Azure Subscription** - You need an active Azure subscription
3. **Node.js and npm** - Already installed (required for building the app)
4. **Google Maps API Key** - Already configured in `.env` file

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

After verifying manual deployment works, set up automated deployment from GitHub.

### Step 9: Configure GitHub Pipeline

```bash
azd pipeline config
```

This command will:
1. Create a service principal with federated credentials (OIDC authentication)
2. Generate `.github/workflows/azure-dev.yml` workflow file
3. Automatically configure GitHub secrets:
   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`
   - `AZURE_ENV_NAME`
   - `AZURE_LOCATION`

You'll be prompted for:
- GitHub repository URL (format: `owner/repo`)
- Branch name (use `master`)

### Step 10: Add Google Maps API Key as GitHub Secret

The automated workflow needs your Google Maps API key to build the app.

**Via GitHub web interface:**
1. Go to your repository on GitHub
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `VITE_GOOGLE_MAPS_API_KEY`
5. Value: Your Google Maps API key (from `.env` file)
6. Click "Add secret"

**Optional:** If you're using a Map ID, also add `VITE_GOOGLE_MAPS_MAP_ID`.

### Step 11: Test Automated Deployment

Commit and push changes to trigger deployment:

```bash
git add .
git commit -m "Update deployment configuration"
git push origin master
```

**Verify:**
1. Go to GitHub → Actions tab
2. You should see the workflow running
3. Check that it completes successfully
4. Visit your Static Web App URL to verify the latest changes deployed

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
Set in `.env` file:
- `VITE_GOOGLE_MAPS_API_KEY` - Your Google Maps API key
- `VITE_GOOGLE_MAPS_MAP_ID` - (Optional) Google Maps Map ID

### GitHub Actions
Set as repository secrets:
- `VITE_GOOGLE_MAPS_API_KEY` - Required for build
- `VITE_GOOGLE_MAPS_MAP_ID` - Optional

Automatically configured by `azd pipeline config`:
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_ENV_NAME` (variable)
- `AZURE_LOCATION` (variable)

---

## Troubleshooting

### Build Fails with "Missing API Key"
Ensure `VITE_GOOGLE_MAPS_API_KEY` is set in GitHub secrets and exported in the workflow.

### Static Website Returns 404
Check that static website hosting is enabled:
```bash
az storage blob service-properties show \
  --account-name <storage-account-name> \
  --query staticWebsite
```

### Deployment Script Fails
The deployment script needs proper permissions. Check that the managed identity has the "Storage Blob Data Contributor" role on the storage account.

### CORS Issues
Azure Blob Storage static websites don't support CORS configuration directly. If you need CORS for API calls from your app, consider using Azure CDN or Azure Static Web Apps instead.

---

## Next Steps

- **Custom Domain**: Configure a custom domain for your static website
- **Azure CDN**: Add CDN for global distribution and caching
- **Multiple Environments**: Create separate `dev` and `prod` environments using `azd env new`
- **Monitoring**: Set up Application Insights for monitoring (requires additional Bicep changes)

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  GitHub Repository (kdcllc/trip-planner)       │
│  ├── src/                                       │
│  ├── azure.yaml                                 │
│  ├── infra/                                     │
│  │   ├── main.bicep                             │
│  │   └── core/storage/storage-account.bicep     │
│  └── .github/workflows/azure-dev.yml            │
└──────────────────┬──────────────────────────────┘
                   │
                   │ Push to master
                   ▼
┌─────────────────────────────────────────────────┐
│  GitHub Actions Workflow                        │
│  ├── Build (npm run build)                      │
│  └── Deploy (azd deploy)                        │
└──────────────────┬──────────────────────────────┘
                   │
                   │ OIDC Authentication
                   ▼
┌─────────────────────────────────────────────────┐
│  Azure Storage Account                          │
│  ├── Static Website Hosting Enabled             │
│  ├── $web Container (public read)               │
│  │   ├── index.html                             │
│  │   ├── assets/*.js                            │
│  │   └── assets/*.css                           │
│  └── Primary Web Endpoint (https://...)         │
└─────────────────────────────────────────────────┘
```

## Files Created

- `azure.yaml` - Azure Developer CLI configuration
- `infra/main.bicep` - Main infrastructure template
- `infra/main.parameters.json` - Infrastructure parameters
- `infra/core/storage/storage-account.bicep` - Storage account module
- `.github/workflows/azure-dev.yml` - GitHub Actions workflow (generated by azd)
- `DEPLOYMENT.md` - This file

## Resources

- [Azure Developer CLI Documentation](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
- [Azure Blob Storage Static Websites](https://learn.microsoft.com/azure/storage/blobs/storage-blob-static-website)
- [Bicep Documentation](https://learn.microsoft.com/azure/azure-resource-manager/bicep/)
- [GitHub Actions with Azure](https://learn.microsoft.com/azure/developer/github/connect-from-azure)
