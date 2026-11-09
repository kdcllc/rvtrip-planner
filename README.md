# RV Trip Planner

Plan RV routes, add stop dates, and see daily weather forecasts for each stop.

**Live Demo:** https://red-rock-016ee8c0f.4.azurestaticapps.net (sign-in required; signed-out visitors see a landing page where you can request an invite; registration needs an invite code)

## Features

- Manual stop list with arrival and departure dates
- Optional starting point that does not require dates
- **Free Open-Source Mapping:** Uses OpenStreetMap, MapLibre GL JS, and free routing APIs (no API keys required by default)
- **Resilient Routing:** Automatic fallback between multiple OSRM servers and OpenRouteService
- Daily weather forecasts per stop (NOAA + historical climate data)
- Fuel cost estimation based on vehicle MPG and gas prices
- Multi-user accounts: register (shared invite code or a single-use invite code, emailed or sent as a link by an admin), log in, log out, and password reset by email
- Trips are stored per user on the server (Azure SQL) via `/api/trips`
- Each trip is saved separately; saves retry automatically while the serverless database wakes, with a "Retry now" banner and a prompt to keep your version or load the saved one on a conflict
- Sync button in the header (next to Sign out): flushes pending edits, then reloads your trips from the server and shows "Synced at HH:MM". The server copy wins; trips whose unsaved local edits were replaced are named in a notice. The app also syncs automatically when the tab regains focus or becomes visible, only if nothing is unsaved and at least 30 seconds have passed since the last sync (no polling)
- Import a single trip or a full backup as JSON (trips whose ids already exist are skipped); "Download all trips" backup and a per-trip Download button
- Trips from older browser storage are imported into your account on sign-in
- Landing page for signed-out visitors with Sign up, Log in and Request an invite; admins review requests under "Access requests" and can send, resend or decline invites, or invite any email address directly with the Email/Name form at the top of the panel (Invite button); after inviting, sending or resending, the panel shows the invite link once to copy
- Address autocomplete and validation via Photon/Nominatim
- Print/PDF export of trip itinerary

## Open-Source Stack

This application uses **free, open-source services** with no API keys required by default:

