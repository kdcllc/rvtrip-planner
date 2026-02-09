# RV Trip Planner

Plan RV routes, add stop dates, and see daily weather forecasts for each stop.

## Setup

1. Install dependencies
   - `npm install`
2. Create a `.env` file based on `.env.example` and add your Google Maps API key
   - `VITE_GOOGLE_MAPS_API_KEY=your_key_here`
   - Optional: `VITE_GOOGLE_MAPS_MAP_ID=your_map_id` for Advanced Markers
3. Start the development server
   - `npm run dev`

## Getting a Google Maps API key

1. Sign in to the Google Cloud Console and create or select a project.
2. Enable the Maps JavaScript API, Places API, and Address Validation API for the project.
3. (Recommended) Create a Map ID in Google Cloud Maps Platform if you want Advanced Markers.
4. Create an API key.
5. (Recommended) Restrict the key to your local development origin or domain.
6. Copy the key into your `.env` file as `VITE_GOOGLE_MAPS_API_KEY`.
Read [](file:///home/kdcllc/Downloads/trip-planner/src/App.css)

Ran terminal command:  grep -r "map-canvas\|map-wrap" src/ --include="*.css"

Ran terminal command:  npm run dev

Replacing 15 lines with 22 lines in [](file:///home/kdcllc/Downloads/trip-planner/src/App.css), [](file:///home/kdcllc/Downloads/trip-planner/src/features/map/TripMap.tsx)


```

```

```

```


Replacing 5 lines with 6 lines in [](file:///home/kdcllc/Downloads/trip-planner/src/features/map/TripMap.tsx)


```

```


Replacing 20 lines with 42 lines in [](file:///home/kdcllc/Downloads/trip-planner/src/features/map/TripMap.tsx)


```

```


Replacing 4 lines with 8 lines in [](file:///home/kdcllc/Downloads/trip-planner/src/features/map/TripMap.tsx)


```

```


Checked [](file:///home/kdcllc/Downloads/trip-planner/src/features/map/TripMap.tsx), 13 problems found

Searched for files matching `**/*.d.ts`, 1 match

Read [](file:///home/kdcllc/Downloads/trip-planner/package.json)

Read [](file:///home/kdcllc/Downloads/trip-planner/src/vite-env.d.ts)

Read [](file:///home/kdcllc/Downloads/trip-planner/src/vite-env.d.ts)

Replacing 2 lines with 8 lines in [](file:///home/kdcllc/Downloads/trip-planner/src/vite-env.d.ts)


```

```


Checked [](file:///home/kdcllc/Downloads/trip-planner/src), 38 problems found

Replacing 8 lines with 11 lines in [](file:///home/kdcllc/Downloads/trip-planner/src/vite-env.d.ts)


```

```
Fixed the map display issues:

**Changes made:**

1. **App.css** - Added explicit `height: 480px` and `width: 100%` to `.map-canvas` (Google Maps requires containers with explicit dimensions)

2. **TripMap.tsx** - Made Map ID optional and added fallback markers:
   - Only pass `mapId` if actually configured
   - Use `AdvancedMarkerElement` when Map ID is set
   - Fall back to regular `Marker` when no Map ID (the likely cause of your blank map)

3. **useGoogleMaps.ts** - Improved script loading to handle edge cases

4. **vite-env.d.ts** - Fixed TypeScript declarations

The map should now render at  http://localhost:5174/. If you still don't see it, try adding a Map ID to your .env:

1. Go to [Google Cloud Console > Maps](https://console.cloud.google.com/google/maps-apis/start)
2. Create a Map ID
3. In .env uncomment and set:
   ```
   VITE_GOOGLE_MAPS_MAP_ID=your_map_id_here
   ```

Made changes.
## Features

- Manual stop list with arrival and departure dates
- Optional starting point that does not require dates
- Google Maps route with numbered markers
- Open-Meteo daily forecasts per stop

## Notes

- Weather is pulled for the exact date range you provide per stop.
- If the Google Maps key is missing, the map panel will show a warning.
