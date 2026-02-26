export type TripConflictSource = 'drive' | 'import'

export type TripConflictCategory =
  | 'remote-newer'
  | 'local-newer'
  | 'missing-remote'
  | 'missing-local'
  | 'checksum-mismatch'

export type TripConflictAction =
  | 'use-local'
  | 'use-remote'
  | 'merge'
  | 'create-new'
  | 'ignore'

export type TripConflictSide = {
  label: string
  tripId?: string
  name?: string
  updatedAt?: string
  stopCount?: number
  checksum?: string
  fileId?: string
  deviceId?: string
  lastSyncedAt?: string
}

export type TripConflict = {
  id: string
  source: TripConflictSource
  category: TripConflictCategory
  local: TripConflictSide | null
  incoming: TripConflictSide | null
}

export type TripConflictDecision = {
  conflictId: string
  action: TripConflictAction
}
