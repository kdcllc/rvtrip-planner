# RV Trip Planner

Plan RV routes, add stop dates, and see daily weather forecasts for each stop.

**Live Demo:** https://st3i2mi47qegi24.z20.web.core.windows.net/

## Features

- Manual stop list with arrival and departure dates
- Optional starting point that does not require dates
- Google Maps route with numbered markers
- **Cost-optimized routing:** Routes are calculated only when explicitly requested by user (prevents bot/automated API costs)
- Daily weather forecasts per stop (NOAA + historical climate data)
- Fuel cost estimation based on vehicle MPG and gas prices
- Export/import trip data as JSON
- Google Drive sync for cloud backup
- Address autocomplete and validation
- Print/PDF export of trip itinerary

## Cost Optimization

To reduce Google Maps API costs, this application implements several protections:

1. **User-Gated Routes:** Map loading and route calculations are **disabled by default**. Users must explicitly click "Calculate Routes" in the map panel to enable them. This prevents:
   - Bots from triggering billable API calls
   - Automatic route calculations on every page load
   - Unnecessary API usage for users who only want to manage stops

2. **Route Caching:** Routes are cached in memory to avoid duplicate API calls between map rendering and distance calculations

3. **Bot Deterrence:** `robots.txt` blocks well-behaved crawlers (additional protection requires API key restrictions)

### Recommended API Key Security

Protect your Google API keys in the [Google Cloud Console](https://console.cloud.google.com/):

1. **HTTP Referrer Restrictions:**
   - Add your domain(s): `https://yourdomain.azurestaticapps.net/*`
   - Add localhost for dev: `http://localhost:*`

2. **API Restrictions:**
   - Only enable required APIs:
     - Maps JavaScript API
     - Places API
     - Routes API
     - Geocoding API (if used)

3. **Quotas & Budgets:**
   - Set daily/monthly quotas for each API
   - Configure billing alerts

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
   - Routes API
   - Geocoding API (optional, for address lookups)
3. (Recommended) Create a Map ID in Google Cloud Maps Platform for Advanced Markers
4. Create an API key
5. **IMPORTANT:** Restrict the key for security and cost control:
   - Add HTTP referrer restrictions (your domain + localhost)
   - Restrict to only the APIs listed above
   - Set daily quotas and budget alerts
6. Copy the key into your `.env` file as `VITE_GOOGLE_MAPS_API_KEY`

> **Note:** Without proper API key restrictions, your key could be used by bots or unauthorized sites, leading to unexpected costs.

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

- **Enable Routes:** Route calculations are disabled by default. Click the "Calculate Routes" button in the map panel to enable mapping and distance calculations.
- **Weather Forecasts:** Weather is pulled for the exact date range you provide per stop (NOAA for near-term, climate data for historical/future).
- **Fuel Costs:** Estimated based on your vehicle's MPG (configurable in settings) and current gas prices.
- **Data Persistence:** Trip data is stored in browser localStorage. Use Google Drive sync or export to JSON for backup.

## Architecture

- **Frontend:** React 19 + TypeScript + Vite
- **Hosting:** Azure Static Web Apps
- **APIs:** Google Maps (JS, Places, Routes), NOAA Weather, Open-Meteo Climate
- **State:** React Context + localStorage (no backend)
- **Cost Optimization:** User-gated routing, in-memory caching, bot deterrence

## Notes

- Weather is pulled for the exact date range you provide per stop.
- If the Google Maps key is missing, the map panel will show a warning.