- **Maps:** [MapLibre GL JS](https://maplibre.org/) with [OpenStreetMap](https://www.openstreetmap.org/) tiles
- **Routing:** [OSRM](http://project-osrm.org/) demo servers with automatic fallback to German OSM routing server
- **Geocoding:** [Photon](https://photon.komoot.io/) (primary) and [Nominatim](https://nominatim.org/) (fallback)
- **Autocomplete:** [Photon](https://photon.komoot.io/)
- **Weather:** NOAA and Open-Meteo (free)
- **Caching:** Routing, geocoding and autocomplete responses are cached in browser localStorage with intelligent TTLs (5min for autocomplete, 7 days for geocoding, 24hr for routes)

### Optional Enhancements

For improved reliability, you can add:

- **OpenRouteService API Key** (free tier available): Adds a third routing fallback when OSRM servers are unreachable
  - Sign up at [openrouteservice.org](https://openrouteservice.org/dev/#/signup)
  - Add `VITE_OPENROUTE_API_KEY` to your `.env` file
  - Free tier: 2,000 requests/day

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
   
   ```

3. Start the development server
   ```bash
   npm run dev
   ```

Mapping and routing services are free and need no API keys. Sign-in, registration and trip storage need the API and a database, so for the full app run it locally against a Docker SQL Server:

```bash
npm install                      # root dependencies
(cd api && npm install)          # API dependencies
npm run db:up                    # start local SQL Server (docker compose)
export SQL_CONNECTION_STRING='...'   # see db/README.md
npm run db:migrate               # apply db/migrations/*.sql
npm run dev:swa                  # SWA CLI: Vite dev server + /api functions
```

The server-side settings (`SQL_CONNECTION_STRING`, `SESSION_SECRET`, `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`, `APP_BASE_URL`, `INVITE_CODE`, `ADMIN_EMAILS`) are listed by name in `.env.example`; for local runs put them in `api/local.settings.json` (git-ignored) or your shell. See [db/README.md](db/README.md) for the local database.

## Deployment to Azure

This application (SPA plus the managed Azure Functions API in `api/`) is deployed to Azure Static Web Apps using Azure Developer CLI (`azd`). Deploys go through `azd` only. See [DEPLOYMENT.md](DEPLOYMENT.md) for details.

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
- **Azure Static Web App:** Unique name (e.g., `stapp-abc123def456`) in `AZURE_LOCATION` (East US 2 for the live deployment)
- **Azure SQL server and database** (free offer, serverless, auto-pause) in `AZURE_SQL_LOCATION`, default `centralus`
- **Azure Communication Services** with an Azure-managed email domain (password-reset, invite and access-request mail), plus an optional custom sender domain (`rvtrip@moedim.dev`) enabled by `USE_CUSTOM_EMAIL_DOMAIN` after DNS verification; see [DEPLOYMENT.md](DEPLOYMENT.md#custom-email-domain)
- **App settings** on the Static Web App (applied by Bicep): `SQL_CONNECTION_STRING`, `SESSION_SECRET`, `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`, `APP_BASE_URL`, `INVITE_CODE`, `ADMIN_EMAILS`
- **Default URL:** `https://{name}.azurestaticapps.net`
- **Custom Domain:** Supports HTTPS with managed certificates (see DEPLOYMENT.md)

### GitHub Actions CI/CD

`.github/workflows/azure-dev.yml` runs on push to `master`: lint, tests (root and `api/`), then, using a federated credential, applies database migrations (`scripts/db-migrate.sh`, opening a temporary SQL firewall rule for the runner and removing it afterwards), sets the `ADMIN_EMAILS` app setting from the optional repository variable `ADMIN_EMAILS` (default `travel@kingdavidconsulting.com`) when it differs, and runs `azd deploy`. A migration failure skips the deploy. It needs these repository variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_ENV_NAME`, `AZURE_LOCATION`, `AZURE_RESOURCE_GROUP`. `azd pipeline config` can create them. Optionally add the `VITE_OPENROUTE_API_KEY` secret for the third routing fallback. See [DEPLOYMENT.md](DEPLOYMENT.md).

- **Enable Routes:** Route calculations are disabled by default. Click the "Calculate Routes" button in the map panel to enable mapping and distance calculations.
- **Weather Forecasts:** Weather is pulled for the exact date range you provide per stop (NOAA for near-term, climate data for historical/future).
- **Fuel Costs:** Estimated based on your vehicle's MPG (configurable in settings) and current gas prices.
- **Data Persistence:** Each trip is saved to your account on the server as its own row. Saves retry automatically while the serverless database wakes, and the browser warns before you close the tab with unsaved changes. Use "Download all trips" for a backup.

## Architecture

- **Frontend:** React 19 + TypeScript + Vite
- **Hosting:** Azure Static Web Apps (SPA) with built-in managed Azure Functions (`api/`)
- **Backend:** Azure Functions (Node 22) with cookie-session, invite-code-gated registration (the shared `INVITE_CODE` or a single-use invite code, emailed or sent as a link by an admin), and Azure Communication Services email (password reset, invites, access-request notifications)
- **Database:** Azure SQL Database (serverless, free offer); schema in `db/migrations/`
- **Mapping:** MapLibre GL JS + OpenStreetMap tiles (free)
- **Routing:** OSRM + OpenRouteService (free, with optional API key)
- **Geocoding:** Photon + Nominatim (free)
- **Weather:** NOAA + Open-Meteo (free)
- **State:** React Context; trips load and save per trip through `/api/trips` (`src/services/storage/tripStorage.ts`); routing/geocoding caches use localStorage
- **Cost Optimization:** Multi-server fallback, intelligent caching, request batching

## Notes

- **No third-party API keys required by default** for mapping, routing, geocoding and weather
- Weather is pulled for the exact date range you provide per stop
- Route requests are batched and cached to respect free public APIs
- Trip data persists server-side per account (one row per trip) - use "Download all trips" or a per-trip download for backup
