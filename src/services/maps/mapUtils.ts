import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import type { TripStop } from '../../domain/trip/types'

/**
 * OpenStreetMap style configuration for MapLibre
 */
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution:
        '© OpenStreetMap contributors, Tiles courtesy of OpenStreetMap and HOT',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm-tiles',
    },
  ],
}

/**
 * Create a numbered marker element for a stop
 * @param index - Stop index (0-based, will display as 1-based)
 * @param stopId - Optional stop ID for data attribute
 * @returns HTML element for the marker
 */
export const createStopMarkerElement = (index: number, stopId?: string): HTMLElement => {
  const pin = document.createElement('div')
  pin.className = 'map-pin'
  pin.textContent = `${index + 1}`
  if (stopId) {
    pin.setAttribute('data-stop-id', stopId)
  }
  return pin
}

/**
 * Create a route label element
 * @param durationText - Text to display (e.g., "2h 30m")
 * @returns HTML element for the label
 */
export const createRouteLabelElement = (durationText: string): HTMLElement => {
  const labelContent = document.createElement('div')
  labelContent.className = 'route-label'
  labelContent.textContent = durationText
  return labelContent
}

/**
 * Calculate bounds that contain all valid stops
 * @param stops - Array of trip stops
 * @returns LngLatBounds object or null if no valid stops
 */
export const calculateStopBounds = (stops: TripStop[]): maplibregl.LngLatBounds | null => {
  const validStops = stops.filter((stop) => stop.location)
  
  if (validStops.length === 0) {
    return null
  }

  const bounds = new maplibregl.LngLatBounds()
  validStops.forEach((stop) => {
    if (stop.location) {
      bounds.extend([stop.location.lng, stop.location.lat])
    }
  })

  return bounds
}

/**
 * Inject marker and route label styles into a container
 * This is needed for off-screen rendering where the main CSS may not be loaded
 * @param container - Container element to inject styles into
 */
export const injectMapStyles = (container: HTMLElement): HTMLStyleElement => {
  const style = document.createElement('style')
  style.textContent = `
    .map-pin {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #f97316;
      color: #fff;
      display: grid;
      place-items: center;
      font-size: 0.75rem;
      font-weight: 700;
      border: 2px solid #fff;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.25);
    }
    
    .route-label {
      padding: 4px 8px;
      border-radius: 999px;
      background: #fff;
      color: #f59e0b;
      font-size: 0.7rem;
      font-weight: 700;
      border: 2px solid #f59e0b;
      box-shadow: 0 6px 14px rgba(15, 23, 42, 0.2);
      white-space: nowrap;
    }
  `
  container.appendChild(style)
  return style
}

/**
 * Format duration text for route labels
 * @param duration - Duration string (e.g., "2 hours 30 minutes")
 * @returns Shortened duration text (e.g., "2h 30m")
 */
export const formatDurationForLabel = (duration: string): string => {
  if (duration === 'N/A' || !duration) {
    return '↝'
  }

  return duration
    .replace(/\s/g, '')
    .replace('minutes', 'm')
    .replace('minute', 'm')
    .replace('hours', 'h')
    .replace('hour', 'h')
    .replace('days', 'd')
    .replace('day', 'd')
}
