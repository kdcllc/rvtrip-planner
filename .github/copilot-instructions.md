---
description: Project-wide Copilot instructions for trip-planner (React 19 + Vite + TypeScript)
---

# Trip Planner Copilot Instructions

## Project Context
- React 19 + Vite + TypeScript.
- SPA plus a backend: Azure Static Web Apps managed Functions in `api/` with Azure SQL.
- Trips persist per user through `/api/trips` (`src/services/storage/tripStorage.ts`); routing/geocoding response caches use localStorage (`src/services/network/cache.ts`).
- Integrations: MapLibre GL JS maps, OSRM/OpenRouteService routing, Photon/Nominatim geocoding, and NOAA/Open-Meteo weather APIs (see README Open-Source Stack).
- Primary feature areas: trip planning, mapping, and weather.

## Architecture Preferences
- Keep feature modules under `src/features/<feature>`.
- Use small, focused components and custom hooks for reusable stateful logic.
- Prefer a services layer for side-effecting logic (HTTP, storage, import/export).
- Place pure domain rules/types under `src/domain` (no side effects).
- Keep reusable UI in `src/components/common`.

## React + TypeScript Standards
- Functional components only; avoid class components.
- Prefer explicit prop/types interfaces in feature files.
- Use hooks for state, effects, and derived state.
- Keep effects narrowly scoped with correct dependency arrays.
- Favor composition over prop drilling (context or custom hooks when needed).

## Data and Side Effects
- Encapsulate network calls in services; avoid fetch in components when possible.
- Persist trips only through `src/services/storage/tripStorage.ts` (server-backed via `/api/trips`); avoid ad-hoc storage access in components.
- Guard external API calls with validation and error handling.

## UI/UX and Accessibility
- Use semantic HTML and accessible labeling for form inputs and buttons.
- Keep UI state (loading/error/empty) explicit and visible.

## Testing and Safety
- When adding new logic, include lightweight unit tests where practical.
- Avoid introducing breaking changes to persisted data formats without migration.

## Repo Conventions
- Use existing utilities in `src/utils` when appropriate.
- Keep constants/config in `src/config` or `src/domain` as applicable.
- Prefer small, reusable functions over large inline blocks.
