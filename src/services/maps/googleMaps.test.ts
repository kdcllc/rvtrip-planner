import { describe, it, expect } from 'vitest'
import type { TripStop } from '../../domain/trip/types'
import {
  validateStopsForMaps,
  buildGoogleMapsDirectionsUrl,
} from './googleMaps'

describe('googleMaps', () => {
  const stopWithCoords: TripStop = {
    id: '1',
    label: 'Yosemite',
    address: '120 Model Farm Rd, Yosemite',
    startDate: '2025-03-01',
    endDate: '2025-03-03',
    location: { lat: 37.7749, lng: -122.4194 },
  }

  const stopWithAddress: TripStop = {
    id: '2',
    label: 'Camping Spot',
    address: '123 Mountain Road, Colorado',
    startDate: '2025-03-04',
    endDate: '2025-03-06',
    manualEntry: true,
    // No location - manual address without geocoding
  }

  const stopWithEmptyAddress: TripStop = {
    id: '3',
    label: 'Empty',
    address: '',
    startDate: '2025-03-07',
    endDate: '2025-03-08',
  }

  describe('validateStopsForMaps', () => {
    it('should validate stops with coordinates', () => {
      const result = validateStopsForMaps([stopWithCoords])
      expect(result.valid).toBe(true)
      expect(result.validStops).toHaveLength(1)
    })

    it('should validate stops with address text (even without coordinates)', () => {
      const result = validateStopsForMaps([stopWithAddress])
      expect(result.valid).toBe(true)
      expect(result.validStops).toHaveLength(1)
    })

    it('should reject stops with empty address and no coordinates', () => {
      const result = validateStopsForMaps([stopWithEmptyAddress])
      expect(result.valid).toBe(false)
      expect(result.validStops).toHaveLength(0)
    })

    it('should filter out invalid stops and validate mixed list', () => {
      const result = validateStopsForMaps([
        stopWithCoords,
        stopWithAddress,
        stopWithEmptyAddress,
      ])
      expect(result.valid).toBe(true)
      expect(result.validStops).toHaveLength(2)
    })

    it('should reject when no valid stops', () => {
      const result = validateStopsForMaps([stopWithEmptyAddress])
      expect(result.valid).toBe(false)
      expect(result.error).toContain('No stops have valid addresses or coordinates')
    })

    it('should reject when more than 11 stops', () => {
      const stops = Array.from({ length: 12 }, (_, i) => ({
        ...stopWithCoords,
        id: `${i}`,
        label: `Stop ${i}`,
      }))
      const result = validateStopsForMaps(stops)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('maximum 11 locations')
    })
  })

  describe('buildGoogleMapsDirectionsUrl', () => {
    it('should build URL with coordinates when available', () => {
      const url = buildGoogleMapsDirectionsUrl([stopWithCoords])
      expect(url).toContain('37.7749')
      expect(url).toContain('-122.4194')
      expect(url).toContain('https://www.google.com/maps/search')
    })

    it('should build URL with address fallback when coordinates unavailable', () => {
      const url = buildGoogleMapsDirectionsUrl([stopWithAddress])
      expect(url).toContain('123%20Mountain%20Road')
      expect(url).toContain('Colorado')
      expect(url).toContain('https://www.google.com/maps/search')
    })

    it('should build directions URL with multiple stops', () => {
      const url = buildGoogleMapsDirectionsUrl([stopWithCoords, stopWithAddress])
      expect(url).toContain('https://www.google.com/maps/dir')
      expect(url).toContain('api=1')
      expect(url).toContain('origin=')
      expect(url).toContain('destination=')
      // Origin should be coordinates, destination should be address
      expect(url).toContain('37.7749')
      expect(url).toContain('123%20Mountain%20Road')
    })

    it('should throw error when no valid stops', () => {
      expect(() => {
        buildGoogleMapsDirectionsUrl([stopWithEmptyAddress])
      }).toThrow()
    })

    it('should handle waypoints in directions URL', () => {
      const stop3 = {
        ...stopWithCoords,
        id: '3',
        label: 'Stop 3',
      }
      const url = buildGoogleMapsDirectionsUrl([stopWithCoords, stopWithAddress, stop3])
      expect(url).toContain('waypoints=')
    })

    it('should respect selectedIndices parameter', () => {
      const stops = [stopWithCoords, stopWithAddress, { ...stopWithCoords, id: '3', label: 'Stop 3' }]
      const url = buildGoogleMapsDirectionsUrl(stops, [0, 2])
      // Should only include indices 0 and 2
      expect(url).toContain('37.7749')
      // Should not see the address from index 1
      expect(url).not.toContain('123%20Mountain%20Road')
    })
  })
})
