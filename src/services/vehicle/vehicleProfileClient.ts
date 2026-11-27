import { apiGet, apiPut } from '../auth/apiClient'
import type {
  GetVehicleProfileResponse,
  PutVehicleProfileResponse,
  VehicleProfile,
} from '../../types/api'

export const loadVehicleProfile = () =>
  apiGet<GetVehicleProfileResponse>('/api/vehicle-profile')

export const saveVehicleProfile = (profile: VehicleProfile) =>
  apiPut<PutVehicleProfileResponse>('/api/vehicle-profile', { profile })
