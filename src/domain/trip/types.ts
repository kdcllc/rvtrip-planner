export type TripStopStatus = 'idle' | 'geocoding' | 'ready' | 'error'

export type TripStopSourceName =
  | 'RV Life'
  | 'Hipcamp'
  | 'Campendium'
  | 'Harvest Hosts'
  | 'RV Parky'
  | 'Other'

export type TripStopSource = {
  name: TripStopSourceName
  url?: string
  siteType?: string
  fees?: string
  amenities?: string
}

export type TripStop = {
  id: string
  label: string
  address: string
  startDate: string
  endDate: string
  checkInTime?: string
  checkOutTime?: string
  note?: string
  source?: TripStopSource
  location?: {
    lat: number
    lng: number
  }
  status?: TripStopStatus
  manualEntry?: boolean
  distanceFromPreviousMeters?: number
  estimatedFuelCost?: number
}

export type Trip = {
  id: string
  name: string
  stops: TripStop[]
  createdAt: string
  updatedAt: string
  vehicleSettings?: {
    mpg: number
  }
}

export type TripsState = {
  trips: Trip[]
  currentTripId: string | null
}
