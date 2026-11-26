# RV Trip Planner

Plan RV routes, add stop dates, and see daily weather forecasts for each stop.

**Live Demo:** https://trip.moedim.dev (sign-in required; signed-out visitors see a landing page where you can request an invite; registration needs an invite code)

## Features

- Manual stop list: only an address is required; arrival and departure dates are optional for every stop, including the starting point, and the title is filled from the address when left blank
- Stop drawer: address, title, starting point and dates come first; a collapsible `Stay` section holds campground source, site type, check-in/out, nightly cost and reservation details (confirmation number, site number and contact phone show only when the status is Reserved); one `Notes` field (up to 2000 characters); `Travel & costs` appears when editing a stop. Older trips and export files with separate fees, amenities and reservation-note fields load with that text merged into Notes
- **Free Open-Source Mapping:** Uses OpenStreetMap, MapLibre GL JS, and free routing APIs (no API keys required by default)
- **Resilient Routing:** Automatic fallback between multiple OSRM servers and OpenRouteService
- Daily weather forecasts per stop (NOAA + historical climate data); stops without dates show "Dates not set" and get no forecast, timeline position or calendar event
- Fuel cost estimation based on vehicle MPG and gas prices
- Multi-user accounts: register (shared invite code or a single-use invite code, emailed or sent as a link by an admin), log in, log out, and password reset by email
- Trips are stored per user on the server (Azure SQL) via `/api/trips`
- Each trip is saved separately; saves retry automatically while the serverless database wakes, with a "Retry now" banner and a prompt to keep your version or load the saved one on a conflict
- Sync button in the header (next to Sign out): flushes pending edits, then reloads your trips from the server and shows "Synced at HH:MM". The server copy wins; trips whose unsaved local edits were replaced are named in a notice. The app also syncs automatically when the tab regains focus or becomes visible, only if nothing is unsaved and at least 30 seconds have passed since the last sync (no polling)
- Import a single trip or a full backup as JSON (trips whose ids already exist are skipped); "Download all trips" backup and a per-trip Download button
- Trips from older browser storage are imported into your account on sign-in
- Landing page for signed-out visitors with Sign up, Log in and Request an invite; admins review requests under "Access requests" and can send, resend or decline invites, or invite any email address directly with the Email/Name form at the top of the panel (Invite button); after inviting, sending or resending, the panel shows the invite link once to copy; an Email delivery section sends a test email to your own address to check delivery
- Address autocomplete and validation via Photon/Nominatim
- Print/PDF export of trip itinerary
- Version label `v<version> (<commit>)` on the landing page footer and in the signed-in app; open tabs check for a newer deploy on load, every 5 minutes and when the tab regains focus, and show a "New version available" banner with a Reload button (no forced reload)

## Open-Source Stack

This application uses **free, open-source services** with no API keys required by default:

