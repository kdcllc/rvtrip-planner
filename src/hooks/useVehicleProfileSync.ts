import { useCallback, useEffect, useRef } from 'react'
import { useVehicleSettingsContext } from './useVehicleSettings'
import {
  loadVehicleGarage,
  saveVehicleGarage,
} from '../services/vehicle/vehiclesClient'
import type { VehicleGarage } from '../types/api'

type LoadState = 'idle' | 'inflight' | 'ok' | 'failed'

const garageKey = (garage: VehicleGarage) => JSON.stringify(garage)

/**
 * Syncs the vehicle garage with /api/vehicles. Call once from inside the
 * signed-in app. Loads on mount, copies the browser value to the server when
 * the server has none, then saves every debounced change.
 */
export const useVehicleProfileSync = () => {
  const {
    garage,
    debouncedGarage,
    replaceGarage,
    setProfileSyncStatus,
  } = useVehicleSettingsContext()

  const garageRef = useRef(garage)
  const loadStateRef = useRef<LoadState>('idle')
  const lastSavedRef = useRef<string | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    garageRef.current = garage
  }, [garage])

  const save = useCallback(
    async (value: VehicleGarage, generation: number) => {
      const result = await saveVehicleGarage(value)
      if (generation !== generationRef.current) return false
      if (result.kind === 'success') {
        lastSavedRef.current = garageKey(value)
        setProfileSyncStatus('synced')
        return true
      }
      setProfileSyncStatus('error')
      return false
    },
    [setProfileSyncStatus]
  )

  const initialLoad = useCallback(async () => {
    const generation = generationRef.current
    loadStateRef.current = 'inflight'
    setProfileSyncStatus('loading')
    const result = await loadVehicleGarage()
    if (generation !== generationRef.current) return
    if (result.kind !== 'success') {
      loadStateRef.current = 'failed'
      setProfileSyncStatus('error')
      return
    }
    const server = result.data.garage
    if (server) {
      lastSavedRef.current = garageKey(server)
      loadStateRef.current = 'ok'
      replaceGarage(server)
      setProfileSyncStatus('synced')
      return
    }
    const local = garageRef.current
    const saved = await save(local, generation)
    if (generation !== generationRef.current) return
    loadStateRef.current = saved ? 'ok' : 'failed'
  }, [replaceGarage, save, setProfileSyncStatus])

  // Initial load on mount; unmount cancels pending work.
  useEffect(() => {
    generationRef.current += 1
    void initialLoad()
    return () => {
      generationRef.current += 1
      loadStateRef.current = 'idle'
    }
  }, [initialLoad])

  // Later changes: retry a failed load first, otherwise save when different.
  useEffect(() => {
    const state = loadStateRef.current
    if (state === 'inflight' || state === 'idle') return
    if (state === 'failed') {
      void initialLoad()
      return
    }
    if (garageKey(debouncedGarage) === lastSavedRef.current) return
    setProfileSyncStatus('loading')
    void save(debouncedGarage, generationRef.current)
  }, [debouncedGarage, initialLoad, save, setProfileSyncStatus])
}
