import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useVehicleSettingsContext } from '../../hooks/useVehicleSettings'
import {
  MPG_MAX,
  MPG_MIN,
  TANK_GALLONS_MAX,
  TANK_GALLONS_MIN,
  VEHICLE_NAME_MAX_LENGTH,
  VEHICLES_MAX,
  type FuelType,
} from '../../types/api'
import type { GasPriceLookupResult } from '../../domain/gas/types'
import { getDefaultVehicle } from '../../domain/vehicle/garage'
import './StopDrawer.css'
import './VehicleSettingsModal.css'

const SYNC_STATUS_TEXT = {
  synced: 'Saved to your account',
  loading: 'Saving…',
  error: 'Saved on this device only — could not reach the server',
  local: 'Saved on this device',
} as const

type VehicleSettingsModalProps = {
  isOpen: boolean
  selectedVehicleId?: string
  gasPrice?: GasPriceLookupResult
  onClose: () => void
}

const FUEL_LABEL: Record<FuelType, string> = {
  gasoline: 'Gasoline',
  diesel: 'Diesel',
}

export const VehicleSettingsModal = ({
  isOpen,
  selectedVehicleId,
  gasPrice,
  onClose,
}: VehicleSettingsModalProps) => {
  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  // Focus management
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        const mpgInput = document.querySelector(
          '.vehicle-settings-modal-content input'
        ) as HTMLInputElement
        if (mpgInput) {
          mpgInput.focus()
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  // The body mounts on each open, so its selection state starts fresh.
  return (
    <VehicleSettingsBody
      initialVehicleId={selectedVehicleId}
      gasPrice={gasPrice}
      onClose={onClose}
    />
  )
}

type VehicleSettingsBodyProps = {
  initialVehicleId?: string
  gasPrice?: GasPriceLookupResult
  onClose: () => void
}

const VehicleSettingsBody = ({
  initialVehicleId,
  gasPrice,
  onClose,
}: VehicleSettingsBodyProps) => {
  const {
    garage,
    addVehicle,
    updateVehicle,
    removeVehicle,
    setDefaultVehicle,
    profileSyncStatus,
  } = useVehicleSettingsContext()
  const [pickedId, setPickedId] = useState<string | undefined>(initialVehicleId)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const listButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<'delete' | 'list' | null>(null)

  const defaultVehicle = getDefaultVehicle(garage)
  const selected =
    garage.vehicles.find((vehicle) => vehicle.id === pickedId) ?? defaultVehicle
  const isDefault = selected.id === garage.defaultVehicleId
  const isOnlyVehicle = garage.vehicles.length <= 1
  const atMax = garage.vehicles.length >= VEHICLES_MAX
  const confirming = confirmingId === selected.id && !isOnlyVehicle
  const selectedLabel = selected.name || 'Unnamed vehicle'

  const handleMpgChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    if (!isNaN(value)) {
      updateVehicle(selected.id, { mpg: value })
    }
  }

  const handleTankChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    updateVehicle(selected.id, { tankGallons: isNaN(value) ? null : value })
  }

  // Focus targets mount after the state change, so focus once they exist.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target === 'delete') {
      deleteButtonRef.current?.focus()
    } else {
      listButtonRefs.current.get(selected.id)?.focus()
    }
  })

  const handleAdd = () => {
    const id = addVehicle()
    if (id) {
      setPickedId(id)
      setConfirmingId(null)
    }
  }

  const handleDelete = () => {
    pendingFocus.current = 'list'
    removeVehicle(selected.id)
    setPickedId(undefined)
    setConfirmingId(null)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="stop-drawer-backdrop"
        onClick={onClose}
        role="presentation"
      />

      {/* Modal */}
      <div
        className="stop-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="stop-drawer-header">
          <h2 id="settings-modal-title">Vehicles</h2>
          <button
            className="stop-drawer-close"
            onClick={onClose}
            aria-label="Close settings"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="vehicle-settings-modal-content stop-drawer-content">
          <ul className="vehicle-list" aria-label="Your vehicles">
            {garage.vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <button
                  ref={(node) => {
                    if (node) listButtonRefs.current.set(vehicle.id, node)
                    else listButtonRefs.current.delete(vehicle.id)
                  }}
                  type="button"
                  className="vehicle-list-item"
                  aria-pressed={vehicle.id === selected.id}
                  onClick={() => {
                    setPickedId(vehicle.id)
                    setConfirmingId(null)
                  }}
                >
                  <span className="vehicle-list-name">
                    {vehicle.name || 'Unnamed vehicle'}
                  </span>
                  <span className="vehicle-list-summary muted">
                    {FUEL_LABEL[vehicle.fuelType]} · {vehicle.mpg} MPG
                  </span>
                  {vehicle.id === garage.defaultVehicleId && (
                    <span className="vehicle-badge">Default</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="vehicle-action"
            onClick={handleAdd}
            disabled={atMax}
          >
            Add vehicle
          </button>
          {atMax && (
            <p className="muted vehicle-helper">
              You can keep up to {VEHICLES_MAX} vehicles.
            </p>
          )}

          <div className="form-group">
            <label htmlFor="rv-name-input">
              RV name
              <input
                id="rv-name-input"
                type="text"
                maxLength={VEHICLE_NAME_MAX_LENGTH}
                value={selected.name}
                onChange={(e) =>
                  updateVehicle(selected.id, { name: e.target.value })
                }
              />
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="fuel-type-select">
              Fuel type
              <select
                id="fuel-type-select"
                value={selected.fuelType}
                onChange={(e) =>
                  updateVehicle(selected.id, {
                    fuelType: e.target.value as FuelType,
                  })
                }
              >
                <option value="gasoline">Gasoline</option>
                <option value="diesel">Diesel</option>
              </select>
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="mpg-input">
              Miles Per Gallon (MPG)
              <input
                id="mpg-input"
                type="number"
                min={MPG_MIN}
                max={MPG_MAX}
                step="0.5"
                value={selected.mpg}
                onChange={handleMpgChange}
                aria-label="Vehicle MPG"
              />
            </label>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: '4px' }}>
              Used to calculate estimated fuel costs for your trip.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="tank-gallons-input">
              Fuel tank (gallons)
              <input
                id="tank-gallons-input"
                type="number"
                min={TANK_GALLONS_MIN}
                max={TANK_GALLONS_MAX}
                step="1"
                value={selected.tankGallons ?? ''}
                onChange={handleTankChange}
              />
            </label>
          </div>

          <p
            role="status"
            className="muted"
            style={{ fontSize: '0.9rem', marginTop: '4px' }}
          >
            {SYNC_STATUS_TEXT[profileSyncStatus]}
          </p>

          <div className="vehicle-actions">
            {!isDefault && (
              <button
                type="button"
                className="vehicle-action"
                onClick={() => setDefaultVehicle(selected.id)}
              >
                Set as default
              </button>
            )}
            {!confirming && (
              <button
                ref={deleteButtonRef}
                type="button"
                className="vehicle-action vehicle-action-danger"
                disabled={isOnlyVehicle}
                title={isOnlyVehicle ? 'Keep at least one vehicle' : undefined}
                onClick={() => setConfirmingId(selected.id)}
              >
                Delete vehicle
              </button>
            )}
          </div>
          {isOnlyVehicle && (
            <p className="muted vehicle-helper">Keep at least one vehicle</p>
          )}
          {confirming && (
            <div className="vehicle-confirm" role="alert">
              <p>
                Delete {selectedLabel}? Trips that use it will switch to your
                default vehicle.
              </p>
              <div className="vehicle-actions">
                <button
                  type="button"
                  className="vehicle-action vehicle-action-danger"
                  onClick={handleDelete}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="vehicle-action"
                  onClick={() => {
                    pendingFocus.current = 'delete'
                    setConfirmingId(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {gasPrice && (
            <div className="form-group">
              <label>Current Gas Price</label>
              <div
                style={{
                  padding: '12px',
                  backgroundColor: 'var(--color-surface-strong)',
                  borderRadius: '12px',
                }}
              >
                <p style={{ margin: '0 0 4px 0', fontWeight: 500 }}>
                  ${gasPrice.pricePerGallon.toFixed(2)} per gallon
                </p>
                <p className="muted" style={{ margin: '4px 0 0 0', fontSize: '0.85rem' }}>
                  Source: {gasPrice.source}
                </p>
                {gasPrice.error && (
                  <p className="form-error" style={{ margin: '4px 0 0 0', fontSize: '0.85rem' }}>
                    {gasPrice.error}
                  </p>
                )}
              </div>
            </div>
          )}

          {!gasPrice && (
            <div className="form-group">
              <p className="muted">
                Gas price information not available. Make sure your trip has a starting location.
              </p>
            </div>
          )}
        </div>

        <div className="stop-drawer-footer">
          <div className="footer-actions-right">
            <button className="primary" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
