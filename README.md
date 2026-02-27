# RV Trip Planner

Plan RV routes, add stop dates, and see daily weather forecasts for each stop.

**Live Demo:** https://st3i2mi47qegi24.z20.web.core.windows.net/

## Features

- Manual stop list with arrival and departure dates
- Optional starting point that does not require dates
- **Free Open-Source Mapping:** Uses OpenStreetMap, MapLibre GL JS, and free routing APIs (no API keys required by default)
- **Resilient Routing:** Automatic fallback between multiple OSRM servers and OpenRouteService
- Daily weather forecasts per stop (NOAA + historical climate data)
- Fuel cost estimation based on vehicle MPG and gas prices
- Export/import trip data as JSON
- Google Drive sync for cloud backup (optional)
- Address autocomplete and validation via Photon/Nominatim
- Print/PDF export of trip itinerary

## Open-Source Stack

This application uses **free, open-source services** with no API keys required by default:

- **Maps:** [MapLibre GL JS](https://maplibre.org/) with [OpenStreetMap](https://www.openstreetmap.org/) tiles
- **Routing:** [OSRM](http://project-osrm.org/) demo servers with automatic fallback to German OSM routing server
- **Geocoding:** [Photon](https://photon.komoot.io/) (primary) and [Nominatim](https://nominatim.org/) (fallback)
- **Autocomplete:** [Photon](https://photon.komoot.io/)
- **Weather:** NOAA and Open-Meteo (free)
- **Caching:** All API responses are cached in browser localStorage with intelligent TTLs (5min for autocomplete, 7 days for geocoding, 24hr for routes)

### Optional Enhancements

For improved reliability, you can add:

- **OpenRouteService API Key** (free tier available): Adds a third routing fallback when OSRM servers are unreachable
  - Sign up at [openrouteservice.org](https://openrouteservice.org/dev/#/signup)
  - Add `VITE_OPENROUTE_API_KEY` to your `.env` file
  - Free tier: 2,000 requests/day

- **Google Drive Client ID** (optional): Enable cloud sync/backup of trips
  - Create OAuth 2.0 credentials in [Google Cloud Console](https://console.cloud.google.com/)
  - Add `VITE_GOOGLE_DRIVE_CLIENT_ID` to your `.env` file

## Routing Architecture

The app tries routing services in this order:

1. **OSRM Demo** (`router.project-osrm.org`) - Primary free routing
2. **OpenStreetMap Germany** (`routing.openstreetmap.de`) - Fallback OSRM instance
3. **OpenRouteService** - Final fallback (requires free API key)

If all routing services fail, the app continues to work - you just won't see distances or route lines on the map. Each route pair is tried independently, so partial failures don't break the entire trip.

### Rate Limiting & Batching

To be respectful to free public APIs, route requests are automatically batched:
- **Batch size:** 2 concurrent requests at a time
- **Delay between batches:** 500ms
- **Example:** A 10-stop trip calculates 9 routes in 5 batches over ~2.5 seconds

Geocoding (address → coordinates) runs sequentially in the background with built-in caching (7-day TTL), and autocomplete queries are debounced (250ms) with aggressive caching (5-minute TTL).

## Local Development Setup

1. Install dependencies
   ```bash
   npm install
   ```

2. (Optional) Create a `.env` file for enhanced features:
   ```bash
   # OpenRouteService (optional - for routing fallback)
   VITE_OPENROUTE_API_KEY=your_free_key_from_openrouteservice.org
   
   # Google Drive (optional - for cloud sync)
   VITE_GOOGLE_DRIVE_CLIENT_ID=your_oauth_client_id
   ```

3. Start the development server
   ```bash
   npm run dev
   ```

The app works immediately with no configuration - all mapping and routing services are free and require no API keys!

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

Optionally, add these GitHub secrets for enhanced features (both are optional):
- `VITE_GOOGLE_DRIVE_CLIENT_ID` - Enable Google Drive cloud sync
- `VITE_OPENROUTE_API_KEY` - Add third routing fallback

- **Enable Routes:** Route calculations are disabled by default. Click the "Calculate Routes" button in the map panel to enable mapping and distance calculations.
- **Weather Forecasts:** Weather is pulled for the exact date range you provide per stop (NOAA for near-term, climate data for historical/future).
- **Fuel Costs:** Estimated based on your vehicle's MPG (configurable in settings) and current gas prices.
- **Data Persistence:** Trip data is stored in browser localStorage. Use Google Drive sync or export to JSON for backup.

## Architecture

- **Frontend:** React 19 + TypeScript + Vite
- **Hosting:** Azure Static Web Apps
- **Mapping:** MapLibre GL JS + OpenStreetMap tiles (free)
- **Routing:** OSRM + OpenRouteService (free, with optional API key)
- **Geocoding:** Photon + Nominatim (free)
- **Weather:** NOAA + Open-Meteo (free)
- **State:** React Context + localStorage (no backend)
- **Cost Optimization:** Multi-server fallback, intelligent caching, request batching

## Notes

- **No API keys required by default** - the app works immediately out of the box
- Weather is pulled for the exact date range you provide per stop
- Route requests are batched and cached to respect free public APIs
- All data persists in browser localStorage - use Google Drive sync or JSON export for backup
