export type TripStopStatus = 'idle' | 'geocoding' | 'ready' | 'error'

export type TripStop = {
  id: string
  label: string
  address: string
  startDate: string
  endDate: string
  location?: {
    lat: number
    lng: number
  }
  status?: TripStopStatus
}
