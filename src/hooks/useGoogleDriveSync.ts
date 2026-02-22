import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Trip, TripsState } from '../domain/trip/types'
import { GOOGLE_DRIVE_CLIENT_ID } from '../config/env'
import {
  createDriveFile,
  downloadDriveFile,
  ensureDriveFolder,
  listDriveFiles,
  updateDriveFile,
  type DriveFileInfo,
} from '../services/drive/googleDriveService'
import {
  buildDriveAppProperties,
  buildDriveTripPayload,
  createStopsChecksum,
  createTripFileName,
  type DriveTripFileInfo,
  type DriveTripPayload,
} from '../services/drive/tripDriveSync'
import {
  loadDriveChecksums,
  loadDriveFileMap,
  loadDriveIgnoredTripIds,
  loadDriveQueue,
  saveDriveChecksums,
  saveDriveFileMap,
  saveDriveIgnoredTripIds,
  saveDriveQueue,
} from '../services/drive/driveStorage'
import {
  loadAccessToken,
  saveAccessToken,
  clearAccessToken,
  isTokenNearExpiry,
} from '../services/drive/tokenStorage'
import { loadGoogleIdentityServices, revokeGoogleAccess } from '../services/drive/googleIdentity'

const DRIVE_FOLDER_NAME = 'Trip Planner'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export type DriveAuthStatus = 'signed-out' | 'loading' | 'signed-in' | 'error'
export type DriveSyncStatus = 'idle' | 'syncing' | 'error'

export type DriveConflictType = 'remote-newer' | 'checksum-mismatch' | 'remote-only'

export type DriveConflict = {
  id: string
  tripId: string
  tripName: string
  type: DriveConflictType
  fileId: string
  localUpdatedAt?: string
  remoteUpdatedAt?: string
}

type TokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type SyncResult = {
  conflicts: DriveConflict[]
  fileMap: Record<string, string>
  checksums: Record<string, string>
}

