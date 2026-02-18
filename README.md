# RV Trip Planner

Plan RV routes, add stop dates, and see daily weather forecasts for each stop.

**Live Demo:** https://st3i2mi47qegi24.z20.web.core.windows.net/

## Features

- Manual stop list with arrival and departure dates
- Optional starting point that does not require dates
- Google Maps route with numbered markers
- Daily weather forecasts per stop (NOAA + historical climate data)
- Export/import trip data as JSON
- Address autocomplete and validation

## Local Development Setup

1. Install dependencies
   ```bash
   npm install
   ```

2. Create a `.env` file based on `.env.example` and add your Google Maps API key
   ```bash
   VITE_GOOGLE_MAPS_API_KEY=your_key_here
   VITE_GOOGLE_MAPS_MAP_ID=your_map_id  # Optional for Advanced Markers
   ```

3. Start the development server
   ```bash
   npm run dev
   ```

## Getting a Google Maps API key

1. Sign in to the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project
2. Enable the following APIs:
   - Maps JavaScript API
   - Places API
   - Address Validation API
   - Routes API
3. (Recommended) Create a Map ID in Google Cloud Maps Platform for Advanced Markers
4. Create an API key
5. (Recommended) Restrict the key to your domain or development origin
6. Copy the key into your `.env` file as `VITE_GOOGLE_MAPS_API_KEY`

## Deployment to Azure

This application is deployed to Azure Static Web Apps using Azure Developer CLI (`azd`).

### Prerequisites

- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- Azure subscription

### Quick Deploy

```bash
# Login to Azure
azd auth login

# Deploy (provision + deploy in one command)
azd up
```

### Step-by-Step Deploy

```bash
# Create environment
azd env new prod

# Provision Azure resources
azd provision

# Deploy application
azd deploy
```

### Update Deployment

After making code changes:

```bash
azd deploy
```

### Resources Created

- **Resource Group:** `rg-{environmentName}`
- **Azure Static Web App:** Unique name (e.g., `stapp-abc123def456`)
- **Location:** East US 2 (or your chosen region)
- **Default URL:** `https://{name}.azurestaticapps.net`
- **Custom Domain:** Supports HTTPS with managed certificates (see DEPLOYMENT.md)

### GitHub Actions CI/CD

To set up automated deployment from GitHub:

```bash
# Configure GitHub integration
azd pipeline config
```

Then add `VITE_GOOGLE_MAPS_API_KEY` as a GitHub repository secret.

For detailed deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md) or [QUICKSTART.md](QUICKSTART.md).
## Features

- Manual stop list with arrival and departure dates
- Optional starting point that does not require dates
- Google Maps route with numbered markers
- Open-Meteo daily forecasts per stop

## Notes

- Weather is pulled for the exact date range you provide per stop.
- If the Google Maps key is missing, the map panel will show a warning.
