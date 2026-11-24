import maplibregl from 'maplibre-gl'
import polyline from '@mapbox/polyline'
import type { TripStop } from '../../domain/trip/types'
import { computeRoute } from './routesService'
import { formatDuration } from '../../utils/distance'
import {
  OSM_STYLE,
  createStopMarkerElement,
  createRouteLabelElement,
  calculateStopBounds,
  injectMapStyles,
  formatDurationForLabel,
} from './mapUtils'

type CaptureOptions = {
  width?: number
  height?: number
  includeRoutes?: boolean
}

/**
 * Capture a map with trip stops as a data URL for PDF generation
 * @param stops - Array of trip stops to render on the map
 * @param options - Configuration options for map capture
 * @returns Promise resolving to data URL of the map image, or null if capture fails
 */
export const captureMapAsDataUrl = async (
  stops: TripStop[],
  options: CaptureOptions = {}
): Promise<string | null> => {
  const { width = 1200, height = 700, includeRoutes = true } = options

  const validStops = stops.filter((stop) => stop.location)

  if (validStops.length === 0) {
    console.warn('No valid stops with coordinates for map capture')
    return null
  }

  // Create off-screen container
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = `${width}px`
  container.style.height = `${height}px`
  container.style.zIndex = '-1'

  document.body.appendChild(container)

  // Inject styles needed for markers and route labels
  injectMapStyles(container)

  let map: maplibregl.Map | null = null

  try {
    // Initialize map
    map = new maplibregl.Map({
      container,
      style: OSM_STYLE,
      center: [validStops[0].location!.lng, validStops[0].location!.lat],
      zoom: 5,
      preserveDrawingBuffer: true, // Critical: allows canvas capture
      interactive: false, // No user interaction for static capture
    })

    // Wait for map to load
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Map load timeout'))
      }, 15000) // 15 second timeout

      map!.once('load', () => {
        clearTimeout(timeout)
        resolve()
      })

      map!.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })

    // Add markers for each stop
    const markers: maplibregl.Marker[] = []
    validStops.forEach((stop, index) => {
      if (!stop.location) {
        return
      }

      const pin = createStopMarkerElement(index, stop.id)
      const marker = new maplibregl.Marker({ element: pin, anchor: 'center' })
        .setLngLat([stop.location.lng, stop.location.lat])
        .addTo(map!)

      markers.push(marker)
    })

    // Add routes if enabled and we have multiple stops
    const routeLabels: maplibregl.Marker[] = []
    if (includeRoutes && validStops.length > 1) {
      for (let i = 0; i < validStops.length - 1; i++) {
        const origin = validStops[i].location
        const destination = validStops[i + 1].location

        if (!origin || !destination) {
          continue
        }

        try {
          const routeResponse = await computeRoute({
            origin,
            destination,
            avoidTolls: false,
            avoidHighways: false,
            avoidFerries: false,
          })

          const polylineData = routeResponse.polyline
          if (!polylineData) {
            continue
          }

          const decoded = polyline.decode(polylineData)
          const coordinates = decoded.map(([lat, lng]: [number, number]) => [lng, lat])

          if (coordinates.length === 0) {
            continue
          }

          const sourceId = `route-source-${i}`
          const layerId = `route-line-${i}`

          map.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates,
              },
              properties: {},
            },
          })

          map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#f59e0b',
              'line-width': 3,
              'line-opacity': 0.8,
            },
          })

          // Add route label
          const duration = formatDuration(routeResponse.duration)
          const durationText = formatDurationForLabel(duration)

          const midpoint = coordinates[Math.floor(coordinates.length / 2)]
          const labelElement = createRouteLabelElement(durationText)

          const label = new maplibregl.Marker({ element: labelElement, anchor: 'center' })
            .setLngLat(midpoint as [number, number])
            .addTo(map)

          routeLabels.push(label)
        } catch (error) {
          console.warn(`Failed to compute route ${i + 1}:`, error)
          // Continue with other routes
        }
      }
    }

    // Fit bounds to show all stops
    const bounds = calculateStopBounds(validStops)
    if (bounds) {
      if (validStops.length === 1) {
        // Single stop: center and zoom
        map.setCenter([validStops[0].location!.lng, validStops[0].location!.lat])
        map.setZoom(8)
      } else {
        // Multiple stops: fit bounds
        map.fitBounds(bounds, { padding: 60, duration: 0 })
      }
    }

    // Wait for tiles to render
    // MapLibre's load event fires before tiles are fully rendered
    await new Promise((resolve) => setTimeout(resolve, 800))

    // Check if map is rendered (idle means all tiles loaded)
    if (!map.isStyleLoaded()) {
      console.warn('Map style not fully loaded, capture may be incomplete')
    }

    // Capture canvas as data URL
    const canvas = map.getCanvas()
    const dataUrl = canvas.toDataURL('image/png')

    // Cleanup
    markers.forEach((marker) => marker.remove())
    routeLabels.forEach((label) => label.remove())
    map.remove()
    document.body.removeChild(container)

    return dataUrl
  } catch (error) {
    console.error('Failed to capture map:', error)

    // Cleanup on error
    if (map) {
      try {
        map.remove()
      } catch (removeError) {
        console.error('Failed to remove map:', removeError)
      }
    }

    if (container.parentNode) {
      document.body.removeChild(container)
    }

    return null
  }
}
