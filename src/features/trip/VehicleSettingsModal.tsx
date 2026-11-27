import { useEffect, type ChangeEvent } from 'react'
import { useVehicleSettingsContext } from '../../hooks/useVehicleSettings'
import {
  MPG_MAX,
  MPG_MIN,
  TANK_GALLONS_MAX,
  TANK_GALLONS_MIN,
  VEHICLE_NAME_MAX_LENGTH,
  type FuelType,
} from '../../types/api'
import type { GasPriceLookupResult } from '../../domain/gas/types'
import './StopDrawer.css'

const SYNC_STATUS_TEXT = {
  synced: 'Saved to your account',
  loading: 'Saving…',
  error: 'Saved on this device only — could not reach the server',
  local: 'Saved on this device',
} as const

type VehicleSettingsModalProps = {
  isOpen: boolean
  gasPrice?: GasPriceLookupResult
  onClose: () => void
}

export const VehicleSettingsModal = ({
  isOpen,
  gasPrice,
  onClose,
}: VehicleSettingsModalProps) => {
  const { mpg, setMpg, profile, setProfile, profileSyncStatus } =
    useVehicleSettingsContext()

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

  const handleMpgChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    if (!isNaN(value)) {
      setMpg(value)
    }
  }

  const handleTankChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    setProfile({ tankGallons: isNaN(value) ? null : value })
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
          <h2 id="settings-modal-title">Vehicle Settings</h2>
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
          <div className="form-group">
            <label htmlFor="rv-name-input">
              RV name
              <input
                id="rv-name-input"
                type="text"
                maxLength={VEHICLE_NAME_MAX_LENGTH}
                value={profile.name}
                onChange={(e) => setProfile({ name: e.target.value })}
              />
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="fuel-type-select">
              Fuel type
              <select
                id="fuel-type-select"
                value={profile.fuelType}
                onChange={(e) =>
                  setProfile({ fuelType: e.target.value as FuelType })
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
                value={mpg}
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
                value={profile.tankGallons ?? ''}
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
