import {
  MPG_MAX,
  MPG_MIN,
  TANK_GALLONS_MAX,
  TANK_GALLONS_MIN,
  VEHICLES_MAX,
  VEHICLE_ID_PATTERN,
  VEHICLE_NAME_MAX_LENGTH,
  type Vehicle,
  type VehicleGarage,
  type VehicleProfile,
} from '../../types/api'

export const DEFAULT_MPG = 25

const clampMpg = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MPG_MIN, Math.min(MPG_MAX, value))
    : fallback

/**
 * Validate a profile-shaped value. The name is cut to the maximum length;
 * surrounding whitespace is trimmed only when `trimName` is set (on read).
 */
export const sanitizeVehicleProfile = (
  raw: Partial<Record<keyof VehicleProfile, unknown>> | null | undefined,
  fallbackMpg: number,
  trimName: boolean
): VehicleProfile => {
  const source = raw ?? {}
  const rawName = typeof source.name === 'string' ? source.name : ''
  const name = (trimName ? rawName.trim() : rawName).slice(
    0,
    VEHICLE_NAME_MAX_LENGTH
  )
  const tank = source.tankGallons
  const tankGallons =
    typeof tank === 'number' &&
    Number.isFinite(tank) &&
    tank >= TANK_GALLONS_MIN &&
    tank <= TANK_GALLONS_MAX
      ? tank
      : null
  return {
    name,
    fuelType: source.fuelType === 'diesel' ? 'diesel' : 'gasoline',
    mpg: clampMpg(source.mpg, clampMpg(fallbackMpg, DEFAULT_MPG)),
    tankGallons,
  }
}

export const createVehicle = (
  id: string,
  patch?: Partial<VehicleProfile>
): Vehicle => ({
  id,
  ...sanitizeVehicleProfile(patch, DEFAULT_MPG, false),
})

export const garageFromProfile = (
  profile: VehicleProfile,
  id: string
): VehicleGarage => ({
  vehicles: [createVehicle(id, profile)],
  defaultVehicleId: id,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const sanitizeGarage = (raw: unknown): VehicleGarage | null => {
  if (!isRecord(raw) || !Array.isArray(raw.vehicles)) return null
  const seen = new Set<string>()
  const vehicles: Vehicle[] = []
  for (const item of raw.vehicles) {
    if (vehicles.length >= VEHICLES_MAX) break
    if (!isRecord(item)) continue
    const id = item.id
    if (typeof id !== 'string' || !VEHICLE_ID_PATTERN.test(id) || seen.has(id)) {
      continue
    }
    seen.add(id)
    vehicles.push({
      id,
      ...sanitizeVehicleProfile(item, DEFAULT_MPG, false),
    })
  }
  if (vehicles.length === 0) return null
  const defaultVehicleId =
    typeof raw.defaultVehicleId === 'string' && seen.has(raw.defaultVehicleId)
      ? raw.defaultVehicleId
      : vehicles[0].id
  return { vehicles, defaultVehicleId }
}

export const getDefaultVehicle = (garage: VehicleGarage): Vehicle =>
  garage.vehicles.find((v) => v.id === garage.defaultVehicleId) ??
  garage.vehicles[0]

export const resolveTripVehicle = (
  garage: VehicleGarage,
  vehicleId?: string
): Vehicle =>
  (vehicleId !== undefined
    ? garage.vehicles.find((v) => v.id === vehicleId)
    : undefined) ?? getDefaultVehicle(garage)

export const addVehicle = (
  garage: VehicleGarage,
  vehicle: Vehicle
): VehicleGarage =>
  garage.vehicles.length >= VEHICLES_MAX
    ? garage
    : { ...garage, vehicles: [...garage.vehicles, vehicle] }

export const updateVehicle = (
  garage: VehicleGarage,
  id: string,
  patch: Partial<VehicleProfile>
): VehicleGarage => ({
  ...garage,
  vehicles: garage.vehicles.map((v) =>
    v.id === id
      ? { id, ...sanitizeVehicleProfile({ ...v, ...patch }, v.mpg, false) }
      : v
  ),
})

export const removeVehicle = (
  garage: VehicleGarage,
  id: string
): VehicleGarage => {
  if (garage.vehicles.length <= 1) return garage
  const vehicles = garage.vehicles.filter((v) => v.id !== id)
  if (vehicles.length === garage.vehicles.length) return garage
  return {
    vehicles,
    defaultVehicleId:
      garage.defaultVehicleId === id ? vehicles[0].id : garage.defaultVehicleId,
  }
}

export const setDefaultVehicle = (
  garage: VehicleGarage,
  id: string
): VehicleGarage =>
  garage.vehicles.some((v) => v.id === id)
    ? { ...garage, defaultVehicleId: id }
    : garage
