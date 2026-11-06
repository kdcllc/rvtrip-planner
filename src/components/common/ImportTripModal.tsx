import { useId, useState, type ChangeEvent } from 'react'
import type { Trip } from '../../domain/trip/types'
import { parseImportFile } from '../../services/tripFile/tripFile'

type ImportOutcome = { ok: true } | { ok: false; error: string }

interface ImportTripModalProps {
  isOpen: boolean
  /** Imports the parsed trips into the account; resolves with the outcome. */
  onImport: (trips: Trip[]) => Promise<ImportOutcome>
  onClose: () => void
}

const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Unable to read that file.'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsText(file)
  })

// Mounted only while open, so every opening starts with clean state.
export function ImportTripModal({ isOpen, onImport, onClose }: ImportTripModalProps) {
  if (!isOpen) return null
  return <ImportTripDialog onImport={onImport} onClose={onClose} />
}

function ImportTripDialog({ onImport, onClose }: Omit<ImportTripModalProps, 'isOpen'>) {
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [error, setError] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const titleId = useId()

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setTrips(null)
    setError('')
    if (!file) return
    try {
      const raw: unknown = JSON.parse(await readFileText(file))
      const parsed = parseImportFile(raw)
      if (parsed.ok) setTrips(parsed.trips)
      else setError(parsed.error)
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? 'That file does not contain valid trip data.'
          : err instanceof Error
            ? err.message
            : 'Unable to import that file.',
      )
    }
  }

  const handleImport = async () => {
    if (!trips || isImporting) return
    setIsImporting(true)
    setError('')
    const outcome = await onImport(trips)
    setIsImporting(false)
    if (outcome.ok) onClose()
    else setError(outcome.error)
  }

  return (
    <div
      className="import-trip-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="import-trip-modal">
        <h2 id={titleId}>Import trips</h2>
        <p className="import-trip-subtitle">
          Choose a trip file or a backup of all your trips. They are added to your account.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          aria-label="Trip file"
          onChange={(event) => void handleFileChange(event)}
        />
        {trips ? (
          <div className="import-trip-summary">
            <span>
              {trips.length} trip{trips.length === 1 ? '' : 's'} ready to import
            </span>
            <ul>
              {trips.map((trip) => (
                <li key={trip.id}>
                  {trip.name} ({trip.stops.length} stop{trip.stops.length === 1 ? '' : 's'})
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <p className="import-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="import-trip-actions">
          <button
            className="ghost"
            type="button"
            onClick={() => void handleImport()}
            disabled={!trips || isImporting}
          >
            {isImporting ? 'Importing...' : 'Import'}
          </button>
          <button className="ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
