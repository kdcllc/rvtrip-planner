import { describe, expect, it } from 'vitest'
import { VEHICLES_MAX } from '../../types/api'
import {
  DEFAULT_MPG,
  addVehicle,
  createVehicle,
  garageFromProfile,
  getDefaultVehicle,
  removeVehicle,
  resolveTripVehicle,
  sanitizeGarage,
  sanitizeVehicleProfile,
  setDefaultVehicle,
  updateVehicle,
} from './garage'

const three = () => {
  let g = garageFromProfile(createVehicle('x'), 'a')
  g = addVehicle(g, createVehicle('b', { name: 'B' }))
  g = addVehicle(g, createVehicle('c', { name: 'C' }))
  return g
}

describe('sanitizeVehicleProfile', () => {
  it('clamps, trims on read and nulls bad tank', () => {
    expect(
      sanitizeVehicleProfile(
        { name: `  ${'a'.repeat(100)} `, mpg: 500, tankGallons: 9999, fuelType: 'x' },
        25,
        true
      )
    ).toEqual({ name: 'a'.repeat(80), fuelType: 'gasoline', mpg: 100, tankGallons: null })
  })
  it('keeps spaces when not trimming and uses fallback mpg', () => {
    const p = sanitizeVehicleProfile({ name: 'My ', fuelType: 'diesel' }, 30, false)
    expect(p.name).toBe('My ')
    expect(p.mpg).toBe(30)
    expect(p.fuelType).toBe('diesel')
    expect(sanitizeVehicleProfile(null, NaN, true).mpg).toBe(DEFAULT_MPG)
  })
})

describe('createVehicle / garageFromProfile', () => {
  it('uses defaults', () => {
    expect(createVehicle('v1')).toEqual({
      id: 'v1',
      name: '',
      fuelType: 'gasoline',
      mpg: 25,
      tankGallons: null,
    })
  })
  it('wraps a profile as a one-vehicle garage', () => {
    const g = garageFromProfile({ name: 'R', fuelType: 'diesel', mpg: 9, tankGallons: 40 }, 'id1')
    expect(g.defaultVehicleId).toBe('id1')
    expect(g.vehicles).toEqual([
      { id: 'id1', name: 'R', fuelType: 'diesel', mpg: 9, tankGallons: 40 },
    ])
  })
})

describe('sanitizeGarage', () => {
  it('returns null for junk or no surviving vehicle', () => {
    expect(sanitizeGarage(null)).toBeNull()
    expect(sanitizeGarage({})).toBeNull()
    expect(sanitizeGarage({ vehicles: [], defaultVehicleId: 'a' })).toBeNull()
    expect(sanitizeGarage({ vehicles: [{ id: 'bad id!' }], defaultVehicleId: 'a' })).toBeNull()
  })
  it('drops invalid and duplicate ids and repairs default', () => {
    const g = sanitizeGarage({
      vehicles: [{ id: 'a', mpg: 10 }, { id: 'a', mpg: 11 }, { id: '' }, { id: 5 }, { id: 'b' }],
      defaultVehicleId: 'zzz',
    })
    expect(g?.vehicles.map((v) => v.id)).toEqual(['a', 'b'])
    expect(g?.vehicles[0].mpg).toBe(10)
    expect(g?.defaultVehicleId).toBe('a')
  })
  it('keeps a valid default and caps at VEHICLES_MAX', () => {
    const vehicles = Array.from({ length: VEHICLES_MAX + 3 }, (_, i) => ({ id: `v${i}` }))
    const g = sanitizeGarage({ vehicles, defaultVehicleId: 'v2' })
    expect(g?.vehicles).toHaveLength(VEHICLES_MAX)
    expect(g?.defaultVehicleId).toBe('v2')
  })
})

describe('lookup', () => {
  it('getDefaultVehicle and resolveTripVehicle', () => {
    const g = setDefaultVehicle(three(), 'b')
    expect(getDefaultVehicle(g).id).toBe('b')
    expect(resolveTripVehicle(g, 'c').id).toBe('c')
    expect(resolveTripVehicle(g, 'nope').id).toBe('b')
    expect(resolveTripVehicle(g).id).toBe('b')
  })
})

describe('updaters', () => {
  it('addVehicle is a no-op at max', () => {
    let g = garageFromProfile(createVehicle('x'), 'v0')
    for (let i = 1; i < VEHICLES_MAX; i++) g = addVehicle(g, createVehicle(`v${i}`))
    expect(g.vehicles).toHaveLength(VEHICLES_MAX)
    expect(addVehicle(g, createVehicle('extra'))).toBe(g)
  })
  it('updateVehicle sanitises without trimming', () => {
    const g = updateVehicle(three(), 'b', { name: 'Big ', mpg: 999 })
    const b = g.vehicles.find((v) => v.id === 'b')
    expect(b?.name).toBe('Big ')
    expect(b?.mpg).toBe(100)
    expect(b?.id).toBe('b')
  })
  it('removeVehicle reassigns default and keeps the last vehicle', () => {
    const g = removeVehicle(three(), 'a')
    expect(g.vehicles.map((v) => v.id)).toEqual(['b', 'c'])
    expect(g.defaultVehicleId).toBe('b')
    expect(removeVehicle(three(), 'c').defaultVehicleId).toBe('a')
    const single = garageFromProfile(createVehicle('x'), 'only')
    expect(removeVehicle(single, 'only')).toBe(single)
    const t = three()
    expect(removeVehicle(t, 'unknown')).toBe(t)
  })
  it('setDefaultVehicle ignores unknown ids', () => {
    const g = three()
    expect(setDefaultVehicle(g, 'nope')).toBe(g)
    expect(setDefaultVehicle(g, 'c').defaultVehicleId).toBe('c')
  })
})
