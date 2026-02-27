import { describe, it, expect } from 'vitest'
import {
  calculateFuelCost,
  calculateTripTotalFuelCost,
  calculateTripTotalAccommodationCost,
  calculateNights,
  calculateTripTotalCost,
} from './costCalculation'
import type { TripStop } from '../domain/trip/types'

describe('costCalculation', () => {
  describe('calculateFuelCost', () => {
    it('should calculate fuel cost correctly', () => {
      const cost = calculateFuelCost(100000, 10, 3.5) // 100km (100000m), 10 mpg, $3.50/gal
      expect(cost).toBeCloseTo(21.75, 2)
    })

    it('should return undefined if distance is missing', () => {
      const cost = calculateFuelCost(undefined, 10, 3.5)
      expect(cost).toBeUndefined()
    })

    it('should return undefined if gas price is missing', () => {
      const cost = calculateFuelCost(100000, 10, undefined)
      expect(cost).toBeUndefined()
    })

    it('should return undefined if mpg is 0 or negative', () => {
      const cost1 = calculateFuelCost(100000, 0, 3.5)
      const cost2 = calculateFuelCost(100000, -5, 3.5)
      expect(cost1).toBeUndefined()
      expect(cost2).toBeUndefined()
    })

    it('should round to 2 decimal places', () => {
      const cost = calculateFuelCost(16093.44, 10, 3.55) // 10 miles, 10 mpg, $3.55/gal
      expect(cost).toEqual(3.55)
    })
  })

  describe('calculateTripTotalFuelCost', () => {
    it('should sum all estimated fuel costs', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          estimatedFuelCost: 10.5,
        },
        {
          id: '2',
          label: 'Stop 2',
          address: 'Address 2',
          startDate: '2024-01-02',
          endDate: '2024-01-03',
          estimatedFuelCost: 15.75,
        },
      ]
      const total = calculateTripTotalFuelCost(stops)
      expect(total).toEqual(26.25)
    })

    it('should handle missing fuel costs as 0', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
        },
        {
          id: '2',
          label: 'Stop 2',
          address: 'Address 2',
          startDate: '2024-01-02',
          endDate: '2024-01-03',
          estimatedFuelCost: 10,
        },
      ]
      const total = calculateTripTotalFuelCost(stops)
      expect(total).toEqual(10)
    })
  })

  describe('calculateNights', () => {
    it('should calculate correct number of nights', () => {
      const nights = calculateNights('2024-01-01', '2024-01-03')
      expect(nights).toEqual(2)
    })

    it('should return 0 for same day', () => {
      const nights = calculateNights('2024-01-01', '2024-01-01')
      expect(nights).toEqual(0)
    })

    it('should return 1 for one night', () => {
      const nights = calculateNights('2024-01-01', '2024-01-02')
      expect(nights).toEqual(1)
    })

    it('should handle invalid dates', () => {
      const nights = calculateNights('invalid', '2024-01-03')
      expect(nights).toEqual(0)
    })
  })

  describe('calculateTripTotalAccommodationCost', () => {
    it('should calculate total accommodation cost with nightly rates', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-03', // 2 nights
          nightlyCost: 50,
        },
        {
          id: '2',
          label: 'Stop 2',
          address: 'Address 2',
          startDate: '2024-01-03',
          endDate: '2024-01-05', // 2 nights
          nightlyCost: 75,
        },
      ]
      const total = calculateTripTotalAccommodationCost(stops)
      expect(total).toEqual(250) // (50*2) + (75*2)
    })

    it('should handle missing nightly costs as 0', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-03',
        },
        {
          id: '2',
          label: 'Stop 2',
          address: 'Address 2',
          startDate: '2024-01-03',
          endDate: '2024-01-05',
          nightlyCost: 100,
        },
      ]
      const total = calculateTripTotalAccommodationCost(stops)
      expect(total).toEqual(200) // only second stop's 2 nights * $100
    })

    it('should handle zero nights', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-01', // same day = 0 nights
          nightlyCost: 100,
        },
      ]
      const total = calculateTripTotalAccommodationCost(stops)
      expect(total).toEqual(0)
    })
  })

  describe('calculateTripTotalCost', () => {
    it('should sum fuel and accommodation costs', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-03',
          estimatedFuelCost: 20,
          nightlyCost: 50,
        },
      ]
      const total = calculateTripTotalCost(stops)
      expect(total).toEqual(120) // 20 (fuel) + (50 * 2 nights)
    })

    it('should return only accommodation cost when fuel data missing', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-03',
          nightlyCost: 75,
        },
      ]
      const total = calculateTripTotalCost(stops)
      expect(total).toEqual(150) // only accommodation: 75 * 2 nights
    })

    it('should handle empty stops array', () => {
      const total = calculateTripTotalCost([])
      expect(total).toEqual(0)
    })
  })
})
