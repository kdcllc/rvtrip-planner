import { useEffect, useRef } from 'react'
import { GOOGLE_MAPS_MAP_ID } from '../../config/env'
import type { TripStop } from '../../domain/trip/types'
import type { MapBounds } from '../../services/campsiteSearch'
import { formatDistance, formatDuration } from '../../utils/distance'
import { computeRoute } from '../../services/maps/routesService'
import { useRoutesEnabled } from '../../hooks/useRoutesEnabled'

type TripMapProps = {
  stops: TripStop[]
  mapsLoaded: boolean
  mapsError: string | null
  apiKey: string
  onBoundsChange?: (bounds: MapBounds) => void
  onStopHover?: (stopId: string | null) => void
  onStopDoubleClick?: (stopId: string) => void
}

type RouteSegment = {
  distance: string
  duration: string
  polyline: google.maps.Polyline
}

const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 36.1699, lng: -115.1398 }

// Format stop information for InfoWindow display
const formatStopInfoContent = (stop: TripStop): string => {
  const dateRange = `${new Date(stop.startDate).toLocaleDateString()} – ${new Date(stop.endDate).toLocaleDateString()}`
  
  let timeRange = ''
  if (stop.checkInTime || stop.checkOutTime) {
    const checkIn = stop.checkInTime ? `Check-in: ${stop.checkInTime}` : ''
    const checkOut = stop.checkOutTime ? `Check-out: ${stop.checkOutTime}` : ''
    timeRange = [checkIn, checkOut].filter(Boolean).join(' • ')
  }

  const distance = stop.distanceFromPreviousMeters 
    ? `${(stop.distanceFromPreviousMeters / 1609.34).toFixed(1)} mi` 
    : ''
  const fuelCost = stop.estimatedFuelCost 
    ? `$${stop.estimatedFuelCost.toFixed(2)}` 
    : ''
  const travelInfo = [distance, fuelCost].filter(Boolean).join(' • ')

  const sourceHtml = stop.source
    ? `<div style="font-size: 0.9em; color: #666; margin-top: 8px;">
        <strong>${stop.source.name}</strong>
        ${stop.source.siteType ? `<br>Type: ${stop.source.siteType}` : ''}
        ${stop.source.fees ? `<br>Fees: ${stop.source.fees}` : ''}
      </div>`
    : ''

  const noteHtml = stop.note
    ? `<div style="font-size: 0.9em; color: #666; margin-top: 8px; font-style: italic;">${stop.note}</div>`
    : ''

  return `
    <div style="font-family: Arial, sans-serif; padding: 8px; max-width: 280px;">
      <h3 style="margin: 0 0 4px 0; font-size: 1.1em; cursor: pointer; color: #0066cc; text-decoration: underline;" data-stop-nav-id="${stop.id}">${stop.label}</h3>
      <p style="margin: 0 0 4px 0; font-size: 0.75em; color: #999;">Click title to view in timeline</p>
      <p style="margin: 0 0 4px 0; font-size: 0.9em; color: #666;">${stop.address}</p>
      <p style="margin: 0 0 4px 0; font-size: 0.9em;"><strong>${dateRange}</strong></p>
      ${timeRange ? `<p style="margin: 0 0 4px 0; font-size: 0.9em;">${timeRange}</p>` : ''}
      ${travelInfo ? `<p style="margin: 0 0 4px 0; font-size: 0.9em; color: #666;">${travelInfo}</p>` : ''}
      ${sourceHtml}
      ${noteHtml}
    </div>
  `
}