export function useGoogleDriveSync(
  tripsState: TripsState,
  setTripsState: Dispatch<SetStateAction<TripsState>>,
) {
  const [authStatus, setAuthStatus] = useState<DriveAuthStatus>('signed-out')
  const [syncStatus, setSyncStatus] = useState<DriveSyncStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<DriveConflict[]>([])
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [fileMap, setFileMap] = useState<Record<string, string>>(() => loadDriveFileMap())
  const [checksums, setChecksums] = useState<Record<string, string>>(() => loadDriveChecksums())
  const [queue, setQueue] = useState<Set<string>>(() => new Set(loadDriveQueue()))
  const [ignoredTripIds, setIgnoredTripIds] = useState<Set<string>>(
    () => new Set(loadDriveIgnoredTripIds())
  )

  const accessTokenRef = useRef<string | null>(null)
  const tokenExpiresAtRef = useRef<number | null>(null)
  const folderIdRef = useRef<string | null>(null)
  const initializingRef = useRef(false)

  const hasClientId = Boolean(GOOGLE_DRIVE_CLIENT_ID)

  // Load stored token on mount
  useEffect(() => {
    if (initializingRef.current) return
    initializingRef.current = true

    const storedToken = loadAccessToken()
    if (storedToken && hasClientId) {
      accessTokenRef.current = storedToken
      setAuthStatus('signed-in')
    }
  }, [hasClientId])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const requestAccessToken = useCallback(async (silentMode = false) => {
    await loadGoogleIdentityServices()

    if (!GOOGLE_DRIVE_CLIENT_ID) {
      throw new Error('Missing Google Drive client ID')
    }

    return new Promise<TokenResponse>((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error('Google Identity Services is unavailable'))
        return
      }

      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_DRIVE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (response) => resolve(response as TokenResponse),
      })

      // Use 'none' for silent refresh (no prompt), 'consent' for explicit sign-in
      client.requestAccessToken({ prompt: silentMode ? 'none' : 'consent' })
    })
  }, [])

  const refreshAccessToken = useCallback(async (silent = true) => {
    try {
      const response = await requestAccessToken(silent)
      if (response.error) {
        if (silent && response.error === 'popup_closed_by_user') {
          // Silent refresh failed because user isn't logged into Google or denied
          throw new Error('Silent refresh failed. Please sign in again.')
        }
        throw new Error(response.error_description ?? response.error)
      }
      if (!response.access_token) {
        throw new Error('No access token returned from Google')
      }

      accessTokenRef.current = response.access_token
      tokenExpiresAtRef.current = response.expires_in
        ? Date.now() + response.expires_in * 1000
        : null

      saveAccessToken(response.access_token, response.expires_in)
      setError(null)
      return true
    } catch (refreshError) {
      console.error('Token refresh failed:', refreshError)

      if (!silent) {
        // Explicit refresh failed - show error
        setError(refreshError instanceof Error ? refreshError.message : 'Token refresh failed')
      }

      // After failed refresh, clear token
      clearAccessToken()
      setAuthStatus('signed-out')
      return false
    }
  }, [requestAccessToken])


  const ensureFolder = useCallback(async () => {
    if (!accessTokenRef.current) {
      throw new Error('Missing Drive access token')
    }

    if (folderIdRef.current) {
      return folderIdRef.current
    }

    const folder = await ensureDriveFolder(accessTokenRef.current, DRIVE_FOLDER_NAME)
    folderIdRef.current = folder.id
    return folder.id
  }, [])

  const performUpload = useCallback(
    async (trip: Trip, existingFileId?: string) => {
      if (!accessTokenRef.current) {
        throw new Error('Missing Drive access token')
      }

      const checksum = createStopsChecksum(trip.stops)
      const payload = buildDriveTripPayload(trip)
      const appProperties = buildDriveAppProperties(trip, checksum)
      const name = createTripFileName(trip)

      let updatedFile: DriveFileInfo
      if (existingFileId) {
        updatedFile = await updateDriveFile(accessTokenRef.current, {
          fileId: existingFileId,
          name,
          appProperties,
          payload,
        })
      } else {
        const folderId = await ensureFolder()
        updatedFile = await createDriveFile(accessTokenRef.current, {
          folderId,
          name,
          appProperties,
          payload,
        })
      }

      return {
        fileId: updatedFile.id,
        checksum,
      }
    },
    [ensureFolder],
  )

  const uploadTrip = useCallback(
    async (trip: Trip) => {
      const existingFileId = fileMap[trip.id]
      const uploadResult = await performUpload(trip, existingFileId)

      const nextFileMap = {
        ...fileMap,
        [trip.id]: uploadResult.fileId,
      }
      setFileMap(nextFileMap)
      saveDriveFileMap(nextFileMap)

      const nextChecksums = {
        ...checksums,
        [trip.id]: uploadResult.checksum,
      }
      setChecksums(nextChecksums)
      saveDriveChecksums(nextChecksums)
    },
    [checksums, fileMap, performUpload],
  )

  const applyDriveTrip = useCallback(
    (payload: DriveTripPayload) => {
      const incomingTrip = payload.trip
      setTripsState((prev) => {
        const index = prev.trips.findIndex((item) => item.id === incomingTrip.id)
        if (index === -1) {
          return {
            ...prev,
            trips: [...prev.trips, incomingTrip],
            currentTripId: prev.currentTripId ?? incomingTrip.id,
          }
        }

        const updatedTrips = [...prev.trips]
        updatedTrips[index] = incomingTrip
        return {
          ...prev,
          trips: updatedTrips,
        }
      })

      const nextChecksums = {
        ...checksums,
        [incomingTrip.id]: payload.checksum,
      }
      setChecksums(nextChecksums)
      saveDriveChecksums(nextChecksums)
    },
    [checksums, setTripsState],
  )

  const syncTripsWithDrive = useCallback(
    async (state: TripsState): Promise<SyncResult> => {
      if (!accessTokenRef.current) {
        throw new Error('Missing Drive access token')
      }

      const folderId = await ensureFolder()
      const driveFiles = await listDriveFiles(accessTokenRef.current, folderId)
      const driveTrips = driveFiles
        .map(toDriveTripFile)
        .filter((file): file is DriveTripFileInfo => Boolean(file?.appProperties?.tripId))

      const driveTripMap = new Map(driveTrips.map((file) => [file.appProperties?.tripId, file]))
      const nextFileMap = { ...fileMap }
      const nextChecksums = { ...checksums }
      const nextConflicts: DriveConflict[] = []

      for (const trip of state.trips) {
        const driveFile = driveTripMap.get(trip.id)
        const localChecksum = createStopsChecksum(trip.stops)
        const remoteChecksum = driveFile?.appProperties?.checksum
        const remoteUpdatedAt = driveFile?.appProperties?.updatedAt

        if (!driveFile) {
          const uploadResult = await performUpload(trip)
          nextFileMap[trip.id] = uploadResult.fileId
          nextChecksums[trip.id] = uploadResult.checksum
          continue
        }

        nextFileMap[trip.id] = driveFile.id

        if (remoteChecksum && remoteChecksum === localChecksum) {
          nextChecksums[trip.id] = localChecksum
          continue
        }

        const remoteUpdatedValue = parseDateValue(remoteUpdatedAt ?? driveFile.modifiedTime)
        const localUpdatedValue = parseDateValue(trip.updatedAt)

        if (remoteUpdatedValue > localUpdatedValue) {
          nextConflicts.push({
            id: `${trip.id}-remote-newer`,
            tripId: trip.id,
            tripName: trip.name,
            type: 'remote-newer',
            fileId: driveFile.id,
            localUpdatedAt: trip.updatedAt,
            remoteUpdatedAt: remoteUpdatedAt ?? driveFile.modifiedTime,
          })
          continue
        }

        if (remoteUpdatedValue === localUpdatedValue) {
          nextConflicts.push({
            id: `${trip.id}-checksum-mismatch`,
            tripId: trip.id,
            tripName: trip.name,
            type: 'checksum-mismatch',
            fileId: driveFile.id,
            localUpdatedAt: trip.updatedAt,
            remoteUpdatedAt: remoteUpdatedAt ?? driveFile.modifiedTime,
          })
          continue
        }

        const uploadResult = await performUpload(trip, driveFile.id)
        nextFileMap[trip.id] = uploadResult.fileId
        nextChecksums[trip.id] = uploadResult.checksum
      }

      for (const file of driveTrips) {
        const tripId = file.appProperties?.tripId
        if (!tripId || state.trips.some((trip) => trip.id === tripId)) {
          continue
        }
        if (ignoredTripIds.has(tripId)) {
          continue
        }

        nextConflicts.push({
          id: `${tripId}-remote-only`,
          tripId,
          tripName: file.appProperties?.tripName ?? file.name,
          type: 'remote-only',
          fileId: file.id,
          remoteUpdatedAt: file.appProperties?.updatedAt ?? file.modifiedTime,
        })
      }

      saveDriveFileMap(nextFileMap)
      saveDriveChecksums(nextChecksums)

      return {
        conflicts: nextConflicts,
        fileMap: nextFileMap,
        checksums: nextChecksums,
      }
    },
    [checksums, ensureFolder, fileMap, ignoredTripIds, performUpload],
  )

  const resolveConflict = useCallback(
    async (conflict: DriveConflict, action: 'use-local' | 'use-drive' | 'ignore') => {
      if (!accessTokenRef.current) return

      setSyncStatus('syncing')
      setError(null)

      try {
        if (action === 'ignore') {
          setIgnoredTripIds((prev) => {
            const next = new Set(prev)
            next.add(conflict.tripId)
            saveDriveIgnoredTripIds(Array.from(next))
            return next
          })
        }

        if (action === 'use-local') {
          const trip = tripsState.trips.find((item) => item.id === conflict.tripId)
          if (trip) {
            await uploadTrip(trip)
          }
        }

        if (action === 'use-drive') {
          const payload = await downloadDriveFile<DriveTripPayload>(
            accessTokenRef.current,
            conflict.fileId,
          )
          applyDriveTrip(payload)

          const nextFileMap = {
            ...fileMap,
            [conflict.tripId]: conflict.fileId,
          }
          setFileMap(nextFileMap)
          saveDriveFileMap(nextFileMap)
        }

        setConflicts((prev) => prev.filter((item) => item.id !== conflict.id))
        setLastSyncAt(new Date().toISOString())
        setSyncStatus('idle')
      } catch (syncError) {
        setSyncStatus('error')
        setError(syncError instanceof Error ? syncError.message : 'Unable to resolve conflict')
      }
    },
    [applyDriveTrip, fileMap, tripsState.trips, uploadTrip],
  )

  const syncAll = useCallback(
    async (reason: 'initial' | 'manual' | 'queue' | 'auto') => {
      if (!accessTokenRef.current) return
      if (!isOnline) {
        setSyncStatus('idle')
        if (reason !== 'auto') {
          setError('You are offline. Sync will resume when you are back online.')
        }
        return
      }

      setSyncStatus('syncing')
      setError(null)

      try {
        const result = await syncTripsWithDrive(tripsState)
        setFileMap(result.fileMap)
        setChecksums(result.checksums)
        setConflicts(result.conflicts)
        if (result.conflicts.length === 0) {
          setLastSyncAt(new Date().toISOString())
        }
        setSyncStatus('idle')
      } catch (syncError) {
        setSyncStatus('error')
        setError(syncError instanceof Error ? syncError.message : 'Unable to sync with Drive')
      }
    },
    [isOnline, syncTripsWithDrive, tripsState],
  )

  const syncNow = useCallback(async () => {
    await syncAll('manual')
  }, [syncAll])

  const signIn = useCallback(async () => {
    setError(null)
    setAuthStatus('loading')

    try {
      // Use explicit consent prompt for initial sign-in
      const response = await requestAccessToken(false)
      if (response.error) {
        throw new Error(response.error_description ?? response.error)
      }
      if (!response.access_token) {
        throw new Error('No access token returned from Google')
      }

      accessTokenRef.current = response.access_token
      tokenExpiresAtRef.current = response.expires_in
        ? Date.now() + response.expires_in * 1000
        : null

      // Persist token
      saveAccessToken(response.access_token, response.expires_in)

      setAuthStatus('signed-in')
      await syncAll('initial')
    } catch (syncError) {
      setAuthStatus('error')
      setError(syncError instanceof Error ? syncError.message : 'Unable to sign in to Drive')
    }
  }, [requestAccessToken, syncAll])

  const signOut = useCallback(async () => {
    const token = accessTokenRef.current
    if (token) {
      await revokeGoogleAccess(token)
    }

    accessTokenRef.current = null
    tokenExpiresAtRef.current = null
    folderIdRef.current = null
    clearAccessToken()
    setAuthStatus('signed-out')
    setConflicts([])
    setSyncStatus('idle')
  }, [])

  const enqueueTrip = useCallback((tripId: string) => {
    setQueue((prev) => {
      const next = new Set(prev)
      next.add(tripId)
      saveDriveQueue(Array.from(next))
      return next
    })
  }, [])

  const flushQueue = useCallback(async () => {
    if (!accessTokenRef.current || queue.size === 0 || !isOnline) return

    const queuedTrips = tripsState.trips.filter((trip) => queue.has(trip.id))
    if (queuedTrips.length === 0) {
      setQueue(new Set())
      saveDriveQueue([])
      return
    }

    setSyncStatus('syncing')

    try {
      for (const trip of queuedTrips) {
        await uploadTrip(trip)
      }
      setQueue(new Set())
      saveDriveQueue([])
      setLastSyncAt(new Date().toISOString())
      setSyncStatus('idle')
    } catch (syncError) {
      setSyncStatus('error')
      setError(syncError instanceof Error ? syncError.message : 'Unable to sync queued trips')
    }
  }, [isOnline, queue, tripsState.trips, uploadTrip])

  useEffect(() => {
    if (authStatus !== 'signed-in') return
    if (conflicts.length > 0) return

    const changedTrips = tripsState.trips.filter((trip) => {
      const checksum = createStopsChecksum(trip.stops)
      return checksums[trip.id] !== checksum
    })

    if (changedTrips.length === 0) return

    if (!isOnline) {
      changedTrips.forEach((trip) => enqueueTrip(trip.id))
      return
    }

    void (async () => {
      setSyncStatus('syncing')
      setError(null)

      try {
        for (const trip of changedTrips) {
          await uploadTrip(trip)
        }
        setLastSyncAt(new Date().toISOString())
        setSyncStatus('idle')
      } catch (syncError) {
        setSyncStatus('error')
        setError(syncError instanceof Error ? syncError.message : 'Unable to sync trips')
      }
    })()
  }, [authStatus, checksums, conflicts.length, enqueueTrip, isOnline, tripsState.trips, uploadTrip])

  useEffect(() => {
    if (authStatus !== 'signed-in') return
    if (queue.size === 0) return

    void flushQueue()
  }, [authStatus, flushQueue, queue.size])

  // Check for token expiry and silently refresh without user prompt (every 30 seconds)
  useEffect(() => {
    if (authStatus !== 'signed-in') return

    const interval = setInterval(() => {
      if (isTokenNearExpiry()) {
        // Use silent mode (prompt: 'none') - no user interaction needed if they're still logged into Google
        void refreshAccessToken(true)
      }
    }, 30000) // Check every 30 seconds

    return () => clearInterval(interval)
  }, [authStatus, refreshAccessToken])

  return {
    authStatus,
    syncStatus,
    error,
    lastSyncAt,
    conflicts,
    isOnline,
    hasClientId,
    signIn,
    signOut,
    syncNow,
    resolveConflict,
  }
}

function parseDateValue(value?: string): number {
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function toDriveTripFile(file: DriveFileInfo): DriveTripFileInfo | null {
  if (!file.appProperties?.tripId) {
    return null
  }

  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    appProperties: file.appProperties as DriveTripFileInfo['appProperties'],
  }
}
