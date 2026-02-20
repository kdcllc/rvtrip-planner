import { useEffect, useRef } from 'react'
import { GOOGLE_MAPS_MAP_ID } from '../../config'
import type { TripStop } from '../trip/types'
import type { MapBounds } from '../../utils/campsiteSearch'

type TripMapProps = {
  stops: TripStop[]
  mapsLoaded: boolean
  mapsError: string | null
  apiKey: string
  onBoundsChange?: (bounds: MapBounds) => void
}

type RouteSegment = {
  distance: string
  duration: string
  polyline: any
}

const DEFAULT_CENTER = { lat: 36.1699, lng: -115.1398 }

const formatDistance = (meters?: number) => {
  if (meters === undefined || Number.isNaN(meters)) {
    return 'N/A'
  }
  const miles = meters / 1609.344
  if (miles < 0.1) {
    return `${Math.round(meters)} m`
  }
  return `${miles.toFixed(1)} mi`
}

const formatDuration = (duration?: string) => {
  if (!duration) {
    return 'N/A'
  }
  const match = duration.match(/(\d+)s/)
  if (!match) {
    return duration
  }
  const totalSeconds = Number(match[1])
  const totalMinutes = Math.round(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return `${days}d ${remHours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export const TripMap = ({ stops, mapsLoaded, mapsError, apiKey, onBoundsChange }: TripMapProps) => {
  const mapRef = useRef<any>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const markersRef = useRef<any[]>([])
  const routesRef = useRef<RouteSegment[]>([])
  const routeLabelsRef = useRef<any[]>([])

  useEffect(() => {
    if (!mapsLoaded || !mapContainerRef.current || mapRef.current) {
      return
    }

    if (!window.google?.maps?.Map) {
      console.error('Google Maps API not available')
      return
    }

    try {
      const mapOptions: any = {
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

    markersRef.current.forEach((marker) => {
      if (marker.map !== undefined) {
        marker.map = null
      } else if (marker.setMap) {
        marker.setMap(null)
      }
    })
    markersRef.current = []

    // Clear existing route polylines
    routesRef.current.forEach((segment) => {
      segment.polyline.setMap(null)
    })
    routesRef.current = []

    // Clear route labels
    routeLabelsRef.current.forEach((label) => {
      if (label.map !== undefined) {
        label.map = null
      } else if (label.setMap) {
        label.setMap(null)
      }
    })
    routeLabelsRef.current = []

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
          return pin
        })(),
      })
      markersRef.current.push(marker)

      bounds.extend(stop.location)
    })

    // Calculate routes between consecutive stops
    const calculateRoutes = async () => {
      if (validStops.length < 2) return

      console.log('Calculating routes between', validStops.length, 'stops')

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
          const requestBody = {
            origin: {
              location: {
                latLng: {
                  latitude: origin.lat,
                  longitude: origin.lng,
                },
              },
            },
            destination: {
              location: {
                latLng: {
                  latitude: destination.lat,
                  longitude: destination.lng,
                },
              },
            },
            routeModifiers: {
              avoidTolls: false,
              avoidHighways: false,
              avoidFerries: false,
            },
            travelMode: 'DRIVE',
            computeAlternativeRoutes: false,
            languageCode: 'en-US',
          }
          console.log('Sending Routes API request:', JSON.stringify(requestBody, null, 2))
          const resp = await fetch(
            `https://routes.googleapis.com/directions/v2:computeRoutes`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask':
                  'routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters',
              },
              body: JSON.stringify(requestBody),
            }
          )

          if (!resp.ok) {
            const errorText = await resp.text()
            console.error('Routes API error:', resp.status)
            console.error('Error response:', errorText)
            try {
              const errorData = JSON.parse(errorText)
              console.error('Parsed error object:', JSON.stringify(errorData, null, 2))
            } catch (e) {
              console.error('Could not parse error as JSON')
            }
            continue
          }

          const data = await resp.json()
          console.log('Routes API response:', data)

          if (!data.routes?.length) {
            console.warn('No routes found in response')
            continue
          }

          const route = data.routes[0]
          const polylineData = route.polyline?.encodedPolyline
          const leg = route.legs?.[0]

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

            const distance = formatDistance(leg?.distanceMeters)
            const duration = formatDuration(leg?.duration)

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
    }

    void calculateRoutes()
    
    if (validStops.length >= 1) {
      map.fitBounds(bounds, 60)
    }
  }, [mapsLoaded, stops])

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

  return (
    <div className="map-wrap">
      <div className="panel-header">
        <div>
          <h2>Route map</h2>
          <p>Stop markers and the overall route.</p>
        </div>
        <span className="chip">Google Maps</span>
      </div>
      <div className="map-canvas" ref={mapContainerRef}>
        {!mapsLoaded && (
          <div className="map-overlay">
            <p>{mapsError ?? 'Loading Google Maps...'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
