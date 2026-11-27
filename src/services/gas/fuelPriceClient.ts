import { apiGet } from '../auth/apiClient'
import type { GetFuelPricesResponse } from '../../types/api'

export const loadFuelPrices = (area: string, product: string, from: string, to: string) =>
  apiGet<GetFuelPricesResponse>(
    `/api/fuel-prices?area=${encodeURIComponent(area)}&product=${encodeURIComponent(product)}` +
      `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
