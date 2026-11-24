import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import polyline from '@mapbox/polyline'
import type { TripStop } from '../../domain/trip/types'
import type { MapBounds } from '../../services/campsiteSearch'
import { formatDistance, formatDuration } from '../../utils/distance'
import { computeRoute } from '../../services/maps/routesService'
import { useRoutesEnabled } from '../../hooks/useRoutesEnabled'
import {
  OSM_STYLE,
  createStopMarkerElement,
  createRouteLabelElement,
  formatDurationForLabel,
} from '../../services/maps/mapUtils'

type TripMapProps = {
  stops: TripStop[]
  onBoundsChange?: (bounds: MapBounds) => void
  onStopHover?: (stopId: string | null) => void
  onStopDoubleClick?: (stopId: string) => void
}

const DEFAULT_CENTER: [number, number] = [-115.1398, 36.1699]

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
      <h3 style="margin: 0 0 4px 0; font-size: 1.1em;">
        <button type="button" style="padding: 0; border: 0; background: transparent; cursor: pointer; color: #0066cc; text-decoration: underline; font: inherit; text-align: left;" data-stop-nav-id="${stop.id}">${stop.label}</button>
      </h3>
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

export const TripMap = ({ stops, onBoundsChange, onStopHover, onStopDoubleClick }: TripMapProps) => {
  const [routesEnabled, setRoutesEnabled] = useRoutesEnabled()
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const routeLabelsRef = useRef<maplibregl.Marker[]>([])
  const routeLayerIdsRef = useRef<string[]>([])
  const routeSourceIdsRef = useRef<string[]>([])
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const popupCleanupRef = useRef<(() => void) | null>(null)
  const popupCloseTimeoutRef = useRef<number | null>(null)
  const markerHoveringRef = useRef(false)
  const popupHoveringRef = useRef(false)
  const routeCalculationInFlight = useRef(false)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    try {
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: OSM_STYLE,
        center: DEFAULT_CENTER,
        zoom: 5,
      })

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

      map.on('load', () => {
        setMapReady(true)
      })

      map.on('error', () => {
        setMapError('Map failed to load.')
      })

      mapRef.current = map
    } catch (error) {
      console.error('Error creating MapLibre map:', error)
      setMapError('Map failed to initialize.')
    }

    return () => {
      if (popupCloseTimeoutRef.current !== null) {
        window.clearTimeout(popupCloseTimeoutRef.current)
      }
      popupCleanupRef.current?.()
      mapRef.current?.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    if (!mapReady || !mapRef.current) {
      return
    }

    const map = mapRef.current
    const validStops = stops.filter((stop) => stop.location)

    const clearPopupCloseTimeout = () => {
      if (popupCloseTimeoutRef.current !== null) {
        window.clearTimeout(popupCloseTimeoutRef.current)
        popupCloseTimeoutRef.current = null
      }
    }

    const removePopup = () => {
      clearPopupCloseTimeout()
      popupCleanupRef.current?.()
      popupCleanupRef.current = null
      popupRef.current?.remove()
      popupHoveringRef.current = false
      markerHoveringRef.current = false
      onStopHover?.(null)
    }

    const schedulePopupClose = () => {
      clearPopupCloseTimeout()
      popupCloseTimeoutRef.current = window.setTimeout(() => {
        popupCloseTimeoutRef.current = null
        if (markerHoveringRef.current || popupHoveringRef.current) {
          return
        }

        removePopup()
      }, 220)
    }

    if (popupRef.current) {
      removePopup()
    }

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    routeLabelsRef.current.forEach((label) => label.remove())
    routeLabelsRef.current = []

    routeLayerIdsRef.current.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId)
      }
    })
    routeLayerIdsRef.current = []

    routeSourceIdsRef.current.forEach((sourceId) => {
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId)
      }
    })
    routeSourceIdsRef.current = []

    const bounds = new maplibregl.LngLatBounds()

    validStops.forEach((stop, index) => {
      if (!stop.location) {
        return
      }

        const pin = createStopMarkerElement(index, stop.id)
      pin.setAttribute('role', 'button')
      pin.setAttribute('aria-label', `Stop ${index + 1}: ${stop.label}. Open stop details.`)
      pin.tabIndex = 0

      const marker = new maplibregl.Marker({ element: pin, anchor: 'center' })
        .setLngLat([stop.location.lng, stop.location.lat])
        .addTo(map)

      const showPopup = () => {
        clearPopupCloseTimeout()
        const popup =
          popupRef.current ??
          new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })

        popupRef.current = popup
        popup.setLngLat([stop.location!.lng, stop.location!.lat])
        popup.setHTML(formatStopInfoContent(stop))
        popup.addTo(map)

        const popupElement = popup.getElement()
        const handlePopupMouseEnter = () => {
          popupHoveringRef.current = true
          clearPopupCloseTimeout()
          onStopHover?.(stop.id)
        }
        const handlePopupMouseLeave = () => {
          popupHoveringRef.current = false
          schedulePopupClose()
        }

        popupCleanupRef.current?.()
        popupElement.addEventListener('mouseenter', handlePopupMouseEnter)
        popupElement.addEventListener('mouseleave', handlePopupMouseLeave)
        popupCleanupRef.current = () => {
          popupElement.removeEventListener('mouseenter', handlePopupMouseEnter)
          popupElement.removeEventListener('mouseleave', handlePopupMouseLeave)
        }
      }

      pin.addEventListener('mouseenter', () => {
        markerHoveringRef.current = true
        onStopHover?.(stop.id)
        showPopup()
      })

      pin.addEventListener('focus', () => {
        markerHoveringRef.current = true
        onStopHover?.(stop.id)
        showPopup()
      })

      pin.addEventListener('mouseleave', () => {
        markerHoveringRef.current = false
        schedulePopupClose()
      })

      pin.addEventListener('blur', () => {
        markerHoveringRef.current = false
        schedulePopupClose()
      })

      pin.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        markerHoveringRef.current = true
        onStopHover?.(stop.id)
        showPopup()
      })

      pin.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        markerHoveringRef.current = true
        onStopHover?.(stop.id)
        showPopup()
      })

      pin.addEventListener('dblclick', (event) => {
        event.preventDefault()
        event.stopPropagation()
        onStopDoubleClick?.(stop.id)
      })

      markersRef.current.push(marker)
      bounds.extend([stop.location.lng, stop.location.lat])
    })

    const calculateRoutes = async () => {
      if (validStops.length < 2) return
      if (!routesEnabled) return
      if (routeCalculationInFlight.current) {
        return
      }

      routeCalculationInFlight.current = true

      try {
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
              console.warn('No polyline data in route', i)
              continue
            }

            const decoded = polyline.decode(polylineData)
            const coordinates = decoded.map(([lat, lng]: [number, number]) => [lng, lat])

            if (coordinates.length === 0) {
              console.warn('Empty polyline for route', i)
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

            routeSourceIdsRef.current.push(sourceId)
            routeLayerIdsRef.current.push(layerId)

            const distance = formatDistance(routeResponse.distanceMeters)
            const duration = formatDuration(routeResponse.duration)

            const midpoint = coordinates[Math.floor(coordinates.length / 2)]
            const durationText = formatDurationForLabel(duration)

            const labelContent = createRouteLabelElement(durationText)
            labelContent.title = `${validStops[i].label} → ${validStops[i + 1].label}\n${distance} • ${duration}`

            const label = new maplibregl.Marker({ element: labelContent, anchor: 'center' })
              .setLngLat(midpoint as [number, number])
              .addTo(map)
            routeLabelsRef.current.push(label)
          } catch (err) {
            console.error(`Error calculating route ${i + 1}:`, err)
          }
        }
      } finally {
        routeCalculationInFlight.current = false
      }
    }

    void calculateRoutes()

    if (validStops.length === 1) {
      const stop = validStops[0]
      if (stop.location) {
        map.setCenter([stop.location.lng, stop.location.lat])
        map.setZoom(8)
      }
    } else if (validStops.length > 1) {
      map.fitBounds(bounds, { padding: 60, duration: 0 })
    }

    return () => {
      clearPopupCloseTimeout()
      popupCleanupRef.current?.()
      popupCleanupRef.current = null
      routeCalculationInFlight.current = false
    }
  }, [mapReady, stops, onStopHover, onStopDoubleClick, routesEnabled])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !onBoundsChange) {
      return
    }

    const map = mapRef.current
    const emitBounds = () => {
      const bounds = map.getBounds()
      const ne = bounds.getNorthEast()
      const sw = bounds.getSouthWest()

      onBoundsChange({
        neLat: ne.lat,
        neLng: ne.lng,
        swLat: sw.lat,
        swLng: sw.lng,
      })
    }

    emitBounds()
    map.on('moveend', emitBounds)

    return () => {
      map.off('moveend', emitBounds)
    }
  }, [mapReady, onBoundsChange])

  useEffect(() => {
    const handleInfoWindowClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const trigger = target?.closest<HTMLElement>('[data-stop-nav-id]')

      if (!trigger) {
        return
      }

      const stopId = trigger.getAttribute('data-stop-nav-id')
      if (stopId) {
        onStopDoubleClick?.(stopId)
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
        <span className="chip">MapLibre + OSM</span>
      </div>
      {!routesEnabled && (
        <div style={{ padding: '16px', background: 'var(--color-surface-strong)', borderRadius: '8px', margin: '0 16px 16px' }}>
          <p style={{ margin: '0 0 12px', fontSize: '0.9em', color: 'var(--color-text-muted)' }}>
            Route calculation is disabled by default to reduce API costs. Click below to enable route visualization.
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
        {!mapReady && (
          <div className="map-overlay">
            <p>{mapError ?? 'Loading map...'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