export const TripMap = ({ stops, mapsLoaded, mapsError, apiKey, onBoundsChange, onStopHover, onStopDoubleClick }: TripMapProps) => {
  const [routesEnabled, setRoutesEnabled] = useRoutesEnabled()
  const mapRef = useRef<google.maps.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const routesRef = useRef<RouteSegment[]>([])
  const routeLabelsRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const hoveredStopIdRef = useRef<string | null>(null)
  const routeCalculationInFlight = useRef(false)
  useEffect(() => {
    if (!mapsLoaded || !mapContainerRef.current || mapRef.current) {
      return
    }

    if (!window.google?.maps?.Map) {
      console.error('Google Maps API not available')
      return
    }

    try {
      const mapOptions: google.maps.MapOptions = {
        center: DEFAULT_CENTER,
        zoom: 5,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      }

      if (GOOGLE_MAPS_MAP_ID && GOOGLE_MAPS_MAP_ID.trim()) {
        mapOptions.mapId = GOOGLE_MAPS_MAP_ID
      } else {
        console.warn('GOOGLE_MAPS_MAP_ID is missing; AdvancedMarkerElement may not render as expected.')
      }

      console.log('Creating map with options:', mapOptions)
      mapRef.current = new window.google.maps.Map(mapContainerRef.current, mapOptions)
      console.log('Map created successfully')
    } catch (error) {
      console.error('Error creating map:', error)
    }
  }, [mapsLoaded])

  useEffect(() => {
    if (!mapsLoaded || !mapRef.current) {
      return
    }

    const map = mapRef.current
    const validStops = stops.filter((stop) => stop.location)
    const bounds = new window.google.maps.LatLngBounds()

    // Clean up InfoWindow and references when stops change
    if (infoWindowRef.current) {
      infoWindowRef.current.close()
    }
    hoveredStopIdRef.current = null
    onStopHover?.(null)

    // Clear existing markers
    markersRef.current.forEach((marker) => {
      marker.map = null
    })
    markersRef.current = []

    validStops.forEach((stop, index) => {
      if (!stop.location) {
        return
      }

      if (!window.google?.maps?.marker?.AdvancedMarkerElement) {
        console.warn('AdvancedMarkerElement not available; check Maps JS API version and mapId.')
        return
      }

      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        map,
        position: stop.location,
        title: stop.source?.name ? `${stop.label} • ${stop.source.name}` : stop.label,
        content: (() => {
          const pin = document.createElement('div')
          pin.className = 'map-pin'
          pin.textContent = `${index + 1}`
          pin.setAttribute('data-stop-id', stop.id)
          return pin
        })(),
      })

      // Add event listeners for hover and double-click
      marker.addListener('mouseover', () => {
        hoveredStopIdRef.current = stop.id
        onStopHover?.(stop.id)

        // Create or update InfoWindow
        if (!infoWindowRef.current) {
          infoWindowRef.current = new window.google.maps.InfoWindow()
        }

        const infoWindow = infoWindowRef.current
        infoWindow.setContent(formatStopInfoContent(stop))
        infoWindow.open(map, marker)

        // Visual feedback on marker
        const pinElement = marker.content as HTMLElement
        if (pinElement) {
          pinElement.style.transform = 'scale(1.2)'
          pinElement.style.zIndex = '999'
        }
      })

      marker.addListener('mouseout', () => {
        hoveredStopIdRef.current = null
        onStopHover?.(null)

        // Hide InfoWindow
        if (infoWindowRef.current) {
          infoWindowRef.current.close()
        }

        // Reset marker visual
        const pinElement = marker.content as HTMLElement
        if (pinElement) {
          pinElement.style.transform = 'scale(1)'
          pinElement.style.zIndex = ''
        }
      })

      marker.addListener('click', () => {
        // Show InfoWindow on click for accessibility
        if (!infoWindowRef.current) {
          infoWindowRef.current = new window.google.maps.InfoWindow()
        }

        const infoWindow = infoWindowRef.current
        infoWindow.setContent(formatStopInfoContent(stop))
        infoWindow.open(map, marker)
      })

      marker.addListener('dblclick', () => {
        onStopDoubleClick?.(stop.id)
      })

      markersRef.current.push(marker)

      bounds.extend(stop.location)
    })

    // Calculate routes between consecutive stops (gated by routesEnabled)
    const calculateRoutes = async () => {
      if (validStops.length < 2) return
      if (!routesEnabled) return
      if (routeCalculationInFlight.current) {
        console.log('Route calculation already in progress, skipping')
        return
      }

      routeCalculationInFlight.current = true
      console.log('Calculating routes between', validStops.length, 'stops')

      // Clear existing route polylines and labels before recalculating
      routesRef.current.forEach((segment) => {
        segment.polyline.setMap(null)
      })
      routesRef.current = []

      routeLabelsRef.current.forEach((label) => {
        label.map = null
      })
      routeLabelsRef.current = []

      try {
        for (let i = 0; i < validStops.length - 1; i++) {
          const origin = validStops[i].location
          const destination = validStops[i + 1].location

          if (!origin || !destination) {
            continue
          }

          console.log(
            `Calculating route ${i + 1} from ${validStops[i].label} to ${validStops[i + 1].label}`
          )

          try {
            // Use shared routes service with caching
            const routeResponse = await computeRoute(
              {
                origin,
                destination,
                avoidTolls: false,
                avoidHighways: false,
                avoidFerries: false,
              },
              apiKey
            )

            const polylineData = routeResponse.polyline

            if (polylineData && window.google?.maps?.geometry?.encoding) {
              // Decode polyline
              const path = window.google.maps.geometry.encoding.decodePath(
                polylineData
              )
              console.log('Decoded polyline path length:', path.length)

              const polyline = new window.google.maps.Polyline({
                map,
                path,
                strokeColor: '#f59e0b',
                strokeOpacity: 0.8,
                strokeWeight: 3,
                zIndex: 1,
              })

              const distance = formatDistance(routeResponse.distanceMeters)
              const duration = formatDuration(routeResponse.duration)

              console.log(`Route ${i + 1}: ${distance} • ${duration}`)

              routesRef.current.push({
                distance,
                duration,
                polyline,
              })

              // Add label at midpoint
              if (path.length > 0) {
                const midpoint = path[Math.floor(path.length / 2)]
                const durationText = duration === 'N/A'
                  ? '↝'
                  : duration
                      .replace(/\s/g, '')
                      .replace('minutes', 'm')
                      .replace('minute', 'm')
                      .replace('hours', 'h')
                      .replace('hour', 'h')
                      .replace('days', 'd')
                      .replace('day', 'd')

                const labelContent = document.createElement('div')
                labelContent.className = 'route-label'
                labelContent.textContent = durationText

                const label = new window.google.maps.marker.AdvancedMarkerElement({
                  map,
                  position: midpoint,
                  title: `${validStops[i].label} → ${validStops[i + 1].label}\n${distance} • ${duration}`,
                  content: labelContent,
                })
                routeLabelsRef.current.push(label)
              }
            } else {
              console.warn('No polyline data in route', i)
            }
          } catch (err) {
            console.error(`Error calculating route ${i + 1}:`, err)
          }
        }
      } finally {
        routeCalculationInFlight.current = false
      }
    }

    void calculateRoutes()
    
    if (validStops.length >= 1) {
      map.fitBounds(bounds, 60)
    }

    // Cleanup: reset in-flight guard when effect re-runs or unmounts
    return () => {
      routeCalculationInFlight.current = false
    }
  }, [apiKey, mapsLoaded, stops, onStopHover, onStopDoubleClick, routesEnabled])

  // Track map bounds for campsite search
  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || !onBoundsChange) {
      return
    }

    const map = mapRef.current
    const emitBounds = () => {
      const bounds = map.getBounds()
      if (!bounds) {
        return
      }

      const ne = bounds.getNorthEast()
      const sw = bounds.getSouthWest()
      
      onBoundsChange({
        neLat: ne.lat(),
        neLng: ne.lng(),
        swLat: sw.lat(),
        swLng: sw.lng(),
      })
    }

    // Emit initial bounds when map bounds change
    window.google?.maps?.event?.addListenerOnce(map, 'bounds_changed', emitBounds)

    // Emit bounds on idle (after user stops panning/zooming)
    const idleListener = window.google?.maps?.event?.addListener(map, 'idle', emitBounds)

    return () => {
      if (idleListener) {
        window.google?.maps?.event?.removeListener(idleListener)
      }
    }
  }, [mapsLoaded, onBoundsChange])

  // Handle clicks on InfoWindow titles to navigate to timeline
  useEffect(() => {
    const handleInfoWindowClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target && target.hasAttribute('data-stop-nav-id')) {
        const stopId = target.getAttribute('data-stop-nav-id')
        if (stopId) {
          // Trigger double-click callback to navigate
          onStopDoubleClick?.(stopId)
        }
      }
    }

    document.addEventListener('click', handleInfoWindowClick)
    return () => {
      document.removeEventListener('click', handleInfoWindowClick)
    }
  }, [onStopDoubleClick])

  const handleEnableRoutes = () => {
    setRoutesEnabled(true)
  }

  return (
    <div className="map-wrap">
      <div className="panel-header">
        <div>
          <h2>Route map</h2>
          <p>Stop markers and the overall route.</p>
        </div>
        <span className="chip">Google Maps</span>
      </div>
      {!routesEnabled && (
        <div style={{ padding: '16px', background: 'var(--color-surface-strong)', borderRadius: '8px', margin: '0 16px 16px' }}>
          <p style={{ margin: '0 0 12px', fontSize: '0.9em', color: 'var(--color-text-muted)' }}>
            Route calculation is disabled by default to reduce API costs. Click below to enable map and route visualization.
          </p>
          <button
            onClick={handleEnableRoutes}
            style={{
              padding: '10px 20px',
              background: 'var(--color-accent)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '0.95em',
            }}
          >
            Calculate Routes
          </button>
        </div>
      )}
      <div className="map-canvas" ref={mapContainerRef}>
        {!mapsLoaded && routesEnabled && (
          <div className="map-overlay">
            <p>{mapsError ?? 'Loading Google Maps...'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
