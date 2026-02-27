import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Trip, TripsState, TripStop } from '../domain/trip/types'
import type {
  TripConflict,
  TripConflictDecision,
  TripConflictSide,
  TripStopMergeDecision,
} from '../domain/trip/conflicts'
import { GOOGLE_DRIVE_CLIENT_ID } from '../config/env'
import { createId } from '../utils/id'
import {
  createDriveFile,
  downloadDriveFile,
  ensureDriveFolder,
  listDriveFiles,
  updateDriveFile,
  DriveApiError,
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
  loadDriveDeviceId,
  loadDriveFileMap,
  loadDriveIgnoredTripIds,
  loadDriveLastSyncedAtMap,
  loadDriveQueue,
  loadDriveTripNames,
  saveDriveChecksums,
  saveDriveDeviceId,
  saveDriveFileMap,
  saveDriveIgnoredTripIds,
  saveDriveLastSyncedAtMap,
  saveDriveQueue,
  saveDriveTripNames,
} from '../services/drive/driveStorage'
import {
  loadAccessToken,
  saveAccessToken,
  clearAccessToken,
  isTokenNearExpiry,
  loadDriveUserInfo,
  saveDriveUserInfo,
  type DriveUserInfo,
} from '../services/drive/tokenStorage'
import {
  fetchGoogleUserInfo,
  loadGoogleIdentityServices,
  revokeGoogleAccess,
} from '../services/drive/googleIdentity'

const DRIVE_FOLDER_NAME = 'Trip Planner'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file openid email profile'

export type DriveAuthStatus = 'signed-out' | 'loading' | 'signed-in' | 'error'
export type DriveSyncStatus = 'idle' | 'syncing' | 'error'

type TokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type SyncResult = {
  conflicts: TripConflict[]
  fileMap: Record<string, string>
  checksums: Record<string, string>
  tripNames: Record<string, string>
  lastSyncedAtByTrip: Record<string, string>
}

