# Quick Start Guide - Azure Static Web Apps Deployment

## Prerequisites Check

Before starting, ensure you have:
- [ ] Azure CLI installed (`az --version`)
- [ ] Azure Developer CLI installed (`azd version`)
- [ ] Node.js and npm installed (`node --version`)
- [ ] Azure subscription access
- [ ] Google Maps API key configured in `.env` file

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
- Prompt for Azure region (e.g., "eastus")
- Create Azure Static Web App
- Build the application
- Deploy to Azure

**Expected time:** 2-3 minutes

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
Install Azure Developer CLI: https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd

### "az: command not found"
The deployment script needs Azure CLI. Install it: https://learn.microsoft.com/cli/azure/install-azure-cli

### Build Fails
Check that `.env` file exists with your Google Maps API key:
```bash
cat .env | grep VITE_GOOGLE_MAPS_API_KEY
```

### Deployment Script Permission Denied
```bash
chmod +x ./scripts/deploy.sh
```

---

## Next: Setup CI/CD

After manual deployment works, set up GitHub Actions:

1. Run `azd pipeline config`
2. Follow prompts to connect GitHub repository
3. Add `VITE_GOOGLE_MAPS_API_KEY` as GitHub secret
4. Push code to trigger automated deployment

Full instructions in [DEPLOYMENT.md](DEPLOYMENT.md)

---

## File Structure

```
trip-planner/
├── azure.yaml                 # azd configuration
├── infra/                     # Bicep infrastructure templates
│   ├── main.bicep
│   ├── main.parameters.json
│   └── core/storage/storage-account.bicep
├── scripts/
│   └── deploy.sh             # Deployment script
├── .azure/                    # azd environment config (git-ignored)
├── dist/                      # Build output (git-ignored)
└── src/                       # Application source
```

---

## Useful Links

- [Azure Developer CLI Docs](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
- [Azure Blob Storage Static Websites](https://learn.microsoft.com/azure/storage/blobs/storage-blob-static-website)
- [Full Deployment Guide](DEPLOYMENT.md)
