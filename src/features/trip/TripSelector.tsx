import { useState, useRef, useEffect } from 'react'
import type { TripsState } from '../../domain/trip/types'
import { getTripsSortedByRecent } from '../../services/storage/tripStorage'

interface TripSelectorProps {
  tripsState: TripsState
  onSelectTrip: (tripId: string) => void
  onCreateTrip: (name: string) => void
  onRequestDelete: (tripId: string) => void
  onRenameTrip: (tripId: string, newName: string) => void
}

export function TripSelector({
  tripsState,
  onSelectTrip,
  onCreateTrip,
  onRequestDelete,
  onRenameTrip,
}: TripSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [newTripName, setNewTripName] = useState('')
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [editTripName, setEditTripName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setIsCreatingNew(false)
        setEditingTripId(null)
        setEditTripName('')
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Focus input when creating new trip
  useEffect(() => {
    if (isCreatingNew && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isCreatingNew])

  useEffect(() => {
    if (editingTripId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingTripId])

  const currentTrip = tripsState.trips.find((t) => t.id === tripsState.currentTripId)
  const sortedTrips = getTripsSortedByRecent(tripsState.trips)

  const handleCreateTrip = () => {
    if (newTripName.trim()) {
      onCreateTrip(newTripName.trim())
      setNewTripName('')
      setIsCreatingNew(false)
    }
  }

  const handleStartEdit = (tripId: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingTripId(tripId)
    setEditTripName(name)
  }

  const handleCancelEdit = () => {
    setEditingTripId(null)
    setEditTripName('')
  }

  const handleConfirmEdit = (tripId: string, originalName: string) => {
    const trimmed = editTripName.trim()
    if (!trimmed || trimmed === originalName) {
      handleCancelEdit()
      return
    }

    onRenameTrip(tripId, trimmed)
    handleCancelEdit()
  }

  const handleDeleteClick = (tripId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onRequestDelete(tripId)
  }

  const handleSelectTrip = (tripId: string) => {
    if (currentTrip?.id !== tripId) {
      onSelectTrip(tripId)
    }
    setIsOpen(false)
  }

  return (
    <div className="trip-selector-container">
      <label htmlFor="trip-select" className="trip-selector-label">
        Current Trip:
      </label>
      <div className="trip-selector" ref={dropdownRef}>
        <button
          id="trip-select"
          className="trip-selector-button"
          onClick={() => setIsOpen(!isOpen)}
        >
          {currentTrip ? currentTrip.name : 'No trips yet'}
          <span className="trip-selector-arrow">{isOpen ? '▼' : '▶'}</span>
        </button>

        {isOpen && (
          <div className="trip-selector-dropdown">
            {sortedTrips.length === 0 ? (
              <div className="trip-selector-empty">No trips yet. Create one to get started!</div>
            ) : (
              <ul className="trip-selector-list">
                {sortedTrips.map((trip) => (
                  <li key={trip.id} className="trip-selector-item">
                    <div className="trip-selector-item-content">
                      {editingTripId === trip.id ? (
                        <div className="trip-selector-editing">
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editTripName}
                            onChange={(e) => setEditTripName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleConfirmEdit(trip.id, trip.name)
                              } else if (e.key === 'Escape') {
                                handleCancelEdit()
                              }
                            }}
                            onBlur={handleCancelEdit}
                            aria-label="Rename trip"
                            className="trip-selector-edit-input"
                          />
                          <span className="trip-selector-item-stops">
                            ({trip.stops.length} {trip.stops.length === 1 ? 'stop' : 'stops'})
                          </span>
                        </div>
                      ) : (
                        <button
                          className={`trip-selector-item-button ${
                            currentTrip?.id === trip.id ? 'active' : ''
                          }`}
                          onClick={() => handleSelectTrip(trip.id)}
                        >
                          {trip.name}
                          <span className="trip-selector-item-stops">
                            ({trip.stops.length} {trip.stops.length === 1 ? 'stop' : 'stops'})
                          </span>
                        </button>
                      )}
                      <button
                        className="trip-selector-delete-button"
                        onClick={(e) => handleDeleteClick(trip.id, e)}
                        title="Delete trip"
                        aria-label="Delete trip"
                      >
                        ×
                      </button>
                      {editingTripId !== trip.id && (
                        <button
                          className="trip-selector-rename-button"
                          onClick={(e) => handleStartEdit(trip.id, trip.name, e)}
                          title="Rename trip"
                          aria-label="Rename trip"
                        >
                          Rename
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {!isCreatingNew && (
              <button
                className="trip-selector-new-button"
                onClick={() => setIsCreatingNew(true)}
              >
                + New Trip
              </button>
            )}

            {isCreatingNew && (
              <div className="trip-selector-create">
                <input
                  ref={inputRef}
                  type="text"
                  value={newTripName}
                  onChange={(e) => setNewTripName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateTrip()
                    } else if (e.key === 'Escape') {
                      setIsCreatingNew(false)
                      setNewTripName('')
                    }
                  }}
                  placeholder="Enter trip name..."
                  className="trip-selector-input"
                />
                <button
                  onClick={handleCreateTrip}
                  disabled={!newTripName.trim()}
                  className="trip-selector-create-button"
                >
                  Create
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
