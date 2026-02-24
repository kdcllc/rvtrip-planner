interface ImportTripModalProps {
  isOpen: boolean
  tripName: string
  stopCount: number
  skippedStops: number
  onMerge: () => void
  onCreateNew: () => void
  onCancel: () => void
}

export function ImportTripModal({
  isOpen,
  tripName,
  stopCount,
  skippedStops,
  onMerge,
  onCreateNew,
  onCancel,
}: ImportTripModalProps) {
  if (!isOpen) return null

  return (
    <div className="import-trip-backdrop" role="dialog" aria-modal="true">
      <div className="import-trip-modal">
        <h2>Import trip</h2>
        <p className="import-trip-subtitle">
          Choose how you want to bring in <strong>{tripName}</strong>.
        </p>
        <div className="import-trip-summary">
          <span>{stopCount} stop{stopCount === 1 ? '' : 's'} ready to import</span>
          {skippedStops > 0 ? (
            <span>
              {skippedStops} invalid stop{skippedStops === 1 ? '' : 's'} skipped
            </span>
          ) : null}
        </div>
        <div className="import-trip-actions">
          <button className="ghost" type="button" onClick={onMerge}>
            Merge into current trip
          </button>
          <button className="ghost" type="button" onClick={onCreateNew}>
            Create new trip
          </button>
          <button className="ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