export function useGoogleDriveSync(
  tripsState: TripsState,
  setTripsState: Dispatch<SetStateAction<TripsState>>,
) {
  const [authStatus, setAuthStatus] = useState<DriveAuthStatus>('signed-out')
  const [syncStatus, setSyncStatus] = useState<DriveSyncStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<TripConflict[]>([])
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [userInfo, setUserInfo] = useState<DriveUserInfo | null>(() => loadDriveUserInfo())
  const [gisReady, setGisReady] = useState(() => Boolean(window.google?.accounts?.oauth2))
  const [fileMap, setFileMap] = useState<Record<string, string>>(() => loadDriveFileMap())
  const [checksums, setChecksums] = useState<Record<string, string>>(() => loadDriveChecksums())
  const [tripNames, setTripNames] = useState<Record<string, string>>(() => loadDriveTripNames())
  const [lastSyncedAtByTrip, setLastSyncedAtByTrip] = useState<Record<string, string>>(() =>
    loadDriveLastSyncedAtMap(),
  )
  const [deviceId] = useState(() => {
    const stored = loadDriveDeviceId()
    if (stored) return stored
    const next = createId()
    saveDriveDeviceId(next)
    return next
  })
  const [queue, setQueue] = useState<Set<string>>(() => new Set(loadDriveQueue()))
  const [ignoredTripIds, setIgnoredTripIds] = useState<Set<string>>(
    () => new Set(loadDriveIgnoredTripIds())
  )

  const accessTokenRef = useRef<string | null>(null)
  const tokenExpiresAtRef = useRef<number | null>(null)
  const folderIdRef = useRef<string | null>(null)
  const initializingRef = useRef(false)
  const silentAuthAttemptedRef = useRef(false)

  const hasClientId = Boolean(GOOGLE_DRIVE_CLIENT_ID)

  // Load stored token on mount
  useEffect(() => {
    if (initializingRef.current) return
    initializingRef.current = true

    const storedToken = loadAccessToken()
    if (storedToken && hasClientId) {
      accessTokenRef.current = storedToken
      setAuthStatus('signed-in')
      setUserInfo(loadDriveUserInfo())
    } else if (!storedToken) {
      setUserInfo(null)
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

  useEffect(() => {
    if (!hasClientId || gisReady) return

    void loadGoogleIdentityServices()
      .then(() => setGisReady(true))
      .catch(() => setGisReady(false))
  }, [gisReady, hasClientId])

  const requestAccessTokenInteractive = useCallback(
    (prompt?: 'consent' | 'select_account') => {
      if (!GOOGLE_DRIVE_CLIENT_ID) {
        throw new Error('Missing Google Drive client ID')
      }

      return new Promise<TokenResponse>((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) {
          reject(new Error('Google Identity Services is not ready. Please try again.'))
          return
        }

        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_DRIVE_CLIENT_ID,
          scope: DRIVE_SCOPE,
          callback: (response) => resolve(response as TokenResponse),
        })

        if (prompt) {
          client.requestAccessToken({ prompt })
        } else {
          client.requestAccessToken({})
        }
      })
    },
    [],
  )

  const requestAccessTokenSilent = useCallback(async () => {
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

      client.requestAccessToken({ prompt: 'none' })
    })
  }, [])

  const applyTokenResponse = useCallback(async (response: TokenResponse) => {
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

    saveAccessToken(response.access_token, response.expires_in)

    const profile = await fetchGoogleUserInfo(response.access_token)
    if (profile) {
      saveDriveUserInfo(profile)
      setUserInfo(profile)
    }

    setError(null)
  }, [])

  const withTimeout = useCallback(
    async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
      let timeoutId: number | undefined
      const timeout = new Promise<T>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(message))
        }, ms)
      })

      try {
        return await Promise.race([promise, timeout])
      } finally {
        if (timeoutId) {
          window.clearTimeout(timeoutId)
        }
      }
    },
    [],
  )

  const refreshAccessToken = useCallback(async (silent = true) => {
    try {
      const response = await withTimeout(
        requestAccessTokenSilent(),
        6000,
        'Silent refresh timed out. Please sign in again.',
      )
      await applyTokenResponse(response)
      return true
    } catch (refreshError) {
      console.error('Token refresh failed:', refreshError)

      if (!silent) {
        // Explicit refresh failed - show error
        setError(refreshError instanceof Error ? refreshError.message : 'Token refresh failed')
      }

      // After failed refresh, clear token
      clearAccessToken()
      setUserInfo(null)
      setAuthStatus('signed-out')
      return false
    }
  }, [applyTokenResponse, requestAccessTokenSilent, withTimeout])

  const withDriveAuthRetry = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      try {
        return await operation()
      } catch (error) {
        if (error instanceof DriveApiError && error.status === 401) {
          const refreshed = await refreshAccessToken(true)
          if (refreshed) {
            return await operation()
          }
        }
        throw error
      }
    },
    [refreshAccessToken],
  )


  const ensureFolder = useCallback(async () => {
    if (!accessTokenRef.current) {
      throw new Error('Missing Drive access token')
    }

    if (folderIdRef.current) {
      return folderIdRef.current
    }

    const folder = await withDriveAuthRetry(() =>
      ensureDriveFolder(accessTokenRef.current as string, DRIVE_FOLDER_NAME),
    )
    folderIdRef.current = folder.id
    return folder.id
  }, [withDriveAuthRetry])

  const performUpload = useCallback(
    async (trip: Trip, existingFileId?: string) => {
      if (!accessTokenRef.current) {
        throw new Error('Missing Drive access token')
      }

      const checksum = createStopsChecksum(trip.stops)
      const payload = buildDriveTripPayload(trip)
      const lastSyncedAt = new Date().toISOString()
      const appProperties = buildDriveAppProperties(trip, checksum, {
        deviceId,
        lastSyncedAt,
      })
      const name = createTripFileName(trip)

      let updatedFile: DriveFileInfo
      if (existingFileId) {
        updatedFile = await withDriveAuthRetry(() =>
          updateDriveFile(accessTokenRef.current as string, {
            fileId: existingFileId,
            name,
            appProperties,
            payload,
          }),
        )
      } else {
        const folderId = await ensureFolder()
        updatedFile = await withDriveAuthRetry(() =>
          createDriveFile(accessTokenRef.current as string, {
            folderId,
            name,
            appProperties,
            payload,
          }),
        )
      }

      return {
        fileId: updatedFile.id,
        checksum,
        lastSyncedAt,
      }
    },
    [deviceId, ensureFolder, withDriveAuthRetry],
  )

  const applyUploadResult = useCallback(
    (trip: Trip, uploadResult: { fileId: string; checksum: string; lastSyncedAt?: string }) => {
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

      const nextTripNames = {
        ...tripNames,
        [trip.id]: trip.name,
      }
      setTripNames(nextTripNames)
      saveDriveTripNames(nextTripNames)

      if (uploadResult.lastSyncedAt) {
        const nextLastSynced = {
          ...lastSyncedAtByTrip,
          [trip.id]: uploadResult.lastSyncedAt,
        }
        setLastSyncedAtByTrip(nextLastSynced)
        saveDriveLastSyncedAtMap(nextLastSynced)
      }
    },
    [checksums, fileMap, lastSyncedAtByTrip, tripNames],
  )

  const buildMergedStops = useCallback(
    (localStops: TripStop[], remoteStops: TripStop[], decisions: TripStopMergeDecision[]) => {
      const localById = new Map(localStops.map((stop) => [stop.id, stop]))
      const remoteById = new Map(remoteStops.map((stop) => [stop.id, stop]))
      const merged: TripStop[] = []

      for (const decision of decisions) {
        if (decision.choice === 'skip') {
          continue
        }

        if (decision.choice === 'local') {
          if (!decision.localStopId) {
            throw new Error('Missing local stop for merge selection.')
          }
          const stop = localById.get(decision.localStopId)
          if (!stop) {
            throw new Error('Local stop not found for merge selection.')
          }
          merged.push(stop)
          continue
        }

        if (!decision.remoteStopId) {
          throw new Error('Missing Drive stop for merge selection.')
        }
        const stop = remoteById.get(decision.remoteStopId)
        if (!stop) {
          throw new Error('Drive stop not found for merge selection.')
        }
        merged.push(stop)
      }

      return merged
    },
    [],
  )

  const uploadTrip = useCallback(
    async (trip: Trip) => {
      const existingFileId = fileMap[trip.id]
      const uploadResult = await performUpload(trip, existingFileId)
      applyUploadResult(trip, uploadResult)
    },
    [applyUploadResult, fileMap, performUpload],
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

      const nextTripNames = {
        ...tripNames,
        [incomingTrip.id]: incomingTrip.name,
      }
      setTripNames(nextTripNames)
      saveDriveTripNames(nextTripNames)

      const nextLastSynced = {
        ...lastSyncedAtByTrip,
        [incomingTrip.id]: new Date().toISOString(),
      }
      setLastSyncedAtByTrip(nextLastSynced)
      saveDriveLastSyncedAtMap(nextLastSynced)
    },
    [checksums, lastSyncedAtByTrip, setTripsState, tripNames],
  )

  const syncTripsWithDrive = useCallback(
    async (state: TripsState): Promise<SyncResult> => {
      if (!accessTokenRef.current) {
        throw new Error('Missing Drive access token')
      }

      const folderId = await ensureFolder()
      const driveFiles = await withDriveAuthRetry(() =>
        listDriveFiles(accessTokenRef.current as string, folderId),
      )
      const driveTrips = driveFiles
        .map(toDriveTripFile)
        .filter((file): file is DriveTripFileInfo => Boolean(file?.appProperties?.tripId))

      const driveTripMap = new Map(driveTrips.map((file) => [file.appProperties?.tripId, file]))
      const nextFileMap = { ...fileMap }
      const nextChecksums = { ...checksums }
      const nextTripNames = { ...tripNames }
      const nextLastSyncedAtByTrip = { ...lastSyncedAtByTrip }
      const nextConflicts: TripConflict[] = []
      const renameUpdates: Array<{ tripId: string; newName: string; updatedAt: string }> = []
      const remoteStopsCache = new Map<string, TripStop[]>()

      const loadRemoteStops = async (fileId: string): Promise<TripStop[]> => {
        if (remoteStopsCache.has(fileId)) {
          return remoteStopsCache.get(fileId) as TripStop[]
        }

        const payload = await withDriveAuthRetry(() =>
          downloadDriveFile<DriveTripPayload>(accessTokenRef.current as string, fileId),
        )
        const stops = payload?.trip?.stops ?? []
        remoteStopsCache.set(fileId, stops)
        return stops
      }

      for (const trip of state.trips) {
        const driveFile = driveTripMap.get(trip.id)
        const localChecksum = createStopsChecksum(trip.stops)
        const remoteChecksum = driveFile?.appProperties?.checksum
        const remoteUpdatedAt = driveFile?.appProperties?.updatedAt

        if (!driveFile) {
          const hadRemote = Boolean(fileMap[trip.id])
          if (hadRemote) {
            nextConflicts.push(
              buildDriveConflict({
                trip,
                file: null,
                category: 'missing-remote',
                localChecksum,
                lastSyncedAt: lastSyncedAtByTrip[trip.id],
              }),
            )
            continue
          }

          const uploadResult = await performUpload(trip)
          nextFileMap[trip.id] = uploadResult.fileId
          nextChecksums[trip.id] = uploadResult.checksum
          nextTripNames[trip.id] = trip.name
          if (uploadResult.lastSyncedAt) {
            nextLastSyncedAtByTrip[trip.id] = uploadResult.lastSyncedAt
          }
          continue
        }

        nextFileMap[trip.id] = driveFile.id

        const remoteName = driveFile.appProperties?.tripName
        const nameChanged = Boolean(remoteName && remoteName !== trip.name)
        const stopsMatch = Boolean(remoteChecksum && remoteChecksum === localChecksum)

        if (stopsMatch && !nameChanged) {
          nextChecksums[trip.id] = localChecksum
          nextTripNames[trip.id] = trip.name
          continue
        }

        const remoteUpdatedValue = parseDateValue(remoteUpdatedAt ?? driveFile.modifiedTime)
        const localUpdatedValue = parseDateValue(trip.updatedAt)

        if (stopsMatch && nameChanged) {
          if (remoteUpdatedValue > localUpdatedValue && remoteName) {
            renameUpdates.push({
              tripId: trip.id,
              newName: remoteName,
              updatedAt: remoteUpdatedAt ?? driveFile.modifiedTime ?? new Date().toISOString(),
            })
            nextChecksums[trip.id] = localChecksum
            nextTripNames[trip.id] = remoteName
            continue
          }

          const uploadResult = await performUpload(trip, driveFile.id)
          nextFileMap[trip.id] = uploadResult.fileId
          nextChecksums[trip.id] = uploadResult.checksum
          nextTripNames[trip.id] = trip.name
          if (uploadResult.lastSyncedAt) {
            nextLastSyncedAtByTrip[trip.id] = uploadResult.lastSyncedAt
          }
          continue
        }

        if (remoteUpdatedValue > localUpdatedValue) {
          const remoteStops = await loadRemoteStops(driveFile.id)
          nextConflicts.push(
            buildDriveConflict({
              trip,
              file: driveFile,
              category: 'remote-newer',
              localChecksum,
              lastSyncedAt: lastSyncedAtByTrip[trip.id],
              localStops: trip.stops,
              incomingStops: remoteStops,
            }),
          )
          continue
        }

        if (remoteUpdatedValue === localUpdatedValue) {
          const remoteStops = await loadRemoteStops(driveFile.id)
          nextConflicts.push(
            buildDriveConflict({
              trip,
              file: driveFile,
              category: 'checksum-mismatch',
              localChecksum,
              lastSyncedAt: lastSyncedAtByTrip[trip.id],
              localStops: trip.stops,
              incomingStops: remoteStops,
            }),
          )
          continue
        }

        const remoteStops = await loadRemoteStops(driveFile.id)
        nextConflicts.push(
          buildDriveConflict({
            trip,
            file: driveFile,
            category: 'local-newer',
            localChecksum,
            lastSyncedAt: lastSyncedAtByTrip[trip.id],
            localStops: trip.stops,
            incomingStops: remoteStops,
          }),
        )
      }

      for (const file of driveTrips) {
        const tripId = file.appProperties?.tripId
        if (!tripId || state.trips.some((trip) => trip.id === tripId)) {
          continue
        }
        if (ignoredTripIds.has(tripId)) {
          continue
        }

        const payload = await withDriveAuthRetry(() =>
          downloadDriveFile<DriveTripPayload>(accessTokenRef.current as string, file.id),
        )
        applyDriveTrip(payload)
        nextFileMap[tripId] = file.id
      }

      saveDriveFileMap(nextFileMap)
      saveDriveChecksums(nextChecksums)
      saveDriveTripNames(nextTripNames)
      saveDriveLastSyncedAtMap(nextLastSyncedAtByTrip)

      if (renameUpdates.length > 0) {
        setTripsState((prev) => {
          const updatedTrips = prev.trips.map((trip) => {
            const rename = renameUpdates.find((item) => item.tripId === trip.id)
            if (!rename) return trip
            return {
              ...trip,
              name: rename.newName,
              updatedAt: rename.updatedAt,
            }
          })

          return {
            ...prev,
            trips: updatedTrips,
          }
        })
      }

      return {
        conflicts: nextConflicts,
        fileMap: nextFileMap,
        checksums: nextChecksums,
        tripNames: nextTripNames,
        lastSyncedAtByTrip: nextLastSyncedAtByTrip,
      }
    },
    [
      applyDriveTrip,
      checksums,
      ensureFolder,
      fileMap,
      ignoredTripIds,
      lastSyncedAtByTrip,
      performUpload,
      setTripsState,
      tripNames,
      withDriveAuthRetry,
    ],
  )

  const resolveConflictsBatch = useCallback(
    async (decisions: TripConflictDecision[]) => {
      if (!accessTokenRef.current) return

      setSyncStatus('syncing')
      setError(null)

      const resolvedIds = new Set<string>()
      let failureCount = 0
      let firstFailureMessage: string | null = null

      try {
        for (const decision of decisions) {
          const conflict = conflicts.find((c) => c.id === decision.conflictId)
          if (!conflict) continue

          const { action } = decision
          let didResolve = false

          try {
            if (action === 'ignore') {
              const tripId = conflict.local?.tripId ?? conflict.incoming?.tripId
              if (tripId) {
                setIgnoredTripIds((prev) => {
                  const next = new Set(prev)
                  next.add(tripId)
                  saveDriveIgnoredTripIds(Array.from(next))
                  return next
                })
              }
              didResolve = true
            }

            if (action === 'use-local') {
              const tripId = conflict.local?.tripId
              if (!tripId) {
                throw new Error('Missing local trip for upload.')
              }
              const trip = tripsState.trips.find((item) => item.id === tripId)
              if (!trip) {
                throw new Error('Local trip not found for upload.')
              }
              if (conflict.category === 'missing-remote') {
                const uploadResult = await performUpload(trip)
                applyUploadResult(trip, uploadResult)
              } else {
                await uploadTrip(trip)
              }
              didResolve = true
            }

            if (action === 'merge') {
              const tripId = conflict.local?.tripId
              if (!tripId) {
                throw new Error('Missing local trip for merge.')
              }
              const trip = tripsState.trips.find((item) => item.id === tripId)
              if (!trip) {
                throw new Error('Local trip not found for merge.')
              }
              const remoteStops = conflict.incoming?.stops
              if (!remoteStops) {
                throw new Error('Missing Drive stops for merge.')
              }
              const stopMergeDecisions = decision.stopMergeDecisions
              if (!stopMergeDecisions || stopMergeDecisions.length === 0) {
                throw new Error('Missing merge selections.')
              }

              const mergedStops = buildMergedStops(trip.stops, remoteStops, stopMergeDecisions)
              const mergedTrip: Trip = {
                ...trip,
                stops: mergedStops,
                updatedAt: new Date().toISOString(),
              }

              setTripsState((prev) => {
                const index = prev.trips.findIndex((item) => item.id === tripId)
                if (index === -1) return prev
                const nextTrips = [...prev.trips]
                nextTrips[index] = mergedTrip
                return {
                  ...prev,
                  trips: nextTrips,
                }
              })

              const uploadResult = await performUpload(
                mergedTrip,
                conflict.incoming?.fileId ?? undefined,
              )
              applyUploadResult(mergedTrip, uploadResult)
              didResolve = true
            }

            if (action === 'use-remote' || action === 'create-new') {
              const fileId = conflict.incoming?.fileId
              if (!fileId) {
                throw new Error('Missing Drive file for download.')
              }
              const payload = await withDriveAuthRetry(() =>
                downloadDriveFile<DriveTripPayload>(
                  accessTokenRef.current as string,
                  fileId,
                ),
              )

              if (action === 'create-new') {
                const newTrip = {
                  ...payload.trip,
                  id: createId(),
                  name: `${payload.trip.name} (${new Date().toLocaleDateString()})`,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }

                setTripsState((prev) => ({
                  ...prev,
                  trips: [...prev.trips, newTrip],
                }))

                await uploadTrip(newTrip)
              } else {
                applyDriveTrip(payload)

                const tripId = conflict.local?.tripId ?? conflict.incoming?.tripId
                if (tripId) {
                  const nextFileMap = {
                    ...fileMap,
                    [tripId]: fileId,
                  }
                  setFileMap(nextFileMap)
                  saveDriveFileMap(nextFileMap)
                }
              }

              didResolve = true
            }
          } catch (decisionError) {
            failureCount += 1
            if (!firstFailureMessage) {
              firstFailureMessage =
                decisionError instanceof Error
                  ? decisionError.message
                  : 'Unable to resolve a conflict.'
            }
          }

          if (didResolve) {
            resolvedIds.add(decision.conflictId)
          }
        }

        if (resolvedIds.size > 0) {
          setConflicts((prev) => prev.filter((c) => !resolvedIds.has(c.id)))
        }

        if (failureCount > 0) {
          setSyncStatus('error')
          setError(firstFailureMessage ?? 'Unable to resolve conflicts')
          return
        }

        setLastSyncAt(new Date().toISOString())
        setSyncStatus('idle')
      } catch (syncError) {
        setSyncStatus('error')
        setError(syncError instanceof Error ? syncError.message : 'Unable to resolve conflicts')
      }
    },
    [
      applyDriveTrip,
      applyUploadResult,
      buildMergedStops,
      conflicts,
      fileMap,
      performUpload,
      setTripsState,
      tripsState.trips,
      uploadTrip,
      withDriveAuthRetry,
    ],
  )

  const resolveConflict = useCallback(
    async (conflict: TripConflict, action: TripConflictDecision['action']) => {
      return resolveConflictsBatch([{ conflictId: conflict.id, action }])
    },
    [resolveConflictsBatch],
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
        setTripNames(result.tripNames)
        setLastSyncedAtByTrip(result.lastSyncedAtByTrip)
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
      if (!gisReady || !window.google?.accounts?.oauth2) {
        throw new Error('Google Identity Services is still loading. Please try again.')
      }

      let response = await requestAccessTokenInteractive('select_account')

      if (response.error === 'consent_required' || response.error === 'invalid_scope') {
        response = await requestAccessTokenInteractive('consent')
      }

      await applyTokenResponse(response)
      setAuthStatus('signed-in')
      await syncAll('initial')
    } catch (syncError) {
      setAuthStatus('error')
      setError(syncError instanceof Error ? syncError.message : 'Unable to sign in to Drive')
    }
  }, [applyTokenResponse, gisReady, requestAccessTokenInteractive, syncAll])

  const signOut = useCallback(async () => {
    const token = accessTokenRef.current
    if (token) {
      await revokeGoogleAccess(token)
    }

    accessTokenRef.current = null
    tokenExpiresAtRef.current = null
    folderIdRef.current = null
    clearAccessToken()
    setUserInfo(null)
    setAuthStatus('signed-out')
    setConflicts([])
    setSyncStatus('idle')
  }, [])

  useEffect(() => {
    if (!hasClientId) return
    if (silentAuthAttemptedRef.current) return
    if (accessTokenRef.current) return

    silentAuthAttemptedRef.current = true
    setAuthStatus('loading')

    void (async () => {
      try {
        const response = await withTimeout(
          requestAccessTokenSilent(),
          6000,
          'Silent sign-in blocked by the browser. Click Connect to sign in.',
        )
        if (response.error || !response.access_token) {
          setAuthStatus('signed-out')
          return
        }

        await applyTokenResponse(response)
        setAuthStatus('signed-in')
        await syncAll('initial')
      } catch (silentError) {
        if (silentError instanceof Error) {
          setError(silentError.message)
        }
        setAuthStatus('signed-out')
      }
    })()
  }, [applyTokenResponse, hasClientId, requestAccessTokenSilent, syncAll, withTimeout])

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
      const nameChanged = tripNames[trip.id] !== trip.name
      return checksums[trip.id] !== checksum || nameChanged
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
  }, [
    authStatus,
    checksums,
    conflicts.length,
    enqueueTrip,
    isOnline,
    tripNames,
    tripsState.trips,
    uploadTrip,
  ])

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
    gisReady,
    userInfo,
    signIn,
    signOut,
    syncNow,
    resolveConflict,
    resolveConflictsBatch,
  }
}