- **Maps:** [MapLibre GL JS](https://maplibre.org/) with [OpenStreetMap](https://www.openstreetmap.org/) tiles
- **Routing:** [OSRM](http://project-osrm.org/) demo servers with automatic fallback to German OSM routing server
- **Geocoding:** [Photon](https://photon.komoot.io/) (primary) and [Nominatim](https://nominatim.org/) (fallback)
- **Autocomplete:** [Photon](https://photon.komoot.io/)
- **Weather:** NOAA and Open-Meteo (free)
- **Caching:** Routing, geocoding and autocomplete responses are cached in browser localStorage with intelligent TTLs (5min for autocomplete, 7 days for geocoding, 24hr for routes); they are cleared once when a new app version first loads (trips, vehicle settings and theme are kept)
- **Fonts:** Fraunces and Nunito Sans are self-hosted through `@fontsource-variable/*` packages (no Google Fonts requests)

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

## Prerequisites

- Node.js 22 and npm. `api/package.json` sets `engines.node` to `>=22 <23`, the runtime of the deployed API.
- Docker with Docker Compose, `sqlcmd` and Bash, for the local database (full app only).
- For deployment: an Azure subscription and the [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd).

## Run locally

To look at the frontend alone:

```bash
npm install
npm run dev
```

This serves the SPA at `http://localhost:5173`. Mapping, routing, geocoding and weather need no API keys, but sign-in, registration and trip storage need the API and a database, so on this port you only get the signed-out landing page.

For the full app (SPA, API and a local SQL Server in Docker), follow [QUICKSTART.md](QUICKSTART.md). The environment variables are listed with a comment each in [.env.example](.env.example).

## npm scripts

Root `package.json`:

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (SPA only) |
| `npm run dev:swa` | SWA CLI: Vite dev server plus the `api/` functions on one origin |
| `npm run build` | Type check (`tsc -b`) and production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm test` | SPA tests (Vitest) |
| `npm run db:up` | Start the local SQL Server (`docker compose`) |
| `npm run db:migrate` | Apply `db/migrations/*.sql` with `scripts/db-migrate.sh` |
| `npm run generate:icons` | Regenerate app icons with `scripts/generate-icons.mjs` |

`api/package.json`:

| Script | What it does |
|---|---|
| `npm run build` | Compile the API with `tsc` into `api/dist/` |
| `npm run build:deploy` | Bundle the API for deployment (`api/scripts/build-deploy.mjs`) |
| `npm test` | API tests (Vitest) |

## Project layout

```
src/
  app/            App shell and the signed-in app
  features/       UI by area: admin, auth, landing, map, trip, weather
  components/     Shared UI (components/common)
  domain/         Pure rules: trip, weather, gas
  services/       Network, storage, routing, geocoding, weather, auth and other clients
  hooks/          React context providers and hooks
  config/env.ts   The only place the browser build reads environment variables
api/              Azure Functions API (functions in api/src/functions, shared code in api/src/shared)
db/               SQL migrations (db/migrations) and database notes
infra/            Bicep templates used by azd
scripts/          Database migration, CI and Azure helper scripts
docs/             AZURE-PREFLIGHT.md, a record of the pre-build Azure checks
public/           Static assets
.github/          Workflows, issue and pull request templates
```

## Deployment to Azure

The SPA and the managed Azure Functions API in `api/` are deployed to Azure Static Web Apps with the Azure Developer CLI (`azd`). Deploys go through `azd` only. The provisioning, deploy, custom domain and CI/CD steps are in [DEPLOYMENT.md](DEPLOYMENT.md).

### Resources created

- **Resource Group:** `rg-{environmentName}`
- **Azure Static Web App:** Unique name (e.g., `stapp-abc123def456`) in `AZURE_LOCATION` (East US 2 for the live deployment)
- **Azure SQL server and database** (free offer, serverless, auto-pause) in `AZURE_SQL_LOCATION`, default `centralus`
- **Azure Communication Services** with an Azure-managed email domain (password-reset, invite and access-request mail), plus an optional custom sender domain (`rvtrip@moedim.dev`) enabled by `USE_CUSTOM_EMAIL_DOMAIN` after DNS verification; see [DEPLOYMENT.md](DEPLOYMENT.md#custom-email-domain)
- **App settings** on the Static Web App (applied by Bicep): `SQL_CONNECTION_STRING`, `SESSION_SECRET`, `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`, `APP_BASE_URL`, `INVITE_CODE`, `ADMIN_EMAILS`
- **Default URL:** `https://{name}.azurestaticapps.net`
- **Custom Domain:** Supports HTTPS with managed certificates (see [DEPLOYMENT.md](DEPLOYMENT.md))

### GitHub Actions

| Workflow | File | Runs on |
|---|---|---|
| PR Checks | `.github/workflows/pr-checks.yml` | Pull requests: type check, lint, tests (root and `api/`), build |
| Secret Scan | `.github/workflows/secret-scan.yml` | Pull requests and pushes to `master`: gitleaks |
| Deploy to Azure Static Web Apps | `.github/workflows/azure-dev.yml` | Pushes to `master`: lint, tests, database migrations, then `azd deploy` |
| Provision Azure infrastructure (manual) | `.github/workflows/azure-provision.yml` | Manual run: `azd provision` preview, applied on request |

The repository variables and secrets these workflows need are listed in [DEPLOYMENT.md](DEPLOYMENT.md).

## Using the app

- **Enable Routes:** Route calculations are disabled by default. Click the "Calculate Routes" button in the map panel to enable mapping and distance calculations.
- **Weather Forecasts:** Weather is pulled for the exact date range you provide per stop (NOAA for near-term, climate data for historical/future). Stops without dates get no forecast.
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
- **Versioning:** The app version is the `package.json` `version` plus the short git commit and build time, injected at build by `vite.config.ts`. Every build emits `/version.json`, which the update check reads
- **Cost Optimization:** Multi-server fallback, intelligent caching, request batching

## Notes

- **No third-party API keys required by default** for mapping, routing, geocoding and weather
- Weather is pulled for the exact date range you provide per stop; stops without dates get no forecast
- Route requests are batched and cached to respect free public APIs
- Trip data persists server-side per account (one row per trip) - use "Download all trips" or a per-trip download for backup

## Contributing, security and license

- [CONTRIBUTING.md](CONTRIBUTING.md): branch and pull request flow, required checks, commit style
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately
- [LICENSE](LICENSE): MIT
