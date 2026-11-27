import { describe, it, expect } from 'vitest'
import {
  calculateFuelCost,
  calculateTripTotalAccommodationCost,
  calculateTripTotalActualGasCost,
  calculateTripTotalActualFoodCost,
  calculateTripTotalActualMiscCost,
  calculateTripTotalActualCost,
  calculateNights,
  calculateStopCostsWithPrices,
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

    it('should return 0 when either date is empty', () => {
      expect(calculateNights('', '')).toEqual(0)
      expect(calculateNights('2024-01-01', '')).toEqual(0)
      expect(calculateNights('', '2024-01-02')).toEqual(0)
    })

    it('should handle invalid dates', () => {
      const nights = calculateNights('invalid', '2024-01-03')
      expect(nights).toEqual(0)
    })
  })

  describe('calculateTripTotalAccommodationCost', () => {
    it('should stay finite with an undated stop that has a nightly cost', () => {
      const stops = [
        { id: '1', label: 'A', address: 'A', startDate: '', endDate: '', nightlyCost: 50 },
        { id: '2', label: 'B', address: 'B', startDate: '2024-01-01', endDate: '2024-01-03', nightlyCost: 10 },
      ] as TripStop[]
      const total = calculateTripTotalAccommodationCost(stops)
      expect(Number.isFinite(total)).toBe(true)
      expect(total).toEqual(20)
    })

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

  describe('calculateTripTotalActualGasCost', () => {
    it('should sum all actual gas costs', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          actualGasCost: 20.25,
        },
        {
          id: '2',
          label: 'Stop 2',
          address: 'Address 2',
          startDate: '2024-01-02',
          endDate: '2024-01-03',
          actualGasCost: 39.75,
        },
      ]

      expect(calculateTripTotalActualGasCost(stops)).toEqual(60)
    })
  })

  describe('calculateTripTotalActualFoodCost', () => {
    it('should sum all actual food costs', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          actualFoodCost: 45.5,
        },
        {
          id: '2',
          label: 'Stop 2',
          address: 'Address 2',
          startDate: '2024-01-02',
          endDate: '2024-01-03',
          actualFoodCost: 14.5,
        },
      ]

      expect(calculateTripTotalActualFoodCost(stops)).toEqual(60)
    })
  })

  describe('calculateTripTotalActualMiscCost', () => {
    it('should sum all actual misc costs', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          actualMiscCost: 12.25,
        },
        {
          id: '2',
          label: 'Stop 2',
          address: 'Address 2',
          startDate: '2024-01-02',
          endDate: '2024-01-03',
        },
      ]

      expect(calculateTripTotalActualMiscCost(stops)).toEqual(12.25)
    })
  })

  describe('calculateTripTotalActualCost', () => {
    it('should sum actual gas, food, and misc costs', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          actualGasCost: 20,
          actualFoodCost: 30,
          actualMiscCost: 10,
        },
        {
          id: '2',
          label: 'Stop 2',
          address: 'Address 2',
          startDate: '2024-01-02',
          endDate: '2024-01-03',
          actualGasCost: 15,
          actualFoodCost: 25,
          actualMiscCost: 5,
        },
      ]

      expect(calculateTripTotalActualCost(stops)).toEqual(105)
    })

    it('should round to 2 decimal places', () => {
      const stops: TripStop[] = [
        {
          id: '1',
          label: 'Stop 1',
          address: 'Address 1',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          actualGasCost: 1.335,
          actualFoodCost: 2.335,
          actualMiscCost: 3.335,
        },
      ]

      expect(calculateTripTotalActualCost(stops)).toEqual(7.01)
    })

    it('should handle empty stops array', () => {
      expect(calculateTripTotalActualCost([])).toEqual(0)
    })
  })
  describe('calculateStopCostsWithPrices', () => {
    const stops = [
      { id: 'a', label: 'A', address: 'A', startDate: '', endDate: '', distanceFromPreviousMeters: 160934.4 },
      { id: 'b', label: 'B', address: 'B', startDate: '', endDate: '', distanceFromPreviousMeters: 160934.4 },
      { id: 'c', label: 'C', address: 'C', startDate: '', endDate: '' },
    ] as TripStop[]

    it('uses each stop price and leaves unpriced stops undefined', () => {
      const prices = new Map([['a', { price: 3 }], ['c', { price: 9 }]])
      const result = calculateStopCostsWithPrices(stops, 10, prices)
      expect(result[0].estimatedFuelCost).toBe(30) // 100 miles / 10 mpg * $3
      expect(result[1].estimatedFuelCost).toBeUndefined()
      expect(result[2].estimatedFuelCost).toBeUndefined()
    })

    it('does not mutate the input stops', () => {
      calculateStopCostsWithPrices(stops, 10, new Map([['a', { price: 3 }]]))
      expect(stops[0].estimatedFuelCost).toBeUndefined()
    })
  })
})
