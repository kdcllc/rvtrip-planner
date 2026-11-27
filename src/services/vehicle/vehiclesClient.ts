import { apiGet, apiPut } from '../auth/apiClient'
import type {
  GetVehiclesResponse,
  PutVehiclesResponse,
  VehicleGarage,
} from '../../types/api'

export const loadVehicleGarage = () =>
  apiGet<GetVehiclesResponse>('/api/vehicles')

export const saveVehicleGarage = (garage: VehicleGarage) =>
  apiPut<PutVehiclesResponse>('/api/vehicles', { garage })
