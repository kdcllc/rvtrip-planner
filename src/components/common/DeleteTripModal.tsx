interface DeleteTripModalProps {
  isOpen: boolean
  tripName: string
  stopCount: number
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteTripModal({
  isOpen,
  tripName,
  stopCount,
  onConfirm,
  onCancel,
}: DeleteTripModalProps) {
  if (!isOpen) return null

  return (
    <div className="delete-trip-backdrop" role="dialog" aria-modal="true">
      <div className="delete-trip-modal">
        <h2>Delete trip?</h2>
        <p className="delete-trip-subtitle">
          Are you sure you want to delete <strong>{tripName}</strong>?
        </p>
        <div className="delete-trip-summary">
          <span className="delete-trip-warning">
            ⚠ This will permanently delete {stopCount} stop{stopCount === 1 ? '' : 's'} and all trip data.
          </span>
          <span>This action cannot be undone.</span>
        </div>
        <div className="delete-trip-actions">
          <button className="ghost delete-confirm" type="button" onClick={onConfirm}>
            Delete trip
          </button>
          <button className="ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