function buildDriveConflict(options: {
  trip: Trip | null
  file: DriveTripFileInfo | null
  category: TripConflict['category']
  localChecksum?: string | null
  lastSyncedAt?: string
  localStops?: TripStop[]
  incomingStops?: TripStop[]
}): TripConflict {
  const { trip, file, category, localChecksum, lastSyncedAt, localStops, incomingStops } = options

  const local: TripConflictSide | null = trip
    ? {
        label: 'Local',
        tripId: trip.id,
        name: trip.name,
        updatedAt: trip.updatedAt,
        stopCount: trip.stops.length,
        stops: localStops,
        checksum: localChecksum ?? undefined,
        lastSyncedAt,
      }
    : null

  const incoming: TripConflictSide | null = file
    ? {
        label: 'Drive',
        tripId: file.appProperties?.tripId,
        name: file.appProperties?.tripName ?? file.name,
        updatedAt: file.appProperties?.updatedAt ?? file.modifiedTime,
        stopCount: file.appProperties?.stopCount
          ? parseInt(file.appProperties.stopCount, 10)
          : undefined,
        stops: incomingStops,
        checksum: file.appProperties?.checksum,
        fileId: file.id,
        deviceId: file.appProperties?.deviceId,
        lastSyncedAt: file.appProperties?.lastSyncedAt,
      }
    : null

  const conflictId =
    category === 'missing-local'
      ? `${file?.appProperties?.tripId ?? 'unknown'}-${category}`
      : `${trip?.id ?? 'unknown'}-${category}`

  return {
    id: conflictId,
    source: 'drive',
    category,
    local,
    incoming,
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
