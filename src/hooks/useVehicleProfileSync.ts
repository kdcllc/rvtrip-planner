import { useCallback, useEffect, useRef } from 'react'
import { useVehicleSettingsContext } from './useVehicleSettings'
import {
  loadVehicleProfile,
  saveVehicleProfile,
} from '../services/vehicle/vehicleProfileClient'
import type { VehicleProfile } from '../types/api'

type LoadState = 'idle' | 'inflight' | 'ok' | 'failed'

const profileKey = (profile: VehicleProfile) => JSON.stringify(profile)

/**
 * Syncs the RV profile with /api/vehicle-profile. Call once from inside the
 * signed-in app. Loads on mount, copies the browser value to the server when
 * the server has none, then saves every debounced change.
 */
export const useVehicleProfileSync = () => {
  const {
    profile,
    debouncedProfile,
    replaceProfile,
    setProfileSyncStatus,
  } = useVehicleSettingsContext()

  const profileRef = useRef(profile)
  const loadStateRef = useRef<LoadState>('idle')
  const lastSavedRef = useRef<string | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  const save = useCallback(
    async (value: VehicleProfile, generation: number) => {
      const result = await saveVehicleProfile(value)
      if (generation !== generationRef.current) return false
      if (result.kind === 'success') {
        lastSavedRef.current = profileKey(value)
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
    const result = await loadVehicleProfile()
    if (generation !== generationRef.current) return
    if (result.kind !== 'success') {
      loadStateRef.current = 'failed'
      setProfileSyncStatus('error')
      return
    }
    const server = result.data.profile
    if (server) {
      lastSavedRef.current = profileKey(server)
      loadStateRef.current = 'ok'
      replaceProfile(server)
      setProfileSyncStatus('synced')
      return
    }
    const local = profileRef.current
    const saved = await save(local, generation)
    if (generation !== generationRef.current) return
    loadStateRef.current = saved ? 'ok' : 'failed'
  }, [replaceProfile, save, setProfileSyncStatus])

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
    if (profileKey(debouncedProfile) === lastSavedRef.current) return
    setProfileSyncStatus('loading')
    void save(debouncedProfile, generationRef.current)
  }, [debouncedProfile, initialLoad, save, setProfileSyncStatus])
}
